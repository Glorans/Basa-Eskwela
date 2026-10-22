-- PREPARED ONLY. Requires review and approval. Not applied anywhere.
-- C9: M8 XP and difficulty from trusted evidence. Forward-only; apply after DT1
-- (20261025_m2_trusted_diagnostics.sql) in ONE run of this whole file. Re-runnable:
-- every object is replaced in place and the display summary is recomputed.
-- Before: supabase/staging/verify_c9_trusted_xp.sql P-C9a..P-C9f.
-- After:  V-C9a..V-C9i, then audit_stage_b.sql A1-A8.
--
-- Fixes (see docs/C9_TRUSTED_XP_REVIEW.md):
-- * m8_on_comprehension_completed raised 'Reading difficulty is locked', which
--   rolled back a valid M6 completion. XP is now decided by branching: an
--   unavailable reward never rejects the completion.
-- * Authorization came from m8_learner_progress.unlocked_difficulty, a shared,
--   last-write-wins value (EN or FIL) copied from learner-written diagnostics.
--   It now authorizes nothing and is a display summary of verified results.
-- Unchanged: trigger names and timing (V12e, M7), m8_grant_xp idempotency,
-- reading-day and badge rules, earned badges, XP events and diagnostic rows.
begin;

do $$
declare item record;
begin
  if pg_catalog.to_regprocedure('public.m2_trusted_reading_level(uuid,text)') is null
    or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.diagnostic_results'::regclass
      and attname = 'verification_status' and not attisdropped) then
    raise exception 'Stop: apply DT1 (20261025_m2_trusted_diagnostics.sql) before C9.';
  end if;
  for item in select * from (values
    ('m8_on_comprehension_completed()', 'm6_comprehension_attempts', 'm8_m6_completed'),
    ('m8_sync_diagnostic()', 'diagnostic_results', 'm8_diagnostic_sync')
  ) as required(fn, tbl, trg) loop
    if pg_catalog.to_regprocedure('public.' || item.fn) is null or not exists (
      select 1 from pg_catalog.pg_trigger where tgrelid = pg_catalog.to_regclass('public.' || item.tbl)
        and tgname = item.trg and not tgisinternal) then
      raise exception 'Stop: C2/C3 object public.% or trigger % is missing.', item.fn, item.trg;
    end if;
  end loop;
  if pg_catalog.to_regprocedure('public.m8_grant_xp(uuid,text,uuid,integer)') is null
    or pg_catalog.to_regprocedure('public.m8_record_reading_day(uuid,date)') is null then
    raise exception 'Stop: C2/C3 XP functions are missing.';
  end if;
  -- Saved attempts are authorization evidence only while clients cannot forge
  -- their source, owner, snapshot or completion. Do not bypass this boundary.
  for item in select c.oid, r.rolname from pg_catalog.pg_class c
    cross join pg_catalog.pg_roles r
    where c.oid in (pg_catalog.to_regclass('public.m6_comprehension_attempts'),
      pg_catalog.to_regclass('public.m6_comprehension_responses'))
      and r.rolname in ('anon','authenticated') loop
    if has_any_column_privilege(item.rolname, item.oid, 'SELECT')
      or has_any_column_privilege(item.rolname, item.oid, 'INSERT')
      or has_any_column_privilege(item.rolname, item.oid, 'UPDATE')
      or has_table_privilege(item.rolname, item.oid, 'DELETE,TRUNCATE,TRIGGER') then
      raise exception 'Stop: M6 evidence must remain backend-only.';
    end if;
  end loop;
  if pg_catalog.to_regprocedure('public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)') is null
    or has_function_privilege('anon', 'public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)', 'EXECUTE') then
    raise exception 'Stop: M6 completion RPC must remain backend-only.';
  end if;
  if not exists (select 1 from pg_catalog.pg_proc p
      where p.oid = 'public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)'::regprocedure
        and p.prosecdef and p.proconfig = array['search_path=""']
        and not pg_has_role('anon', p.proowner, 'MEMBER')
        and not pg_has_role('authenticated', p.proowner, 'MEMBER')
        and md5(replace(p.prosrc, E'\r\n', E'\n')) in
          ('ab592754ec820e5ed2533fa52a6adb7f', 'ab1569a4dab7fffd71e7ff1315dd5971')) then
    raise exception 'Stop: unreviewed M6 completion function. Compare its definition before replacing it.';
  end if;
  for item in select * from (values
    ('m6_comprehension_attempts','language'), ('m6_comprehension_attempts','module_id'),
    ('m6_comprehension_attempts','room_id'), ('m6_comprehension_attempts','assignment_id'),
    ('m6_comprehension_attempts','material_id'), ('m6_comprehension_attempts','activity_assignment_id'),
    ('modules','path_id'), ('modules','difficulty'), ('modules','status'), ('modules','deleted_at'),
    ('learning_paths','language'), ('room_modules','assigned_by'), ('rooms','teacher_id'),
    ('enrollments','student_id'), ('profiles','teacher_status'),
    ('uploaded_materials','language'), ('uploaded_materials','uploaded_by'), ('uploaded_materials','extraction_status'),
    ('reading_activity_assignments','student_id'), ('reading_activity_assignments','assigned_by')
  ) as required(tbl, col) loop
    if not exists (select 1 from pg_catalog.pg_attribute where attrelid = pg_catalog.to_regclass('public.' || item.tbl)
        and attname = item.col and not attisdropped) then
      raise exception 'Stop: missing prerequisite column public.%.%', item.tbl, item.col;
    end if;
  end loop;
