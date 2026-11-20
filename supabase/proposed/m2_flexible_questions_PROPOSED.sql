-- PROPOSED ONLY: NOT APPLIED. Requires separate approval for the existing local database.
-- Replaces structural validation only. No data updates, activation, thresholds, or history changes.
begin;
create or replace function public.m2_assessment_content_issues(p_title text, p_paragraphs jsonb, p_questions jsonb)
returns text[] language plpgsql immutable set search_path = '' as $$
declare
  issues text[] := '{}';
  q jsonb; c jsonb; i integer := 0; words integer := 0; ids text[] := '{}'; choice_ids text[];
  types text[] := '{}';
begin
  if nullif(btrim(coalesce(p_title, '')), '') is null then issues := array_append(issues, 'Add a passage title.'); end if;
  if jsonb_typeof(p_paragraphs) <> 'array' or jsonb_array_length(p_paragraphs) not between 1 and 10 then
    issues := array_append(issues, 'The passage needs 1 to 10 paragraphs.');
  else
    for i in 0 .. jsonb_array_length(p_paragraphs) - 1 loop
      if jsonb_typeof(p_paragraphs -> i) <> 'string' or nullif(btrim(p_paragraphs ->> i), '') is null then
        issues := array_append(issues, format('Paragraph %s is empty.', i + 1));
      else
        words := words + coalesce(array_length(regexp_split_to_array(btrim(p_paragraphs ->> i), '\s+'), 1), 0);
      end if;
    end loop;
    if words not between 20 and 600 then issues := array_append(issues, 'The passage needs 20 to 600 words.'); end if;
  end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) not between 5 and 8 then
    issues := array_append(issues, 'Add 5 to 8 comprehension questions.');
    return issues;
  end if;
  for i in 0 .. jsonb_array_length(p_questions) - 1 loop
    q := p_questions -> i;
    if jsonb_typeof(q) <> 'object' then issues := array_append(issues, format('Question %s is invalid.', i + 1)); continue; end if;
    if nullif(btrim(coalesce(q ->> 'id', '')), '') is null or (q ->> 'id') = any(ids) then
      issues := array_append(issues, format('Question %s needs a unique id.', i + 1));
    else ids := ids || (q ->> 'id'); end if;
    if coalesce(q ->> 'type', '') not in ('literal', 'inferential', 'critical') then
      issues := array_append(issues, format('Question %s needs a type (literal, inferential or critical).', i + 1));
    else types := types || (q ->> 'type'); end if;
    if nullif(btrim(coalesce(q ->> 'prompt', '')), '') is null then issues := array_append(issues, format('Question %s needs a prompt.', i + 1)); end if;
    if jsonb_typeof(q -> 'choices') <> 'array' or jsonb_array_length(q -> 'choices') <> 4 then
      issues := array_append(issues, format('Question %s needs exactly 4 answer choices.', i + 1));
      continue;
    end if;
    choice_ids := '{}';
    for c in select value from jsonb_array_elements(q -> 'choices') loop
      if nullif(btrim(coalesce(c ->> 'label', '')), '') is null then issues := array_append(issues, format('Question %s has an empty answer choice.', i + 1)); end if;
      if coalesce(c ->> 'id', '') not in ('a', 'b', 'c', 'd') or (c ->> 'id') = any(choice_ids) then
        issues := array_append(issues, format('Question %s answer choices must be a, b, c and d.', i + 1));
      else choice_ids := choice_ids || (c ->> 'id'); end if;
    end loop;
    if coalesce(q ->> 'correctChoiceId', '') <> all(choice_ids) or q ->> 'correctChoiceId' is null then
      issues := array_append(issues, format('Question %s needs one correct answer.', i + 1));
    end if;
  end loop;
  if not ('literal' = any(types) and 'inferential' = any(types) and 'critical' = any(types)) then
    issues := array_append(issues, 'Include at least one literal, one inferential and one critical question.');
  end if;
  return issues;
end $$;

commit;
