"""Credentials, tokens and the SSRF guard."""

import hashlib
import time

import pytest

from app import security


def test_passwords_are_salted_scrypt_and_verify():
    stored = security.hash_password("correct horse")
    assert stored.startswith("scrypt$") and "correct horse" not in stored
    assert security.hash_password("correct horse") != stored          # random salt
    assert security.verify_password("correct horse", stored)
    assert not security.verify_password("wrong", stored)
    assert not security.verify_password("x", "not-a-hash")


def test_api_keys_are_random_and_stored_as_sha256():
    key = security.new_api_key()
    assert key.startswith("urumi_") and len(key) > 40
    assert key != security.new_api_key()
    assert security.hash_token(key) == hashlib.sha256(key.encode()).hexdigest()


def test_upstream_credentials_round_trip_encrypted():
    token = "github_pat_example"
    sealed = security.encrypt(token)
    assert token not in sealed
    assert security.decrypt(sealed) == token
    with pytest.raises(RuntimeError):
        security.decrypt(sealed[:-4] + "AAAA")                       # tampered ciphertext


def test_signed_tokens_check_kind_expiry_and_tampering():
    session = security.sign({"kind": "session", "sub": "1"}, 60)
    assert security.verify(session, "session")["sub"] == "1"
    assert security.verify(session, "agent") is None                  # a session can't act as an agent token
    assert security.verify(session[:-2] + "xx", "session") is None
    expired = security.sign({"kind": "agent", "sub": "1"}, -1)
    assert security.verify(expired, "agent") is None


@pytest.mark.parametrize("url", [
    "http://169.254.169.254/latest/meta-data",       # cloud metadata
    "http://127.0.0.1:5432/mcp",                     # loopback
    "http://10.42.0.7:8000/mcp",                     # pod network
    "http://192.168.1.10/mcp",                       # private LAN
    "ftp://example.com/mcp",                         # wrong scheme
])
def test_ssrf_guard_refuses_internal_targets(url):
    with pytest.raises(security.UnsafeURL):
        security.check_upstream_url(url)


def test_ssrf_guard_allows_public_and_allowlisted_in_cluster_hosts():
    security.check_upstream_url("https://8.8.8.8/mcp")
    security.check_upstream_url("http://store-woo-mcp.store.svc.cluster.local:8000/mcp")
    security.check_upstream_url("http://everything.mcp.svc.cluster.local:3001/mcp")


def test_ssrf_allowlist_excludes_the_gateway_namespace():
    # gateway-postgres lives there; it must never be registrable as an "upstream"
    with pytest.raises(security.UnsafeURL):
        security.check_upstream_url("http://gateway-postgres.gateway.svc.cluster.local:5432/mcp")
