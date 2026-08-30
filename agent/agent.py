#!/usr/bin/env python3
"""Minimal FastAPI backend using Strands Skills and Grafana MCP."""

import json
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from mcp.client.streamable_http import streamablehttp_client
from pydantic import BaseModel
from strands import Agent
from strands.models.openai import OpenAIModel
from strands.tools.mcp import MCPClient
from strands.vended_plugins.skills import AgentSkills

MCP_URL = os.getenv("MCP_URL", "http://127.0.0.1:8000/mcp")
MODEL_ID = os.getenv(
    "OPENROUTER_MODEL", "nvidia/nemotron-3-ultra-550b-a55b:free"
)
SYSTEM = """You are a site-reliability assistant for a service dashboard.
For dashboard questions, load the dashboard-analysis skill and use Grafana MCP
to query live metrics before answering. Be concise and support the verdict with
the relevant endpoint, host, or region and measured value.
"""

app = FastAPI()


class Chat(BaseModel):
    message: str


def grafana_mcp() -> MCPClient:
    return MCPClient(lambda: streamablehttp_client(MCP_URL))


def sse(event: dict) -> str:
    return "data: " + json.dumps(event) + "\n\n"


@app.get("/api/health")
def health() -> dict:
    try:
        with grafana_mcp() as client:
            return {"ok": True, "tools": len(client.list_tools_sync())}
    except Exception:
        return {"ok": False, "tools": 0}


@app.post("/api/chat")
async def chat(req: Chat) -> StreamingResponse:
    async def events():
        if not os.getenv("OPENROUTER_API_KEY"):
            yield sse({"error": "OPENROUTER_API_KEY is not set"})
            yield "data: [DONE]\n\n"
            return

        client = grafana_mcp()
        try:
            model = OpenAIModel(
                client_args={
                    "api_key": os.environ["OPENROUTER_API_KEY"],
                    "base_url": "https://openrouter.ai/api/v1",
                },
                model_id=MODEL_ID,
            )
            agent = Agent(
                model=model,
                system_prompt=SYSTEM,
                tools=[client],
                plugins=[
                    AgentSkills(
                        skills=Path(__file__).parent / "skills",
                        strict=True,
                    )
                ],
                callback_handler=None,
            )
            seen_tools = set()
            async for event in agent.stream_async(req.message):
                if event.get("reasoningText"):
                    yield sse({"type": "thinking", "content": event["reasoningText"]})
                if event.get("data"):
                    yield sse({"type": "answer", "content": event["data"]})
                tool = event.get("current_tool_use") or {}
                tool_id = tool.get("toolUseId")
                if tool_id and tool_id not in seen_tools:
                    seen_tools.add(tool_id)
                    yield sse({"type": "tool_start", "name": tool.get("name", "tool")})
        except Exception as error:  # noqa: BLE001
            yield sse({"error": str(error)})
        finally:
            try:
                client.stop(None, None, None)
            except Exception:  # noqa: BLE001
                pass
        yield "data: [DONE]\n\n"

    return StreamingResponse(events(), media_type="text/event-stream")
