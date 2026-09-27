"""Demo data: a sample brand kit (used by `clipforge seed` and local demos)."""

from __future__ import annotations

from .models import DEFAULT_PLATFORMS, Brand, BrandKit, CalendarSlot, CaptionStyle, Platform, PostingCalendar, Tier

DEMO_BRAND_ID = "00000000-0000-4000-8000-000000000001"


def demo_brand(org_id: str = "default") -> Brand:
    return Brand(
        id=DEMO_BRAND_ID, org_id=org_id, name="Daily Habits Lab", tier=Tier.economy, budget_per_run=25.0,
        daily_budget=250.0, auto_approve_after=10,
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


# Ready-made brand presets: `clipforge seed --preset baby-stories-hindi`
PRESETS: dict[str, Brand] = {
    "baby-stories-hindi": Brand(
        id="00000000-0000-4000-8000-000000000002", name="Baby Story", tier=Tier.premium,
        budget_per_run=25.0, daily_budget=250.0, auto_approve_after=10,
        kit=BrandKit(
            niche="cute AI baby micro-stories set in everyday Indian life (street food stalls, markets, "
                  "festivals, family homes)",
            audience="Hindi-speaking families on YouTube Shorts, Instagram Reels and Facebook",
            tone="warm, playful, funny, wholesome", region="IN", language="hi", subtitle_languages=["en"],
            visual_style="photorealistic, cinematic, 4K, soft natural light, shallow depth of field, "
                         "toddlers with expressive faces, traditional Indian clothes, busy Indian street "
                         "background, no text",
            negative_prompts=["text", "watermark", "logo", "distorted hands", "extra fingers", "low quality",
                              "blurry faces"],
            banned_topics=["politics", "religion debates", "medical advice"],
            hashtags=["aibaby", "cutebaby", "shorts", "babystory"], music_moods=["playful"],
            consistency="first_shot", template="bold",
            caption_style=CaptionStyle(highlight_color="#FFD400", font_size=80, position="bottom"),
            platforms=[Platform.youtube, Platform.instagram, Platform.facebook, Platform.tiktok],
            platform_options={Platform.facebook: {"page_id": ""}},
        ),
        calendar=PostingCalendar(timezone="Asia/Kolkata",
                                 slots=[CalendarSlot(weekday=d, time="19:30") for d in range(7)]),
    ),
}
