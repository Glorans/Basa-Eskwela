-- Prepared only; NOT applied. Apply after m3_question_set_options.sql and
-- 20261012_m6_activity_question_sets.sql. No table/schema changes.
-- Deploy with the separate save/approve API; old combined review writes fail closed.
begin;
set local lock_timeout = '5s';
create or replace function public.m3_write_material_question_set(
  actor_id uuid, target_material uuid, target_set uuid, operation text,
  expected_revision integer, bank jsonb
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  actor_role text;
  owner_id uuid;
  next_number integer;
  saved_set public.material_question_sets%rowtype;
  item jsonb;
  old_question public.comprehension_questions%rowtype;
  answer_text text;
  answer_index integer;
  inserted_question_id uuid;
  position integer := 0;
begin
  select role into actor_role from public.profiles where id = actor_id;
  if actor_role is null or actor_role not in ('teacher', 'admin') then
    raise exception 'Question management requires a Teacher or Admin' using errcode = '42501';
  end if;
  select uploaded_by, next_question_set_number into owner_id, next_number
  from public.uploaded_materials where id = target_material for update;
  if not found or (actor_role <> 'admin' and owner_id <> actor_id) then
    raise exception 'Material unavailable to this account' using errcode = '42501';
  end if;
  if operation is null or operation not in ('create', 'regenerate', 'save', 'approve', 'delete') then
    raise exception 'Invalid question set operation' using errcode = '22023';
  end if;
  if operation not in ('save', 'approve') and (actor_role <> 'teacher' or owner_id <> actor_id) then
    raise exception 'Only the owning Teacher may generate or delete sets' using errcode = '42501';
  end if;
  if operation <> 'delete' then
    if jsonb_typeof(bank) is distinct from 'array' then
      raise exception 'A question bank is required' using errcode = '22023';
    end if;
    if jsonb_array_length(bank) not in (3, 6, 9, 12) or exists (
      select 1 from unnest(array['literal','inferential','critical']) category
      where (select count(*) from jsonb_array_elements(bank) q where q->>'type' = category) <> jsonb_array_length(bank) / 3
    ) then
      raise exception 'Choose 3, 6, 9 or 12 questions, evenly divided across the three categories' using errcode = '22023';
    end if;
  end if;
  if operation = 'create' then
    if target_set is not null then raise exception 'New sets must not target an existing set' using errcode = '22023'; end if;
    insert into public.material_question_sets(material_id, created_by, name, sequence_number)
    values(target_material, actor_id, 'Question Set ' || next_number, next_number) returning * into saved_set;
    update public.uploaded_materials set next_question_set_number = next_number + 1 where id = target_material;
  else
    select * into saved_set from public.material_question_sets
    where id = target_set and material_id = target_material for update;
    if not found then raise exception 'Question set not found' using errcode = 'P0002'; end if;
    if expected_revision is distinct from saved_set.revision then
      raise exception 'This question set changed. Reload it before saving or regenerating.' using errcode = '40001';
    end if;
  end if;
  if operation in ('save', 'approve', 'regenerate') and exists (
    select 1 from public.reading_activity_assignments a
    join public.m6_comprehension_attempts t on t.activity_assignment_id = a.id
    where a.question_set_id = saved_set.id and a.material_id = target_material
  ) then
    raise exception 'Students have already answered this question set; generate a new set instead' using errcode = '40001';
  end if;
  if operation = 'delete' then
    delete from public.comprehension_question_answers
    where question_id in (select id from public.comprehension_questions
      where question_set_id = saved_set.id and material_id = target_material);
    delete from public.comprehension_questions where question_set_id = saved_set.id and material_id = target_material;
    delete from public.material_question_sets where id = saved_set.id and material_id = target_material;
    -- Keep next_question_set_number and every remaining historical sequence unchanged.
    return saved_set.id;
  end if;
  if operation = 'regenerate' and (select count(*) from public.comprehension_questions
    where question_set_id = saved_set.id) <> jsonb_array_length(bank) then
    raise exception 'Regeneration must preserve the saved question count' using errcode = '22023';
  end if;
  if operation in ('save', 'approve') then
    if (select count(*) from public.comprehension_questions where question_set_id = saved_set.id) <> jsonb_array_length(bank)
      or (select count(distinct q->>'id') from jsonb_array_elements(bank) q) <> jsonb_array_length(bank)
      or exists(select 1 from jsonb_array_elements(bank) submitted where not exists (
        select 1 from public.comprehension_questions q where q.id = (submitted->>'id')::uuid
          and q.material_id = target_material and q.question_set_id = saved_set.id
      )) then
      raise exception 'Every edited question must belong to the selected set' using errcode = '42501';
    end if;
  elsif operation = 'regenerate' then
    -- Atomic replacement affects only this set. A failed insert rolls this back.
    delete from public.comprehension_questions where question_set_id = saved_set.id and material_id = target_material;
  end if;
  for item in select value from jsonb_array_elements(bank) loop
    position := position + 1;
    if operation in ('save', 'approve') then
      select * into strict old_question from public.comprehension_questions
      where id = (item->>'id')::uuid and question_set_id = saved_set.id;
      select correct_answer into answer_text from public.comprehension_question_answers where question_id = old_question.id;
      select ordinality::integer - 1 into answer_index from jsonb_array_elements_text(old_question.options) with ordinality
      where value = answer_text;
      if answer_index is null then raise exception 'Invalid saved answer key' using errcode = '22023'; end if;
      if operation = 'approve' then
        -- Approval changes only review metadata, never content or answer keys.
        update public.comprehension_questions
          set review_status = 'reviewed', reviewed_by = actor_id, reviewed_at = now()
          where id = old_question.id and review_status is distinct from 'reviewed';
        continue;
      end if;
      if (old_question.question_type, old_question.question_text, old_question.options,
          old_question.scaffolding_hint) is not distinct from
         (item->>'type', btrim(item->>'questionText'), item->'options', btrim(item->>'scaffoldingHint')) then
        continue;
      end if;
      update public.comprehension_questions set question_type = item->>'type', question_text = btrim(item->>'questionText'),
        options = item->'options', scaffolding_hint = btrim(item->>'scaffoldingHint'),
        review_status = 'generated', reviewed_by = null, reviewed_at = null
      where id = old_question.id;
      -- Retain answer-key identity/created_at and the system-selected option.
      update public.comprehension_question_answers set correct_answer = item->'options'->>answer_index
      where question_id = old_question.id;
    else
      insert into public.comprehension_questions(material_id, question_set_id, question_type, question_text,
        options, scaffolding_hint, display_order, generated_by_ai, review_status)
      values(target_material, saved_set.id, item->>'type', btrim(item->>'questionText'), item->'options',
        btrim(item->>'scaffoldingHint'), position, true, 'generated') returning id into inserted_question_id;
      insert into public.comprehension_question_answers(question_id, correct_answer) values(inserted_question_id, item->>'correctAnswer');
    end if;
  end loop;
  update public.material_question_sets set revision = revision + 1, updated_at = now() where id = saved_set.id;
  return saved_set.id;
end $$;
revoke all on function public.m3_write_material_question_set(uuid,uuid,uuid,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.m3_write_material_question_set(uuid,uuid,uuid,text,integer,jsonb) to service_role;
commit;
