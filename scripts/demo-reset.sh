#!/usr/bin/env sh
# Reset demo data before a recording. Keeps the system (admin account, MCP servers and tool
# permissions, product catalogue); removes what testing leaves behind (other users, API keys,
# invites, audit log, orders, products without a photo). Targets whatever cluster KUBECONFIG points at.
set -eu

if [ "${CONFIRM:-}" != "yes" ]; then
  printf "This permanently deletes users (except the admin), API keys, the audit log and ALL store orders\non cluster '%s'. Type yes to continue: " "$(kubectl config current-context)"
  read -r answer
  [ "$answer" = "yes" ] || { echo "aborted"; exit 1; }
fi

ADMIN_EMAIL=$(kubectl get configmap gateway-config -n gateway -o jsonpath='{.data.ADMIN_EMAIL}')
SEEDED=$(kubectl get configmap gateway-config -n gateway -o jsonpath='{.data.SEED_SERVERS}' \
  | python3 -c "import sys, json; print(','.join(\"'%s'\" % s['slug'] for s in json.load(sys.stdin)))")

echo "==> gateway: keep $ADMIN_EMAIL and servers ($SEEDED)"
kubectl exec -n gateway gateway-postgres-0 -- psql -U gateway -d gateway -v ON_ERROR_STOP=1 -q -c "
  BEGIN;
  DELETE FROM audit_log;
  DELETE FROM api_keys;
  DELETE FROM invites;
  DELETE FROM users WHERE email <> '$ADMIN_EMAIL';
  DELETE FROM servers WHERE slug NOT IN ($SEEDED);
  UPDATE servers SET tools_changed_at = NULL;
  COMMIT;
  SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM servers) AS servers, (SELECT count(*) FROM audit_log) AS audit_rows;"

echo "==> store: orders and photo-less products (via woo-mcp's own store credentials)"
kubectl exec -n store deploy/store-woo-mcp -- python -c '
import asyncio, server
async def main():
    woo = server.woo
    orders = 0
    while True:
        batch = await woo.request("GET", "/orders", {"per_page": 100, "status": "any"})
        if not batch:
            break
        for o in batch:
            oid = o["id"]
            await woo.request("DELETE", f"/orders/{oid}", {"force": True})
            orders += 1
    print(f"   deleted {orders} orders")
    for status in ("publish", "draft", "trash"):
        for p in await woo.request("GET", "/products", {"per_page": 100, "status": status}):
            if status == "trash" or not p["images"]:
                pid, name = p["id"], p["name"]
                await woo.request("DELETE", f"/products/{pid}", {"force": True})
                print(f"   deleted product: {name} ({status})")
asyncio.run(main())'

echo "==> make sure every upstream is running"
kubectl scale deploy/everything -n mcp --replicas=1 >/dev/null
echo "done. Admin password: $(kubectl get secret gateway-secrets -n gateway -o jsonpath='{.data.admin-password}' | base64 -d)"
