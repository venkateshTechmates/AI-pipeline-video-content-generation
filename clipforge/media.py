"""ffmpeg / ffprobe helpers used by TTS normalisation, the ffmpeg renderer and QA."""

from __future__ import annotations

import asyncio
import json
import re
import shlex
from pathlib import Path

from .config import get_settings


class MediaError(RuntimeError):
    pass


async def run(cmd: list[str], timeout: float = 900) -> tuple[str, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except TimeoutError:
        proc.kill()
        raise MediaError(f"timeout: {shlex.join(cmd[:6])}...") from None
    if proc.returncode != 0:
        raise MediaError(f"{shlex.join(cmd[:8])}... failed ({proc.returncode}): {err.decode()[-1500:]}")
    return out.decode(), err.decode()


def ffmpeg() -> str:
    return get_settings().ffmpeg_bin


def ffprobe() -> str:
    return get_settings().ffprobe_bin


async def probe(path: Path) -> dict:
    out, _ = await run([ffprobe(), "-v", "error", "-print_format", "json", "-show_format", "-show_streams",
                        str(path)])
    return json.loads(out)


async def duration(path: Path) -> float:
    info = await probe(path)
    return float(info["format"]["duration"])


async def loudness(path: Path) -> dict[str, float]:
    """Integrated loudness (LUFS), true peak and LRA via the loudnorm analysis pass."""
    _, err = await run([ffmpeg(), "-hide_banner", "-nostats", "-i", str(path), "-af",
                        "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"])
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", err, re.S)
    if not m:
        raise MediaError("could not parse loudnorm output")
    d = json.loads(m.group(0))
    return {"lufs": float(d["input_i"]), "true_peak": float(d["input_tp"]), "lra": float(d["input_lra"])}


async def normalize_loudness(src: Path, dst: Path, target: float = -16.0) -> Path:
    """Two-pass EBU R128 normalisation to `target` LUFS."""
    m = await loudness(src)
    if m["lufs"] == float("-inf") or m["lufs"] < -70:
        await run([ffmpeg(), "-y", "-i", str(src), "-c:a", "libmp3lame", "-b:a", "192k", str(dst)])
        return dst
    af = (f"loudnorm=I={target}:TP=-1.5:LRA=11:measured_I={m['lufs']}:measured_TP={m['true_peak']}"
          f":measured_LRA={m['lra']}:linear=true")
    await run([ffmpeg(), "-y", "-i", str(src), "-af", af, "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "192k",
               str(dst)])
    return dst


async def black_segments(path: Path, min_d: float = 0.5) -> list[tuple[float, float]]:
    _, err = await run([ffmpeg(), "-hide_banner", "-nostats", "-i", str(path), "-vf",
                        f"blackdetect=d={min_d}:pix_th=0.10", "-an", "-f", "null", "-"])
    return [(float(a), float(b)) for a, b in re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", err)]


async def freeze_segments(path: Path, min_d: float = 2.0) -> list[tuple[float, float]]:
    _, err = await run([ffmpeg(), "-hide_banner", "-nostats", "-i", str(path), "-vf",
                        f"freezedetect=n=-60dB:d={min_d}", "-an", "-f", "null", "-"])
    starts = [float(x) for x in re.findall(r"freeze_start: ([\d.]+)", err)]
    ends = [float(x) for x in re.findall(r"freeze_end: ([\d.]+)", err)]
    return list(zip(starts, ends + [float("inf")] * (len(starts) - len(ends)), strict=False))


async def extract_frame(path: Path, t: float, dst: Path, width: int = 540) -> Path:
    await run([ffmpeg(), "-y", "-ss", f"{t:.3f}", "-i", str(path), "-frames:v", "1", "-vf", f"scale={width}:-2",
               str(dst)])
    return dst


async def sample_frames(path: Path, n: int, dst_dir: Path) -> list[Path]:
    d = await duration(path)
    dst_dir.mkdir(parents=True, exist_ok=True)
    frames = []
    for i in range(n):
        t = d * (i + 0.5) / n
        frames.append(await extract_frame(path, t, dst_dir / f"frame_{i:02d}.jpg"))
    return frames


async def scene_scores(path: Path, n: int = 12) -> list[tuple[float, float]]:
    """Return (time, sharpness proxy) samples for thumbnail picking — higher is more detailed."""
    d = await duration(path)
    out = []
    for i in range(n):
        t = d * (i + 0.5) / n
        _, err = await run([ffmpeg(), "-hide_banner", "-nostats", "-ss", f"{t:.3f}", "-i", str(path),
                            "-frames:v", "1", "-vf", "signalstats,metadata=print", "-f", "null", "-"])
        m = re.search(r"lavfi\.signalstats\.YAVG=([\d.]+)", err)
        s = re.search(r"lavfi\.signalstats\.SATAVG=([\d.]+)", err)
        yavg = float(m.group(1)) if m else 0.0
        sat = float(s.group(1)) if s else 0.0
        # prefer mid-brightness, saturated frames
        out.append((t, sat - abs(yavg - 128) * 0.3))
    return out
