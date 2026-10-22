"""Minimal async client for the WooCommerce REST API (wc/v3).

Why OAuth 1.0a: WooCommerce only accepts HTTP Basic auth over HTTPS. Inside the
cluster we talk plain HTTP to the WordPress Service, so every request is signed
with OAuth 1.0a (HMAC-SHA256) instead. The secret never goes over the wire;
only a signature computed from it does.

Why two base URLs: WooCommerce verifies the signature against its *own* home
URL (e.g. http://store.localtest.me), not the hostname we connect to. So we
sign for `public_url` but send the request to `internal_url` (the ClusterIP
Service), which never leaves the cluster. The scheme WooCommerce uses is that
of the incoming request, so on an https store reached over in-cluster http we
sign for http://<public host>.
"""

import base64
import hashlib
import hmac
import secrets
import time
from typing import Any
from urllib.parse import quote, unquote, urlsplit

import httpx


class WooError(Exception):
    """A WooCommerce API call failed; the message is safe to show to the model."""


def _enc(value: str) -> str:
    # Matches WooCommerce's PHP-side normalisation: encode once, then encode the '%'.
    return quote(unquote(value), safe="").replace("%", "%25")


def _php_str(value: Any) -> str:
    if isinstance(value, bool):
        return "1" if value else ""
    return str(value)


class WooClient:
    def __init__(self, internal_url: str, public_url: str, key: str, secret: str, timeout: float = 15.0):
        self.internal_url = internal_url.rstrip("/")
        # Public host, but the scheme we actually connect with (see module docstring).
        self.sign_base = f"{urlsplit(internal_url).scheme}://{urlsplit(public_url).netloc}"
        self.key = key
        self.secret = secret
        self.http = httpx.AsyncClient(timeout=timeout)

    def _sign(self, method: str, path: str, params: dict[str, Any]) -> dict[str, str]:
        oauth = {
            "oauth_consumer_key": self.key,
            "oauth_timestamp": str(int(time.time())),
            "oauth_nonce": secrets.token_hex(16),
            "oauth_signature_method": "HMAC-SHA256",
        }
        all_params = {k: _php_str(v) for k, v in {**params, **oauth}.items()}
        normalized = sorted((_enc(k), _enc(v)) for k, v in all_params.items())
        query = "%26".join(f"{k}%3D{v}" for k, v in normalized)
        base_uri = quote(f"{self.sign_base}/wp-json/wc/v3{path}", safe="")
        string_to_sign = f"{method}&{base_uri}&{query}"
        digest = hmac.new(f"{self.secret}&".encode(), string_to_sign.encode(), hashlib.sha256).digest()
        return {**all_params, "oauth_signature": base64.b64encode(digest).decode()}

    async def request(self, method: str, path: str, params: dict[str, Any] | None = None, json: Any = None) -> Any:
        params = {k: v for k, v in (params or {}).items() if v is not None}
        signed = self._sign(method, path, params)
        try:
            resp = await self.http.request(method, f"{self.internal_url}/wp-json/wc/v3{path}", params=signed, json=json)
        except httpx.HTTPError as exc:
            raise WooError(f"store unreachable: {exc.__class__.__name__}") from exc
        if resp.status_code >= 400:
            try:
                msg = resp.json().get("message", resp.text)
            except ValueError:
                msg = resp.text[:200]
            raise WooError(f"WooCommerce returned {resp.status_code}: {msg}")
        return resp.json()

    async def ping(self) -> bool:
        try:
            resp = await self.http.get(f"{self.internal_url}/wp-json/", timeout=5)
            return resp.status_code == 200
        except httpx.HTTPError:
            return False
