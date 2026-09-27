import base64
import hashlib
import hmac
import time
from datetime import UTC, datetime, timedelta

import pytest

from clipforge.agents.llm import FakeLLM, ScriptDeps, hash_embed, validate_script
from clipforge.captions import caption_drift_ms, estimate_word_timings, group_words, to_ass, to_srt
from clipforge.config import Settings
from clipforge.db import MemoryRepo
from clipforge.dedupe import filter_hooks
from clipforge.graph.state import RESET, clear_from, merge_clips
from clipforge.ledger import CostLedger
from clipforge.models import (
    ApprovalDecision,
    Brand,
    CalendarSlot,
    CaptionStyle,
    Hook,
    Platform,
    PostingCalendar,
    QACheck,
    QAReport,
    Run,
    Tier,
    WordTiming,
)
from clipforge.platforms import PLATFORM_LIMITS, fit_metadata
from clipforge.providers.fal import snap_duration
from clipforge.providers.tts import chars_to_words
from clipforge.retry import AllProvidersFailed, BudgetExceeded, with_fallback
from clipforge.schedule import next_slot


def W(word, s, e):
    return WordTiming(word=word, start=s, end=e)


# ------------------------------------------------------------------ captions


def test_group_words_breaks_on_punctuation():
    words = [W("Hello", 0, .3), W("world.", .3, .6), W("This", .7, .9), W("is", .9, 1), W("great", 1, 1.3)]
    assert [[w.word for w in g] for g in group_words(words, 3)] == [["Hello", "world."], ["This", "is", "great"]]


def test_estimated_timings_monotonic_and_fill_duration():
    ws = estimate_word_timings("One two three. Four, five six!", 3.0)
    assert len(ws) == 6
    assert all(a.start <= b.start for a, b in zip(ws, ws[1:], strict=False))
    assert ws[-1].end <= 3.0 and ws[-1].end > 2.5


def test_ass_highlights_active_word():
    ass = to_ass([W("hi", 0, .5), W("there", .5, 1)], CaptionStyle(words_per_line=2), 1080, 1920)
    assert ass.count("Dialogue:") == 2
    assert "PlayResY: 1920" in ass
    assert "{\\c&H0000D4FF}HI{\\r} THERE" in ass  # #FFD400 highlight, uppercase


def test_srt_and_drift():
    ws = [W("a", 0, .2), W("b", .2, .4)]
    assert "00:00:00,000 --> 00:00:00,400" in to_srt(ws)
    assert caption_drift_ms(ws, 1.0) < 150
    assert caption_drift_ms(ws, 0.1) > 150  # captions run past audio
    assert caption_drift_ms([W("a", .5, .6), W("b", .2, .3)], 1.0) > 150  # non-monotonic


def test_elevenlabs_alignment_to_words():
    text = "Hi you"
    chars = list(text)
    starts = [0, .1, .2, .3, .4, .5]
    ends = [.1, .2, .3, .4, .5, .6]
    ws = chars_to_words(chars, starts, ends)
    assert [(w.word, w.start, w.end) for w in ws] == [("Hi", 0, .2), ("you", .3, .6)]


# ------------------------------------------------------------------ dedupe / platforms / models


def test_dedupe_drops_duplicates_and_banned():
    hooks = [Hook(text="5 sleep mistakes everyone makes", score=.9),
             Hook(text="Why crypto is the future", score=.8),
             Hook(text="The breathing trick for instant calm", score=.7)]
    history = [hash_embed("5 sleep mistakes everyone makes")]
    kept = filter_hooks(hooks, [hash_embed(h.text) for h in hooks], history, ["crypto"], 0.85)
    assert [h.text for h, _ in kept] == ["The breathing trick for instant calm"]


def test_fit_metadata_limits():
    title, desc, tags = fit_metadata(Platform.x, "t" * 300, "word " * 200, [f"#tag{i}" for i in range(10)])
    lim = PLATFORM_LIMITS[Platform.x]
    assert len(title) <= lim.title and len(tags) == lim.hashtags
    assert len(desc) + sum(len(t) + 2 for t in tags) + 2 <= lim.description


