-- PROPOSED - NOT APPLIED - REQUIRES APPROVAL
-- M6 Admin practice: an Admin may complete comprehension on a published module the Admin
-- created, as the owner of their own attempt. DDL only: no attempt, answer, score, XP or
-- badge row is inserted, updated or deleted.
--
-- What changes
--   1. m6_assert_completion_access(uuid) is renamed, UNCHANGED, to
--      m6_assert_learner_completion_access(uuid). Renaming keeps the live body exactly as it is
--      on the target database (it may include M4 changes not in this repository).
--   2. A new m6_assert_completion_access(uuid) dispatches: every non-Admin owner gets the
--      unchanged learner check (so Teachers are still refused and Student/Independent Learner
--      rules are identical); an Admin owner gets the Admin-practice check below.
--      Callers (m6_apply_action, m8_on_comprehension_completed) call it by name, so they use
--      the dispatcher without being edited.
--   3. m8_on_comprehension_completed(): Admin completions earn no XP, reading day or badge.
--   4. m7_enqueue_completion(): Admin completions are not queued for at-risk evaluation.
--
-- Admin-practice rule (all must hold)
--   * attempt owner's role is 'admin'; the attempt is a module attempt with no classroom,
--     assignment or uploaded material;
--   * the module is published, not deleted, and created by that same Admin;
--   * the attempt language matches the module language;
--   * the linked M5 reading exists, belongs to the same Admin and is for the same module.
--
-- Fingerprints (resolved 2026-11-05)
--   The guards below use CR-normalized md5 values of pg_get_functiondef read READ-ONLY from
--   ReadFlow-Staging (PostgreSQL 17.11) on 2026-11-05. The same values were reproduced exactly
--   by replaying the repository migrations in PGlite (PostgreSQL 17), so the live bodies of
--   m8_on_comprehension_completed and m7_enqueue_completion are byte-identical to the bodies
--   reproduced here (20261026_m8_trusted_xp.sql, 20261024_m7_analytics.sql), apart from the one
--   Admin line each. Any drift since then stops this script.
--
-- Separate, related proposal (not part of this file)
--   Admin M5 practice readings still reach m8_oral_completed (read-aloud count, reading day,
--   Brave Reader badge). supabase/proposed/m8_reward_eligibility_PROPOSED.sql fixes that; its live
--   fingerprint is 76c29f67f939493194c7fb5c8a191bdb (pg_get_functiondef, read 2026-11-05).
--   Apply both for an Admin practice workflow with zero M8 progress.
--
-- BEFORE APPLYING
--   Run m6_admin_practice_VERIFY_READONLY.sql and take a staging backup. Apply this file only
--   with explicit approval. Test: server/tests/m6AdminPracticeProposal.test.js (PGlite).

begin;

do $$
declare
  fn text;
begin
  if to_regprocedure('public.m6_assert_completion_access(uuid)') is null then
    raise exception 'Stop: public.m6_assert_completion_access(uuid) is missing.';
  end if;
  if to_regprocedure('public.m6_assert_learner_completion_access(uuid)') is not null then
    raise exception 'Stop: m6_assert_learner_completion_access already exists (already applied?).';
  end if;
  foreach fn in array array['public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)', 'public.m8_on_comprehension_completed()'] loop
    if position('m6_assert_completion_access' in pg_get_functiondef(fn::regprocedure)) = 0 then
      raise exception 'Stop: % no longer calls m6_assert_completion_access.', fn;
    end if;
  end loop;
  -- The learner check that is renamed unchanged (fingerprint of the reviewed live definition).
  if md5(replace(pg_get_functiondef('public.m6_assert_completion_access(uuid)'::regprocedure), chr(13), ''))
      is distinct from '91606e8441adbf5aa18e8d9d8c6e6171' then
    raise exception 'Stop: m6_assert_completion_access differs from the reviewed definition.';
  end if;
  if md5(replace(pg_get_functiondef('public.m8_on_comprehension_completed()'::regprocedure), chr(13), ''))
      is distinct from '315d8d440b617e93281fd5a35cb623ed' then
    raise exception 'Stop: m8_on_comprehension_completed differs from the reviewed definition.';
  end if;
  if md5(replace(pg_get_functiondef('public.m7_enqueue_completion()'::regprocedure), chr(13), ''))
      is distinct from 'f5274f2a411092aea73d88fe1b093d68' then
    raise exception 'Stop: m7_enqueue_completion differs from the reviewed definition.';
  end if;
end $$;

-- 1. The live learner check, unchanged, under a new name.
alter function public.m6_assert_completion_access(uuid) rename to m6_assert_learner_completion_access;
revoke all on function public.m6_assert_learner_completion_access(uuid) from public, anon, authenticated;

