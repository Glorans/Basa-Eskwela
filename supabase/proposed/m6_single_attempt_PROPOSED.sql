-- ============================================================================
-- PROPOSED - NOT APPLIED. Do not run without explicit approval.
-- M6 single-attempt comprehension: one question = one final submitted answer.
-- ============================================================================
--
-- Why a migration is needed
--   The answer rule lives in the locked database function m6_apply_action
--   (service_role only). Today it leaves a question open after a wrong first
--   answer so the learner can answer once more. The backend
--   (server/services/comprehensionActionService.js) already refuses a second
--   answer and closes answered questions without this migration, but two
--   answer requests sent at the same moment could both pass that check before
--   either is saved. Only the locked function can make the rule race-free.
--
-- What changes (m6_apply_action only)
--   * The first answer finishes the question (resolved = true), correct or not.
--   * Any further answer to an answered question is refused
--     ('This question already has a final answer'); a retry of the same
--     request still returns the saved result.
--   * The separate 'hint' action is removed (the app no longer sends it).
--   Everything else is unchanged: ownership lock, request-ID retries,
--   first-answer columns, completion checks and m6_assert_completion_access.
--
-- What does NOT change
--   No table, column, constraint, trigger, policy or row. Completed attempts,
--   saved answers, answer_history, hint_used, first-answer scores, M7 records
--   and M8 XP/badges stay exactly as they are; nothing is recalculated.
--   Scoring stays one point per correct first answer (comprehensionScoring.js).
--   M8 XP is still granted once, on completion, by m8_on_comprehension_completed.
--
-- In-progress attempts
--   A question answered wrongly before this change may still be open. The
--   backend closes such questions when the activity is completed; a new answer
--   to them is refused here.
--
-- Prerequisite: supabase/migrations/20261026_m8_trusted_xp.sql (current definition).
-- Rollback: supabase/proposed/m6_single_attempt_ROLLBACK_PROPOSED.sql
-- ============================================================================
begin;
set local lock_timeout = '5s';

do $$
declare
  fn regprocedure := pg_catalog.to_regprocedure('public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)');
begin
  if fn is null then
    raise exception 'm6_apply_action is missing; apply supabase/migrations/20261026_m8_trusted_xp.sql first';
  end if;
  -- Body fingerprint (CR removed) of the current (M8 trusted XP) definition. Stop on any drift.
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc p where p.oid = fn) <> 'ab1569a4dab7fffd71e7ff1315dd5971' then
    raise exception 'm6_apply_action differs from the expected current (M8 trusted XP) definition; review before applying';
  end if;
  if not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = fn) then
    raise exception 'm6_apply_action must be SECURITY DEFINER';
  end if;
end $$;

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

  -- Single attempt: there is no separate hint action; the scaffolding prompt is
  -- shown by the backend after an incorrect answer and never changes the score.
  if action_name is null
     or action_name not in ('answer', 'complete') then
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

      -- The saved answer is final; report it as finished.
      return jsonb_build_object(
        'correct', (previous_action->>'correct')::boolean,
        'resolved', true
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

  -- One question = one final submitted answer. A saved answer is never replaced;
  -- a retry of the same request was answered above with the saved result.
  if response.first_option_index is not null then
    raise exception 'This question already has a final answer'
      using errcode = '22023';
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

      -- The first answer is final, correct or not.
      resolved = true,

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

do $$
declare
  fn regprocedure := 'public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)'::regprocedure;
begin
  if not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = fn)
     or has_function_privilege('anon', fn, 'EXECUTE')
     or has_function_privilege('authenticated', fn, 'EXECUTE')
     or not has_function_privilege('service_role', fn, 'EXECUTE') then
    raise exception 'm6_apply_action security or privileges are wrong; rolling back';
  end if;
end $$;

commit;
