-- ============================================================================
-- PROPOSED ROLLBACK - NOT APPLIED. Restores the two-try m6_apply_action from
-- supabase/migrations/20261026_m8_trusted_xp.sql. No rows are changed; questions
-- finished under the single-attempt rule stay finished.
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
  -- Body fingerprint (CR removed) of the single-attempt (proposed) definition. Stop on any drift.
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc p where p.oid = fn) <> '6a7332a3bf7108d8a3000c380b2d224b' then
    raise exception 'm6_apply_action differs from the expected single-attempt (proposed) definition; review before applying';
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
