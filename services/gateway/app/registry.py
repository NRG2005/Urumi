"""Server registry: aggregation, routing, permissions and health.

Naming scheme: every tool is exposed as "<server slug>__<tool name>", e.g.
"woo__list_orders". Slugs are unique and may not contain "_", so splitting on
the first "__" is unambiguous, and two servers with the same tool name never
collide. Names are stable: adding a server never renames anyone else's tools.

Failure isolation: a background loop polls every enabled server and caches its
tool list in Postgres. tools/list is served from that cache, so a slow or
dead upstream cannot slow listing down; it just drops out until it recovers.
"""

import asyncio
import hashlib
import json
import logging
import os
import re

from . import config, db, upstream
from .security import decrypt, encrypt

log = logging.getLogger("gateway.registry")

SEP = "__"
SLUG_RE = re.compile(r"^[a-z][a-z0-9]{1,15}$")
ROLE_RANK = {"member": 0, "admin": 1}


class ToolNotAvailable(Exception):
    """Unknown tool, disabled/unreachable server, or not allowed for this user."""

    def __init__(self, message: str, outcome: str, server_slug: str | None = None):
        super().__init__(message)
        self.outcome = outcome
        self.server_slug = server_slug


def _fingerprint(tools: list[dict]) -> str:
    """Hash of what the model reads: names, descriptions and schemas."""
    view = sorted((t["name"], t.get("description", ""), json.dumps(t.get("inputSchema", {}), sort_keys=True)) for t in tools)
    return hashlib.sha256(json.dumps(view).encode()).hexdigest()


def _allowed(role: str, min_role: str) -> bool:
    return ROLE_RANK[role] >= ROLE_RANK[min_role]


async def _policies() -> dict[tuple[int, str], str]:
    rows = await db.fetch("SELECT server_id, tool_name, min_role FROM tool_policies")
    return {(r["server_id"], r["tool_name"]): r["min_role"] for r in rows}


# ---------- what a user sees ----------

async def visible_tools(user: dict) -> list[dict]:
    servers = await db.fetch(
        "SELECT id, slug, name, tools FROM servers WHERE enabled AND status = 'connected' ORDER BY slug"
    )
    policies = await _policies()
    out = []
    for s in servers:
        for t in s["tools"]:
            if not _allowed(user["role"], policies.get((s["id"], t["name"]), "member")):
                continue  # hidden, and also rejected in resolve() if called anyway
            out.append({
                **t,
                "name": f"{s['slug']}{SEP}{t['name']}",
                # Provenance in the description: the model and the human both see which server owns a tool.
                "description": f"[{s['name']}] {t.get('description', '')}".strip(),
            })
    return out


async def resolve(user: dict, prefixed: str) -> tuple[dict, str]:
    """Map "<slug>__<tool>" to (server row, upstream tool name), enforcing every rule."""
    slug, sep, tool = prefixed.partition(SEP)
    if not sep or not tool:
        raise ToolNotAvailable(f"unknown tool {prefixed!r}", "denied")
    server = await db.fetchrow("SELECT * FROM servers WHERE slug = $1", slug)
    if not server:
        raise ToolNotAvailable(f"unknown tool {prefixed!r}", "denied")
    if not server["enabled"]:
        raise ToolNotAvailable(f"server {slug!r} is disabled by an admin", "denied", slug)
    if server["status"] == "unreachable":
        # Fail fast instead of waiting out a timeout on a server we already know is down.
        raise ToolNotAvailable(f"server {slug!r} is unreachable: {server['last_error']}", "unreachable", slug)
    if not any(t["name"] == tool for t in server["tools"]):
        raise ToolNotAvailable(f"unknown tool {prefixed!r}", "denied", slug)
    policy = await db.fetchrow("SELECT min_role FROM tool_policies WHERE server_id = $1 AND tool_name = $2", server["id"], tool)
    if policy and not _allowed(user["role"], policy["min_role"]):
        raise ToolNotAvailable(f"{prefixed} requires the {policy['min_role']} role", "denied", slug)
    return server, tool


# ---------- health ----------

async def check_server(server: dict) -> None:
    if not server["enabled"]:
        await db.execute("UPDATE servers SET status = 'disabled', last_checked_at = now() WHERE id = $1", server["id"])
        return
    try:
        tools = await upstream.list_tools(server, config.HEALTH_TIMEOUT)
    except upstream.UpstreamError as exc:
        await db.execute(
            "UPDATE servers SET status = 'unreachable', last_error = $2, last_checked_at = now() WHERE id = $1",
            server["id"], str(exc),
        )
        return
    changed = bool(server["tools"]) and _fingerprint(tools) != _fingerprint(server["tools"])
    await db.execute(
        """UPDATE servers SET status = 'connected', last_error = NULL, last_checked_at = now(), tools = $2,
               tools_changed_at = CASE WHEN $3 THEN now() ELSE tools_changed_at END
           WHERE id = $1""",
        server["id"], tools, changed,
    )
    if changed:
        log.warning("server %s changed its tool definitions", server["slug"])


async def check_all() -> None:
    servers = await db.fetch("SELECT * FROM servers")
    # Checked concurrently: one slow server never delays the others.
    await asyncio.gather(*(check_server(s) for s in servers), return_exceptions=True)


async def health_loop() -> None:
    while True:
        try:
            await check_all()
        except Exception:  # noqa: BLE001 - keep the loop alive no matter what
            log.exception("health check round failed")
        await asyncio.sleep(config.HEALTH_INTERVAL)


# ---------- seeding from Helm values ----------

async def seed() -> None:
    """Register the servers listed in SEED_SERVERS on first boot (e.g. the store's woo-mcp).

    For servers that already exist, the Kubernetes Secret stays the source of truth for
    their credential: rotate the Secret, `helm upgrade`, and the new value is picked up."""
    for s in config.SEED_SERVERS:
        credential = os.environ.get(s.get("credential_env", ""), "")
        existing = await db.fetchrow("SELECT id, credential_enc FROM servers WHERE slug = $1", s["slug"])
        if existing:
            current = decrypt(existing["credential_enc"]) if existing["credential_enc"] else ""
            if credential and credential != current:
                await db.execute("UPDATE servers SET credential_enc = $2 WHERE id = $1", existing["id"], encrypt(credential))
                log.info("updated credential for %s from its Secret", s["slug"])
            continue
        auth_type = s.get("auth_type", "none")
        if auth_type != "none" and not credential:
            log.warning("skipping seed server %s: %s is empty", s["slug"], s.get("credential_env"))
            continue
        row = await db.fetchrow(
            """INSERT INTO servers (slug, name, url, auth_type, auth_header, credential_enc)
               VALUES ($1, $2, $3, $4, $5, $6) RETURNING id""",
            s["slug"], s["name"], s["url"], auth_type, s.get("auth_header"),
            encrypt(credential) if credential else None,
        )
        for tool in s.get("admin_only_tools", []):
            await db.execute(
                "INSERT INTO tool_policies (server_id, tool_name, min_role) VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING",
                row["id"], tool,
            )
        log.info("seeded server %s", s["slug"])
