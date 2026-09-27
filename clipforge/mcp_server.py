"""MCP server (PRD §8 "MCP surface"): lets Claude/agents drive the pipeline.

Tools: create_run, get_run, approve_run, list_queue (+ list_brands). It is a thin
client of the ClipForge API, so it works against any deployment:
  CLIPFORGE_API_URL (default http://localhost:8000), CLIPFORGE_API_TOKEN (= API_TOKEN on the server).
Run: `clipforge mcp` (stdio) — e.g. `claude mcp add clipforge -- clipforge mcp`.
"""

from __future__ import annotations

import os
from typing import Any, Literal

import httpx

try:  # mcp >= 2
    from mcp.server.mcpserver import MCPServer
except ImportError:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP as MCPServer

mcp = MCPServer("clipforge", instructions="Create, inspect and approve ClipForge short-form video runs.")


def _client() -> httpx.AsyncClient:
    token = os.environ.get("CLIPFORGE_API_TOKEN")
    return httpx.AsyncClient(
        base_url=os.environ.get("CLIPFORGE_API_URL", "http://localhost:8000"), timeout=30,
        headers={"Authorization": f"Bearer {token}"} if token else {},
    )


async def _req(method: str, path: str, **kw: Any) -> Any:
    async with _client() as c:
        r = await c.request(method, path, **kw)
        if r.status_code >= 400:
            raise RuntimeError(f"{method} {path} -> {r.status_code}: {r.text[:500]}")
        return r.json()


@mcp.tool()
async def list_brands() -> list[dict[str, Any]]:
    """List brands (id, name, tier, budget per run, trust score)."""
    data = await _req("GET", "/brands")
    return [{k: b[k] for k in ("id", "name", "tier", "budget_per_run", "trust_score")} for b in data["items"]]


@mcp.tool()
async def create_run(brand_id: str, brief: str | None = None, tier: Literal["economy", "premium"] | None = None,
                     schedule: str | None = None, platforms: list[str] | None = None) -> dict[str, Any]:
    """Start a video run for a brand. `brief` is the topic (optional: the brand's niche is used).
    `schedule` is an ISO-8601 publish time (optional: next brand calendar slot).
    `platforms` subset of youtube, instagram, tiktok, linkedin, x, facebook, threads, pinterest, bluesky, reddit."""
    body = {k: v for k, v in {"brand_id": brand_id, "brief": brief, "tier": tier, "schedule": schedule,
                              "platforms": platforms}.items() if v is not None}
    return await _req("POST", "/runs", json=body)


@mcp.tool()
async def get_run(run_id: str) -> dict[str, Any]:
    """Run status, per-stage progress, cost, script, QA report, render URLs and posts."""
    d = await _req("GET", f"/runs/{run_id}")
    st = d["state"]
    return {
        "run": d["run"],
        "stages": [{k: s[k] for k in ("name", "status", "attempt", "provider", "cost", "error")} for s in d["stages"]],
        "script": st.get("script"),
        "qa": st.get("qa_report"),
        "renders": [{"aspect": r["aspect"], "url": r["url"]} for r in st.get("renders", [])],
        "metadata": st.get("metadata"),
        "posts": d["posts"],
    }


@mcp.tool()
async def approve_run(run_id: str, decision: Literal["approve", "regenerate", "edit", "reject"] = "approve",
                      stage: str | None = None, patch: dict[str, Any] | None = None,
                      note: str | None = None) -> dict[str, Any]:
    """Resolve the approval gate. regenerate needs `stage` (ideate|script|tts|gen_shots|music|render);
    edit needs `patch` with Script fields (title, hook, vo_text, caption_text, cta, beats)."""
    body = {k: v for k, v in {"decision": decision, "stage": stage, "patch": patch, "note": note}.items()
            if v is not None}
    return await _req("POST", f"/runs/{run_id}/approve", json=body)


@mcp.tool()
async def list_queue(brand_id: str | None = None) -> list[dict[str, Any]]:
    """Runs waiting for human approval, with QA score, title, preview URL and cost."""
    d = await _req("GET", "/queue", params={"brand_id": brand_id} if brand_id else None)
    return [{"run_id": i["run"]["id"], "brand": i["brand_name"], "title": (i.get("script") or {}).get("title"),
             "qa_score": (i.get("qa") or {}).get("score"), "preview_url": i["preview_url"],
             "cost_total": i["cost_total"], "budget": i["budget"]} for i in d["items"]]


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
