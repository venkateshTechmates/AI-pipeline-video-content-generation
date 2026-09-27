"""QA node checks (PRD stage 7).

Duration in range, loudness, caption sync drift < 150 ms, moderation (text + sampled
frames via vision LLM), black-frame / freeze detection, and output format.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from . import media
from .agents.llm import LLMBackend
from .captions import caption_drift_ms
from .models import QACheck, QAReport, Script, ShotList, WordTiming

MIN_S, MAX_S = 28.0, 62.0
TARGET_LUFS, LUFS_TOL = -16.0, 1.5
MAX_DRIFT_MS = 150.0


async def run_qa(
    video: Path,
    *,
    words: list[WordTiming],
    vo_duration: float,
    script: Script,
    shot_list: ShotList,
    banned: list[str],
    llm: LLMBackend,
    expected_size: tuple[int, int] = (1080, 1920),
    frames: int = 6,
) -> tuple[QAReport, int]:
    checks: list[QACheck] = []
    tokens = 0

    info = await media.probe(video)
    dur = float(info["format"]["duration"])
    checks.append(QACheck(name="duration", passed=MIN_S <= dur <= MAX_S, value=round(dur, 2),
                          detail=f"{MIN_S:.0f}-{MAX_S:.0f}s"))

    v = next((s for s in info["streams"] if s["codec_type"] == "video"), {})
    num, den = (v.get("r_frame_rate") or "0/1").split("/")
    fps = float(num) / float(den or 1)
    size_ok = (v.get("width"), v.get("height")) == expected_size
    fmt_ok = size_ok and abs(fps - 30) < 0.5 and v.get("codec_name") == "h264"
    checks.append(QACheck(name="format", passed=fmt_ok,
                          value=f"{v.get('width')}x{v.get('height')}@{fps:.2f} {v.get('codec_name')}",
                          detail=f"{expected_size[0]}x{expected_size[1]}@30 h264"))

    loud = await media.loudness(video)
    checks.append(QACheck(name="loudness", passed=abs(loud["lufs"] - TARGET_LUFS) <= LUFS_TOL,
                          value=round(loud["lufs"], 2), detail=f"{TARGET_LUFS}±{LUFS_TOL} LUFS"))

    drift = caption_drift_ms(words, vo_duration)
    checks.append(QACheck(name="caption_sync", passed=drift < MAX_DRIFT_MS, value=drift, detail="< 150 ms"))

    black = [s for s in await media.black_segments(video) if s[1] - s[0] >= 0.5]
    checks.append(QACheck(name="black_frames", passed=not black, value=black[:5], detail="no black >= 0.5 s"))
    freeze = await media.freeze_segments(video)
    long_freeze = [s for s in freeze if s[1] - s[0] >= 2.0]
    checks.append(QACheck(name="freeze", passed=not long_freeze, value=long_freeze[:5], detail="no freeze >= 2 s",
                          weight=0.5))

    text = "\n".join([script.title, script.vo_text, script.caption_text, script.cta,
                      *(s.prompt for s in shot_list.shots)])
    mt, t1 = await llm.moderate_text(text, banned)
    tokens += t1
    checks.append(QACheck(name="moderation_text", passed=mt.safe, value=mt.categories, detail=mt.reason))

    with tempfile.TemporaryDirectory() as d:
        fr = await media.sample_frames(video, frames, Path(d))
        mf, t2 = await llm.moderate_frames(fr, banned)
    tokens += t2
    checks.append(QACheck(name="moderation_frames", passed=mf.safe, value=mf.categories, detail=mf.reason))

    return QAReport(checks=checks), tokens
