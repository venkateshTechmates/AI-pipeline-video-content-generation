"""ffmpeg renderer: ambient clip audio under the voice, film grade, three aspects (offline fakes)."""

import pytest

from clipforge import media
from clipforge.models import Aspect, CaptionStyle
from clipforge.providers.base import VideoRequest
from clipforge.providers.fake import FakeTTS, FakeVideo
from clipforge.providers.render import FfmpegRenderer
from clipforge.render_spec import BrandOverlay, RenderAudio, RenderClip, RenderSpec
from clipforge.storage import LocalStore

from .conftest import requires_ffmpeg

pytestmark = requires_ffmpeg


async def _clips(store: LocalStore, with_audio: bool) -> list[RenderClip]:
    gen = FakeVideo(durations=None)
    out = []
    for i, prompt in enumerate(("a street stall at dusk", "two toddlers giggling")):
        res = await gen.generate(VideoRequest(prompt=prompt, duration=3, generate_audio=with_audio))
        key = f"runs/r/clips/{i}.mp4"
        store.put_bytes(key, res.data)
        out.append(RenderClip(path=key, start=3.0 * i, duration=3.0))
    return out


async def _spec(store: LocalStore, with_audio: bool, ambient: float | None, look: str) -> RenderSpec:
    text = "Nobody noticed the nurse who could hold lightning until the night the city went dark."
    tts = await FakeTTS().synthesize(text, "v")
    store.put_bytes("runs/r/vo.mp3", tts.audio)
    return RenderSpec(
        run_id="r", duration=6.0, aspects=[Aspect.vertical], clips=await _clips(store, with_audio),
        audio=RenderAudio(voice_path="runs/r/vo.mp3", ambient_gain_db=ambient), words=tts.words,
        caption_style=CaptionStyle(), brand=BrandOverlay(cta_text="Follow"), output_prefix="runs/r/out", film_look=look,
    )


@pytest.mark.parametrize("with_audio,ambient,look",
                         [(True, -18.0, "cinematic"), (True, None, "none"), (False, -18.0, "cinematic")])
async def test_ffmpeg_render_mixes_ambient_audio_and_grades(tmp_path, with_audio, ambient, look):
    store = LocalStore(tmp_path)
    spec = await _spec(store, with_audio, ambient, look)
    if with_audio:  # the fake model produced a native audio track, like Veo 3.1 does
        info = await media.probe(store.local_path(spec.clips[0].path))
        assert any(s["codec_type"] == "audio" for s in info["streams"])
    renderer = FfmpegRenderer(store, "ultrafast")
    result = await renderer.render(spec)
    out = store.local_path(result.outputs[0].path)
    info = await media.probe(out)
    kinds = {s["codec_type"] for s in info["streams"]}
    assert kinds == {"video", "audio"} and abs(float(info["format"]["duration"]) - 6.0) < 0.2
    assert abs((await media.loudness(out))["lufs"] - (-16.0)) < 1.5  # still normalised with ambience mixed in