end $$;

-- Same mapping as the backend's normalizeLanguage (oralReadingAttemptService.js)
-- and assignedReadingSource.js. learning_paths.language is unconstrained text.
create or replace function public.m8_normalize_language(p_language text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case lower(btrim(p_language))
    when 'en' then 'en' when 'english' then 'en'
    when 'fil' then 'fil' when 'filipino' then 'fil' when 'tagalog' then 'fil'
    when 'fil-ph' then 'fil' when 'tl' then 'fil' when 'tl-ph' then 'fil'
  end
$$;
revoke all on function public.m8_normalize_language(text) from public, anon, authenticated;

-- Completion authority is separate from reward eligibility. Current access is
-- required even for a previously started assessment (owner decision, C9 review).
-- Keep the saved question/text snapshot; ordinary content edits do not replace it.
-- SHARE locks hold the authorization rows through completion and XP/queue writes:
-- concurrent revocation either wins first or waits until this transaction ends.
create or replace function public.m6_assert_completion_access(p_attempt uuid)
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
  if v_role is null or v_role not in ('student','general_user') then
    raise exception 'Learner access required' using errcode = '42501';
  end if;
  if (a.room_id is not null and v_role <> 'student')
    or (a.room_id is null and v_role <> 'general_user') then
    raise exception 'Learner role does not match attempt context' using errcode = '42501';
  end if;
  if a.module_id is not null then
    if a.material_id is not null or a.activity_assignment_id is not null
      or (a.room_id is null) <> (a.assignment_id is null) then
      raise exception 'Malformed classroom module attempt' using errcode = '22023';
    end if;
    select public.m8_normalize_language(p.language) into v_language
    from public.modules m join public.learning_paths p on p.id = m.path_id
    where m.id = a.module_id and m.status = 'published' and m.deleted_at is null
    for share of m, p;
    if not found then raise exception 'Module access revoked' using errcode = '42501'; end if;
    if v_language is null then raise exception 'Unknown module language' using errcode = '22023'; end if;
    if v_language is distinct from a.language then
      raise exception 'Attempt language does not match its module' using errcode = '22023';
    end if;
    if a.room_id is not null then
      perform 1 from public.room_modules rm
      join public.rooms r on r.id = rm.room_id
      join public.enrollments e on e.room_id = r.id and e.student_id = a.user_id
      join public.profiles t on t.id = r.teacher_id
      where rm.id = a.assignment_id and rm.room_id = a.room_id and rm.module_id = a.module_id
        and rm.assigned_by = r.teacher_id and t.role = 'teacher' and t.teacher_status = 'approved'
      for share of rm, r, e, t;
      if not found then
        raise exception 'Classroom module access revoked or assignment does not belong to this classroom module'
          using errcode = '42501';
      end if;
    end if;
  elsif a.material_id is not null and a.activity_assignment_id is not null
      and a.room_id is not null and a.assignment_id is null then
    select public.m8_normalize_language(m.language) into v_language
    from public.reading_activity_assignments ra
    join public.uploaded_materials m on m.id = ra.material_id
    join public.rooms r on r.id = ra.room_id
    join public.enrollments e on e.room_id = r.id and e.student_id = a.user_id
    join public.profiles t on t.id = r.teacher_id
    where ra.id = a.activity_assignment_id and ra.student_id = a.user_id
      and ra.room_id = a.room_id and ra.material_id = a.material_id
      and ra.assigned_by = r.teacher_id and m.uploaded_by = r.teacher_id
      and t.role = 'teacher' and t.teacher_status = 'approved' and m.extraction_status = 'completed'
    for share of ra, m, r, e, t;
    if not found then
      raise exception 'Material access revoked or assignment does not belong to learner' using errcode = '42501';
    end if;
    if v_language is null or v_language is distinct from a.language then
      raise exception 'Attempt language does not match its material' using errcode = '22023';
    end if;
  else
    raise exception 'Malformed comprehension source' using errcode = '22023';
  end if;
end $$;
revoke all on function public.m6_assert_completion_access(uuid) from public, anon, authenticated;

-- Display only: the highest tier among the learner's verified EN and FIL levels,
-- 'Easy' without any. Never used to authorize XP.
create or replace function public.m8_verified_difficulty_summary(p_user uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case greatest(
      coalesce(case public.m2_trusted_reading_level(p_user, 'en')
        when 'Independent' then 3 when 'Instructional' then 2 when 'Frustration' then 1 end, 1),
      coalesce(case public.m2_trusted_reading_level(p_user, 'fil')
        when 'Independent' then 3 when 'Instructional' then 2 when 'Frustration' then 1 end, 1))
    when 3 then 'Hard' when 2 then 'Medium' else 'Easy' end
$$;
revoke all on function public.m8_verified_difficulty_summary(uuid) from public, anon, authenticated;

-- Only server-verified diagnostics reach M8. DT1 already rejects new unverified
-- rows and freezes old ones; the guard keeps that true if DT1's trigger changes.
create or replace function public.m8_sync_diagnostic()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.verification_status is distinct from 'server_verified' then return new; end if;
  if new.reading_level not in ('Frustration', 'Instructional', 'Independent') then
    raise exception 'Invalid reading level';
  end if;
  insert into public.m8_learner_progress(user_id, unlocked_difficulty)
  values (new.user_id, public.m8_verified_difficulty_summary(new.user_id))
  on conflict (user_id) do update
    set unlocked_difficulty = excluded.unlocked_difficulty, updated_at = now();
  if new.reading_level in ('Independent', 'Instructional') then
    insert into public.m8_earned_badges(user_id, badge_id) values (new.user_id, 'level_up')
    on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function public.m8_sync_diagnostic() from public, anon, authenticated;

-- Recheck current access for trusted direct inserts too, not only the M6 RPC.
-- Missing trusted diagnostics affect XP only; revoked access rejects completion.
-- * Classroom work earns its full tier. Independent work earns at most the
--   learner's trusted tier in the attempt's language.
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

-- Existing M6 scoring/ownership/retry logic is unchanged except the access check
-- before a new completion. Already-completed retries return the saved outcome.
CREATE OR REPLACE FUNCTION public.m6_apply_action(target_attempt uuid, target_user uuid, target_question uuid, action_name text, selected_option integer, request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  activity public.m6_comprehension_attempts%rowtype;
  response public.m6_comprehension_responses%rowtype;
  question jsonb;
  correct_index integer;
  answer_correct boolean;
  history jsonb;
  previous_action jsonb;
begin
  -- Lock the activity so answer/hint/completion requests run in order.
  select *
  into activity
  from public.m6_comprehension_attempts
  where id = target_attempt
    and user_id = target_user
  for update;

  if not found then
    raise exception 'Activity not found'
      using errcode = 'P0002';
  end if;

  if action_name is null
     or action_name not in ('answer', 'hint', 'complete') then
    raise exception 'Invalid activity action'
      using errcode = '22023';
  end if;

  if action_name = 'complete' then
    if activity.status = 'completed' then
      return jsonb_build_object('completed', true);
    end if;

    perform public.m6_assert_completion_access(activity.id);

    if exists (
      select 1
      from jsonb_array_elements(activity.question_snapshot) as q(value)
      where not exists (
        select 1
        from public.m6_comprehension_responses r
        where r.attempt_id = activity.id
          and r.question_id = (q.value->>'id')::uuid
          and r.resolved = true
      )
    ) then
      raise exception 'Finish every question before completing'
        using errcode = '22023';
    end if;

    update public.m6_comprehension_attempts
    set status = 'completed',
        completed_at = now()
    where id = activity.id;

    return jsonb_build_object('completed', true);
  end if;

  select q.value
  into question
  from jsonb_array_elements(activity.question_snapshot) as q(value)
  where q.value->>'id' = target_question::text;

  if question is null then
    raise exception 'Question does not belong to this activity'
      using errcode = '22023';
  end if;

  if action_name = 'answer' then
    if selected_option is null
       or selected_option < 0
       or selected_option > 3
       or request_id is null then
      raise exception 'Invalid answer request'
        using errcode = '22023';
    end if;
  end if;

  select *
  into response
  from public.m6_comprehension_responses
  where attempt_id = activity.id
    and question_id = target_question;

  -- A network retry reuses its request ID.
  if action_name = 'answer' and response.id is not null then
    select h.value
    into previous_action
    from jsonb_array_elements(response.answer_history) as h(value)
    where h.value->>'requestId' = request_id::text;

    if previous_action is not null then
      if (previous_action->>'optionIndex')::integer
         <> selected_option then
        raise exception 'Request ID already used for another answer'
          using errcode = '22023';
      end if;

      return jsonb_build_object(
        'correct', (previous_action->>'correct')::boolean,
        'resolved', response.resolved
      );
    end if;
  end if;

  if activity.status = 'completed' then
    raise exception 'This activity is already completed'
      using errcode = '22023';
  end if;

  if response.id is null then
    insert into public.m6_comprehension_responses (
      attempt_id,
      question_id
    )
    values (
      activity.id,
      target_question
    )
    returning * into response;
  end if;

  if action_name = 'hint' then
    if not response.resolved then
      update public.m6_comprehension_responses
      set hint_used = true,
          updated_at = now()
      where id = response.id;
    end if;

    return jsonb_build_object(
      'hint', question->>'scaffoldingHint',
      'resolved', response.resolved
    );
  end if;

  if response.resolved then
    raise exception 'This question is already finished'
      using errcode = '22023';
  end if;

  correct_index := (question->>'correctOptionIndex')::integer;

  if correct_index is null
     or correct_index < 0
     or correct_index > 3 then
    raise exception 'Invalid saved answer key';
  end if;

  answer_correct := selected_option = correct_index;

  history := response.answer_history || jsonb_build_array(
    jsonb_build_object(
      'requestId', request_id,
      'optionIndex', selected_option,
      'correct', answer_correct,
      'hintUsed', response.hint_used,
      'answeredAt', now()
    )
  );

  update public.m6_comprehension_responses
  set first_option_index =
        coalesce(first_option_index, selected_option),
      first_answer_correct =
        coalesce(first_answer_correct, answer_correct),
      answer_history = history,

      -- After two answers, move to explanation and the next question.
      resolved = answer_correct
        or jsonb_array_length(history) >= 2,

      updated_at = now()
  where id = response.id
  returning * into response;

  return jsonb_build_object(
    'correct', answer_correct,
    'resolved', response.resolved
  );
end;
$function$;
revoke all on function public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid) from public, anon, authenticated;
grant execute on function public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid) to service_role;

-- Recompute the display summary from verified results only. Earned badges and
-- XP events are kept; diagnostic rows are not touched.
insert into public.m8_learner_progress(user_id, unlocked_difficulty)
select distinct d.user_id, public.m8_verified_difficulty_summary(d.user_id)
from public.diagnostic_results d where d.verification_status = 'server_verified'
on conflict (user_id) do nothing;
update public.m8_learner_progress p
set unlocked_difficulty = public.m8_verified_difficulty_summary(p.user_id), updated_at = now()
where p.unlocked_difficulty is distinct from public.m8_verified_difficulty_summary(p.user_id);

notify pgrst, 'reload schema';
commit;
