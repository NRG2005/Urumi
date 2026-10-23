import os
import sys

import pytest

# app.config reads the environment at import time, as it does in the pod.
os.environ.setdefault("DATABASE_URL", "postgresql://unused/for-unit-tests")
os.environ.setdefault("GATEWAY_SECRET_KEY", "unit-test-secret-at-least-32-bytes-long")
os.environ.setdefault("INTERNAL_HOST_ALLOWLIST", "store.svc.cluster.local,mcp.svc.cluster.local")
os.environ.setdefault("LLM_API_KEY", "test-key")
os.environ.setdefault("LLM_BASE_URL", "https://llm.test/v1")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture
def anyio_backend():
    return "asyncio"
