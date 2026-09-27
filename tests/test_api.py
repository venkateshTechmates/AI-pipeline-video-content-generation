import hashlib
import hmac
import json
import time

import jwt
import pytest
from fastapi.testclient import TestClient

from clipforge.api.app import create_app
from clipforge.models import Brand, Platform, PostRecord, Run, RunStatus
from clipforge.orchestrator import create_app_state
from clipforge.seed import demo_brand

SECRET = "test-jwt-secret-with-enough-length-0123456789"


@pytest.fixture
async def cf(settings):
    s = settings.model_copy(update={"supabase_jwt_secret": SECRET, "api_token": "svc", "cron_secret": "cron",
                                    "publisher_webhook_secret": "pub", "fal_webhook_secret": "falsecret"})
    a = await create_app_state(s)
    yield a
    await a.aclose()


@pytest.fixture
def client(cf):
    with TestClient(create_app(cf.settings, app_state=cf)) as c:
        yield c


def token(uid: str) -> dict[str, str]:
    t = jwt.encode({"sub": uid, "aud": "authenticated", "exp": int(time.time()) + 600}, SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {t}"}


def test_runs_crud_and_costs(client):
    b = demo_brand()
    assert client.post("/brands", json=b.model_dump(mode="json")).status_code == 200
    r = client.post("/runs", json={"brand_id": b.id, "brief": "sleep", "platforms": ["tiktok", "x"]})
    assert r.status_code == 201
    run_id = r.json()["run_id"]
    d = client.get(f"/runs/{run_id}").json()
    assert d["run"]["status"] == "queued" and d["run"]["platforms"] == ["tiktok", "x"]
    assert client.get("/runs", params={"status": "queued"}).json()["items"][0]["id"] == run_id
    assert client.post(f"/runs/{run_id}/approve", json={"decision": "approve"}).status_code == 409
    assert client.post(f"/runs/{run_id}/approve", json={"decision": "regenerate"}).status_code == 422
    costs = client.get(f"/brands/{b.id}/costs").json()
    assert costs["total"] == 0 and costs["runs"] == 0
    assert client.get("/runs/nope").status_code == 404


async def test_approve_sets_pending_decision(client, cf):
    b = demo_brand()
    await cf.repo.upsert_brand(b)
    run = Run(brand_id=b.id, status=RunStatus.awaiting_approval)
    await cf.repo.create_run(run)
    assert client.get("/queue").json()["items"][0]["run"]["id"] == run.id
    r = client.post(f"/runs/{run.id}/approve", json={"decision": "edit", "patch": {"cta": "Follow"}})
    assert r.json() == {"status": "resume_requested"}
    stored = await cf.repo.get_run(run.id)
    assert stored.pending_decision["patch"] == {"cta": "Follow"}
    assert stored.pending_decision["reviewer"] == "service"


async def test_jwt_scoping(client, cf):
    mine, other = Brand(name="Mine", org_id="org-a"), Brand(name="Other", org_id="org-b")
    await cf.repo.upsert_brand(mine)
    await cf.repo.upsert_brand(other)
    cf.repo.org_members["org-a"].add("user-1")
    h = token("user-1")
    names = [b["name"] for b in client.get("/brands", headers=h).json()["items"]]
    assert names == ["Mine"]
    assert client.post("/runs", headers=h, json={"brand_id": other.id}).status_code == 404
    assert client.post("/runs", headers=h, json={"brand_id": mine.id}).status_code == 201
    run = Run(brand_id=other.id)
    await cf.repo.create_run(run)
    assert client.get(f"/runs/{run.id}", headers=h).status_code == 404
    assert client.get(f"/brands/{other.id}/costs", headers=h).status_code == 404
    assert client.get("/brands", headers={"Authorization": "Bearer garbage"}).status_code == 401
    # static service token sees everything
    assert len(client.get("/brands", headers={"Authorization": "Bearer svc"}).json()["items"]) == 2


def test_auth_required(cf):
    cf.settings = cf.settings.model_copy(update={"auth_required": True})
    with TestClient(create_app(cf.settings, app_state=cf)) as c:
        assert c.get("/brands").status_code == 401
        assert c.get("/brands", headers={"Authorization": "Bearer svc"}).status_code == 200
        assert c.get("/healthz").status_code == 200


def test_fal_webhook_token_and_dedupe(client, monkeypatch):
    resolved = []
    from clipforge.providers import jobs

    monkeypatch.setattr(jobs.get_waiter(), "resolve", lambda rid, p: resolved.append(rid))
    body = {"request_id": "req-1", "status": "OK", "payload": {"video": {"url": "https://x/v.mp4"}}}
    assert client.post("/webhooks/fal", json=body).status_code == 401
    assert client.post("/webhooks/fal?token=falsecret", json=body).json() == {"ok": True}
    assert client.post("/webhooks/fal?token=falsecret", json=body).json() == {"duplicate": True}
    assert resolved == ["req-1"]


async def test_publisher_webhook_updates_post(client, cf):
    b = demo_brand()
    await cf.repo.upsert_brand(b)
    run = Run(brand_id=b.id, status=RunStatus.scheduled)
    await cf.repo.create_run(run)
    await cf.repo.upsert_post(PostRecord(run_id=run.id, platform=Platform.tiktok, external_id="tt-1",
                                         status="scheduled"))
    body = json.dumps({"platform_post_id": "tt-1", "status": "published", "url": "https://tiktok/v/1"}).encode()
    assert client.post("/webhooks/publisher", content=body).status_code == 401
    sig = hmac.new(b"pub", body, hashlib.sha256).hexdigest()
    r = client.post("/webhooks/publisher", content=body, headers={"x-signature": sig,
                                                                 "content-type": "application/json"})
    assert r.json() == {"ok": True, "matched": True}
    post = (await cf.repo.list_posts(run.id))[0]
    assert post.status == "published" and post.url == "https://tiktok/v/1"
    assert (await cf.repo.get_run(run.id)).status == RunStatus.published


async def test_cron_calendar_creates_runs_once(client, cf):
    from datetime import timedelta

    from clipforge.models import CalendarSlot, PostingCalendar, utcnow

    slot = utcnow() + timedelta(hours=cf.settings.calendar_lead_hours, minutes=5)
    b = Brand(name="Cal", calendar=PostingCalendar(timezone="UTC", slots=[
        CalendarSlot(weekday=slot.weekday(), time=slot.strftime("%H:%M"))]))
    await cf.repo.upsert_brand(b)
    assert client.post("/cron/calendar").status_code == 401
    h = {"x-cron-secret": "cron"}
    assert client.post("/cron/calendar", headers=h).json() == {"created": 1}
    assert client.post("/cron/calendar", headers=h).json() == {"created": 0}
    runs = await cf.repo.list_runs([b.id])
    assert runs[0].schedule.strftime("%H:%M") == slot.strftime("%H:%M")
    assert client.post("/cron/nope", headers=h).status_code == 404
    assert client.post("/cron/recover", headers=h).json() == {"requeued": 0}


async def test_patch_brand_platforms_and_credentials(client, cf):
    b = demo_brand()
    await cf.repo.upsert_brand(b)
    r = client.patch(f"/brands/{b.id}", json={"kit": {"platforms": ["youtube", "reddit", "pinterest"],
                                                      "platform_options": {"pinterest": {"board_id": "b1"}}},
                                              "publisher": "ayrshare", "budget_per_run": 4})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["kit"]["platforms"] == ["youtube", "reddit", "pinterest"] and d["publisher"] == "ayrshare"
    assert d["warnings"] == ["reddit: needs subreddit"]
    assert d["kit"]["niche"] == b.kit.niche  # untouched kit fields survive
    assert d["credentials"] == {"upload_post": False, "ayrshare": False}
    assert client.patch(f"/brands/{b.id}", json={"kit": {"platforms": ["myspace"]}}).status_code == 422
    assert client.post(f"/brands/{b.id}/credentials", json={"provider": "ayrshare", "token": "pk"}).status_code == 204
    d = client.get(f"/brands/{b.id}").json()
    assert d["credentials"]["ayrshare"] is True and "pk" not in json.dumps(d)
    assert (await cf.repo.get_brand(b.id)).budget_per_run == 4


async def test_languages_and_run_language_defaults(client, cf):
    langs = client.get("/languages").json()["items"]
    assert {"code": "hi", "name": "Hindi", "native": "हिन्दी", "rtl": False} in langs
    b = demo_brand()
    await cf.repo.upsert_brand(b)
    assert client.patch(f"/brands/{b.id}", json={"kit": {"language": "es", "subtitle_languages": ["en", "fr"]}}
                        ).status_code == 200
    rid = client.post("/runs", json={"brand_id": b.id}).json()["run_id"]
    run = client.get(f"/runs/{rid}").json()["run"]
    assert run["language"] == "es" and run["subtitle_languages"] == ["en", "fr"]
    rid = client.post("/runs", json={"brand_id": b.id, "language": "ja", "subtitle_languages": []}).json()["run_id"]
    run = client.get(f"/runs/{rid}").json()["run"]
    assert run["language"] == "ja" and run["subtitle_languages"] == []
    assert client.post("/runs", json={"brand_id": b.id, "language": "klingon"}).status_code == 422
    assert client.patch(f"/brands/{b.id}", json={"kit": {"language": "xx"}}).status_code == 422


async def test_traces_api(client, cf):
    from datetime import timedelta

    from clipforge.models import utcnow
    from clipforge.tracing import Span

    b = demo_brand()
    await cf.repo.upsert_brand(b)
    run = Run(brand_id=b.id, brief="traced", status=RunStatus.published)
    await cf.repo.create_run(run)
    t0 = utcnow()
    root = Span(trace_id=run.id, name="run.execute", kind="run", start_at=t0, end_at=t0 + timedelta(seconds=9),
                duration_ms=9000)
    stage = Span(trace_id=run.id, parent_id=root.id, name="gen_shot", kind="stage", start_at=t0,
                 end_at=t0 + timedelta(seconds=5), duration_ms=5000)
    ok = Span(trace_id=run.id, parent_id=stage.id, name="video:fal:kling-3.0", kind="video", start_at=t0,
              end_at=t0 + timedelta(seconds=4), duration_ms=4000,
              attributes={"provider": "fal:kling-3.0", "cost_usd": 0.42})
    bad = Span(trace_id=run.id, parent_id=stage.id, name="video:fal:kling-3.0", kind="video", status="error",
               start_at=t0, end_at=t0 + timedelta(seconds=1), duration_ms=1000, error="boom",
               attributes={"provider": "fal:kling-3.0"})
    for s in (root, stage, ok, bad):
        await cf.repo.upsert_span(s)
    items = client.get("/traces").json()["items"]
    t = next(i for i in items if i["trace_id"] == run.id)
    assert t["span_count"] == 4 and t["error_count"] == 1 and t["duration_ms"] == 9000 and t["brand_name"]
    assert [i["trace_id"] for i in client.get("/traces", params={"status": "error"}).json()["items"]] == [run.id]
    assert client.get("/traces", params={"q": "nomatch"}).json()["items"] == []
    d = client.get(f"/traces/{run.id}").json()
    assert [s["name"] for s in d["spans"]][:1] == ["run.execute"] and len(d["spans"]) == 4
    st = client.get("/traces/stats").json()
    prov = next(x for x in st["providers"] if x["name"] == "fal:kling-3.0")
    assert prov["calls"] == 2 and prov["errors"] == 1 and prov["cost"] == 0.42 and prov["p95_ms"] > prov["p50_ms"]
    assert any(x["name"] == "gen_shot" for x in st["stages"]) and st["throughput"][0]["runs"] >= 1


async def test_region_drives_default_language(client, cf):
    b = demo_brand()
    await cf.repo.upsert_brand(b)
    d = client.patch(f"/brands/{b.id}", json={"kit": {"region": "in-tg"}}).json()
    assert d["kit"]["region"] == "IN-TG" and d["kit"]["language"] == "te"
    assert d["kit"]["subtitle_languages"] == ["en", "hi"]
    # an explicit language wins over the region default
    d = client.patch(f"/brands/{b.id}", json={"kit": {"region": "IN-TN", "language": "en"}}).json()
    assert d["kit"]["language"] == "en" and d["kit"]["region"] == "IN-TN"
    # per-run region
    rid = client.post("/runs", json={"brand_id": b.id, "region": "IN-UP"}).json()["run_id"]
    run = client.get(f"/runs/{rid}").json()["run"]
    assert run["language"] == "hi" and run["subtitle_languages"] == ["en"] and run["region"] == "IN-UP"
    assert client.post("/runs", json={"brand_id": b.id, "region": "ZZ"}).status_code == 422
    assert client.patch(f"/brands/{b.id}", json={"kit": {"region": "Atlantis"}}).status_code == 422
    # viewer locale
    loc = client.get("/locale", headers={"CF-IPCountry": "IN", "X-Vercel-IP-Country-Region": "TN"}).json()
    assert loc["language"] == "ta" and loc["source"] == "geo" and loc["region"] == "IN-TN"
    loc = client.get("/locale", headers={"Accept-Language": "te-IN,te;q=0.9,en;q=0.8"}).json()
    assert loc["language"] == "te" and loc["source"] == "accept-language"
    assert client.get("/locale", params={"region": "IN-KA"}).json()["language"] == "kn"
    regions = {r["code"]: r for r in client.get("/regions").json()["items"]}
    assert regions["IN-AP"]["language"] == "te" and regions["IN-GJ"]["language"] == "gu"
    # new Indian languages validate
    for code in ("gu", "pa", "or", "as", "ur", "ne", "kok"):
        assert client.patch(f"/brands/{b.id}", json={"kit": {"language": code}}).status_code == 200
