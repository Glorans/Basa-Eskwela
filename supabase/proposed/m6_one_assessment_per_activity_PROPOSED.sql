-- ============================================================================
-- PROPOSED - NOT APPLIED. Do not run without explicit approval.
-- M6: one comprehension assessment per learning activity.
-- ============================================================================
--
-- The rule
--   M5 oral reading may be repeated; every reading is saved. M6 comprehension is one assessment
--   per learning activity, whichever reading leads to it:
--     * a module passage in its context: (user, module, passage, classroom, room assignment).
--       An Admin's or Independent Learner's own practice has no classroom or assignment;
--     * an assigned classroom material: (user, material, activity assignment).
--   Different passages, classrooms or assignments are different activities and are never blocked.
--
-- Why a migration is needed
--   Today the database allows one attempt per (user, oral reading) and per (user, submission).
--   A repeated reading therefore gets a new oral_reading_attempt_id and could start a new attempt.
--   The backend (server/services/comprehensionAttemptService.js) now reopens the activity's
--   existing assessment instead, but two start requests from two different readings sent at the
--   same moment could both pass that check before either is saved. Only the database can make
--   the rule race-free.
--
-- Why a trigger and not a unique index
--   ReadFlow-Staging already holds attempts saved under the old rule: some activities have more
--   than one attempt (read-only check 2026-11-06: one Admin activity with 2 attempts, one
--   completed; one Student activity with 4 attempts, two completed). A unique index cannot be
--   created over them without deleting or changing saved assessments. This trigger leaves every
--   existing row exactly as it is and only refuses NEW duplicates:
--     * INSERT: refused if the same user already has any attempt for the same activity;
--     * a change to status 'completed': refused if another attempt of the same activity is
--       already completed (an older extra attempt can never become a second completed result).
--   A transaction-scoped advisory lock per (user, activity) serializes concurrent starts and
--   completions, so two simultaneous requests cannot both pass. The refusal uses SQLSTATE 23505
--   (unique_violation), which the backend already handles by reopening the existing assessment.
--
-- What does NOT change
--   No table, column, constraint, index, policy or row. Existing attempts, answers, scores,
--   oral-reading links, completion times, M7 queue rows and M8 XP/badges stay exactly as they are.
--   m6_apply_action, m6_assert_completion_access, and the M7/M8 completion triggers are unchanged
--   (this trigger runs BEFORE them; when it refuses, nothing else runs).
--   M5 oral reading is not touched: readings can still be repeated.
--
-- Related, separate proposal
--   supabase/proposed/m6_single_attempt_PROPOSED.sql makes "one final answer per question"
--   race-free inside m6_apply_action. It is independent of this file; either order works.
--
-- BEFORE APPLYING: take a Staging backup, run m6_one_assessment_per_activity_VERIFY_READONLY.sql.
-- Rollback: supabase/proposed/m6_one_assessment_per_activity_ROLLBACK_PROPOSED.sql
--   (guarded on the applied function fingerprint 76e677bf797d8db768e11bc200abb539)
-- Test: server/tests/m6OneAssessmentPerActivityProposal.test.js (PGlite)
-- ============================================================================
begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.m6_comprehension_attempts') is null then
    raise exception 'Stop: public.m6_comprehension_attempts is missing.';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'm6_comprehension_attempts'
      and column_name in ('user_id', 'module_id', 'passage_id', 'room_id', 'assignment_id', 'material_id',
                          'activity_assignment_id', 'status')) <> 8 then
    raise exception 'Stop: m6_comprehension_attempts lacks an activity column.';
  end if;
  if to_regprocedure('public.m6_one_assessment_per_activity()') is not null
     or exists (select 1 from pg_trigger where tgname = 'm6_one_assessment_per_activity' and not tgisinternal) then
    raise exception 'Stop: m6_one_assessment_per_activity already exists (already applied?).';
  end if;
end $$;

create function public.m6_one_assessment_per_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  activity text := case when new.material_id is not null
    then concat_ws('|', 'material', new.user_id, new.material_id, new.activity_assignment_id)
    else concat_ws('|', 'module', new.user_id, new.module_id, new.passage_id,
                   coalesce(new.room_id::text, '-'), coalesce(new.assignment_id::text, '-')) end;
begin
  if tg_op = 'UPDATE' and (new.status is distinct from 'completed' or old.status is not distinct from 'completed') then
    return new;
  end if;
  -- Starts and completions of the same learning activity run one at a time.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('m6-activity|' || activity, 0));
  if exists (
    select 1 from public.m6_comprehension_attempts a
    where a.user_id = new.user_id and a.id <> new.id
      and (tg_op = 'INSERT' or a.status = 'completed')
      and case when new.material_id is not null
        then a.material_id = new.material_id and a.activity_assignment_id = new.activity_assignment_id
        else a.material_id is null and a.module_id = new.module_id and a.passage_id = new.passage_id
          and a.room_id is not distinct from new.room_id and a.assignment_id is not distinct from new.assignment_id end
  ) then
    raise exception using errcode = '23505', constraint = 'm6_one_assessment_per_activity',
      message = case when tg_op = 'INSERT'
        then 'This learning activity already has a comprehension assessment.'
        else 'This learning activity already has a completed comprehension assessment.' end;
  end if;
  return new;
end $$;
revoke all on function public.m6_one_assessment_per_activity() from public, anon, authenticated;

create trigger m6_one_assessment_per_activity
before insert or update of status on public.m6_comprehension_attempts
for each row execute function public.m6_one_assessment_per_activity();

-- Postconditions: fail closed inside this transaction.
do $$
begin
  if not exists (select 1 from pg_trigger t where t.tgname = 'm6_one_assessment_per_activity'
      and t.tgrelid = 'public.m6_comprehension_attempts'::regclass and t.tgenabled = 'O' and not t.tgisinternal) then
    raise exception 'Postcondition: trigger m6_one_assessment_per_activity is missing or disabled';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.m6_one_assessment_per_activity()'::regprocedure) then
    raise exception 'Postcondition: the trigger function must be SECURITY DEFINER';
  end if;
  if has_function_privilege('anon', 'public.m6_one_assessment_per_activity()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.m6_one_assessment_per_activity()', 'EXECUTE') then
    raise exception 'Postcondition: the trigger function is callable by clients';
  end if;
end $$;

commit;
