"""Hook dedupe against the brand's last 90 days (embedding cosine similarity < 0.85)."""

from __future__ import annotations

import math

from .models import Hook


def cosine(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def filter_hooks(
    hooks: list[Hook],
    hook_vecs: list[list[float]],
    history: list[list[float]],
    banned: list[str],
    threshold: float = 0.85,
) -> list[tuple[Hook, float]]:
    """Return (hook, max_similarity) for hooks that are novel and not on a banned topic, best first.

    Accepted hooks are also compared with each other so the ranked list has no near-duplicates.
    """
    banned_l = [b.lower() for b in banned if b]
    kept: list[tuple[Hook, float, list[float]]] = []
    for h, v in sorted(zip(hooks, hook_vecs, strict=True), key=lambda x: -x[0].score):
        text = f"{h.text} {h.angle}".lower()
        if any(b in text for b in banned_l):
            continue
        sim = max((cosine(v, p) for p in history if p), default=0.0)
        if sim >= threshold:
            continue
        if any(cosine(v, kv) >= threshold for _, _, kv in kept):
            continue
        kept.append((h, sim, v))
    return [(h, s) for h, s, _ in kept]
