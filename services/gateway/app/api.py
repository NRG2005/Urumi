"""REST API for the React dashboard. Session cookie auth; admins manage, members use."""

import asyncio
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from . import agent, auth, config, db, registry
from .auth import current_user, require_admin
from .security import UnsafeURL, check_upstream_url, encrypt, hash_password, hash_token, new_api_key, verify_password

router = APIRouter(prefix="/api")
Role = Literal["admin", "member"]


def _set_session(response: Response, user: dict) -> None:
    response.set_cookie(
        config.SESSION_COOKIE, auth.session_token(user),
        httponly=True, samesite="lax", secure=config.COOKIE_SECURE, max_age=12 * 3600,
    )


# ---------- session ----------

class Login(BaseModel):
    email: str
    password: str


@router.post("/auth/login")
async def login(body: Login, response: Response):
    row = await db.fetchrow("SELECT * FROM users WHERE lower(email) = lower($1)", body.email)
    if not row or not row["password_hash"] or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(401, "wrong email or password")
    _set_session(response, row)
    return {"id": row["id"], "email": row["email"], "name": row["name"], "role": row["role"]}


@router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie(config.SESSION_COOKIE)
    return {"ok": True}


@router.get("/me")
async def me(user: dict = Depends(current_user)):
    return user


@router.get("/config")
async def client_config(user: dict = Depends(current_user)):
    return {
        "mcp_url": f"{config.PUBLIC_URL}/mcp",
        "environment": "local" if "localtest.me" in config.PUBLIC_URL or "localhost" in config.PUBLIC_URL else "production",
        "llm_configured": bool(config.LLM_API_KEY),
        "llm_model": config.LLM_MODEL,
    }


# ---------- invites and members ----------

class InviteIn(BaseModel):
    email: str
    role: Role = "member"


@router.post("/invites")
async def create_invite(body: InviteIn, admin: dict = Depends(require_admin)):
    if await db.fetchrow("SELECT 1 FROM users WHERE lower(email) = lower($1)", body.email):
        raise HTTPException(409, "a user with that email already exists")
    token = secrets.token_urlsafe(24)
    await db.execute(
        "INSERT INTO invites (token_hash, email, role, invited_by, expires_at) VALUES ($1, $2, $3, $4, $5)",
        hash_token(token), body.email, body.role, admin["id"], datetime.now(timezone.utc) + timedelta(days=7),
    )
    return {"invite_url": f"{config.PUBLIC_URL}/invite/{token}", "expires_in_days": 7}


class AcceptInvite(BaseModel):
    token: str
    name: str
    password: str = Field(min_length=8)


@router.post("/auth/accept-invite")
async def accept_invite(body: AcceptInvite, response: Response):
    inv = await db.fetchrow(
        "SELECT * FROM invites WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()", hash_token(body.token)
    )
    if not inv:
        raise HTTPException(400, "invite is invalid, used or expired")
    user = await db.fetchrow(
        "INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role",
        inv["email"], body.name, inv["role"], hash_password(body.password),
    )
    await db.execute("UPDATE invites SET used_at = now() WHERE token_hash = $1", inv["token_hash"])
    _set_session(response, user)
    return user


@router.get("/users")
async def list_users(_: dict = Depends(require_admin)):
    users = await db.fetch(
        """SELECT u.id, u.email, u.name, u.role, u.created_at,
                  count(k.id) FILTER (WHERE k.revoked_at IS NULL) AS active_keys
           FROM users u LEFT JOIN api_keys k ON k.user_id = u.id
           WHERE u.password_hash IS NOT NULL GROUP BY u.id ORDER BY u.id"""
    )
    invites = await db.fetch(
        "SELECT email, role, expires_at FROM invites WHERE used_at IS NULL AND expires_at > now() ORDER BY expires_at"
    )
    return {"users": users, "pending_invites": invites}


class RoleIn(BaseModel):
    role: Role


async def _admin_count() -> int:
    return (await db.fetchrow("SELECT count(*) AS n FROM users WHERE role = 'admin' AND password_hash IS NOT NULL"))["n"]


@router.patch("/users/{user_id}")
async def set_role(user_id: int, body: RoleIn, admin: dict = Depends(require_admin)):
    target = await auth.user_by_id(user_id)
    if not target:
        raise HTTPException(404, "no such user")
    if target["role"] == "admin" and body.role == "member" and await _admin_count() <= 1:
        raise HTTPException(400, "cannot demote the last admin")
    await db.execute("UPDATE users SET role = $2 WHERE id = $1", user_id, body.role)
    return {"ok": True}


