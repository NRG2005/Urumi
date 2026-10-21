"""Automated Definition-of-Done check: runs every testable item of the brief
against the live cluster and prints PASS/FAIL for each.

    make test-dod            # full run (uses the chat agent's LLM)
    make test-dod ARGS=--skip-llm

Two users are created fresh on every run: user A (admin, uses the chat agent)
and user B (member, uses a plain MCP client, like Claude Code would).
"""

import argparse
import asyncio
import json
import subprocess
import sys
import time

import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from mcp.shared._httpx_utils import create_mcp_http_client

STORE = "http://store.localtest.me"
DASH = "http://dash.localtest.me"
RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    RESULTS.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail else ""), flush=True)
    return ok


def section(title: str) -> None:
    print(f"\n== {title}", flush=True)


def kubectl(*args: str) -> str:
    return subprocess.run(["kubectl", *args], check=True, capture_output=True, text=True).stdout


def admin_password() -> str:
    import base64
    return base64.b64decode(kubectl("get", "secret", "gateway-secrets", "-n", "gateway", "-o", "jsonpath={.data.admin-password}")).decode()


# ---------- MCP client helpers (what Claude Code does) ----------

async def mcp_tools(key: str) -> list[str]:
    http = create_mcp_http_client(headers={"Authorization": f"Bearer {key}"})
    async with http, Client(streamable_http_client(f"{DASH}/mcp", http_client=http)) as c:
        return [t.name for t in (await c.list_tools()).tools]


async def mcp_call(key: str, tool: str, args: dict) -> tuple[bool, str]:
    http = create_mcp_http_client(headers={"Authorization": f"Bearer {key}"})
    async with http, Client(streamable_http_client(f"{DASH}/mcp", http_client=http)) as c:
        r = await c.call_tool(tool, args)
        text = json.dumps(r.structured_content) if r.structured_content else " ".join(getattr(x, "text", "") for x in r.content)
        return bool(r.is_error), text


async def mcp_rejected(key: str) -> tuple[bool, str]:
    """Send a raw tools/list and look at the HTTP status: the SDK hides a 401 behind a generic error."""
    async with httpx2.AsyncClient() as http:
        r = await http.post(
            f"{DASH}/mcp",
            headers={"Authorization": f"Bearer {key}", "Accept": "application/json, text/event-stream",
                     "MCP-Protocol-Version": "2025-11-25"},
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        )
        return r.status_code == 401, f"HTTP {r.status_code}: {r.text[:60]}"


# ---------- storefront checkout (what a shopper's browser does) ----------

async def storefront_checkout(product_id: int) -> int:
    async with httpx2.AsyncClient(base_url=f"{STORE}/wp-json/wc/store/v1", timeout=30) as s:
        cart = await s.get("/cart")
        h = {"Nonce": cart.headers["Nonce"], "Cart-Token": cart.headers["Cart-Token"]}
        (await s.post("/cart/add-item", json={"id": product_id, "quantity": 1}, headers=h)).raise_for_status()
        addr = {"first_name": "Dod", "last_name": "Tester", "address_1": "1 MG Road", "city": "Bengaluru",
                "state": "KA", "postcode": "560001", "country": "IN", "email": "dod@example.com", "phone": "9999999999"}
        r = await s.post("/checkout", json={"billing_address": addr, "shipping_address": addr, "payment_method": "cod"}, headers=h)
        r.raise_for_status()
        return r.json()["order_id"]


async def wait_status(dash: httpx2.AsyncClient, slug: str, want: str, timeout: float) -> tuple[bool, float]:
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        servers = {s["slug"]: s for s in (await dash.get("/api/servers")).json()}
        if servers.get(slug, {}).get("status") == want:
            return True, time.monotonic() - start
        await asyncio.sleep(1)
    return False, timeout


