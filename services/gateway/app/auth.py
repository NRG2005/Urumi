"""Who is calling? Resolves gateway API keys, chat-agent tokens and dashboard sessions to a user."""

from fastapi import Cookie, Depends, HTTPException

from . import config, db
from .security import KEY_PREFIX, hash_token, sign, verify

AGENT_TOKEN_TTL = 300  # seconds; minted per chat turn


async def user_by_id(user_id: int) -> dict | None:
    return await db.fetchrow(
        "SELECT id, email, name, role FROM users WHERE id = $1 AND password_hash IS NOT NULL", user_id
    )


async def from_bearer(token: str) -> tuple[dict | None, str, str | None]:
    """Returns (user or None, via, rejection reason). Checked on *every* request, so a
    revoked key fails on its very next call; there is no cache to wait out."""
    if token.startswith(KEY_PREFIX):
        row = await db.fetchrow(
            """SELECT k.id AS key_id, k.revoked_at, u.id, u.email, u.name, u.role
               FROM api_keys k JOIN users u ON u.id = k.user_id
               WHERE k.key_hash = $1 AND u.password_hash IS NOT NULL""",
            hash_token(token),
        )
        if not row:
            return None, "mcp", "invalid API key"
        user = {k: row[k] for k in ("id", "email", "name", "role")}
        if row["revoked_at"]:
            return user, "mcp", "API key revoked"
        await db.execute("UPDATE api_keys SET last_used_at = now() WHERE id = $1", row["key_id"])
        return user, "mcp", None
    claims = verify(token, "agent")
    if claims:
        user = await user_by_id(int(claims["sub"]))
        return (user, "chat", None) if user else (None, "chat", "user no longer exists")
    return None, "mcp", "invalid token"


def agent_token(user: dict) -> str:
    """Short-lived token the dashboard's chat agent uses to call /mcp as this user."""
    return sign({"kind": "agent", "sub": str(user["id"])}, AGENT_TOKEN_TTL)


def session_token(user: dict) -> str:
    return sign({"kind": "session", "sub": str(user["id"])}, 12 * 3600)


# ---------- FastAPI dependencies for the dashboard API ----------

async def current_user(urumi_session: str | None = Cookie(default=None, alias=config.SESSION_COOKIE)) -> dict:
    claims = verify(urumi_session or "", "session")
    user = await user_by_id(int(claims["sub"])) if claims else None
    if not user:
        raise HTTPException(401, "not signed in")
    return user


async def require_admin(user: dict = Depends(current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(403, "admin only")
    return user
