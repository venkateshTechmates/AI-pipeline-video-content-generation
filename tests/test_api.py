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
