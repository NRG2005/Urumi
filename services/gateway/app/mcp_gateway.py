"""The gateway as an MCP *server*: one /mcp endpoint for every client.

Request path for a tools/call:
  1. MCPAuth (ASGI middleware) checks the Bearer key against Postgres -> user, or 401.
  2. The SDK parses the JSON-RPC message and calls handle_call_tool.
  3. registry.resolve() splits "<slug>__<tool>" and enforces enabled/healthy/permission rules.
  4. upstream.call_tool() forwards the call with the server's own credential and a timeout.
  5. The outcome is written to the audit log, and the upstream's result is returned unchanged.
"""

import json
import logging
import time

from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPASGIApp, StreamableHTTPSessionManager
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import CallToolResult, ListToolsResult, TextContent, Tool

from . import audit, auth, config, registry, upstream

log = logging.getLogger("gateway.mcp")


def _caller(ctx) -> tuple[dict, str]:
    state = ctx.request.scope["state"]
    return state["user"], state["via"]


def _error(message: str) -> CallToolResult:
    return CallToolResult(content=[TextContent(type="text", text=message)], is_error=True)


async def handle_list_tools(ctx, params) -> ListToolsResult:
    user, _ = _caller(ctx)
    return ListToolsResult(tools=[Tool.model_validate(t) for t in await registry.visible_tools(user)])


async def handle_call_tool(ctx, params) -> CallToolResult:
    user, via = _caller(ctx)
    started = time.monotonic()
    slug, outcome, error = None, "error", None
    try:
        server, tool = await registry.resolve(user, params.name)
        slug = server["slug"]
        result = await upstream.call_tool(server, tool, params.arguments, config.CALL_TIMEOUT)
        outcome = "error" if result.is_error else "success"
        if result.is_error:
            error = " ".join(c.text for c in result.content if isinstance(c, TextContent))[:500]
        return result
    except registry.ToolNotAvailable as exc:
        slug, outcome, error = exc.server_slug, exc.outcome, str(exc)
        return _error(str(exc))
    except upstream.UpstreamError as exc:
        outcome = "timeout" if "timed out" in str(exc) else "unreachable"
        error = f"upstream server {slug!r} failed: {exc}"
        return _error(error)
    finally:
        await audit.record(user, via, slug, params.name, int((time.monotonic() - started) * 1000), outcome, error)


server = Server(
    "urumi-gateway",
    version="0.1.0",
    instructions="Team MCP gateway. Tool names are <server>__<tool>; the description says which server owns each tool.",
    on_list_tools=handle_list_tools,
    on_call_tool=handle_call_tool,
)

session_manager = StreamableHTTPSessionManager(
    app=server,
    # Stateless: every request carries its own auth and is served on its own, so any
    # replica can serve any request and revocation applies to the very next call.
    stateless=True,
    json_response=True,
    # DNS-rebinding protection guards *unauthenticated* local servers; this endpoint
    # requires a Bearer key on every request, and its Host varies (Ingress, Service, localhost).
    security_settings=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)


class MCPAuth:
    """ASGI middleware in front of /mcp: no valid key, no MCP."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        headers = {k.decode().lower(): v.decode() for k, v in scope["headers"]}
        header = headers.get("authorization", "")
        token = header[7:].strip() if header.lower().startswith("bearer ") else ""
        user, via, reason = await auth.from_bearer(token) if token else (None, "mcp", "missing Bearer token")
        if reason:
            if user:  # a real user with a revoked key: worth an audit entry
                receive = await self._audit_rejection(user, via, reason, receive)
            return await self._reject(send, reason)
        scope.setdefault("state", {})
        scope["state"]["user"], scope["state"]["via"] = user, via
        await self.app(scope, receive, send)

    @staticmethod
    async def _audit_rejection(user, via, reason, receive):
        body, more = b"", True
        while more and len(body) < 65536:
            msg = await receive()
            body += msg.get("body", b"")
            more = msg.get("more_body", False)
        try:
            msg = json.loads(body)
            name = (msg.get("params") or {}).get("name") or msg.get("method", "?")
        except (ValueError, AttributeError):
            name = "?"
        slug = name.partition(registry.SEP)[0] if registry.SEP in name else None
        await audit.record(user, via, slug, name, 0, "rejected", reason)
        return receive

    @staticmethod
    async def _reject(send, reason: str):
        body = json.dumps({"error": "unauthorized", "message": reason}).encode()
        await send({
            "type": "http.response.start", "status": 401,
            "headers": [(b"content-type", b"application/json"), (b"www-authenticate", b'Bearer realm="urumi-gateway"')],
        })
        await send({"type": "http.response.body", "body": body})


mcp_asgi = MCPAuth(StreamableHTTPASGIApp(session_manager))