def test_approval_decision_validation():
    with pytest.raises(ValueError):
        ApprovalDecision(decision="regenerate")
    with pytest.raises(ValueError):
        ApprovalDecision(decision="regenerate", stage="publish")
    with pytest.raises(ValueError):
        ApprovalDecision(decision="edit")
    assert ApprovalDecision(decision="edit", patch={"cta": "Follow!"}).patch
    with pytest.raises(ValueError):
        ApprovalDecision(decision="edit", patch={"shots": ["only one"]})
    assert ApprovalDecision(decision="edit", patch={"shots": ["a", {"prompt": "b"}, "c"]})


def test_qa_score_and_blocking():
    r = QAReport(checks=[QACheck(name="a", passed=True), QACheck(name="b", passed=False, weight=0.5)])
    assert r.score == pytest.approx(0.667, abs=1e-3) and r.passed
    r.checks.append(QACheck(name="c", passed=False))
    assert not r.passed


def test_merge_clips_reducer():
    a = merge_clips([], [{"index": 1, "p": "x"}])
    a = merge_clips(a, [{"index": 0, "p": "y"}])
    assert [c["index"] for c in a] == [0, 1]
    assert merge_clips(a, None) == []
    assert merge_clips(a, [RESET, {"index": 2}]) == [{"index": 2}]
    assert set(clear_from("music")) == {"music", "renders", "qa_report"}


async def test_fake_script_is_valid():
    llm = FakeLLM()
    kit = Brand(name="x").kit
    pkg, _ = await llm.script(kit, Hook(text="Sleep better"), None, Tier.economy, 10)
    assert validate_script(pkg, ScriptDeps()) == []


def test_snap_duration():
    assert snap_duration(4.2, (5, 10)) == 5
    assert snap_duration(7, (5, 10)) == 10
    assert snap_duration(14, (5, 10)) == 10


# ------------------------------------------------------------------ schedule


def test_next_slot_respects_timezone():
    cal = PostingCalendar(timezone="America/New_York",
                          slots=[CalendarSlot(weekday=0, time="18:00", platforms=[Platform.tiktok])])
    after = datetime(2026, 9, 27, 12, tzinfo=UTC)  # Sunday
    at = next_slot(cal, Platform.tiktok, after)
    assert at == datetime(2026, 9, 28, 22, 0, tzinfo=UTC)  # Mon 18:00 EDT
    assert next_slot(cal, Platform.youtube, after) is None


# ------------------------------------------------------------------ retry / fallback


class Flaky:
    def __init__(self, name, fails):
        self.name, self.fails, self.calls = name, fails, 0

    async def go(self):
        self.calls += 1
        if self.calls <= self.fails:
            raise RuntimeError("boom")
        return self.name


async def test_fallback_after_retries():
    a, b = Flaky("a", 99), Flaky("b", 1)
    res, used = await with_fallback([a, b], lambda p: p.go(), attempts_each=3, base=0.001)
    assert res == "b" and a.calls == 3 and b.calls == 2


async def test_all_providers_failed():
    with pytest.raises(AllProvidersFailed):
        await with_fallback([Flaky("a", 9)], lambda p: p.go(), attempts_each=2, base=0.001)


# ------------------------------------------------------------------ ledger / budget


async def _ledger_setup(budget=3.0, tier=Tier.economy):
    repo = MemoryRepo()
    brand = Brand(name="b", daily_budget=10)
    await repo.upsert_brand(brand)
    run = Run(brand_id=brand.id, budget=budget, tier=tier)
    await repo.create_run(run)
    return repo, brand, run, CostLedger(repo, Settings(_env_file=None))


async def test_ledger_charges_and_rolls_up():
    repo, brand, run, ledger = await _ledger_setup()
    e = await ledger.charge(run_id=run.id, brand_id=brand.id, stage="gen_shots", provider="fal:kling-3.0", units=10)
    assert e.total == pytest.approx(0.84)
    assert (await repo.get_run(run.id)).cost_total == pytest.approx(0.84)


async def test_budget_downgrades_then_aborts():
    repo, brand, run, ledger = await _ledger_setup(budget=3.0, tier=Tier.premium)
    d = await ledger.ensure_budget(run_id=run.id, brand_id=brand.id, tier=Tier.premium, estimate=16.0,
                                   economy_estimate=2.5)
    assert d.tier == Tier.economy and d.downgraded
    assert (await repo.get_run(run.id)).tier == Tier.economy
    with pytest.raises(BudgetExceeded):
        await ledger.ensure_budget(run_id=run.id, brand_id=brand.id, tier=Tier.economy, estimate=3.5)


