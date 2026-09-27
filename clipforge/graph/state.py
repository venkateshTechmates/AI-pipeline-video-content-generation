"""LangGraph state. Plain JSON-able dicts only (checkpointed to Postgres), and no
provider-specific state: provider choice lives in adapters (PRD §13)."""

from __future__ import annotations

from typing import Annotated, Any, TypedDict

RESET = "__reset__"


def merge_clips(old: list[dict] | None, new: list[Any] | None) -> list[dict]:
    """Reducer for the parallel shot fan-out: merge by timeline index.

    `None` or a list starting with RESET clears previous clips (regenerate).
    """
    if new is None:
        return []
    base = list(old or [])
    if new and new[0] == RESET:
        base, new = [], new[1:]
    by_idx = {c["index"]: c for c in base}
    for c in new:
        by_idx[c["index"]] = c
    return [by_idx[k] for k in sorted(by_idx)]


class RunState(TypedDict, total=False):
    run_id: str
    brand_id: str
    tier: str
    brief: str | None
    platforms: list[str]
    language: str
    subtitle_languages: list[str]
    nonce: dict[str, int]  # bumped per regenerate(stage) to bust content-addressed caches
    rejected_hooks: list[str]

    hooks: list[dict]
    hook: dict
    script: dict
    shot_list: dict
    vo: dict
    timeline: list[dict]  # [{index, shot_index, prompt, negative_prompt, start, duration}]
    ref_frame: str | None
    clips: Annotated[list[dict], merge_clips]
    music: dict | None
    renders: list[dict]
    subtitles: list[dict]  # [{language, srt, vtt, translated}]
    qa_report: dict
    decision: dict
    auto_approved: bool
    metadata: list[dict]
    posts: list[dict]
    status: str


# Downstream keys cleared when a stage is regenerated.
STAGE_OUTPUTS: dict[str, list[str]] = {
    "ideate": ["hooks", "hook"],
    "script": ["script", "shot_list"],
    "tts": ["vo", "timeline"],
    "gen_shots": ["clips", "ref_frame"],
    "music": ["music"],
    "render": ["renders", "subtitles"],
    "qa": ["qa_report"],
}
ORDER = ["ideate", "script", "tts", "gen_shots", "music", "render", "qa"]


def clear_from(stage: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for s in ORDER[ORDER.index(stage):]:
        for k in STAGE_OUTPUTS[s]:
            out[k] = None
    return out