async def main(skip_llm: bool) -> None:
    run = time.strftime("%H%M%S")
    admin = httpx2.AsyncClient(base_url=DASH, timeout=180)
    user_a = httpx2.AsyncClient(base_url=DASH, timeout=180)
    user_b = httpx2.AsyncClient(base_url=DASH, timeout=180)
    (await admin.post("/api/auth/login", json={"email": "admin@urumi.local", "password": admin_password()})).raise_for_status()

    section("Setup: two users")
    for client, who, role in ((user_a, "alice", "admin"), (user_b, "bob", "member")):
        inv = (await admin.post("/api/invites", json={"email": f"{who}-{run}@dod.test", "role": role})).json()
        token = inv["invite_url"].rsplit("/", 1)[1]
        r = await client.post("/api/auth/accept-invite", json={"token": token, "name": who.title(), "password": "dod-pass-123"})
        check(f"user {'A' if who == 'alice' else 'B'} = {who}-{run}@dod.test ({role}) joined via invite", r.status_code == 200)
    key_b = (await user_b.post("/api/keys", json={"name": "claude-code"})).json()["key"]
    check("user B generated their own API key in the dashboard", key_b.startswith("urumi_"))

    section("Store")
    shop = (await httpx2.AsyncClient().get(f"{STORE}/shop/")).status_code
    check("storefront is up", shop == 200, f"/shop/ -> {shop}")
    products = (await httpx2.AsyncClient().get(f"{STORE}/wp-json/wc/store/v1/products")).json()
    order_id = await storefront_checkout(products[-1]["id"])
    check("checkout with Cash on delivery through the storefront cart", order_id > 0, f"order #{order_id}")
    admin_key = (await admin.post("/api/keys", json={"name": f"dod-admin-{run}"})).json()["key"]
    err, text = await mcp_call(admin_key, "woo__get_order", {"order_id": order_id})
    check("order is visible in WooCommerce (read back from the store's REST API)", not err and json.loads(text).get("id") == order_id)

    section("Chat agent as user A")
    if skip_llm:
        print("  SKIP  (--skip-llm)")
    else:
        name = f"DoD Lamp {run}"
        r = await user_a.post("/api/chat", json={"messages": [{"role": "user", "content": f'Create a product called "{name}" priced at 899.'}]})
        trace = r.json().get("trace", []) if r.status_code == 200 else []
        check("agent called woo__create_product", any(t["tool"] == "woo__create_product" and not t["is_error"] for t in trace), r.text[:120] if r.status_code != 200 else "")
        found = (await httpx2.AsyncClient().get(f"{STORE}/wp-json/wc/store/v1/products", params={"search": name})).json()
        check("the new product appears on the storefront", any(p["name"] == name for p in found))
        for p in found:  # tidy up: move the test product to the trash (via woo-mcp's own store credentials)
            kubectl("exec", "-n", "store", "deploy/store-woo-mcp", "--", "python", "-c",
                    f"import asyncio, server; asyncio.run(server.woo.request('DELETE', '/products/{p['id']}'))")
        await asyncio.sleep(5)  # stay under free-tier tokens-per-minute limits
        r = await user_a.post("/api/chat", json={"messages": [{"role": "user", "content": "What orders came in today? List their order numbers."}]})
        body = r.json() if r.status_code == 200 else {}
        check("agent answers 'orders today' with the storefront order", str(order_id) in body.get("reply", ""), (body.get("reply") or r.text)[:100].replace("\n", " "))

    section("External MCP client as user B (gateway URL + API key only)")
    tools_b = await mcp_tools(key_b)
    servers_b = sorted({t.split("__")[0] for t in tools_b})
    enabled = [s["slug"] for s in (await admin.get("/api/servers")).json() if s["enabled"] and s["status"] == "connected"]
    check("sees tools of every enabled server", set(enabled) <= set(servers_b), f"{len(tools_b)} tools from {servers_b}")
    err, text = await mcp_call(key_b, "woo__list_orders", {"date": "today"})
    check("asks the orders question successfully", not err and str(order_id) in text)
    other = "github" if "github" in servers_b else next((s for s in servers_b if s != "woo"), None)
    if other == "github":
        err2, _ = await mcp_call(key_b, "github__list_issues", {"owner": "NRG2005", "repo": "Urumi", "state": "OPEN"})
    else:
        err2, _ = await mcp_call(key_b, f"{other}__echo", {"message": "hi"})
    check(f"uses tools from two different servers (woo + {other})", not err and not err2)
    err, text = await mcp_call(key_b, "woo__create_product", {"name": "nope", "regular_price": "1"})
    check("member cannot call an admin-only tool", err and "admin" in text, text[:70])

    section("Team and control")
    key_id = (await user_b.get("/api/keys")).json()[0]["id"]
    ok_before, _ = await mcp_rejected(key_b)
    await admin.delete(f"/api/keys/{key_id}")
    ok_after, detail = await mcp_rejected(key_b)
    check("admin revokes user B's key -> B's next call is rejected", not ok_before and ok_after, detail)

    servers = {s["slug"]: s for s in (await admin.get("/api/servers")).json()}
    ev = servers["everything"]
    await admin.patch(f"/api/servers/{ev['id']}", json={"enabled": False})
    tools_now = await mcp_tools(admin_key)
    check("disabled server's tools disappear for MCP clients", not any(t.startswith("everything__") for t in tools_now))
    if not skip_llm:
        r = await user_a.post("/api/chat", json={"messages": [{"role": "user", "content": "Use the echo tool to echo 'hello'."}]})
        trace = r.json().get("trace", []) if r.status_code == 200 else []
        check("...and for the chat agent", not any(t["tool"].startswith("everything__") and not t["is_error"] for t in trace))
    await admin.patch(f"/api/servers/{ev['id']}", json={"enabled": True})
    await wait_status(admin, "everything", "connected", 20)

    kubectl("scale", "deploy/everything", "-n", "mcp", "--replicas=0")
    ok, took = await wait_status(admin, "everything", "unreachable", 30)
    check("kill the upstream's pod -> dashboard shows it unreachable", ok, f"after {took:.0f}s")
    err, _ = await mcp_call(admin_key, "woo__list_products", {"per_page": 1})
    check("other servers keep working", not err)
    err, text = await mcp_call(admin_key, "everything__echo", {"message": "x"})
    check("calls to the dead server fail fast with a clear error", err and "unreachable" in text, text[:70])
    kubectl("scale", "deploy/everything", "-n", "mcp", "--replicas=1")
    ok, took = await wait_status(admin, "everything", "connected", 60)
    check("it recovers on its own when the pod comes back", ok, f"after {took:.0f}s")

    section("Audit log")
    audit = (await admin.get("/api/audit", params={"limit": 300})).json()
    a_rows = [r for r in audit if r["user_email"].startswith(f"alice-{run}")]
    b_rows = [r for r in audit if r["user_email"].startswith(f"bob-{run}")]
    if not skip_llm:
        check("user A's chat calls are logged under A (via chat)", any(r["via"] == "chat" and r["outcome"] == "success" for r in a_rows))
    check("user B's calls are logged under B (via MCP client)", any(r["via"] == "mcp" and r["tool_name"] == "woo__list_orders" for r in b_rows))
    check("B's denied and rejected calls are logged too", {"denied", "rejected"} <= {r["outcome"] for r in b_rows})
    check("every entry has server, tool, time, duration and outcome",
          all(r["tool_name"] and r["ts"] and r["duration_ms"] is not None and r["outcome"] for r in a_rows + b_rows))

    failed = [n for n, ok, _ in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed" + (f"; FAILED: {failed}" if failed else ""))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--skip-llm", action="store_true", help="skip the chat-agent checks (no LLM calls)")
    asyncio.run(main(p.parse_args().skip_llm))
