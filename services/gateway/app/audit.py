from . import db


async def record(user: dict | None, via: str, server_slug: str | None, tool: str,
                 duration_ms: int, outcome: str, error: str | None = None) -> None:
    await db.execute(
        """INSERT INTO audit_log (user_id, user_email, via, server_slug, tool_name, duration_ms, outcome, error)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)""",
        user["id"] if user else None, user["email"] if user else "(unknown)", via,
        server_slug, tool, duration_ms, outcome, (error or None) and error[:500],
    )
