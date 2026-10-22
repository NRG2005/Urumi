# What broke, and what I learned

Things that didn't work the first time, why, and what changed. Each one is a gap between "the code looks right" and "it works on a real cluster".

### 1. Latest WooCommerce refused to install
The bootstrap Job failed five times: WooCommerce 11.2 needs WordPress ≥ 7.0 and the image was pinned to 6.8. The Job's `backoffLimit` turned that into a failed Helm install.
**Fix:** WordPress 7.1 image. **Lesson:** "latest" plugin + pinned core is a version mismatch waiting to happen; the bootstrap now exposes `bootstrap.woocommerceVersion` to pin it.

### 2. WooCommerce signatures fail inside the cluster
WooCommerce only accepts HTTP Basic auth over HTTPS, so in-cluster calls use OAuth 1.0a signing. Signing for the URL actually called (`http://store-wordpress…`) returned `401 Invalid signature`: WooCommerce rebuilds the signed URL from its own **home URL**.
**Fix:** sign for `http://store.localtest.me`, send to the internal Service. I tested this before writing the MCP server on top of it.

### 3. "Empty store" that wasn't empty
The REST API returned no products while the storefront had shown one. The product had been moved to the trash from wp-admin.
**Lesson:** check the data (a SQL query) before debugging the code.

### 4. A killed pod kept answering
`kubectl scale --replicas=0` on the Node.js reference server, yet calls still succeeded for ~30 s. Two causes together:
- Node as **PID 1** gets no default signal handlers, so it ignored `SIGTERM` and ran until the grace period's `SIGKILL`.
- kube-proxy routes to **terminating** endpoints when a Service has no ready ones.

**Fix:** `tini` as PID 1 in the image, which forwards signals so the process exits immediately.

### 5. "Kill the pod" never showed Unreachable
A plain `kubectl delete pod` is replaced by the Deployment and ready in ~2 s, faster than the 5 s health check. That's Kubernetes working as designed.
**Demo:** delete a pod to show self-healing; scale to 0 to show the gateway's failure isolation.

### 6. A placeholder credential got stuck
The first `make gateway` ran with the template's `github_pat_…` placeholder. The gateway encrypted and stored it on first boot and never looked at the Secret again, so GitHub stayed "unreachable" after the real token was added.
**Fix:** seeded servers re-sync their credential from the Kubernetes Secret on every start, which also makes token rotation a `helm upgrade`.

### 7. A 401 that said "Server returned an error response"
The MCP client SDK reports an HTTP 401 from a server as a generic error. That hid both GitHub's bad-token error and my own test's revocation check.
**Fix:** the DoD test sends a raw request and checks for the HTTP 401 itself.

### 8. GitHub flapped between Connected and Unreachable
One health check against GitHub's hosted MCP server takes 3.6–4.5 s from India (several round trips to GitHub's US servers), right at the 4 s timeout.
**Fix:**
- 10 s timeout;
- **per-server** health tasks, so a slow remote server never delays detecting a dead local one (scale-to-zero detection still takes about 4 s).

### 9. The free LLM tier couldn't fit 37 tools
Groq's free tier allows 8,000 tokens per minute; 37 tool schemas cost ~5,800 tokens per request, so the second request in a minute was rejected.
**Fix:** tool search. The model starts with `search_tools`, and only matching tools are loaded (~1,000 tokens per request); 429s are retried after the provider's requested delay. This is stand-out #4 in the brief, and it came from a real constraint.

### 10. The model called a tool before searching for it
The model guessed `woo__list_products` without searching. Groq validates tool calls against the request's tool list server-side and rejected the whole completion (HTTP 400).
**Fix:** the agent pre-loads tools matching the user's message, and if the model calls a real-but-unloaded tool, loads it and retries.

### 11. First install on the VPS deadlocked
The store's setup Job was a Helm `post-install` hook, so it runs *after* `helm --wait` sees every pod ready. But woo-mcp is only ready once the store is set up. Locally this never showed up, because the store had been installed before woo-mcp existed.
**Fix:** a plain Job named per revision (`store-bootstrap-<revision>`) that runs alongside everything else; woo-mcp becomes ready as soon as it finishes.

### 12. My own firewall blocked the TLS certificate
Let's Encrypt's HTTP-01 check got a 502. cert-manager answers it with a temporary solver pod, and the namespace's default-deny NetworkPolicy blocked Traefik from reaching it.
**Fix:** a NetworkPolicy allowing Traefik to reach pods labelled `acme.cert-manager.io/http01-solver`. **Lesson:** default-deny is right, but every new kind of traffic needs its rule, including platform components you didn't write.

### 13. https changes the OAuth signature
On an https store reached over in-cluster http, WooCommerce builds the signed URL from its home *host* and the *incoming request's* scheme (http). Signing for `https://…` would fail. Caught by reasoning about it before the first deploy rather than by a failure.
**Fix:** sign for `<internal scheme>://<public host>`.

### 14. One upstream's schema broke tool listing for everyone
A from-scratch reinstall (the check a reviewer would do) failed one test: the chat agent's tool listing errored. GitHub's hosted MCP server now publishes four tools whose `outputSchema` type is `["object", "null"]` or `["null", "array"]`. The MCP spec requires `"object"`, and the SDK validates the gateway's whole `tools/list` result, so one non-conformant upstream tool made the entire aggregated list invalid.
**Fix:** the gateway normalises definitions when it caches them. A non-conformant `outputSchema` (an optional hint) is dropped, a tool that still doesn't validate is skipped, and either case is logged once. **Lesson:** a gateway must treat upstream definitions as untrusted input for *correctness*, not just security. Also: re-run the from-scratch install, because upgraded environments hide what a fresh one hits.

### 15. Small things
- **Helm's `checksum/config` annotation can't include the file it lives in** (infinite recursion). The ConfigMap moved to its own template.
- **MCP SDK v2** renamed `FastMCP` to `MCPServer`, added the 2026-07-28 stateless protocol revision, and turns on DNS-rebinding protection by default when bound to localhost. An in-cluster MCP server must set `allowed_hosts` or every request through its Service is rejected.
