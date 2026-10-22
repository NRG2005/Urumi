# Urumi: WooCommerce hosting with a team MCP gateway, on Kubernetes

A WooCommerce store, an MCP server for it, and a **team MCP gateway** with a React dashboard and a chat agent, all running on Kubernetes and installed with Helm.

An admin connects MCP servers once in the dashboard. Every team member then gets **all** of those tools through **one MCP endpoint and one personal API key**, from Claude Code, Cursor, MCP Inspector, or the chat agent built into the dashboard. Members never see the upstream servers' credentials, and every tool call is audited.

```
                     Claude Code / Cursor (user B)          Browser (user A)
                                │ Bearer urumi_…                 │ session cookie
                                ▼                                ▼
 ┌────────────────────── Traefik Ingress ── dash.localtest.me ──────────────┐   store.localtest.me
 │  ns: gateway                                                             │          │
 │   /mcp ─► Gateway (2 replicas, FastAPI + MCP SDK) ◄─ /api ── Dashboard   │          │
 │            │  auth → resolve "slug__tool" → permission → route → audit   │          │
 │            │  chat agent = MCP client of its own /mcp, as the user       │          │
 │            ├─ Postgres: users, hashed keys, servers, encrypted creds, audit log      │
 └────────────┼─────────────────────────────────────────────────────────────┘          │
              │ MCP (Streamable HTTP), credential injected server-side                 │
   ┌──────────┼───────────────────────┬──────────────────────────────┐                 │
   ▼ ns: store│                       ▼ ns: mcp                      ▼ internet         ▼
 woo-mcp ─► WordPress + WooCommerce ◄─┘ "everything" reference     GitHub's hosted   Shoppers
 (ClusterIP only)   │                   server (kill-the-pod demo)  MCP server (PAT)
                 MariaDB
```

| Layer | What it is | Code |
|---|---|---|
| Store | WordPress 7.1 + WooCommerce + MariaDB, bootstrapped by a WP-CLI Job | [`charts/store`](charts/store) |
| WooCommerce MCP server | 5 tools over Streamable HTTP, written from scratch | [`services/woo-mcp`](services/woo-mcp) |
| Gateway | Aggregating MCP server + REST API + chat agent | [`services/gateway`](services/gateway) |
| Dashboard | React (Vite) app served by nginx | [`dashboard`](dashboard) |
| Other upstreams | MCP reference server (in-cluster), GitHub MCP (hosted, needs a token) | [`charts/everything`](charts/everything), [`charts/gateway/values.yaml`](charts/gateway/values.yaml) |

**Further reading:** [System design and tradeoffs](docs/design.md) · [Threat model](docs/threat-model.md) · [What broke and what I learned](docs/lessons.md) · [Upgrades and rollback](docs/upgrades.md)

---

## Run it locally

**You need:** Docker Desktop (give it 8 GB of memory), `k3d`, `helm` (v3 or v4), `kubectl`, `make`, Python 3.11+.

```bash
brew install k3d helm kubectl
```

**1. Secrets (never committed).** Copy the template and fill in an LLM key for the chat agent and, optionally, a GitHub token for the GitHub upstream:

```bash
cp charts/gateway/secrets.example.yaml charts/gateway/secrets.local.yaml
```

```yaml
llm:
  apiKey: "gsk_…"                  # any OpenAI-compatible API; Groq's free tier works
upstreams:
  credentials:
    GITHUB_TOKEN: "github_pat_…"   # fine-grained PAT, Issues: read & write on one repo
```

Without a GitHub token the GitHub server is simply not registered; without an LLM key the chat agent says so and everything else works.

**2. Create the cluster and install everything:**

```bash
make cluster
make up
```

`make up` builds the five images, imports them into k3d (no registry needed locally) and installs three Helm releases: `store` (namespace `store`), `everything` (namespace `mcp`) and `gateway` (namespace `gateway`). The first run takes a few minutes while WordPress and WooCommerce are set up.

**3. Open it:**

| What | URL | Login |
|---|---|---|
| Storefront | http://store.localtest.me | — |
| WooCommerce admin | http://store.localtest.me/wp-admin | `admin` / `make store-password` |
| Dashboard | http://dash.localtest.me | `admin@urumi.local` / `make admin-password` |

**Local domains.** `*.localtest.me` is public DNS that resolves to `127.0.0.1`, so no `/etc/hosts` edits are needed. k3d maps ports 80/443 on your machine to Traefik inside the cluster, which routes by hostname. On a VPS the same Ingress objects use real domain names from `values-prod.yaml`.

