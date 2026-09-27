"""PostgresRepo + LangGraph Postgres checkpointer against a real database.

Set CLIPFORGE_TEST_DATABASE_URL to an empty database; the core migration is applied
(plus plaintext stand-ins for the pgsodium credential functions from 0002_supabase.sql).
"""

import os
from pathlib import Path

import pytest

from clipforge.models import ApprovalDecision, Brand, Platform, PostRecord, RenderJob, Run, RunStatus
from clipforge.orchestrator import create_app_state, execute

from .conftest import requires_ffmpeg

DSN = os.environ.get("CLIPFORGE_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="CLIPFORGE_TEST_DATABASE_URL not set")

ROOT = Path(__file__).resolve().parent.parent
CRED_SHIM = """
create or replace function put_provider_credential(p_brand uuid, p_provider text, p_token text,
  p_expires timestamptz default null) returns void language sql as $$
  insert into provider_credentials (brand_id, provider, encrypted_token, key_id, nonce, expires_at)
  values (p_brand, p_provider, convert_to(p_token, 'utf8'), gen_random_uuid(), '\\x00', p_expires)
  on conflict (brand_id, provider) do update set encrypted_token = excluded.encrypted_token,
    expires_at = excluded.expires_at $$;
create or replace function get_provider_credential(p_brand uuid, p_provider text) returns text language sql as $$
  select convert_from(encrypted_token, 'utf8') from provider_credentials
  where brand_id = p_brand and provider = p_provider $$;
"""


@pytest.fixture(scope="module")
def migrated():
    import psycopg

    with psycopg.connect(DSN, autocommit=True) as c:
        c.execute("drop schema public cascade; create schema public;")
        c.execute((ROOT / "supabase/migrations/0001_core.sql").read_text())
        c.execute(CRED_SHIM)
    return DSN


@pytest.fixture
def pg_settings(settings, migrated):
    return settings.model_copy(update={"database_url": migrated})


async def test_repo_roundtrip(pg_settings):
    app = await create_app_state(pg_settings)
    repo = app.repo
    try:
        b = Brand(name="PG", org_id="org-pg")
        await repo.upsert_brand(b)
        assert (await repo.get_brand(b.id)).name == "PG"
        assert await repo.record_review(b.id, True) == 1
        assert await repo.record_review(b.id, False) == 0

        run = Run(brand_id=b.id, brief="x", platforms=[Platform.tiktok])
        await repo.create_run(run)
        claimed = await repo.claim_runs("w1", 5)
        assert [r.id for r in claimed] == [run.id] and claimed[0].status == RunStatus.running
        assert await repo.claim_runs("w2", 5) == []
        await repo.update_run(run.id, status=RunStatus.resume_requested, pending_decision={"decision": "approve"})
        r = (await repo.claim_runs("w2", 5))[0]
        assert r.pending_decision == {"decision": "approve"}

        from clipforge.ledger import CostLedger

        await CostLedger(repo, pg_settings).charge(run_id=run.id, brand_id=b.id, stage="tts",
                                                   provider="elevenlabs:tts", units=2)
        assert (await repo.get_run(run.id)).cost_total == pytest.approx(0.36)  # trigger rollup

        p = await repo.upsert_post(PostRecord(run_id=run.id, platform=Platform.tiktok, external_id="e1"))
        assert (await repo.find_post_by_external("e1")).id == p.id

        await repo.add_hook(b.id, run.id, "hook", [0.1, 0.2])
        from datetime import timedelta

        from clipforge.models import utcnow

        assert await repo.recent_hooks(b.id, utcnow() - timedelta(days=1)) == [("hook", pytest.approx([0.1, 0.2]))]
        assert await repo.recent_hooks(b.id, utcnow() - timedelta(days=1), exclude_run_id=run.id) == []

        job = await repo.enqueue_render(RenderJob(run_id=run.id, spec={"a": 1}))
        assert (await repo.claim_render_job("rw")).id == job.id
        await repo.finish_render_job(job.id, {"outputs": []}, None)
        assert (await repo.get_render_job(job.id)).status == "done"

        await repo.put_credential(b.id, "ayrshare", "profile-key")
        assert await repo.get_credential(b.id, "ayrshare") == "profile-key"
        assert await repo.mark_webhook("evt", "fal") is True
        assert await repo.mark_webhook("evt", "fal") is False
    finally:
        await app.aclose()


@requires_ffmpeg
async def test_interrupt_and_resume_across_processes(pg_settings):
    """Worker A runs to the approval gate; a fresh worker B (new pool + checkpointer) resumes it."""
    a = await create_app_state(pg_settings)
    try:
        b = Brand(name="PG2", kit={"niche": "cooking"})
        await a.repo.upsert_brand(b)
        run = Run(brand_id=b.id, brief="one-pan dinners", budget=3.0)
        await a.repo.create_run(run)
        r = await execute(a, run)
        assert r.status == RunStatus.awaiting_approval, r.error
        assert r.checkpoint_id
    finally:
        await a.aclose()

    bapp = await create_app_state(pg_settings)
    try:
        await bapp.repo.update_run(run.id, status=RunStatus.resume_requested,
                                   pending_decision=ApprovalDecision(decision="approve").model_dump(mode="json"))
        claimed = await bapp.repo.claim_runs("worker-b", 1)
        assert claimed[0].id == run.id
        r = await execute(bapp, claimed[0])
        assert r.status == RunStatus.published, r.error
        assert len(await bapp.repo.list_posts(run.id)) == 5
        assert {s.name for s in await bapp.repo.list_stages(run.id)} >= {"ideate", "qa", "approve", "publish"}
    finally:
        await bapp.aclose()