async def test_daily_brand_cap():
    repo, brand, run, ledger = await _ledger_setup(budget=100)
    await ledger.charge(run_id=run.id, brand_id=brand.id, stage="x", provider="p", units=1, unit_cost=9.5)
    with pytest.raises(BudgetExceeded):
        await ledger.ensure_budget(run_id=run.id, brand_id=brand.id, tier=Tier.economy, estimate=1.0)


# ------------------------------------------------------------------ webhook signatures


def test_standard_webhook_signature():
    from clipforge.api.signatures import SignatureError, verify_standard_webhook

    secret = "whsec_" + base64.b64encode(b"k" * 24).decode()
    body, wid, ts = b'{"id":"p1"}', "msg_1", str(int(time.time()))
    sig = base64.b64encode(hmac.new(b"k" * 24, f"{wid}.{ts}.".encode() + body, hashlib.sha256).digest()).decode()
    verify_standard_webhook(secret, {"webhook-id": wid, "webhook-timestamp": ts, "webhook-signature": f"v1,{sig}"},
                            body)
    with pytest.raises(SignatureError):
        verify_standard_webhook(secret, {"webhook-id": wid, "webhook-timestamp": ts, "webhook-signature": "v1,xx"},
                                body)


def test_hmac_signature():
    from clipforge.api.signatures import SignatureError, verify_hmac_hex

    sig = hmac.new(b"s", b"{}", hashlib.sha256).hexdigest()
    verify_hmac_hex("s", {"x-signature": sig}, b"{}")
    verify_hmac_hex("s", {"x-hub-signature-256": f"sha256={sig}"}, b"{}")
    with pytest.raises(SignatureError):
        verify_hmac_hex("s", {"x-signature": "00"}, b"{}")


async def test_fal_ed25519_signature():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

    from clipforge.api.signatures import SignatureError, verify_fal

    key = Ed25519PrivateKey.generate()
    pub = key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    jwk = {"kty": "OKP", "crv": "Ed25519", "x": base64.urlsafe_b64encode(pub).decode().rstrip("=")}
    body, ts = b'{"request_id":"r1"}', str(int(time.time()))
    msg = "\n".join(["r1", "u1", ts, hashlib.sha256(body).hexdigest()]).encode()
    h = {"x-fal-webhook-request-id": "r1", "x-fal-webhook-user-id": "u1", "x-fal-webhook-timestamp": ts,
         "x-fal-webhook-signature": key.sign(msg).hex()}
    await verify_fal(h, body, keys=[jwk])
    with pytest.raises(SignatureError):
        await verify_fal({**h, "x-fal-webhook-timestamp": str(int(time.time()) - 3600)}, body, keys=[jwk])
    with pytest.raises(SignatureError):
        await verify_fal(h, body + b" ", keys=[jwk])


# ------------------------------------------------------------------ job waiter


async def test_job_waiter_webhook_beats_polling():
    import asyncio

    from clipforge.providers.jobs import JobWaiter

    w = JobWaiter(poll_interval=5, timeout=10)
    polls = 0

    async def poll():
        nonlocal polls
        polls += 1
        return None

    async def fire():
        await asyncio.sleep(0.05)
        w.resolve("r1", {"status": "OK"})

    t0 = time.monotonic()
    res, _ = await asyncio.gather(w.wait("r1", poll), fire())
    assert res == {"status": "OK"} and polls == 0 and time.monotonic() - t0 < 1


async def test_job_waiter_polling_and_timeout():
    from clipforge.providers.jobs import JobWaiter, ProviderTimeout

    w = JobWaiter(poll_interval=0.01, timeout=1)
    n = 0

    async def poll():
        nonlocal n
        n += 1
        return {"done": True} if n == 3 else None

    assert await w.wait("r2", poll) == {"done": True}

    async def never():
        return None

    with pytest.raises(ProviderTimeout):
        await JobWaiter(0.01, 0.05).wait("r3", never)


def test_memory_due_metrics():
    from clipforge.db import _due_metrics
    from clipforge.models import PostRecord

    now = datetime(2026, 9, 27, tzinfo=UTC)
    p = PostRecord(run_id="r", platform=Platform.x, status="published", published_at=now - timedelta(hours=25))
    assert _due_metrics([(p, "b")], {}, now) == [(p, "b")]
    assert _due_metrics([(p, "b")], {p.id: [now]}, now) == []
