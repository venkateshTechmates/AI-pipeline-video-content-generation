"""Billing-aware shot timeline.

Video models bill per generated clip in fixed durations (Kling: 5 s / 10 s, Veo: 4/6/8 s).
A naive 4 x 8.5 s timeline bills 4 x 10 s. Instead we choose, per shot, the cheapest
billable clip length and move screen time between shots: a clip can be slowed down up
to STRETCH (imperceptible for b-roll) or trimmed. Shot order and relative emphasis are
kept; every shot keeps at least MIN_SHOT seconds.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

STRETCH = 1.25
MIN_SHOT = 2.0


@dataclass
class Segment:
    shot_index: int
    part: int
    billed: float  # seconds requested from / billed by the provider
    length: float  # seconds on the timeline (<= billed * STRETCH)


def _options(allowed: tuple[float, ...] | None, max_clip: float, want: float) -> list[float]:
    if allowed:
        return sorted(allowed)
    # continuous providers bill per second: offer whole-second lengths
    return [float(s) for s in range(max(1, math.ceil(MIN_SHOT / STRETCH)), int(max_clip) + 1)] or [max_clip]


def plan_timeline(
    lengths: list[float], total: float, allowed: tuple[float, ...] | None, max_clip: float,
    stretch: float = STRETCH,
) -> list[Segment]:
    """Return segments covering exactly `total` seconds with minimal billed seconds."""
    total = round(total, 3)
    # 1) split shots that exceed what one clip can cover
    parts: list[tuple[int, int, float]] = []
    for i, L in enumerate(lengths):
        k = max(1, math.ceil(L / (max_clip * stretch)))
        parts += [(i, p, L / k) for p in range(k)]
    opts = _options(allowed, max_clip, max(lengths))
    # 2) start every segment at the cheapest option that covers a minimal shot
    billed = [next((o for o in opts if o * stretch >= MIN_SHOT), opts[-1]) for _ in parts]

    def capacity() -> float:
        return sum(b * stretch for b in billed)

    # 3) upgrade the most under-served segment until the timeline is covered
    while capacity() < total - 1e-6:
        cand = [(w / (b * stretch), j) for j, ((_, _, w), b) in enumerate(zip(parts, billed, strict=True))
                if b < opts[-1]]
        if not cand:  # everything maxed: add another part to the longest shot
            j = max(range(len(parts)), key=lambda x: parts[x][2])
            i, p, w = parts[j]
            parts[j] = (i, p, w / 2)
            parts.insert(j + 1, (i, p + 1, w / 2))
            billed.insert(j + 1, opts[0])
            continue
        _, j = max(cand)
        billed[j] = next(o for o in opts if o > billed[j])

    # 4) water-fill screen time proportional to the original weights, capped by each clip's capacity
    caps = [b * stretch for b in billed]
    weights = [w for _, _, w in parts]
    out = [0.0] * len(parts)
    free = set(range(len(parts)))
    remaining = total
    while free:
        wsum = sum(weights[j] for j in free)
        capped = [j for j in free if remaining * weights[j] / wsum > caps[j]]
        if not capped:
            for j in free:
                out[j] = remaining * weights[j] / wsum
            break
        for j in capped:
            out[j] = caps[j]
            remaining -= caps[j]
            free.discard(j)
    return [Segment(shot_index=i, part=p, billed=b, length=round(L, 3))
            for (i, p, _), b, L in zip(parts, billed, out, strict=True)]
