"""Postgres access. Plain SQL via asyncpg: every query is visible and easy to trace."""

import json

import asyncpg

from . import config

pool: asyncpg.Pool | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL DEFAULT '',
    role          TEXT NOT NULL CHECK (role IN ('admin', 'member')),
    password_hash TEXT,                       -- NULL until the invite is accepted
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invites (
    token_hash  TEXT PRIMARY KEY,             -- SHA-256 of the one-time invite token
    email       TEXT NOT NULL,
    role        TEXT NOT NULL,
    invited_by  INT REFERENCES users(id) ON DELETE SET NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS api_keys (
    id           SERIAL PRIMARY KEY,
    user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    key_hash     TEXT UNIQUE NOT NULL,        -- SHA-256; the key itself is shown once and never stored
    key_prefix   TEXT NOT NULL,               -- first characters, so people can tell keys apart
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS servers (
    id              SERIAL PRIMARY KEY,
    slug            TEXT UNIQUE NOT NULL,     -- tool-name prefix: <slug>__<tool>
    name            TEXT NOT NULL,
    url             TEXT NOT NULL,
    auth_type       TEXT NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'bearer', 'header')),
    auth_header     TEXT,                     -- header name when auth_type = 'header'
    credential_enc  TEXT,                     -- Fernet-encrypted; never returned by the API
    enabled         BOOLEAN NOT NULL DEFAULT true,
    status          TEXT NOT NULL DEFAULT 'unknown',   -- connected | unreachable | disabled | unknown
    last_error      TEXT,
    last_checked_at TIMESTAMPTZ,
    tools           JSONB NOT NULL DEFAULT '[]',       -- cached tools/list result
    tools_changed_at TIMESTAMPTZ,             -- set when an upstream silently changes its tools
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-tool access rule. No row = any member may use it.
CREATE TABLE IF NOT EXISTS tool_policies (
    server_id  INT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    tool_name  TEXT NOT NULL,
    min_role   TEXT NOT NULL CHECK (min_role IN ('admin', 'member')),
    PRIMARY KEY (server_id, tool_name)
);

CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGSERIAL PRIMARY KEY,
    ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id     INT REFERENCES users(id) ON DELETE SET NULL,
    user_email  TEXT NOT NULL,                -- denormalised: the log survives user deletion
    via         TEXT NOT NULL,                -- 'mcp' (external client) or 'chat' (dashboard agent)
    server_slug TEXT,
    tool_name   TEXT NOT NULL,
    duration_ms INT NOT NULL,
    outcome     TEXT NOT NULL,                -- success | error | timeout | denied | unreachable
    error       TEXT
);
CREATE INDEX IF NOT EXISTS audit_log_ts ON audit_log (ts DESC);
"""


async def _init_conn(conn: asyncpg.Connection) -> None:
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def connect() -> None:
    global pool
    pool = await asyncpg.create_pool(config.DATABASE_URL, min_size=1, max_size=10, init=_init_conn)
    async with pool.acquire() as conn:
        # Advisory lock: with several gateway replicas starting together, only one migrates.
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(4242)")
            await conn.execute(SCHEMA)


async def close() -> None:
    if pool:
        await pool.close()


async def fetch(sql: str, *args) -> list[dict]:
    return [dict(r) for r in await pool.fetch(sql, *args)]


async def fetchrow(sql: str, *args) -> dict | None:
    row = await pool.fetchrow(sql, *args)
    return dict(row) if row else None


async def execute(sql: str, *args) -> str:
    return await pool.execute(sql, *args)
