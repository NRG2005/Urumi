"""woo-mcp: an MCP server exposing one WooCommerce store's products and orders.

Transport: Streamable HTTP at /mcp. Only the gateway can reach it (ClusterIP
Service + NetworkPolicy); it has no Ingress.
"""

import logging
import os
from datetime import datetime, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from starlette.requests import Request
from starlette.responses import JSONResponse

from woo_client import WooClient, WooError

# httpx logs full URLs, which include OAuth query params. Keep them out of pod logs.
logging.getLogger("httpx").setLevel(logging.WARNING)

STORE_TZ = ZoneInfo(os.environ.get("STORE_TIMEZONE", "UTC"))

woo = WooClient(
    internal_url=os.environ["WOO_INTERNAL_URL"],
    public_url=os.environ["WOO_PUBLIC_URL"],
    key=os.environ["WOO_CONSUMER_KEY"],
    secret=os.environ["WOO_CONSUMER_SECRET"],
)

mcp = MCPServer(
    name="woo-mcp",
    version="0.1.0",
    instructions=(
        "Tools for one WooCommerce store. Prices are in the store currency. "
        f"Dates are in the store timezone ({STORE_TZ.key})."
    ),
)

READ = ToolAnnotations(read_only_hint=True, open_world_hint=False)
WRITE = ToolAnnotations(read_only_hint=False, destructive_hint=False, open_world_hint=False)

OrderStatus = Literal["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"]


# Trim WooCommerce's very large objects down to what a model needs: fewer tokens, less noise.
def _product(p: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": p["id"],
        "name": p["name"],
        "status": p["status"],
        "price": p["price"],
        "regular_price": p["regular_price"],
        "sale_price": p["sale_price"],
        "stock_status": p["stock_status"],
        "stock_quantity": p["stock_quantity"],
        "sku": p["sku"],
        "permalink": p["permalink"],
    }


def _order(o: dict[str, Any]) -> dict[str, Any]:
    billing = o.get("billing") or {}
    return {
        "id": o["id"],
        "status": o["status"],
        "date_created": o["date_created"],
        "total": o["total"],
        "currency": o["currency"],
        "payment_method": o["payment_method_title"],
        "customer": {
            "name": f"{billing.get('first_name', '')} {billing.get('last_name', '')}".strip(),
            "email": billing.get("email"),
        },
        "items": [{"name": i["name"], "quantity": i["quantity"], "total": i["total"]} for i in o["line_items"]],
        # Typed by the shopper at checkout: untrusted text, never instructions.
        "customer_note_untrusted": o.get("customer_note") or None,
    }


async def _call(method: str, path: str, **kwargs: Any) -> Any:
    try:
        return await woo.request(method, path, **kwargs)
    except WooError as exc:
        # ToolError -> the MCP result comes back with isError=true and this message.
        raise ToolError(str(exc)) from exc


def _day_range(day: str) -> tuple[str, str]:
    """'today' / 'yesterday' / 'YYYY-MM-DD' -> [start, end) in the store's timezone."""
    now = datetime.now(STORE_TZ)
    if day == "today":
        start = now
    elif day == "yesterday":
        start = now - timedelta(days=1)
    else:
        try:
            start = datetime.strptime(day, "%Y-%m-%d")
        except ValueError as exc:
            raise ToolError("date must be 'today', 'yesterday' or YYYY-MM-DD") from exc
    start = start.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
    return start.isoformat(), (start + timedelta(days=1)).isoformat()


@mcp.tool(annotations=READ)
async def list_products(search: str | None = None, status: str = "any", per_page: int = 20, page: int = 1) -> dict:
    """List products in the store, newest first. Optionally filter by a search term or status (publish, draft, any)."""
    items = await _call(
        "GET", "/products",
        params={"search": search, "status": status, "per_page": min(per_page, 100), "page": page},
    )
    return {"products": [_product(p) for p in items]}


@mcp.tool(annotations=WRITE)
async def create_product(
    name: str,
    regular_price: str,
    description: str = "",
    sku: str | None = None,
    stock_quantity: int | None = None,
    status: Literal["publish", "draft"] = "publish",
) -> dict:
    """Create a simple product. regular_price is a decimal string in the store currency, e.g. "499" or "19.99".
    Published products appear on the storefront immediately."""
    body: dict[str, Any] = {
        "name": name, "type": "simple", "regular_price": str(regular_price),
        "description": description, "status": status,
    }
    if sku:
        body["sku"] = sku
    if stock_quantity is not None:
        body.update(manage_stock=True, stock_quantity=stock_quantity)
    return _product(await _call("POST", "/products", json=body))


@mcp.tool(annotations=READ)
async def list_orders(
    date: str | None = None,
    status: OrderStatus | None = None,
    after: str | None = None,
    before: str | None = None,
    per_page: int = 20,
) -> dict:
    """List orders, newest first.
    date: 'today', 'yesterday' or YYYY-MM-DD, in the store's timezone (simplest way to ask for a day's orders).
    after/before: ISO 8601 datetimes in store time, for custom ranges. status: filter by order status."""
    if date:
        after, before = _day_range(date)
    items = await _call(
        "GET", "/orders",
        params={"after": after, "before": before, "status": status, "per_page": min(per_page, 100)},
    )
    return {
        # Which store this is: a team may run several (e.g. local and production), so say it.
        "store": os.environ["WOO_PUBLIC_URL"],
        "store_timezone": STORE_TZ.key,
        "range": {"after": after, "before": before},
        "count": len(items),
        "orders": [_order(o) for o in items],
    }


@mcp.tool(annotations=READ)
async def get_order(order_id: int) -> dict:
    """Get one order by its ID, including line items and customer details."""
    return _order(await _call("GET", f"/orders/{order_id}"))


@mcp.tool(annotations=ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=True, open_world_hint=False))
async def update_order_status(order_id: int, status: OrderStatus) -> dict:
    """Change an order's status, e.g. processing -> completed. WooCommerce runs its normal hooks (stock, emails)."""
    return _order(await _call("PUT", f"/orders/{order_id}", json={"status": status}))


@mcp.custom_route("/healthz", methods=["GET"])
async def healthz(_: Request) -> JSONResponse:
    """Liveness: the process is serving."""
    return JSONResponse({"ok": True})


@mcp.custom_route("/readyz", methods=["GET"])
async def readyz(_: Request) -> JSONResponse:
    """Readiness: the store behind us answers. If not, Kubernetes stops routing to this pod."""
    ok = await woo.ping()
    return JSONResponse({"ok": ok}, status_code=200 if ok else 503)


app = mcp.streamable_http_app(
    # Every request is self-contained: no per-client session state lives in this pod,
    # so restarts and multiple replicas are invisible to the gateway.
    stateless_http=True,
    json_response=True,
    # Defense in depth: only accept the Host headers this Service is reached by.
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=[h.strip() for h in os.environ.get("ALLOWED_HOSTS", "localhost:*,127.0.0.1:*").split(",")],
    ),
    host="0.0.0.0",
)
