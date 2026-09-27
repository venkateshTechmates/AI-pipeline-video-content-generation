-- ClipForge schema (PRD §9). Every tenant row carries brand_id (multi-tenant, PRD §8).

-- Portable core schema (any Postgres >= 13). Supabase-specific pieces (RLS via auth.uid(), pgsodium,
-- pg_cron, Realtime, Storage) live in 0002_supabase.sql.

-- ------------------------------------------------------------------ orgs & membership

create table if not exists orgs (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists org_members (
  org_id text not null references orgs(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'reviewer' check (role in ('owner', 'admin', 'reviewer')),
  primary key (org_id, user_id)
);

-- ------------------------------------------------------------------ core tables

create table if not exists brands (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references orgs(id) on delete cascade,
  name text not null,
  kit_json jsonb not null default '{}'::jsonb,
  tier text not null default 'economy' check (tier in ('economy', 'premium')),
  budget_per_run numeric(10, 4) not null default 3.0,
  daily_budget numeric(10, 4) not null default 30.0,
  trust_score int not null default 0,
  auto_approve_after int not null default 10,
  calendar_json jsonb not null default '{}'::jsonb,
  publisher text not null default 'upload_post' check (publisher in ('upload_post', 'ayrshare')),
  created_at timestamptz not null default now()
);

create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  brief text,
  status text not null default 'queued',
  tier text not null default 'economy',
  budget numeric(10, 4) not null default 3.0,
  cost_total numeric(10, 4) not null default 0,
  checkpoint_id text,
  schedule timestamptz,
  platforms text[] not null default array['youtube', 'instagram', 'tiktok', 'linkedin', 'x', 'facebook'],
  error text,
  attempts int not null default 0,
  pending_decision jsonb,
  locked_by text,
  locked_at timestamptz,
  state_json jsonb not null default '{}'::jsonb,  -- denormalised snapshot for UI
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists runs_brand_status on runs (brand_id, status, created_at desc);

create table if not exists stages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  name text not null,
  status text not null default 'pending',
  attempt int not null default 0,
  provider text,
  cost numeric(10, 4) not null default 0,
  input_ref text,
  output_ref text,
  error text,
  started_at timestamptz,
  ended_at timestamptz,
  unique (run_id, name)
);

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  type text not null,
  storage_path text not null,
  sha256 text not null,
  meta_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists assets_run on assets (run_id);
create index if not exists assets_sha on assets (sha256);

create table if not exists cost_ledger (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  stage_id uuid references stages(id) on delete set null,
  stage text not null,
  provider text not null,
  units numeric(14, 4) not null,
  unit_cost numeric(12, 6) not null,
  total numeric(10, 4) not null,
  at timestamptz not null default now()
);
create index if not exists cost_ledger_brand_at on cost_ledger (brand_id, at);
create index if not exists cost_ledger_run on cost_ledger (run_id);

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  platform text not null,
  external_id text,
  url text,
  scheduled_at timestamptz,
  published_at timestamptz,
  status text not null default 'scheduled',
  metadata_json jsonb not null default '{}'::jsonb,
  unique (run_id, platform)
);

create table if not exists post_metrics (
  post_id uuid not null references posts(id) on delete cascade,
  captured_at timestamptz not null default now(),
  views bigint not null default 0,
  likes bigint not null default 0,
  comments bigint not null default 0,
  shares bigint not null default 0,
  retention_json jsonb not null default '{}'::jsonb,
  primary key (post_id, captured_at)
);

-- Publisher / provider tokens, encrypted at rest with pgsodium (per-brand isolation).
create table if not exists provider_credentials (
  brand_id uuid not null references brands(id) on delete cascade,
  provider text not null,
  encrypted_token bytea not null,
  key_id uuid not null,
  nonce bytea not null,
  expires_at timestamptz,
  refresh_token_enc bytea,
  primary key (brand_id, provider)
);

-- Render queue consumed by render workers with FOR UPDATE SKIP LOCKED.
create table if not exists render_jobs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  spec jsonb not null,
  output jsonb,
  error text,
  attempts int not null default 0,
  locked_by text,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists render_jobs_queue on render_jobs (status, created_at);

-- Hook history for 90-day dedupe (embedding similarity < 0.85).
create table if not exists hook_history (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  run_id uuid references runs(id) on delete set null,
  text text not null,
  embedding real[],  -- cosine similarity is computed in the app; dimension depends on the model
  created_at timestamptz not null default now()
);
create index if not exists hook_history_brand on hook_history (brand_id, created_at desc);

-- Dead-letter queue for poison runs.
create table if not exists dead_letters (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  stage text,
  error text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Webhook dedupe (idempotent provider callbacks).
create table if not exists webhook_events (
  id text primary key,
  source text not null,
  received_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ triggers

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists runs_touch on runs;
create trigger runs_touch before update on runs for each row execute function touch_updated_at();
drop trigger if exists render_jobs_touch on render_jobs;
create trigger render_jobs_touch before update on render_jobs for each row execute function touch_updated_at();

-- Keep runs.cost_total in sync with the ledger.
create or replace function ledger_rollup() returns trigger language plpgsql as $$
begin
  update runs set cost_total = cost_total + new.total where id = new.run_id;
  return new;
end $$;
drop trigger if exists cost_ledger_rollup on cost_ledger;
create trigger cost_ledger_rollup after insert on cost_ledger for each row execute function ledger_rollup();

