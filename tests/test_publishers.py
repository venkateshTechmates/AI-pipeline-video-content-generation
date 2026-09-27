"""Request shapes sent to the publishing aggregators (httpx mock transport, no network)."""

import json

import httpx
import pytest

from clipforge.models import Platform, PlatformMetadata
from clipforge.providers.base import PublishRequest
from clipforge.providers.publish import AyrsharePublisher, UploadPostPublisher
from clipforge.retry import PermanentError


def req(platform: Platform, **options: str) -> PublishRequest:
    return PublishRequest(
        brand_id="b", run_id="r", platform=platform, video_url="https://cdn/v.mp4",
        metadata=PlatformMetadata(platform=platform, title="Title", description="Desc", hashtags=["a", "b"]),
        options=options)


def capture(response: dict):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=response)

    return seen, httpx.AsyncClient(transport=httpx.MockTransport(handler))


def form(request: httpx.Request) -> dict[str, list[str]]:
    from urllib.parse import parse_qs

    return parse_qs(request.content.decode())


async def test_upload_post_facebook_pinterest_reddit():
    seen, client = capture({"success": True, "results": {"facebook": {"success": True, "platform_post_id": "fb1"}}})
    pub = UploadPostPublisher("k", client=client)
    with pytest.raises(PermanentError, match="page_id"):
        await pub.publish(req(Platform.facebook))
    res = await pub.publish(req(Platform.facebook, page_id="123"))
    assert res.external_id == "fb1"
    f = form(seen[-1])
    assert f["platform[]"] == ["facebook"] and f["facebook_page_id"] == ["123"]

    await pub.publish(req(Platform.pinterest, board_id="board9"))
    assert form(seen[-1])["pinterest_board_id"] == ["board9"]
    await pub.publish(req(Platform.reddit, subreddit="shorts"))
    f = form(seen[-1])
    assert f["subreddit"] == ["shorts"] and f["title"] == ["Title"]
    for p in (Platform.threads, Platform.bluesky, Platform.x):
        await pub.publish(req(p))
        assert form(seen[-1])["platform[]"] == [p.value]


async def test_ayrshare_platform_names_and_options():
    seen, client = capture({"status": "success", "id": "a1", "postIds": [{"platform": "twitter", "id": "t1"}]})
    pub = AyrsharePublisher("k", client=client)
    res = await pub.publish(req(Platform.x))
    body = json.loads(seen[-1].content)
    assert body["platforms"] == ["twitter"] and res.external_id == "t1"
    await pub.publish(req(Platform.facebook))
    assert json.loads(seen[-1].content)["faceBookOptions"]["reels"] is True
    await pub.publish(req(Platform.pinterest, board_id="b"))
    assert json.loads(seen[-1].content)["pinterestOptions"]["boardId"] == "b"
    await pub.publish(req(Platform.reddit, subreddit="s"))
    assert json.loads(seen[-1].content)["redditOptions"] == {"title": "Title", "subreddit": "s"}
    for p in (Platform.threads, Platform.bluesky):
        await pub.publish(req(p))
        assert json.loads(seen[-1].content)["platforms"] == [p.value]


async def test_gemini_tts_pcm_to_mp3():
    import base64
    import math
    import shutil
    import struct

    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg not installed")
    from clipforge.providers.tts import GeminiTTS

    pcm = b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 220 * i / 24000))) for i in range(24000 * 2))
    seen, client = capture({"candidates": [{"content": {"parts": [{"inlineData": {
        "mimeType": "audio/L16;codec=pcm;rate=24000", "data": base64.b64encode(pcm).decode()}}]}}]})
    res = await GeminiTTS("gk", client=client).synthesize("Heroes show up when the lights go out.", "not-a-voice")
    body = json.loads(seen[0].content)
    assert seen[0].headers["x-goog-api-key"] == "gk"
    assert body["generationConfig"]["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"] == "Charon"
    assert 1.8 < res.duration < 2.3 and len(res.words) == 8 and res.audio[:3] in (b"ID3", b"\xff\xfb", b"\xff\xf3")


def test_live_registry_with_anthropic_and_google_only(tmp_path):
    from clipforge.config import Settings
    from clipforge.db import MemoryRepo
    from clipforge.models import Tier
    from clipforge.providers.registry import build_providers
    from clipforge.storage import LocalStore

    s = Settings(_env_file=None, provider_mode="live", anthropic_api_key="a", google_api_key="g")
    p = build_providers(s, MemoryRepo(), LocalStore(tmp_path))
    assert [v.name for v in p.video_chain(Tier.economy)] == ["vertex:veo-3.1-lite"]
    assert [v.name for v in p.video_chain(Tier.premium)] == ["vertex:veo-3.1", "vertex:veo-3.1-fast"]
    assert [t.name for t in p.tts] == ["gemini:tts"]
