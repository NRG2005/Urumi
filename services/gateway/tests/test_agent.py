"""The streamed LLM call: text and tool-call fragments are reassembled, events are emitted."""

import json

import httpx2
import pytest

from app import agent


def sse(*chunks):
    body = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
    return httpx2.Response(200, text=body, headers={"content-type": "text/event-stream"})


def delta(**d):
    return {"choices": [{"delta": d}]}


@pytest.mark.anyio
async def test_streamed_answer_and_split_tool_call_are_reassembled():
    reply = sse(
        delta(reasoning="Need orders."),
        delta(content="Checking "), delta(content="now."),
        delta(tool_calls=[{"index": 0, "id": "call_1", "function": {"name": "woo__list_", "arguments": "{\"da"}}]),
        delta(tool_calls=[{"index": 0, "function": {"name": "orders", "arguments": "te\": \"today\"}"}}]),
    )
    events = []

    async def emit(e):
        events.append(e)

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(lambda req: reply)) as http:
        message = await agent._complete(http, [{"role": "user", "content": "hi"}], [], emit)

    assert message["content"] == "Checking now."
    call = message["tool_calls"][0]
    assert call["id"] == "call_1" and call["function"]["name"] == "woo__list_orders"
    assert json.loads(call["function"]["arguments"]) == {"date": "today"}
    assert [e["t"] for e in events] == ["reasoning", "delta", "delta"]


@pytest.mark.anyio
async def test_unloaded_tool_rejection_is_recognised():
    body = {"error": {"message": "Tool call validation failed: attempted to call tool 'woo__list_products' which was not in request.tools"}}
    transport = httpx2.MockTransport(lambda req: httpx2.Response(400, json=body))
    async with httpx2.AsyncClient(transport=transport) as http:
        with pytest.raises(agent.UnloadedToolCall) as exc:
            await agent._complete(http, [], [], agent._ignore)
    assert exc.value.tool == "woo__list_products"


@pytest.mark.anyio
async def test_provider_errors_surface_as_llm_errors():
    transport = httpx2.MockTransport(lambda req: httpx2.Response(500, text="upstream exploded"))
    async with httpx2.AsyncClient(transport=transport) as http:
        with pytest.raises(agent.LLMError, match="500"):
            await agent._complete(http, [], [], agent._ignore)


def test_old_tool_results_are_trimmed_but_recent_messages_kept():
    history = [{"role": "user", "content": "q"}, {"role": "tool", "content": "x" * 5000, "tool_call_id": "1"}]
    compact = agent._compact(history)
    assert compact[0] == history[0] and len(compact[1]["content"]) == agent.MAX_OLD_RESULT_CHARS
