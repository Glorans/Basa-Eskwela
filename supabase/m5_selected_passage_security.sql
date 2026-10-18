-- REVIEW/APPLY MANUALLY. No live SQL is executed by the application.
-- Prerequisites: M3 schema/RLS, passage phases 1/2, M4 migration, M5 base schema.
begin;
alter table public.oral_reading_attempts
  add column if not exists passage_id uuid,
  add column if not exists passage_title_snapshot text,
  add column if not exists module_title_snapshot text,
  add column if not exists language_snapshot text,
  add column if not exists room_id uuid,
  add column if not exists assignment_id uuid,
  add column if not exists submission_id uuid,
  add column if not exists scoring_version integer not null default 1;
-- References deliberately retain historical context when assignments/rooms are
-- removed. Passage snapshot, rather than current content, is authoritative.
-- Historical attempts remain version 1 and are never rescored/backfilled.
create unique index if not exists m5_owner_submission_unique
  on public.oral_reading_attempts(user_id, submission_id) where submission_id is not null;
-- Only trusted backend service-role writes may persist computed results.
-- Revoke the grant AND add a restrictive policy so other permissive policies
-- cannot restore direct authenticated inserts. No unrelated policies are dropped.
grant select, insert on public.oral_reading_attempts to service_role;
revoke insert, update, delete on public.oral_reading_attempts from anon, authenticated;
drop policy if exists "M5 server computed inserts only" on public.oral_reading_attempts;
create policy "M5 server computed inserts only" on public.oral_reading_attempts
  as restrictive for insert to authenticated with check (false);
-- Teacher reads continue through the authenticated backend, scoped to current
-- enrolled Student profiles and owned rooms; no direct teacher SELECT grant/policy.
commit;
