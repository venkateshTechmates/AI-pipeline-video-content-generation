"""End-to-end graph runs with offline fake providers (real ffmpeg media)."""

from datetime import timedelta

import pytest

from clipforge.models import (
    DEFAULT_PLATFORMS,
    ApprovalDecision,
    Brand,
    CalendarSlot,
    Platform,
    PostingCalendar,
    Run,
    RunStatus,
    StageStatus,
    Tier,
    utcnow,
)
from clipforge.orchestrator import execute
from clipforge.providers.fake import FakeVideo

from .conftest import requires_ffmpeg

pytestmark = requires_ffmpeg


async def new_run(app, **brand_kw) -> Run:
    brand = Brand(name="Test", kit={"niche": "fitness", "hashtags": ["fit"]}, **brand_kw)
    await app.repo.upsert_brand(brand)
    run = Run(brand_id=brand.id, brief="morning habits", budget=brand.budget_per_run, tier=brand.tier,
              platforms=brand.kit.platforms)
    await app.repo.create_run(run)
    return run


async def decide(app, run_id, **kw) -> Run:
    await app.repo.update_run(run_id, pending_decision=ApprovalDecision(**kw).model_dump(mode="json"),
                              status=RunStatus.resume_requested)
    return await execute(app, await app.repo.get_run(run_id))


async def stage(app, run_id, name):
    return await app.repo.get_stage(run_id, name)


async def test_full_run_approve_publish(app):
    run = await new_run(app)
    r = await execute(app, run)
    assert r.status == RunStatus.awaiting_approval, r.error
    state = await app.repo.get_run_state(run.id)
    assert state["qa_report"]["passed"] and state["qa_report"]["score"] >= 0.9
    assert {x["aspect"] for x in state["renders"]} == {"9:16", "1:1", "16:9"}
    assert 3 <= len(state["shot_list"]["shots"]) <= 6
    # economy tier: kling at $0.084/s + TTS; must stay under the $3 target
    assert 0 < r.cost_total <= 3.0
    assert state["music"]["license_id"]

    r = await decide(app, run.id, decision="approve")
    assert r.status == RunStatus.published, r.error
    posts = await app.repo.list_posts(run.id)
    assert {p.platform for p in posts} == set(DEFAULT_PLATFORMS)
    assert all(p.external_id and p.status == "published" for p in posts)
    li = next(p for p in posts if p.platform == Platform.linkedin)
    assert li.metadata["aspect"] == "1:1"
    assert all(p.metadata["ai_disclosure"] for p in posts if p.platform in (Platform.tiktok, Platform.youtube))
    names = {s.name: s.status for s in await app.repo.list_stages(run.id)}
    for n in ("ideate", "script", "tts", "gen_shots", "music", "render", "qa", "approve", "metadata", "publish"):
        assert names[n] == StageStatus.succeeded, n
    assert names["metrics"] == StageStatus.pending
    assert (await app.repo.get_brand(run.brand_id)).trust_score == 1
    ledger = await app.repo.list_ledger(run.id)
    assert {e.stage for e in ledger} >= {"tts", "gen_shots"}

    # metrics pulled at +24 h
    from clipforge.ops import collect_due_metrics

    for p in posts:
        p.published_at = utcnow() - timedelta(hours=25)
        await app.repo.upsert_post(p)
    assert (await collect_due_metrics(app))["collected"] == len(DEFAULT_PLATFORMS)
    assert (await collect_due_metrics(app))["collected"] == 0


async def test_regenerate_music_and_edit_script(app):
    run = await new_run(app)
    await execute(app, run)
    before = await app.repo.get_run_state(run.id)
    video_calls = sum(p.calls for p in app.deps.providers.video_chain(Tier.economy) if isinstance(p, FakeVideo))

    r = await decide(app, run.id, decision="regenerate", stage="music")
    assert r.status == RunStatus.awaiting_approval
    assert (await stage(app, run.id, "music")).attempt == 2
    assert (await stage(app, run.id, "gen_shots")).attempt == 1  # upstream untouched
    assert (await app.repo.get_brand(run.brand_id)).trust_score == 0

    r = await decide(app, run.id, decision="edit", patch={"cta": "Save this for tomorrow!"})
    assert r.status == RunStatus.awaiting_approval, r.error
    after = await app.repo.get_run_state(run.id)
    assert after["script"]["cta"] == "Save this for tomorrow!"
    assert (await stage(app, run.id, "tts")).attempt == 2
    # clips are content-addressed: same prompts/durations -> no new provider calls
    assert sum(p.calls for p in app.deps.providers.video_chain(Tier.economy) if isinstance(p, FakeVideo)) \
        == video_calls
    assert after["renders"][0]["path"] != before["renders"][0]["path"]