-- 2. Dispatcher.
create function public.m6_assert_completion_access(p_attempt uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare a public.m6_comprehension_attempts%rowtype; v_role text; v_language text;
begin
  select * into a from public.m6_comprehension_attempts where id = p_attempt;
  if not found then raise exception 'Activity not found' using errcode = 'P0002'; end if;
  select role into v_role from public.profiles where id = a.user_id for share;
  if v_role is distinct from 'admin' then
    -- Students, Independent Learners and every other role: the unchanged learner rules.
    perform public.m6_assert_learner_completion_access(p_attempt);
    return;
  end if;
  if a.module_id is null or a.room_id is not null or a.assignment_id is not null
      or a.material_id is not null or a.activity_assignment_id is not null then
    raise exception 'Admin practice is limited to the Admin''s own published modules' using errcode = '42501';
  end if;
  select public.m8_normalize_language(p.language) into v_language
  from public.modules m join public.learning_paths p on p.id = m.path_id
  where m.id = a.module_id and m.status = 'published' and m.deleted_at is null and m.created_by = a.user_id
  for share of m, p;
  if not found then raise exception 'Module access revoked' using errcode = '42501'; end if;
  if v_language is null then raise exception 'Unknown module language' using errcode = '22023'; end if;
  if v_language is distinct from a.language then
    raise exception 'Attempt language does not match its module' using errcode = '22023';
  end if;
  perform 1 from public.oral_reading_attempts r
  where r.id = a.oral_reading_attempt_id and r.user_id = a.user_id and r.module_id = a.module_id
    and r.room_id is null and r.material_id is null;
  if not found then
    raise exception 'Admin practice requires the Admin''s own reading of this module' using errcode = '42501';
  end if;
end $$;
revoke all on function public.m6_assert_completion_access(uuid) from public, anon, authenticated;

-- 3. M8: reproduced from 20261026_m8_trusted_xp.sql; the only change is the Admin return.
create or replace function public.m8_on_comprehension_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier integer;
  v_allowed integer;
  v_granted boolean := false;
begin
  if new.status <> 'completed' or new.completed_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'completed' then return new; end if;
  perform public.m6_assert_completion_access(new.id);
  -- Admin practice is valid but is not learner progress: no XP, reading day or badge.
  if exists (select 1 from public.profiles where id = new.user_id and role = 'admin') then return new; end if;

  if new.activity_assignment_id is not null then
    v_granted := public.m8_grant_xp(new.user_id, 'assignment', new.activity_assignment_id, 60);
  else
    select case lower(m.difficulty) when 'easy' then 1 when 'medium' then 2 when 'hard' then 3 else 0 end
      into v_tier from public.modules m where m.id = new.module_id;
    if v_tier is null or v_tier = 0 then raise exception 'Unknown module difficulty'; end if;
    if new.room_id is not null then
      v_allowed := v_tier;
    else
      v_allowed := case public.m2_trusted_reading_level(new.user_id, new.language)
        when 'Independent' then 3 when 'Instructional' then 2 when 'Frustration' then 1 end;
      if v_allowed is null then return new; end if;
    end if;
    v_granted := public.m8_grant_xp(new.user_id, 'module', new.module_id,
      case least(v_tier, v_allowed) when 1 then 30 when 2 then 50 else 80 end);
  end if;

  -- Only new verified XP records a reading day; duplicates never farm streaks.
  if v_granted then
    perform public.m8_record_reading_day(new.user_id, (new.completed_at at time zone 'Asia/Manila')::date);
  end if;
  return new;
end $$;
revoke all on function public.m8_on_comprehension_completed() from public, anon, authenticated;

-- 4. M7: reproduced from 20261024_m7_analytics.sql; Admin completions are not queued.
create or replace function public.m7_enqueue_completion() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed')
     and not exists (select 1 from public.profiles p where p.id = new.user_id and p.role = 'admin') then
    insert into public.m7_risk_queue(id) values (new.user_id)
    on conflict(id) do update set generation = nextval('public.m7_risk_generation'), updated_at = now();
  end if;
  return new;
end; $$;
revoke all on function public.m7_enqueue_completion() from public, anon, authenticated;

-- Admin M5 practice readings (m8_oral_completed) are handled by the separate
-- m8_reward_eligibility_PROPOSED.sql; see the header.

-- Postconditions: fail closed inside this transaction.
do $$
declare fn text;
begin
  foreach fn in array array['public.m6_assert_completion_access(uuid)', 'public.m6_assert_learner_completion_access(uuid)',
    'public.m8_on_comprehension_completed()', 'public.m7_enqueue_completion()'] loop
    if to_regprocedure(fn) is null then raise exception 'Postcondition: % missing', fn; end if;
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'Postcondition: % is callable by clients', fn;
    end if;
  end loop;
  if (select prosecdef from pg_proc where oid = 'public.m6_assert_completion_access(uuid)'::regprocedure) then
    raise exception 'Postcondition: dispatcher must stay SECURITY INVOKER';
  end if;
  if not has_function_privilege('service_role', 'public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)', 'EXECUTE') then
    raise exception 'Postcondition: service_role lost m6_apply_action';
  end if;
end $$;

commit;
