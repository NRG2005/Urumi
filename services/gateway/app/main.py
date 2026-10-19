"""Gateway entrypoint: dashboard REST API at /api, the team MCP endpoint at /mcp."""

import asyncio
import contextlib
import logging

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from starlette.routing import Route

from . import config, db, registry
from .api import router
from .mcp_gateway import mcp_asgi, session_manager
from .security import hash_password

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpx2").setLevel(logging.WARNING)
log = logging.getLogger("gateway")


async def ensure_admin() -> None:
    """First boot: create the admin account from the Secret-provided password."""
    if await db.fetchrow("SELECT 1 FROM users WHERE role = 'admin'") or not config.ADMIN_PASSWORD:
        return
    await db.execute(
        "INSERT INTO users (email, name, role, password_hash) VALUES ($1, 'Admin', 'admin', $2) ON CONFLICT (email) DO NOTHING",
        config.ADMIN_EMAIL, hash_password(config.ADMIN_PASSWORD),
    )
    log.info("created admin user %s", config.ADMIN_EMAIL)


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    await db.connect()
    await ensure_admin()
    await registry.seed()
    health = asyncio.create_task(registry.health_loop())
    async with session_manager.run():
        yield
    health.cancel()
    await db.close()


app = FastAPI(title="Urumi MCP Gateway", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")
app.include_router(router)
# Route (not Mount) so "/mcp" is served as-is without a redirect to "/mcp/".
app.router.routes.append(Route("/mcp", endpoint=mcp_asgi, methods=["GET", "POST", "DELETE"]))


@app.get("/healthz")
async def healthz():
    return {"ok": True}


@app.get("/readyz")
async def readyz():
    try:
        await db.fetchrow("SELECT 1")
    except Exception:  # noqa: BLE001
        return JSONResponse({"ok": False}, status_code=503)
    return {"ok": True}
