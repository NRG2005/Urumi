"""WooCommerce OAuth 1.0a signing: the details that broke in practice (docs/lessons.md #2, #13)."""

import base64
import hashlib
import hmac
from urllib.parse import quote

from woo_client import WooClient, _enc, _php_str

INTERNAL = "http://store-wordpress.store.svc.cluster.local"


def client(public: str) -> WooClient:
    return WooClient(INTERNAL, public, "ck_key", "cs_secret")


def test_signs_for_public_host_not_the_internal_service():
    base = client("http://store.localtest.me").string_to_sign("GET", "/orders", {})
    assert base.startswith("GET&" + quote("http://store.localtest.me/wp-json/wc/v3/orders", safe=""))
    assert "store-wordpress" not in base


def test_https_store_reached_over_http_signs_with_the_request_scheme():
    # WooCommerce rebuilds the URL from its home host and the *incoming* scheme (http in-cluster).
    base = client("https://store.example.com").string_to_sign("GET", "/orders", {})
    assert quote("http://store.example.com/", safe="") in base
    assert "https" not in base


def test_parameters_are_sorted_and_double_encoded_like_php():
    base = client("http://s.test").string_to_sign("GET", "/orders", {"after": "2026-10-22T00:00:00", "a": "1"})
    query = base.split("&", 2)[2]
    assert query.index("a%3D1") < query.index("after%3D")          # sorted by key
    assert "2026-10-22T00%253A00%253A00" in query                     # ':' -> %3A -> %253A


def test_signature_is_hmac_sha256_of_the_base_string_with_secret_and_ampersand():
    c = client("http://s.test")
    signed = c._sign("GET", "/products", {"per_page": 5})
    params = {k: v for k, v in signed.items() if k != "oauth_signature"}
    expected = base64.b64encode(hmac.new(b"cs_secret&", c.string_to_sign("GET", "/products", params).encode(), hashlib.sha256).digest()).decode()
    assert signed["oauth_signature"] == expected
    assert signed["oauth_signature_method"] == "HMAC-SHA256"
    assert "cs_secret" not in signed.values()                         # the secret itself is never sent


def test_php_style_value_normalisation():
    assert _php_str(True) == "1" and _php_str(False) == "" and _php_str(20) == "20"
    assert _enc("a b") == "a%2520b"