**4. Check every Definition-of-Done item automatically:**

```bash
make test-dod
```

It creates two fresh users and runs 24 checks against the live cluster: checkout through the storefront, chat agent as user A, MCP client as user B, revocation, disabling a server, killing an upstream pod, and audit attribution. Add `ARGS=--skip-llm` to skip the LLM calls.

---

## Using it

### Place an order
Open http://store.localtest.me/shop/, add a product to the cart, check out with **Cash on delivery**. The order appears in WooCommerce → Orders.

### Invite a teammate and get an API key
In the dashboard: **Team → Invite a teammate** creates a one-time invite link (7 days). The teammate opens it, sets a password, and goes to **API keys & connect → Generate key**. The key is shown once and stored only as a SHA-256 hash.

### Connect an external MCP client
The gateway URL is `http://dash.localtest.me/mcp` (Streamable HTTP). With a key:

```bash
claude mcp add --transport http urumi http://dash.localtest.me/mcp --header "Authorization: Bearer urumi_…"
```

Cursor (`~/.cursor/mcp.json`):

```json
{ "mcpServers": { "urumi": { "url": "http://dash.localtest.me/mcp", "headers": { "Authorization": "Bearer urumi_…" } } } }
```

MCP Inspector: `npx @modelcontextprotocol/inspector`, transport **Streamable HTTP**, URL as above, header `Authorization: Bearer urumi_…`.

Tools appear as `<server>__<tool>`, for example `woo__list_orders` and `github__issue_write`. Try: *"Summarise today's orders and open a GitHub issue in OWNER/REPO with the summary."*

### Use the chat agent
Dashboard → **Chat agent**. It acts as the signed-in user, calls tools through the gateway's own `/mcp` endpoint, and shows every tool call it made. Its calls appear in the audit log under your name with `via = chat agent`.

### Manage servers
Dashboard → **MCP servers**: status (Connected / Unreachable / Disabled / Quarantined), every tool with its read/write kind, and per-tool access (Everyone / Admins only). Admins can add a server by URL with an optional bearer token or custom header, edit, disable, or remove it.

---

## Production on a VPS (k3s)

**Live deployment:** https://store.4.194.18.91.sslip.io and https://dash.4.194.18.91.sslip.io: an Azure B2as_v2 VM (2 vCPU, 8 GB, Ubuntu 24.04) running single-node k3s, deployed with the same charts and `values-prod.yaml`. `make vps-test` runs the full Definition-of-Done check against it (24/24).

What changes between local and production, all through Helm values:

| | Local (`values-local.yaml`) | VPS (`values-prod.yaml`) |
|---|---|---|
| Domains | `store.localtest.me`, `dash.localtest.me` | `store.<IP>.sslip.io`, `dash.<IP>.sslip.io` (sslip.io resolves to the IP in the name, so no DNS setup); with a real domain, an A record per host |
| TLS | none | cert-manager + Let's Encrypt (HTTP-01), `cert-manager.io/cluster-issuer` annotation; http → https redirect in Traefik |
| Images | built locally, imported with `k3d image import` | `ghcr.io/nrg2005/urumi-*` built for amd64 + arm64 by [CI](.github/workflows/images.yml), `pullPolicy: Always` |
| Storage | `local-path`, 1–2 Gi | `local-path` (k3s), 5 Gi; swap the storage class for a cloud disk on a managed cluster |
| Secrets | generated by Helm, LLM/GitHub keys from `secrets.local.yaml` | same mechanism; the file lives only on the machine running `helm` |
| Cookies | plain | `Secure` (set automatically when the public URL is https) |

**How it was set up** (VM firewall open on 22, 80, 443 only):

```bash
# 1. on the VM: install k3s (Traefik, local-path storage and NetworkPolicy enforcement included)
ssh -i ~/.ssh/urumi-key.pem azureuser@<IP> 'curl -sfL https://get.k3s.io | sudo sh -'

# 2. from the laptop: reach the Kubernetes API through an SSH tunnel; port 6443 is never exposed
make vps-kubeconfig vps-tunnel VPS_IP=<IP>
export KUBECONFIG=~/.kube/urumi-vps.yaml

# 3. TLS: cert-manager, a Let's Encrypt issuer, and an http -> https redirect
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager -n cert-manager --create-namespace --set crds.enabled=true --wait
kubectl apply -f deploy/cluster-issuer.yaml -f deploy/traefik-https-redirect.yaml

# 4. the same three charts with production values (domains in charts/*/values-prod.yaml)
make vps-up
make vps-test
```

