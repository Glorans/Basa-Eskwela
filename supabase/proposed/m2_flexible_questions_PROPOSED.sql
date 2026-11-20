-- M2: 5 TO 8 COMPREHENSION QUESTIONS PER PASSAGE -- PROPOSED. NOT APPLIED. Requires separate approval.
-- Requires: m2_assessment_packages_PROPOSED.sql (applied).
-- Rollback: m2_flexible_questions_ROLLBACK_PROPOSED.sql   Verify: m2_flexible_questions_VERIFY_READONLY.sql
--
-- Changes ONE thing in m2_assessment_content_issues(), the structural check that runs when a version is SUBMITTED
-- (and when the built-in 3.0 is imported): a version may have 5, 6, 7 or 8 questions instead of exactly 6.
-- Everything else is unchanged: each question needs a unique id, a type (literal, inferential or critical), a prompt,
-- exactly four answer choices a-d with text, and one correct answer; every version still needs at least one literal,
-- one inferential and one critical question; the passage still needs a title, 1-10 paragraphs and 20-600 words.
-- Existing six-question versions stay valid. No row is changed; no result, score, threshold or level is touched.
-- Scoring already divides by the version's own question count (calculateComprehensionScore).
-- The body below is the live body with only the count rule and the loop bound changed (md5 cb51bb7e6cf0a501a0950203e0f88da7 -> c349c8b5fbea59de2b3ca99658e0878a).
-- GENERATED FOR THE LOCAL M2 TEST DATABASE (basa-m2-manual), whose validator body uses CRLF line endings. For any
-- other database (e.g. Staging), regenerate from THAT database's live body; the md5 guard below refuses otherwise.
-- The body keeps those exact bytes: do not let an editor or git change its line endings (.gitattributes: -text).
begin;

do $$
begin
  if to_regprocedure('public.m2_assessment_content_issues(text,jsonb,jsonb)') is null then
    raise exception 'STOP: apply m2_assessment_packages_PROPOSED.sql first';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.m2_assessment_content_issues(text,jsonb,jsonb)'::regprocedure) <> 'cb51bb7e6cf0a501a0950203e0f88da7' then
    raise exception 'STOP: m2_assessment_content_issues() is not the reviewed six-question original; review before applying';
  end if;
end $$;

create temporary table m2_validator_acl_before on commit drop as
  select proacl::text as acl, pg_get_userbyid(proowner) as owner, provolatile, proconfig::text as config from pg_proc where oid = 'public.m2_assessment_content_issues(text,jsonb,jsonb)'::regprocedure;

create or replace function public.m2_assessment_content_issues(p_title text, p_paragraphs jsonb, p_questions jsonb)
returns text[] language plpgsql immutable set search_path = '' as $fn$
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
end $fn$;

do $$
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.m2_assessment_content_issues(text,jsonb,jsonb)'::regprocedure) <> 'c349c8b5fbea59de2b3ca99658e0878a' then
    raise exception 'STOP: the new body does not match the reviewed version';
  end if;
  if exists (select 1 from pg_proc p, m2_validator_acl_before b where p.oid = 'public.m2_assessment_content_issues(text,jsonb,jsonb)'::regprocedure
             and (p.proacl::text is distinct from b.acl or pg_get_userbyid(p.proowner) <> b.owner
                  or p.provolatile <> b.provolatile or p.proconfig::text is distinct from b.config)) then
    raise exception 'STOP: owner, privileges, volatility or search_path changed';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