@router.delete("/users/{user_id}")
async def remove_user(user_id: int, admin: dict = Depends(require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(400, "you cannot remove yourself")
    await db.execute("DELETE FROM users WHERE id = $1", user_id)  # cascades to their API keys
    return {"ok": True}


# ---------- API keys ----------

class KeyIn(BaseModel):
    name: str = "default"
    user_id: int | None = None  # admins may issue keys for someone else


@router.get("/keys")
async def list_keys(user_id: int | None = None, user: dict = Depends(current_user)):
    target = user_id if (user_id and user["role"] == "admin") else user["id"]
    return await db.fetch(
        """SELECT id, user_id, name, key_prefix, created_at, last_used_at, revoked_at
           FROM api_keys WHERE user_id = $1 ORDER BY id DESC""",
        target,
    )


@router.post("/keys")
async def create_key(body: KeyIn, user: dict = Depends(current_user)):
    owner = user["id"]
    if body.user_id and body.user_id != user["id"]:
        if user["role"] != "admin":
            raise HTTPException(403, "only admins can issue keys for other users")
        if not await auth.user_by_id(body.user_id):
            raise HTTPException(404, "no such user")
        owner = body.user_id
    key = new_api_key()
    row = await db.fetchrow(
        "INSERT INTO api_keys (user_id, name, key_hash, key_prefix) VALUES ($1, $2, $3, $4) RETURNING id",
        owner, body.name, hash_token(key), key[:12],
    )
    # The only time the full key exists outside the user's hands.
    return {"id": row["id"], "key": key, "mcp_url": f"{config.PUBLIC_URL}/mcp"}


@router.delete("/keys/{key_id}")
async def revoke_key(key_id: int, user: dict = Depends(current_user)):
    key = await db.fetchrow("SELECT user_id FROM api_keys WHERE id = $1", key_id)
    if not key or (key["user_id"] != user["id"] and user["role"] != "admin"):
        raise HTTPException(404, "no such key")
    await db.execute("UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", key_id)
    return {"ok": True}


# ---------- MCP servers ----------

def _server_view(s: dict, policies: dict) -> dict:
    return {
        "id": s["id"], "slug": s["slug"], "name": s["name"], "url": s["url"],
        "auth_type": s["auth_type"], "auth_header": s["auth_header"],
        "has_credential": bool(s["credential_enc"]),  # the credential itself never leaves the server
        "enabled": s["enabled"],
        "status": "disabled" if not s["enabled"] else s["status"],
        "last_error": s["last_error"], "last_checked_at": s["last_checked_at"],
        "tools_changed_at": s["tools_changed_at"],
        "quarantined": bool(s["tools_changed_at"]),
        "tools": [
            {
                "name": t["name"],
                "gateway_name": f"{s['slug']}{registry.SEP}{t['name']}",
                "description": t.get("description", ""),
                "read_only": (t.get("annotations") or {}).get("readOnlyHint"),
                "min_role": policies.get((s["id"], t["name"]), "member"),
            }
            for t in s["tools"]
        ],
    }


@router.get("/servers")
async def list_servers(user: dict = Depends(current_user)):
    servers = await db.fetch("SELECT * FROM servers ORDER BY id")
    policies = await registry._policies()
    views = [_server_view(s, policies) for s in servers]
    if user["role"] != "admin":  # members only see tools they may use
        for v in views:
            v["tools"] = [t for t in v["tools"] if t["min_role"] == "member"]
    return views


class ServerIn(BaseModel):
    name: str
    slug: str
    url: str
    auth_type: Literal["none", "bearer", "header"] = "none"
    auth_header: str | None = None
    credential: str | None = None


class ServerPatch(BaseModel):
    name: str | None = None
    url: str | None = None
    auth_type: Literal["none", "bearer", "header"] | None = None
    auth_header: str | None = None
    credential: str | None = None  # None = keep, "" = clear, value = replace
    enabled: bool | None = None


def _validate(url: str | None, auth_type: str | None, auth_header: str | None) -> None:
    if url:
        try:
            check_upstream_url(url)
        except UnsafeURL as exc:
            raise HTTPException(400, str(exc)) from None
    if auth_type == "header" and not auth_header:
        raise HTTPException(400, "auth_header is required when auth_type is 'header'")


async def _recheck(server_id: int) -> None:
    s = await db.fetchrow("SELECT * FROM servers WHERE id = $1", server_id)
    if s:
        await registry.check_server(s)


@router.post("/servers")
async def add_server(body: ServerIn, _: dict = Depends(require_admin)):
    if not registry.SLUG_RE.match(body.slug):
        raise HTTPException(400, "slug must be 2-16 lowercase letters/digits, starting with a letter (no '_')")
    _validate(body.url, body.auth_type, body.auth_header)
    if await db.fetchrow("SELECT 1 FROM servers WHERE slug = $1", body.slug):
        raise HTTPException(409, "slug already in use")
    row = await db.fetchrow(
        """INSERT INTO servers (slug, name, url, auth_type, auth_header, credential_enc)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id""",
        body.slug, body.name, body.url, body.auth_type, body.auth_header,
        encrypt(body.credential) if body.credential else None,
    )
    await _recheck(row["id"])
    return {"id": row["id"]}


@router.patch("/servers/{server_id}")
async def edit_server(server_id: int, body: ServerPatch, _: dict = Depends(require_admin)):
    s = await db.fetchrow("SELECT * FROM servers WHERE id = $1", server_id)
    if not s:
        raise HTTPException(404, "no such server")
    _validate(body.url, body.auth_type or s["auth_type"], body.auth_header or s["auth_header"])
    cred = s["credential_enc"] if body.credential is None else (encrypt(body.credential) if body.credential else None)
    await db.execute(
        """UPDATE servers SET name = $2, url = $3, auth_type = $4, auth_header = $5, credential_enc = $6, enabled = $7,
               status = CASE WHEN $7 THEN status ELSE 'disabled' END
           WHERE id = $1""",
        server_id, body.name or s["name"], body.url or s["url"], body.auth_type or s["auth_type"],
        body.auth_header if body.auth_header is not None else s["auth_header"], cred,
        s["enabled"] if body.enabled is None else body.enabled,
    )
    await _recheck(server_id)
    return {"ok": True}


@router.delete("/servers/{server_id}")
async def remove_server(server_id: int, _: dict = Depends(require_admin)):
    await db.execute("DELETE FROM servers WHERE id = $1", server_id)
    return {"ok": True}


@router.post("/servers/{server_id}/check")
async def check_now(server_id: int, _: dict = Depends(require_admin)):
    await _recheck(server_id)
    return {"ok": True}


@router.post("/servers/{server_id}/ack-changes")
async def ack_changes(server_id: int, _: dict = Depends(require_admin)):
    await db.execute("UPDATE servers SET tools_changed_at = NULL WHERE id = $1", server_id)
    return {"ok": True}


class PolicyIn(BaseModel):
    tool_name: str
    min_role: Role


@router.put("/servers/{server_id}/policies")
async def set_policy(server_id: int, body: PolicyIn, _: dict = Depends(require_admin)):
    if body.min_role == "member":
        await db.execute("DELETE FROM tool_policies WHERE server_id = $1 AND tool_name = $2", server_id, body.tool_name)
    else:
        await db.execute(
            """INSERT INTO tool_policies (server_id, tool_name, min_role) VALUES ($1, $2, $3)
               ON CONFLICT (server_id, tool_name) DO UPDATE SET min_role = EXCLUDED.min_role""",
            server_id, body.tool_name, body.min_role,
        )
    return {"ok": True}


# ---------- audit + stats ----------

@router.get("/audit")
async def audit_log(limit: int = 200, server: str | None = None, user: dict = Depends(current_user)):
    only_user = None if user["role"] == "admin" else user["id"]  # members see their own calls
    return await db.fetch(
        """SELECT id, ts, user_email, via, server_slug, tool_name, duration_ms, outcome, error FROM audit_log
           WHERE ($1::int IS NULL OR user_id = $1) AND ($2::text IS NULL OR server_slug = $2)
           ORDER BY ts DESC LIMIT $3""",
        only_user, server, min(limit, 1000),
    )


@router.get("/stats")
async def stats(_: dict = Depends(current_user)):
    return await db.fetch(
        """SELECT server_slug, count(*) AS calls,
                  count(*) FILTER (WHERE outcome <> 'success') AS failures,
                  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms))::int AS p50_ms,
                  round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::int AS p95_ms
           FROM audit_log WHERE ts > now() - interval '24 hours' AND server_slug IS NOT NULL
           GROUP BY server_slug ORDER BY server_slug"""
    )


@router.get("/stats/timeseries")
async def timeseries(user: dict = Depends(current_user)):
    """Tool calls per hour for the last 24 hours (members: their own), split by outcome."""
    only_user = None if user["role"] == "admin" else user["id"]
    rows = await db.fetch(
        """SELECT h.hour,
                  count(a.id) FILTER (WHERE a.outcome = 'success') AS ok,
                  count(a.id) FILTER (WHERE a.outcome <> 'success') AS failed
           FROM generate_series(date_trunc('hour', now()) - interval '23 hours', date_trunc('hour', now()), interval '1 hour') AS h(hour)
           LEFT JOIN audit_log a ON date_trunc('hour', a.ts) = h.hour AND ($1::int IS NULL OR a.user_id = $1)
           GROUP BY h.hour ORDER BY h.hour""",
        only_user,
    )
    return rows


# ---------- chat agent ----------

class ChatIn(BaseModel):
    messages: list[dict]


@router.post("/chat")
async def chat(body: ChatIn, user: dict = Depends(current_user)):
    if not config.LLM_API_KEY:
        raise HTTPException(503, "no LLM API key configured (set llm.apiKey in the gateway Helm values)")
    try:
        return await asyncio.wait_for(agent.run(user, body.messages), timeout=120)
    except asyncio.TimeoutError:
        raise HTTPException(504, "the agent took too long") from None
    except agent.LLMError as exc:
        raise HTTPException(502, str(exc)) from None
