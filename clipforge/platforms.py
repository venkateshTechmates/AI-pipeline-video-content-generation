"""Per-platform limits, disclosure rules and metadata sanitising (PRD stage 9)."""

from __future__ import annotations

import re
from dataclasses import dataclass

from .models import Aspect, Platform


@dataclass(frozen=True)
class PlatformLimits:
    title: int
    description: int
    hashtags: int
    max_seconds: int
    aspect: Aspect
    disclosure_required: bool  # platform policy requires labelling realistic AI content


PLATFORM_LIMITS: dict[Platform, PlatformLimits] = {
    Platform.youtube: PlatformLimits(100, 5000, 15, 180, Aspect.vertical, True),
    Platform.instagram: PlatformLimits(100, 2200, 30, 180, Aspect.vertical, True),
    Platform.tiktok: PlatformLimits(100, 2200, 20, 600, Aspect.vertical, True),
    Platform.linkedin: PlatformLimits(150, 3000, 10, 600, Aspect.square, False),
    Platform.x: PlatformLimits(100, 280, 3, 140, Aspect.vertical, False),
}


def clean_hashtag(tag: str) -> str:
    return re.sub(r"[^\w]", "", tag.lstrip("#"))


def truncate(text: str, limit: int) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    sp = cut.rfind(" ")
    return (cut[:sp] if sp > limit * 0.6 else cut).rstrip(" ,.;:") + "…"


def fit_metadata(platform: Platform, title: str, description: str, hashtags: list[str]) -> tuple[str, str, list[str]]:
    lim = PLATFORM_LIMITS[platform]
    tags: list[str] = []
    for t in hashtags:
        c = clean_hashtag(t)
        if c and c.lower() not in (x.lower() for x in tags):
            tags.append(c)
    tags = tags[: lim.hashtags]
    # the description budget must also hold the appended hashtags
    tag_len = sum(len(t) + 2 for t in tags) + 2
    return truncate(title, lim.title), truncate(description, max(20, lim.description - tag_len)), tags
