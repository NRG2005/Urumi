"""All configuration comes from environment variables, which Kubernetes fills
from ConfigMaps (plain settings) and Secrets (credentials)."""

import json
import os


def _env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None:
        raise RuntimeError(f"missing required env var {name}")
    return value


DATABASE_URL = _env("DATABASE_URL")
# Signs dashboard sessions and chat-agent tokens; also the root of the at-rest encryption key.
SECRET_KEY = _env("GATEWAY_SECRET_KEY")

PUBLIC_URL = _env("GATEWAY_PUBLIC_URL", "http://dash.localtest.me").rstrip("/")
# The chat agent reaches the gateway's own /mcp over HTTP, like any other MCP client.
INTERNAL_MCP_URL = _env("GATEWAY_INTERNAL_MCP_URL", "http://127.0.0.1:8000/mcp")

ADMIN_EMAIL = _env("ADMIN_EMAIL", "admin@urumi.local")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD")

# Servers registered on first boot, e.g. the store's woo-mcp (see Helm values).
SEED_SERVERS: list[dict] = json.loads(os.environ.get("SEED_SERVERS", "[]"))

# Upstream URLs that resolve to private addresses are refused (SSRF), except for these
# host suffixes: the cluster-internal MCP servers we deploy ourselves.
INTERNAL_HOST_ALLOWLIST = [h.strip() for h in os.environ.get("INTERNAL_HOST_ALLOWLIST", "").split(",") if h.strip()]

HEALTH_INTERVAL = float(os.environ.get("HEALTH_INTERVAL_SECONDS", "5"))
HEALTH_TIMEOUT = float(os.environ.get("HEALTH_TIMEOUT_SECONDS", "4"))
CALL_TIMEOUT = float(os.environ.get("CALL_TIMEOUT_SECONDS", "20"))

# Any OpenAI-compatible chat-completions API (Groq, Gemini, OpenRouter, a local Ollama...).
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "openai/gpt-oss-120b")

SESSION_COOKIE = "urumi_session"
COOKIE_SECURE = PUBLIC_URL.startswith("https://")
