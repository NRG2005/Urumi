"""Tool search: find the few relevant tools among many, so a model never has to
read every tool's schema.

Ten servers can mean hundreds of tools. Sending all their schemas with every
model request is slow, expensive and (on small context or rate-limited models)
impossible. Instead the model gets one `search_tools` tool, searches for what
it needs, and only the matching tools are loaded with their full schemas.

Ranking is plain keyword scoring over tool names and descriptions: no
embeddings, no extra service, fully explainable. Names count more than
descriptions, and server names count too ("github", "woo", "orders").
"""

import re

_WORD = re.compile(r"[a-z0-9]+")
_STOP = {"a", "an", "the", "to", "of", "for", "and", "or", "in", "on", "by", "with", "from", "is", "are", "get", "my", "me"}


def _words(text: str) -> set[str]:
    words = {w for w in _WORD.findall(text.lower()) if w not in _STOP}
    # Crude stemming so "orders" matches "order" and "issues" matches "issue".
    return words | {w[:-1] for w in words if len(w) > 3 and w.endswith("s")}


def search(tools: list[dict], query: str, limit: int = 6) -> list[dict]:
    """tools: [{"name", "description", ...}] as listed by the gateway. Returns the best matches."""
    terms = _words(query)
    scored = []
    for t in tools:
        name_words = _words(t["name"].replace("__", " ").replace("_", " ").replace("-", " "))
        desc_words = _words(t.get("description") or "")
        score = 3 * len(terms & name_words) + len(terms & desc_words)
        if score:
            scored.append((score, t["name"], t))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [t for _, _, t in scored[:limit]]


def catalog(tools: list[dict]) -> str:
    """One line per server, so the model knows what exists before searching."""
    servers: dict[str, tuple[str, int]] = {}
    for t in tools:
        slug = t["name"].split("__")[0]
        label = (t.get("description") or "").split("]")[0].lstrip("[") if (t.get("description") or "").startswith("[") else slug
        servers[slug] = (label, servers.get(slug, (label, 0))[1] + 1)
    return "\n".join(f"- {slug}: {label} ({n} tools)" for slug, (label, n) in sorted(servers.items()))
