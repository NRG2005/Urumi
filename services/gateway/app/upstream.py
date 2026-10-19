"""The gateway as an MCP *client* of each upstream server.

Each operation opens a short-lived connection, does its work and closes it.
That costs a little latency per call, but it means a dead or restarted
upstream can never leave a broken session behind: the next call simply
connects again.
"""

from contextlib import asynccontextmanager
from typing import Any

import anyio
import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from mcp.shared._httpx_utils import create_mcp_http_client
from mcp.types import CallToolResult, Implementation

from .security import decrypt


class UpstreamError(Exception):
    """Could not reach or talk to the upstream; message is safe to show users."""


def _auth_headers(server: dict) -> dict[str, str]:
    # Credentials are decrypted only here, at the moment of the outbound call,
    # and only ever sent to that server's own URL.
    if server["auth_type"] == "none" or not server.get("credential_enc"):
        return {}
    credential = decrypt(server["credential_enc"])
    if server["auth_type"] == "bearer":
        return {"Authorization": f"Bearer {credential}"}
    return {server["auth_header"]: credential}


def describe(exc: BaseException) -> str:
    """Unwrap anyio exception groups to the first real cause."""
    while isinstance(exc, BaseExceptionGroup) and exc.exceptions:
        exc = exc.exceptions[0]
    if isinstance(exc, TimeoutError):
        return "timed out"
    if isinstance(exc, httpx2.ConnectError):
        return "connection refused or host not found"
    text = str(exc) or exc.__class__.__name__
    return text[:300]


@asynccontextmanager
async def _session(server: dict, timeout: float):
    http = create_mcp_http_client(headers=_auth_headers(server), timeout=httpx2.Timeout(timeout))
    async with http:
        transport = streamable_http_client(server["url"], http_client=http)
        async with Client(transport, client_info=Implementation(name="urumi-gateway", version="0.1.0")) as client:
            yield client


async def list_tools(server: dict, timeout: float) -> list[dict[str, Any]]:
    try:
        with anyio.fail_after(timeout):
            async with _session(server, timeout) as client:
                tools, cursor = [], None
                while True:
                    page = await client.list_tools(cursor=cursor)
                    tools += [t.model_dump(mode="json", by_alias=True, exclude_none=True) for t in page.tools]
                    cursor = page.next_cursor
                    if not cursor:
                        return tools
    except BaseException as exc:  # noqa: BLE001 - anyio raises groups; all failures mean "unreachable"
        if isinstance(exc, (KeyboardInterrupt, SystemExit, anyio.get_cancelled_exc_class())) and not isinstance(exc, TimeoutError):
            raise
        raise UpstreamError(describe(exc)) from None


async def call_tool(server: dict, tool: str, arguments: dict[str, Any] | None, timeout: float) -> CallToolResult:
    try:
        with anyio.fail_after(timeout):
            async with _session(server, timeout) as client:
                return await client.call_tool(tool, arguments or {})
    except BaseException as exc:  # noqa: BLE001
        if isinstance(exc, (KeyboardInterrupt, SystemExit, anyio.get_cancelled_exc_class())) and not isinstance(exc, TimeoutError):
            raise
        raise UpstreamError(describe(exc)) from None