The GHCR images are public because the repository is; for a private repository add an image pull secret.

---

## Upgrades and rollback

Every `make store|gateway|everything` is a `helm upgrade --install`, so each deploy is a numbered release:

```bash
helm history gateway -n gateway
helm rollback gateway <revision> -n gateway
make store-backup        # before upgrading the store: rollback restores Kubernetes objects, not data
```

A bad release does not cause downtime: the gateway runs 2 replicas with a rolling update, so a new pod that never becomes ready never replaces the old ones. See [docs/upgrades.md](docs/upgrades.md) for the tested walkthrough.

---

## Security demo: a malicious MCP server

```bash
make evil       # deploys a demo-only server that looks harmless
# Dashboard → Add server → URL http://evil-mcp.mcp.svc.cluster.local:8000/mcp, slug "weather"
make rugpull    # it rewrites its tool description with hidden instructions for the model
```

Within one health check (about 5 s) the gateway notices the changed definition and **quarantines** the server: its tools disappear for every client and the chat agent, direct calls are refused and audited, and the dashboard shows what changed so an admin can approve or disable it. `make evil-down` removes it. Details in the [threat model](docs/threat-model.md).

---

## Make targets

| Target | What it does |
|---|---|
| `make cluster` / `make cluster-down` | create / delete the local k3d cluster |
| `make up` | build all images and install all releases |
| `make store`, `make everything`, `make gateway` | install or upgrade one release (`ENV=prod` for VPS values) |
| `make images`, `make image-<name>` | build image(s) and import them into k3d |
| `make test-dod` | automated Definition-of-Done check |
| `make admin-password`, `make store-password` | print generated passwords |
| `make store-backup` | dump the store database to `backups/` |
| `make status` | pods, services, ingresses, volumes and network policies |
| `make evil`, `make rugpull`, `make evil-down` | malicious-server security demo |

## Repository layout

```
charts/store        WordPress, MariaDB, WP-CLI bootstrap Job, woo-mcp, NetworkPolicies
charts/gateway      gateway, Postgres, dashboard, Ingress, Secrets, NetworkPolicies
charts/everything   MCP reference server (in-cluster upstream)
charts/evil-mcp     demo-only malicious server
services/woo-mcp    WooCommerce MCP server (Python, MCP SDK)
services/gateway    gateway: app/mcp_gateway.py (MCP endpoint), registry.py (routing, health,
                    quarantine), upstream.py (MCP client), auth.py, security.py, api.py, agent.py,
                    toolsearch.py
dashboard           React dashboard
scripts/test_dod.py automated Definition-of-Done check
docs/               design, threat model, lessons, upgrades
```

## Bonus and stand-out items

The multi-store bonus was not attempted; the core comes first. Stand-out items:

| Item | Status | Where |
|---|---|---|
| 2. Tool permissions | ✅ per-tool role (Everyone / Admins only); hidden from lists **and** refused if called directly; applies to the chat agent too | `registry.py`, Servers page |
| 4. Many tools | ✅ chat agent starts with one `search_tools` tool and loads only matching schemas (~5.8k → ~1k tokens per request) | `toolsearch.py`, `agent.py` |
| 6. Security hardening | ✅ SSRF guard on admin URLs (blocks private ranges and cloud metadata; allowlist for our own in-cluster namespaces), default-deny NetworkPolicies in every namespace (woo-mcp egress limited to its WordPress), non-root containers with read-only root filesystems where possible, upstream credentials encrypted at rest (Fernet), rug-pull quarantine | `security.py`, `charts/*/templates/networkpolicy.yaml` |
| 7. Scaling | ✅ partial: 2 gateway replicas on stateless Streamable HTTP; no rate limits | `charts/gateway/values.yaml` |
| 8. Observability | ✅ partial: per-server calls, failures, p50/p95 latency (24 h); the reason an upstream is unreachable; every failed call's reason in the audit log | `/api/stats`, Servers page |
| 9. Upgrades and rollback | ✅ tested zero-downtime failed release + rollback; DB migrations in the bootstrap Job; `make store-backup` | [docs/upgrades.md](docs/upgrades.md) |
| 1. VPS deployment | ✅ live on Azure k3s with Let's Encrypt TLS; same charts, `values-prod.yaml`; DoD check passes 24/24 against it | "Production on a VPS" above |
