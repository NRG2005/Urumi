from app import toolsearch

INDEX = [
    {"name": "woo__list_orders", "description": "[WooCommerce] List orders, newest first."},
    {"name": "woo__create_product", "description": "[WooCommerce] Create a simple product."},
    {"name": "github__issue_write", "description": "[GitHub] Create or update an issue in a repository."},
    {"name": "everything__echo", "description": "[Everything] Echoes back the input"},
]


def test_names_outrank_descriptions_and_plurals_match():
    assert toolsearch.search(INDEX, "orders today")[0]["name"] == "woo__list_orders"
    assert toolsearch.search(INDEX, "create github issue")[0]["name"] == "github__issue_write"
    assert toolsearch.search(INDEX, "create product")[0]["name"] == "woo__create_product"


def test_no_match_returns_nothing_and_limit_is_respected():
    assert toolsearch.search(INDEX, "weather forecast") == []
    assert len(toolsearch.search(INDEX, "create", limit=1)) == 1


def test_catalog_summarises_servers_for_the_system_prompt():
    lines = toolsearch.catalog(INDEX).splitlines()
    assert "- woo: WooCommerce (2 tools)" in lines and "- github: GitHub (1 tools)" in lines
