# System design and tradeoffs

## Components and where they run

| Namespace | Workload | Kind | Exposed | Storage |
|---|---|---|---|---|
| `store` | WordPress + WooCommerce (Apache) | Deployment, `Recreate` | Ingress `store.<domain>` | PVC 2 Gi (`/var/www/html`) |
| `store` | MariaDB 11.4 | StatefulSet | ClusterIP only | PVC 2 Gi |
| `store` | woo-mcp | Deployment | **ClusterIP only, no Ingress** | none |
| `store` | bootstrap | Job (Helm post-install/upgrade hook) | — | mounts the WordPress PVC |
| `mcp` | MCP reference server ("everything") | Deployment | ClusterIP only | none |
| `gateway` | gateway (FastAPI + MCP SDK) | Deployment, 2 replicas | Ingress `dash.<domain>/api`, `/mcp` | none (state in Postgres) |
| `gateway` | Postgres 17 | StatefulSet | ClusterIP only | PVC 1 Gi |
| `gateway` | dashboard (nginx, static React build) | Deployment | Ingress `dash.<domain>/` | none |

Every container has readiness and liveness probes plus CPU/memory requests and limits (see each chart's `values.yaml`). WordPress also has a startup probe, because its first boot copies WordPress onto the volume and would otherwise be killed by its liveness probe.

**Why woo-mcp lives in the store's namespace.** Secrets cannot be read across namespaces, and woo-mcp needs the WooCommerce API key that the store's bootstrap Job registers. Shipping woo-mcp inside the store chart also means one store = one Helm release = its own MCP server, which is the shape the multi-store bonus would need.

**Why one dashboard host.** `/api` and `/mcp` go to the gateway and `/` to the dashboard on the same hostname. The browser sees one origin: no CORS, and the session cookie works without cross-site settings.

## How the store is set up (no manual steps)

1. Helm generates every store credential into the `store-secrets` Secret on first install (DB passwords, WordPress admin password, WooCommerce consumer key and secret). `lookup` reads the existing Secret on upgrade, so values stay stable, and the Secret is kept on uninstall because the database volume outlives the release.
2. The official WordPress image writes `wp-config.php` from environment variables. `WP_HOME`/`WP_SITEURL` come from Helm values, because WordPress otherwise stores its URL in the database and a VPS deploy would redirect to `localhost`.
3. A post-install/post-upgrade Job runs WP-CLI against the same volume: install WordPress, install and activate WooCommerce, run DB migrations, set timezone and currency, turn off "coming soon" mode, disable shipping (so checkout needs no shipping zones), enable Cash on delivery, and insert the WooCommerce REST API key (HMAC-hashed exactly as WooCommerce stores it). It is idempotent and safe to re-run.

## How woo-mcp talks to the store, and why

**Choice: the WooCommerce REST API (`/wp-json/wc/v3`) over the in-cluster WordPress Service.**

- It is the supported, versioned interface, and it runs WooCommerce's own validation and hooks (stock levels, order-status emails). Writing to the database directly would bypass all of that.
- WP-CLI would mean exec'ing into the WordPress pod from another pod: Kubernetes RBAC for `pods/exec` plus a shell on the store, a much larger blast radius than one HTTP API key.
- Traffic never leaves the cluster; woo-mcp's NetworkPolicy only allows egress to its own WordPress (and DNS).

**Detail that matters:** WooCommerce accepts HTTP Basic auth only over HTTPS. Inside the cluster we use plain HTTP, so woo-mcp signs every request with OAuth 1.0a (HMAC-SHA256). WooCommerce verifies the signature against its own **home URL** (`http://store.localtest.me`), not the host it was reached on, so woo-mcp signs for the public URL but sends the request to the internal Service (`woo_client.py`). The key is read-write and belongs to the store's admin user; woo-mcp exposes only five operations on top of it.

## The gateway

### One endpoint, many servers
The gateway is an MCP **server** (one Streamable HTTP endpoint, `/mcp`) and an MCP **client** of every registered upstream. It uses the low-level `Server` from the MCP Python SDK, because its tool list is not known at import time.

### Naming and collisions: `<slug>__<tool>`
Every tool is exposed as `<server slug>__<tool name>`, e.g. `woo__list_orders`. Slugs are unique, 2–16 characters of `[a-z0-9]`, and cannot contain `_`, so splitting on the first `__` is unambiguous and names fit the 64-character limit most model APIs impose. Two servers with a `search` tool become `github__search` and `docs__search`.

*Rejected alternative:* prefix only on collision. It keeps names shorter, but a tool's name would change when an unrelated server is added, which silently breaks clients and saved prompts. Stable names win.

Each description is also prefixed with the server's display name (`[WooCommerce] List orders…`) so the model, and the human reading the chat trace, always sees which server owns a tool.

### Request path of a `tools/call`
1. **Auth** (`MCPAuth`, ASGI middleware in front of the SDK): `Authorization: Bearer urumi_…` → SHA-256 → one indexed lookup in `api_keys` joined to `users`. Missing, unknown or revoked → HTTP 401 before any MCP processing; a revoked key's attempt is still written to the audit log. The user is attached to the request scope.
2. **Resolve** (`registry.resolve`): split the name, load the server row, then refuse if the server is disabled, quarantined, already known to be unreachable (fail fast), doesn't have that tool, or the tool's policy requires a higher role.
3. **Forward** (`upstream.call_tool`): open a Streamable HTTP client session to the upstream with its credential added as a header, call the tool, all inside a timeout (20 s by default).
4. **Audit**: user, via (`mcp` or `chat`), server, tool, duration, outcome (`success`, `error`, `timeout`, `unreachable`, `denied`, `rejected`) and error text, in a `finally` block so every path is recorded.
5. The upstream's result is returned unchanged, including `isError`.

### Aggregation and failure handling
A background loop checks every server every 5 s (`registry.health_loop`). Each server is checked independently with its own 10 s timeout, so a slow remote server (GitHub needs about 4 s from here) never delays noticing that a local pod died. A check lists the server's tools and caches them in Postgres with the status:

- **`tools/list` is served from that cache**, so listing never waits on an upstream and a dead upstream cannot slow it down. It returns the tools of servers that are enabled, connected and not quarantined, filtered by the caller's role.
- **A dead server** goes `unreachable` within one interval (tested: about 4 s after scaling it to zero), drops out of the tool list, and calls to it fail in milliseconds with the reason (`connection refused`, `timed out`, …) instead of hanging. Other servers are unaffected. It recovers on its own at the next successful check.
- **A slow server** is bounded by the call timeout and returns a clear error result.

### Stateless sessions, and why there is no `list_changed` push
The gateway's MCP endpoint is **stateless**: every request carries its own auth and is handled on its own. That is what makes revocation apply to the very next request, lets any of the gateway replicas serve any request, and matches MCP's 2026-07-28 protocol revision, which removed the `initialize` handshake and `Mcp-Session-Id` in favour of self-contained requests. Older clients that still do the handshake are served statelessly too.

*Tradeoff:* without a long-lived session the gateway cannot push `notifications/tools/list_changed`. When an admin disables a server, its tools vanish from the next `tools/list`, and calls to them are refused immediately, but a client that cached the list shows the stale tools until it re-lists (reconnect, or "List tools" in Inspector). Correctness is enforced on the call path; freshness of a client's cached list is best-effort.

Upstream connections are short-lived (opened per call/check). That adds a few round trips per call, but a restarted or dead upstream can never leave a broken pooled session behind. Pooling per upstream is the obvious next optimisation.

### Credentials
- **Gateway API keys**: `urumi_` + 32 random bytes, shown once, stored as SHA-256. A slow hash (bcrypt/argon2) protects *guessable* secrets; these are 256-bit random values, so there is nothing to brute-force, and a fast hash keeps per-request auth to one indexed lookup.
- **Dashboard passwords**: scrypt (they *are* guessable).
- **Upstream credentials**: Fernet-encrypted in Postgres with a key derived from `GATEWAY_SECRET_KEY` (a Kubernetes Secret), decrypted only in `upstream.py` at the moment of the outbound call, never returned by any API (`has_credential: true` is all the dashboard sees). Seeded servers re-sync their credential from the Secret on every start, so rotating a token is "update the Secret, `helm upgrade`".
- **Chat agent**: a 5-minute signed token for the logged-in user, minted per chat turn.

### The chat agent
The agent is a real MCP client of the gateway's own `/mcp`, authenticated as the signed-in user with the short-lived token. It never calls the registry or an upstream directly, so it gets exactly that user's tool list and permission checks, and its calls are audited under that user with `via = chat`. The LLM is any OpenAI-compatible chat-completions API (Groq's free tier by default), configured through Helm values, with the key in a Secret.

**Many tools (stand-out #4).** Sending every tool's schema with every request costs about 5.8k tokens for 37 tools and grows with every server. The agent instead offers the model one `search_tools` tool plus the tools that (a) match the user's message, (b) the model found by searching, or (c) were used earlier in the conversation. Ranking is keyword scoring over names and descriptions (`toolsearch.py`): no embeddings, no extra service, explainable. If the model calls a real tool it has not loaded yet, the agent loads it and asks again. Rate-limit responses (429) are retried after the delay the provider asks for.

### Permissions (stand-out #2)
`tool_policies` holds a minimum role per (server, tool); no row means any member may use it. The store's write tools (`create_product`, `update_order_status`) are admin-only by default. A restricted tool is removed from that user's `tools/list` **and** refused in `resolve()` if called directly, so hiding is not the only control.

### Quarantine on changed tool definitions
Every health check fingerprints the server's tool names, descriptions and input schemas. If the fingerprint changes after registration, the server is quarantined: hidden from all lists and refused on calls until an admin reviews the new definitions in the dashboard and approves them (or disables the server). See the threat model.

## What changes for production

| Concern | Local | Production | How |
|---|---|---|---|
| DNS | `*.localtest.me` → 127.0.0.1 | A records for `store.` and `dash.` → VPS IP | `store.domain`, `domain` values |
| Ingress | Traefik (bundled with k3d/k3s), port 80 | same Traefik, ports 80/443 | `ingress.className` |
| TLS | off | cert-manager + Let's Encrypt (HTTP-01) | `ingress.tls.enabled`, issuer annotation, `deploy/cluster-issuer.yaml` |
| Storage class | `local-path` | `local-path` on single-node k3s; a cloud disk class on managed Kubernetes | `storage.storageClass`, `postgres.storageClass` |
| Images | built locally, `k3d image import` | GHCR, built by GitHub Actions for amd64 + arm64 | `*.image`, `pullPolicy: Always` |
| Secrets | generated by Helm + gitignored `secrets.local.yaml` | same; for a team, an external secret store (Sealed Secrets / External Secrets) instead of a local file | `charts/*/templates/secret.yaml` |
| Cookies | not `Secure` | `Secure` automatically when the public URL is https | `config.COOKIE_SECURE` |

## Known limits and what I would do next

- **Single-node storage.** `ReadWriteOnce` volumes and `Recreate` for WordPress mean a store upgrade has a short blip. A managed database and shared file storage would remove it.
- **Health checks run in every gateway replica.** Harmless (idempotent writes), but wasteful; a Postgres advisory lock would elect one checker.
- **No per-user rate limits** on `/mcp` yet; the natural place is the auth middleware, keyed by API key.
- **Tool search is keyword-based.** It is enough for tens of tools; for hundreds, embed descriptions and rank by similarity.
- **Admin-added in-cluster servers** are allowed only under the `store` and `mcp` namespaces (SSRF allowlist); the gateway's own namespace (Postgres) is deliberately excluded.
