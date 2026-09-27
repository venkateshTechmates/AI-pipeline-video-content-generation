-- Supabase layer: pgsodium-encrypted provider tokens, RLS, Realtime, Storage bucket, pg_cron schedules.

create extension if not exists pgsodium;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ------------------------------------------------------------------ credentials helpers

create or replace function put_provider_credential(
  p_brand uuid, p_provider text, p_token text, p_expires timestamptz default null
) returns void language plpgsql security definer set search_path = public, pgsodium as $$
declare
  k uuid;
  n bytea := pgsodium.crypto_aead_det_noncegen();
begin
  select id into k from pgsodium.valid_key where name = 'clipforge_tokens' limit 1;
  if k is null then
    select id into k from pgsodium.create_key(name := 'clipforge_tokens');
  end if;
  insert into provider_credentials (brand_id, provider, encrypted_token, key_id, nonce, expires_at)
  values (p_brand, p_provider,
          pgsodium.crypto_aead_det_encrypt(convert_to(p_token, 'utf8'), convert_to(p_brand::text, 'utf8'), k, n),
          k, n, p_expires)
  on conflict (brand_id, provider) do update
    set encrypted_token = excluded.encrypted_token, key_id = excluded.key_id,
        nonce = excluded.nonce, expires_at = excluded.expires_at;
end $$;

create or replace function get_provider_credential(p_brand uuid, p_provider text)
returns text language sql security definer set search_path = public, pgsodium as $$
  select convert_from(
    pgsodium.crypto_aead_det_decrypt(encrypted_token, convert_to(brand_id::text, 'utf8'), key_id, nonce), 'utf8')
  from provider_credentials where brand_id = p_brand and provider = p_provider;
$$;
revoke all on function get_provider_credential(uuid, text) from public, anon, authenticated;
revoke all on function put_provider_credential(uuid, text, text, timestamptz) from public, anon, authenticated;

-- ------------------------------------------------------------------ RLS

create or replace function is_brand_member(p_brand uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from brands b join org_members m on m.org_id = b.org_id
    where b.id = p_brand and m.user_id = auth.uid()
  );
$$;

alter table orgs enable row level security;
alter table org_members enable row level security;
alter table brands enable row level security;
alter table runs enable row level security;
alter table stages enable row level security;
alter table assets enable row level security;
alter table cost_ledger enable row level security;
alter table posts enable row level security;
alter table post_metrics enable row level security;
alter table provider_credentials enable row level security;
alter table render_jobs enable row level security;
alter table hook_history enable row level security;
alter table dead_letters enable row level security;
alter table webhook_events enable row level security;

create policy orgs_member on orgs for select
  using (exists (select 1 from org_members m where m.org_id = orgs.id and m.user_id = auth.uid()));
create policy org_members_self on org_members for select using (user_id = auth.uid());
create policy brands_member on brands for select
  using (exists (select 1 from org_members m where m.org_id = brands.org_id and m.user_id = auth.uid()));
create policy runs_member on runs for select using (is_brand_member(brand_id));
create policy stages_member on stages for select
  using (exists (select 1 from runs r where r.id = stages.run_id and is_brand_member(r.brand_id)));
create policy assets_member on assets for select
  using (exists (select 1 from runs r where r.id = assets.run_id and is_brand_member(r.brand_id)));
create policy ledger_member on cost_ledger for select using (is_brand_member(brand_id));
create policy posts_member on posts for select
  using (exists (select 1 from runs r where r.id = posts.run_id and is_brand_member(r.brand_id)));
create policy post_metrics_member on post_metrics for select
  using (exists (select 1 from posts p join runs r on r.id = p.run_id
                 where p.id = post_metrics.post_id and is_brand_member(r.brand_id)));
create policy hook_history_member on hook_history for select using (is_brand_member(brand_id));
-- provider_credentials, render_jobs, dead_letters, webhook_events: service role only (no policies).

-- Realtime: the review UI subscribes to run status changes.
do $$ begin
  alter publication supabase_realtime add table runs;
exception when others then null;
end $$;

-- ------------------------------------------------------------------ storage

insert into storage.buckets (id, name, public)
values ('clipforge', 'clipforge', false)
on conflict (id) do nothing;

-- ------------------------------------------------------------------ scheduled jobs (pg_cron -> API)
-- Set these once per project:
--   alter database postgres set app.api_url = 'https://api.example.com';
--   alter database postgres set app.cron_secret = '...';

create or replace function call_api(path text) returns void language plpgsql as $$
begin
  perform net.http_post(
    url := current_setting('app.api_url', true) || path,
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-cron-secret', current_setting('app.cron_secret', true)),
    body := '{}'::jsonb);
end $$;

select cron.schedule('clipforge-calendar', '*/15 * * * *', $$select call_api('/cron/calendar')$$);
select cron.schedule('clipforge-metrics', '7 * * * *', $$select call_api('/cron/metrics')$$);
select cron.schedule('clipforge-token-refresh', '23 */6 * * *', $$select call_api('/cron/refresh-tokens')$$);
select cron.schedule('clipforge-recover', '*/5 * * * *', $$select call_api('/cron/recover')$$);