async def test_reject(app):
    run = await new_run(app)
    await execute(app, run)
    r = await decide(app, run.id, decision="reject", note="off-brand")
    assert r.status == RunStatus.aborted
    assert await app.repo.list_posts(run.id) == []


async def test_auto_approve_after_trust(app):
    run = await new_run(app, trust_score=10, auto_approve_after=10)
    r = await execute(app, run)
    assert r.status == RunStatus.published, r.error
    state = await app.repo.get_run_state(run.id)
    assert state["auto_approved"] is True


async def test_budget_abort(app):
    run = await new_run(app, budget_per_run=0.5)
    r = await execute(app, run)
    assert r.status == RunStatus.aborted
    assert "budget" in r.error


async def test_premium_downgrades_to_economy_when_over_budget(app):
    run = await new_run(app, tier=Tier.premium, budget_per_run=3.0)  # Veo std ~ $0.40/s x ~35 s > $3
    r = await execute(app, run)
    assert r.status == RunStatus.awaiting_approval, r.error
    assert r.tier == Tier.economy
    state = await app.repo.get_run_state(run.id)
    assert {c["provider"] for c in state["clips"]} == {"fake:kling"}


async def test_provider_fallback(app):
    app.deps.providers.video[Tier.economy][0].fail_times = 10_000  # kling down
    run = await new_run(app)
    r = await execute(app, run)
    assert r.status == RunStatus.awaiting_approval, r.error
    state = await app.repo.get_run_state(run.id)
    assert {c["provider"] for c in state["clips"]} == {"fake:seedance"}


async def test_crash_resumes_from_checkpoint(app):
    music = app.deps.providers.music[0]
    orig = music.pick
    calls = {"n": 0}

    async def flaky(*a, **kw):
        calls["n"] += 1
        if calls["n"] <= 3:  # all 3 attempts of the first run fail
            raise RuntimeError("music api down")
        return await orig(*a, **kw)

    music.pick = flaky
    run = await new_run(app)
    r = await execute(app, run)
    assert r.status == RunStatus.failed and r.attempts == 1
    video_calls = sum(p.calls for p in app.deps.providers.video_chain(Tier.economy) if isinstance(p, FakeVideo))

    from clipforge.orchestrator import recover

    assert (await recover(app))["requeued"] == 1
    r = await execute(app, await app.repo.get_run(run.id))
    assert r.status == RunStatus.awaiting_approval, r.error
    assert (await stage(app, run.id, "gen_shots")).attempt == 1  # not re-run
    assert sum(p.calls for p in app.deps.providers.video_chain(Tier.economy) if isinstance(p, FakeVideo)) \
        == video_calls


async def test_calendar_scheduling(app):
    cal = PostingCalendar(timezone="UTC", slots=[CalendarSlot(weekday=d, time="09:00") for d in range(7)])
    run = await new_run(app, calendar=cal, trust_score=99)
    r = await execute(app, run)
    assert r.status == RunStatus.scheduled, r.error
    posts = await app.repo.list_posts(run.id)
    assert all(p.status == "scheduled" and p.scheduled_at and p.scheduled_at.hour == 9 for p in posts)


@pytest.mark.parametrize("banned", [["morning"]])
async def test_banned_topic_blocks_ideation(app, banned):
    brand = Brand(name="B", kit={"niche": "morning", "banned_topics": banned})
    await app.repo.upsert_brand(brand)
    run = Run(brand_id=brand.id, brief="morning habits")
    await app.repo.create_run(run)
    r = await execute(app, run)
    assert r.status == RunStatus.failed and "no novel hook" in r.error


async def test_all_platforms_with_account_options(app):
    """Opt into every platform; reddit has no subreddit configured -> that post fails, the rest go out."""
    run = await new_run(app, trust_score=99)
    brand = await app.repo.get_brand(run.brand_id)
    brand.kit.platforms = list(Platform)
    brand.kit.platform_options = {Platform.pinterest: {"board_id": "b1"}, Platform.facebook: {"page_id": "p1"}}
    await app.repo.upsert_brand(brand)
    await app.repo.update_run(run.id, platforms=list(Platform))
    r = await execute(app, await app.repo.get_run(run.id))
    assert r.status == RunStatus.published, r.error
    posts = {p.platform: p for p in await app.repo.list_posts(run.id)}
    assert set(posts) == set(Platform)
    assert posts[Platform.reddit].status == "failed" and "subreddit" in posts[Platform.reddit].metadata["error"]
    assert all(p.status == "published" for k, p in posts.items() if k != Platform.reddit)
    assert posts[Platform.threads].metadata["hashtags"].__len__() <= 1
    assert len(posts[Platform.bluesky].metadata["description"]) <= 300


