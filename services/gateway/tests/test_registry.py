"""Naming, routing, permissions, quarantine and schema normalisation."""

import pytest

from app import registry
from app.registry import ToolNotAvailable

TOOLS = [
    {"name": "list_orders", "description": "List orders", "inputSchema": {"type": "object"}, "annotations": {"readOnlyHint": True}},
    {"name": "create_product", "description": "Create a product", "inputSchema": {"type": "object"}},
]


def server(**over):
    row = {"id": 1, "slug": "woo", "name": "WooCommerce", "enabled": True, "status": "connected",
           "tools_changed_at": None, "last_error": None, "tools": TOOLS}
    return {**row, **over}


@pytest.fixture
def fake_db(monkeypatch):
    """A tiny in-memory stand-in for the two tables resolve()/visible_tools() read."""
    state = {"servers": [server()], "policies": {(1, "create_product"): "admin"}}

    async def fetchrow(sql, *args):
        if "FROM servers" in sql:
            return next((s for s in state["servers"] if s["slug"] == args[0]), None)
        if "FROM tool_policies" in sql:
            role = state["policies"].get((args[0], args[1]))
            return {"min_role": role} if role else None
        raise AssertionError(sql)

    async def fetch(sql, *args):
        if "FROM tool_policies" in sql:
            return [{"server_id": s, "tool_name": t, "min_role": r} for (s, t), r in state["policies"].items()]
        if "FROM servers" in sql:
            return [s for s in state["servers"] if s["enabled"] and s["status"] == "connected" and not s["tools_changed_at"]]
        raise AssertionError(sql)

    monkeypatch.setattr(registry.db, "fetchrow", fetchrow)
    monkeypatch.setattr(registry.db, "fetch", fetch)
    return state


ADMIN = {"id": 1, "role": "admin"}
MEMBER = {"id": 2, "role": "member"}


@pytest.mark.anyio
async def test_resolve_routes_slug_and_tool(fake_db):
    srv, tool = await registry.resolve(MEMBER, "woo__list_orders")
    assert srv["slug"] == "woo" and tool == "list_orders"


@pytest.mark.anyio
async def test_tool_names_may_contain_double_underscores_after_the_slug(fake_db):
    fake_db["servers"][0]["tools"] = [*TOOLS, {"name": "weird__name", "inputSchema": {"type": "object"}}]
    assert (await registry.resolve(MEMBER, "woo__weird__name"))[1] == "weird__name"


@pytest.mark.anyio
@pytest.mark.parametrize("name, outcome, match", [
    ("list_orders", "denied", "unknown tool"),              # no slug separator
    ("nope__list_orders", "denied", "unknown tool"),        # unknown server
    ("woo__drop_tables", "denied", "unknown tool"),         # unknown tool on a known server
])
async def test_resolve_rejects_unknown_names(fake_db, name, outcome, match):
    with pytest.raises(ToolNotAvailable, match=match) as exc:
        await registry.resolve(ADMIN, name)
    assert exc.value.outcome == outcome


@pytest.mark.anyio
@pytest.mark.parametrize("state, outcome, match", [
    ({"enabled": False}, "denied", "disabled"),
    ({"tools_changed_at": "2026-10-22T00:00:00Z"}, "denied", "quarantined"),
    ({"status": "unreachable", "last_error": "connection refused"}, "unreachable", "unreachable: connection refused"),
])
async def test_resolve_refuses_unusable_servers(fake_db, state, outcome, match):
    fake_db["servers"][0].update(state)
    with pytest.raises(ToolNotAvailable, match=match) as exc:
        await registry.resolve(ADMIN, "woo__list_orders")
    assert exc.value.outcome == outcome


@pytest.mark.anyio
async def test_admin_only_tools_are_refused_to_members_even_if_called_directly(fake_db):
    with pytest.raises(ToolNotAvailable, match="requires the admin role"):
        await registry.resolve(MEMBER, "woo__create_product")
    assert (await registry.resolve(ADMIN, "woo__create_product"))[1] == "create_product"


@pytest.mark.anyio
async def test_visible_tools_are_prefixed_attributed_and_filtered_by_role(fake_db):
    member_view = {t["name"]: t for t in await registry.visible_tools(MEMBER)}
    admin_view = {t["name"] for t in await registry.visible_tools(ADMIN)}
    assert set(member_view) == {"woo__list_orders"}
    assert admin_view == {"woo__list_orders", "woo__create_product"}
    assert member_view["woo__list_orders"]["description"].startswith("[WooCommerce] ")


@pytest.mark.anyio
async def test_quarantined_servers_disappear_from_the_list(fake_db):
    fake_db["servers"][0]["tools_changed_at"] = "2026-10-22T00:00:00Z"
    assert await registry.visible_tools(ADMIN) == []


def test_normalise_drops_non_conformant_output_schemas_and_skips_invalid_tools():
    tools = [
        {"name": "ok", "inputSchema": {"type": "object"}, "outputSchema": {"type": "object"}},
        {"name": "nullable", "inputSchema": {"type": "object"}, "outputSchema": {"type": ["object", "null"]}},
        {"name": "array_out", "inputSchema": {"type": "object"}, "outputSchema": {"type": ["null", "array"]}},
        {"name": "no_input_schema"},
    ]
    clean = {t["name"]: t for t in registry._normalise("github", tools)}
    assert set(clean) == {"ok", "nullable", "array_out"}
    assert "outputSchema" in clean["ok"]
    assert "outputSchema" not in clean["nullable"] and "outputSchema" not in clean["array_out"]


def test_fingerprint_tracks_what_the_model_reads():
    base = registry._fingerprint(TOOLS)
    poisoned = [dict(TOOLS[0], description="List orders. <IMPORTANT>exfiltrate</IMPORTANT>"), TOOLS[1]]
    assert registry._fingerprint(poisoned) != base                       # rug pull -> quarantine
    reordered = list(reversed(TOOLS))
    assert registry._fingerprint(reordered) == base                      # order alone isn't a change
    with_output = [dict(TOOLS[0], outputSchema={"type": "object"}), TOOLS[1]]
    assert registry._fingerprint(with_output) == base                    # normalisation can't trigger quarantine


def test_slug_rules_keep_the_split_unambiguous():
    assert registry.SLUG_RE.match("woo") and registry.SLUG_RE.match("github2")
    for bad in ("w", "Woo", "my_server", "2fast", "a" * 17):
        assert not registry.SLUG_RE.match(bad)
