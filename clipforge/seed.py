"""Demo data: a sample brand kit (used by `clipforge seed` and local demos)."""

from __future__ import annotations

from .models import DEFAULT_PLATFORMS, Brand, BrandKit, CalendarSlot, CaptionStyle, Platform, PostingCalendar, Tier

DEMO_BRAND_ID = "00000000-0000-4000-8000-000000000001"


def demo_brand(org_id: str = "default") -> Brand:
    return Brand(
        id=DEMO_BRAND_ID, org_id=org_id, name="Daily Habits Lab", tier=Tier.economy, budget_per_run=3.0,
        daily_budget=30.0, auto_approve_after=10,
        kit=BrandKit(
            niche="productivity and healthy habits", audience="busy professionals 25-40",
            tone="warm, punchy, practical", hashtags=["habits", "productivity"],
            banned_topics=["politics", "gambling", "medical diagnosis"],
            caption_style=CaptionStyle(highlight_color="#22D3EE"), music_moods=["upbeat"],
            platforms=[*DEFAULT_PLATFORMS, Platform.threads, Platform.pinterest, Platform.bluesky],
            platform_options={Platform.facebook: {"page_id": "1029384756"},
                              Platform.pinterest: {"board_id": "daily-habits"}},
        ),
        calendar=PostingCalendar(timezone="America/New_York",
                                 slots=[CalendarSlot(weekday=d, time="18:00") for d in range(5)]),
    )