async def test_edit_shot_prompts_regenerates_clips(app):
    run = await new_run(app)  # new clips are paid again; fits the default $25 budget
    await execute(app, run)
    calls = sum(p.calls for p in app.deps.providers.video_chain(Tier.economy) if isinstance(p, FakeVideo))
    shots = ["A caped hero flies over a stormy city", "Sparks crawl up a nurse's arms",
             {"prompt": "A glowing figure above rooftops at sunrise", "duration": 9}]
    r = await decide(app, run.id, decision="edit", patch={"shots": shots})
    assert r.status == RunStatus.awaiting_approval, r.error
    st = await app.repo.get_run_state(run.id)
    assert [s["prompt"] for s in st["shot_list"]["shots"]] == [shots[0], shots[1], shots[2]["prompt"]]
    assert {t["shot_index"] for t in st["timeline"]} == {0, 1, 2}
    assert sum(p.calls for p in app.deps.providers.video_chain(Tier.economy) if isinstance(p, FakeVideo)) > calls


async def test_premium_veo_runs_within_default_budget(app):
    run = await new_run(app, tier=Tier.premium)  # default $25/run fits Veo 3.1 std (~$0.40/s)
    r = await execute(app, run)
    assert r.status == RunStatus.awaiting_approval, r.error
    assert r.tier == Tier.premium and 3.0 < r.cost_total <= 25.0
    state = await app.repo.get_run_state(run.id)
    assert {c["provider"] for c in state["clips"]} == {"fake:veo"}


@pytest.mark.parametrize("language", ["ja", "hi"])
async def test_multilingual_voice_captions_and_subtitles(app, language):
    brand = Brand(name="ML", kit={"niche": "habits", "language": language, "subtitle_languages": ["en", "es"]})
    await app.repo.upsert_brand(brand)
    run = Run(brand_id=brand.id, brief="habits", language=language, subtitle_languages=["en", "es"])
    await app.repo.create_run(run)
    r = await execute(app, run)
    assert r.status == RunStatus.awaiting_approval, r.error
    st = await app.repo.get_run_state(run.id)
    assert r.language == language and st["qa_report"]["passed"], st["qa_report"]
    words = [w["word"] for w in st["vo"]["words"]]
    if language == "ja":
        assert all(len(w) <= 3 for w in words)  # character chunks, not whole sentences
    assert {s["language"] for s in st["subtitles"]} == {language, "en", "es"}
    main = next(s for s in st["subtitles"] if s["language"] == language)
    srt = app.deps.store.local_path(main["srt"]).read_text()
    assert srt.startswith("1\n00:00:00") and " --> " in srt
    es = next(s for s in st["subtitles"] if s["language"] == "es")
    vtt = app.deps.store.local_path(es["vtt"]).read_text()
    assert vtt.startswith("WEBVTT") and "[es]" in vtt  # FakeLLM marks translations
    assert srt.count(" --> ") == vtt.count(" --> ")  # translated cues keep the same timing


async def test_trace_spans_cover_the_run(app):
    app.deps.providers.video[Tier.economy][0].fail_times = 1  # one retry on the first shot
    run = await new_run(app, trust_score=99)
    r = await execute(app, run)
    assert r.status == RunStatus.published, r.error
    spans = await app.repo.list_spans(run.id)
    by_name = {}
    for s in spans:
        by_name.setdefault(s.name, []).append(s)
    for n in ("run.execute", "ideate", "script", "tts", "gen_shots", "gen_shot", "collect_shots", "music",
              "render", "qa", "approve", "metadata", "publish", "llm.script", "llm.moderate_text"):
        assert n in by_name, n
    root = by_name["run.execute"][0]
    assert by_name["ideate"][0].parent_id == root.id
    assert all(s.end_at and s.duration_ms is not None for s in spans)
    video = [s for s in spans if s.kind == "video"]
    shot_parents = {g.id for g in by_name["gen_shot"] + by_name["gen_shots"]}  # shot 0 runs in the dispatcher
    assert video and all(s.parent_id in shot_parents for s in video)
    assert any(s.status == "error" for s in video)  # the simulated failure is traced
    assert any(e.name == "retry" for g in by_name["gen_shot"] + by_name["gen_shots"] for e in g.events)
    assert {s.attributes["platform"] for s in spans if s.kind == "publish"} == {p.value for p in DEFAULT_PLATFORMS}
    assert sum(float(s.attributes.get("cost_usd", 0)) for s in spans) == pytest.approx(r.cost_total, abs=0.01)
