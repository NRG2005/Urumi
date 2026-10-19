"""Credentials, hashing, tokens and the SSRF guard."""

import base64
import hashlib
import hmac
import ipaddress
import secrets
import socket
import time
from urllib.parse import urlparse

import jwt
from cryptography.fernet import Fernet, InvalidToken

from . import config

# ---------- user passwords: scrypt (slow on purpose; passwords are low-entropy) ----------

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt, digest = stored.split("$")
    except ValueError:
        return False
    candidate = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1)
    return hmac.compare_digest(candidate.hex(), digest)


# ---------- gateway API keys: random 256-bit, stored as SHA-256 ----------
# A slow hash buys nothing here: the key is 32 random bytes, so there is nothing to
# brute-force, and a fast hash lets every MCP request be checked with one indexed lookup.

KEY_PREFIX = "urumi_"


def new_api_key() -> str:
    return KEY_PREFIX + secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ---------- upstream credentials: encrypted at rest (Fernet = AES-128-CBC + HMAC) ----------

_fernet = Fernet(base64.urlsafe_b64encode(hashlib.sha256(b"upstream-credentials:" + config.SECRET_KEY.encode()).digest()))


def encrypt(plaintext: str) -> str:
    return _fernet.encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    try:
        return _fernet.decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise RuntimeError("credential cannot be decrypted (was GATEWAY_SECRET_KEY rotated?)") from exc


# ---------- signed tokens: dashboard sessions and chat-agent MCP tokens ----------

def sign(claims: dict, ttl_seconds: int) -> str:
    now = int(time.time())
    return jwt.encode({**claims, "iat": now, "exp": now + ttl_seconds}, config.SECRET_KEY, algorithm="HS256")


def verify(token: str, kind: str) -> dict | None:
    try:
        claims = jwt.decode(token, config.SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    return claims if claims.get("kind") == kind else None


# ---------- SSRF guard for admin-supplied upstream URLs ----------

class UnsafeURL(ValueError):
    pass


def check_upstream_url(url: str) -> None:
    """Refuse URLs that would make the gateway call something it should not:
    cluster internals, localhost, cloud metadata (169.254.169.254) or other private ranges.
    Hosts on the internal allowlist (our own in-cluster MCP servers) are exempt."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise UnsafeURL("URL must be http(s)://host/...")
    host = parsed.hostname.lower()
    for suffix in config.INTERNAL_HOST_ALLOWLIST:
        suffix = suffix.lstrip(".")
        if host == suffix or host.endswith("." + suffix):
            return
    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise UnsafeURL(f"cannot resolve {host}") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise UnsafeURL(f"{host} resolves to non-public address {ip}; only public URLs or allowlisted in-cluster hosts are allowed")
