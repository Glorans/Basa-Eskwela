-- Full-schema test for supabase/proposed/m3_variable_passage_banks_PROPOSED.sql.
-- DISPOSABLE DATABASE ONLY (a local restore of a staging backup). Never run against staging.
-- Run AFTER the proposal is applied. Everything here happens in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;

select id as admin_id from public.profiles where role = 'admin' limit 1 \gset
select id as teacher_id from public.profiles where role = 'teacher' and teacher_status = 'approved' limit 1 \gset
select id as student_id from public.profiles where role = 'student' limit 1 \gset
select set_config('test.admin', :'admin_id', true), set_config('test.teacher', :'teacher_id', true),
       set_config('test.student', :'student_id', true);

create function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', uid, true);
$$;
create function pg_temp.bank(n integer) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object(
    'type', (array['literal','inferential','critical'])[1 + (i - 1) / (n / 3)],
    'questionText', 'Question ' || i, 'options', jsonb_build_array('A' || i, 'B', 'C', 'D'),
    'correctAnswer', 'A' || i, 'scaffoldingHint', 'Read the story again.',
    'answerExplanation', 'A' || i || ' is stated in the story.', 'supportingEvidence', 'A story.') order by i)
  from generate_series(1, n) i
$$;
create function pg_temp.expect_error(statement text, pattern text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlerrm !~* pattern then raise exception 'expected /%/ but got: %', pattern, sqlerrm; end if;
    return;
  end;
  raise exception 'expected /%/ but the statement succeeded: %', pattern, statement;
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- Admin creates a disposable three-passage draft.
select pg_temp.act_as(current_setting('test.admin'));
set local role authenticated;
select set_config('test.module', gen_random_uuid()::text, true);
select public.m3_create_collection_draft(current_setting('test.module')::uuid, 'FULL SCHEMA TEST (rolled back)',
  '8dbb798c-bc6b-4ea1-a78c-24e752946440', 'Easy',
  (select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'title', 'Passage ' || n, 'passageText', 'A story.')) from generate_series(1, 3) n));

do $test$
declare
  m uuid := current_setting('test.module')::uuid;
  passage record; rev bigint; ids uuid[]; size integer; category text; issues text[];
  sizes integer[] := array[6, 9, 12];
  before_q text; before_rev bigint;
begin
  if public.m3_passage_bank_sizes() <> array[6, 9, 12] then raise exception 'capability gate missing'; end if;

  -- Generate one bank of each size: equal categories, generated status, answer keys saved.
  for passage in select id, display_order from public.module_passages where module_id = m order by display_order loop
    size := sizes[passage.display_order];
    select collection_revision into rev from public.modules where id = m;
    perform public.m3_save_passage_bank(m, passage.id, rev, pg_temp.bank(size), 'generate');
    if (select count(*) from public.comprehension_questions where passage_id = passage.id) <> size then
      raise exception 'passage % expected % questions', passage.display_order, size; end if;
    foreach category in array array['literal','inferential','critical'] loop
      if (select count(*) from public.comprehension_questions where passage_id = passage.id and question_type = category) <> size / 3 then
        raise exception 'passage % expected % % questions', passage.display_order, size / 3, category; end if;
    end loop;
    if exists (select 1 from public.comprehension_questions q left join public.comprehension_question_answers a on a.question_id = q.id
               where q.passage_id = passage.id and (a.correct_answer is null or q.review_status <> 'generated')) then
      raise exception 'passage % has missing keys or wrong status', passage.display_order; end if;
  end loop;

  issues := public.m3_collection_publish_issues(m);
  if not exists (select 1 from unnest(issues) i where i ~* 'need review') then raise exception 'expected review issues: %', issues; end if;

  -- Review keeps every ID and the bank size.
  for passage in select id, display_order from public.module_passages where module_id = m order by display_order loop
    size := sizes[passage.display_order];
    select array_agg(id order by display_order) into ids from public.comprehension_questions where passage_id = passage.id;
    select collection_revision into rev from public.modules where id = m;
    perform public.m3_save_passage_bank(m, passage.id, rev,
      (select jsonb_agg(q || jsonb_build_object('id', ids[o]) order by o) from jsonb_array_elements(pg_temp.bank(size)) with ordinality t(q, o)), 'review');
    if (select array_agg(id order by display_order) from public.comprehension_questions where passage_id = passage.id) <> ids then
      raise exception 'review changed question IDs'; end if;
    if exists (select 1 from public.comprehension_questions where passage_id = passage.id and review_status <> 'reviewed') then
      raise exception 'review did not mark questions reviewed'; end if;
  end loop;
  issues := public.m3_collection_publish_issues(m);
  if cardinality(issues) <> 0 then raise exception 'expected publishable module, got %', issues; end if;

  -- Refusals are atomic: nothing changes.
  select string_agg(id || question_text || question_type || review_status, ',' order by id) into before_q from public.comprehension_questions where module_id = m;
  select collection_revision into before_rev from public.modules where id = m;
  select id into passage from public.module_passages where module_id = m and display_order = 2;
  foreach size in array array[0, 3, 7, 15] loop
    perform pg_temp.expect_error(format('select public.m3_save_passage_bank(%L, %L, %s, %L, %L)', m, passage.id, before_rev,
      coalesce(pg_temp.bank(size), '[]'::jsonb), 'generate'), case when size = 0 then '6, 9 or 12' else '6, 9 or 12' end);
  end loop;
  perform pg_temp.expect_error(format('select public.m3_save_passage_bank(%L, %L, %s, %L, %L)', m, passage.id, before_rev,
    (select jsonb_agg(q || '{"type":"literal"}') from jsonb_array_elements(pg_temp.bank(9)) q), 'generate'), 'Exactly 3 ');
  perform pg_temp.expect_error(format('select public.m3_save_passage_bank(%L, %L, %s, %L, %L)', m, passage.id, before_rev,
    (select jsonb_agg(q || jsonb_build_object('id', c.id) order by c.display_order)
       from public.comprehension_questions c join lateral (select q from jsonb_array_elements(pg_temp.bank(6)) with ordinality t(q, o) where o = c.display_order) b on true
       where c.passage_id = passage.id and c.display_order <= 6), 'review'), 'preserve');
  perform pg_temp.expect_error(format('select public.m3_save_passage_bank(%L, %L, %s, %L, %L)', m, passage.id, before_rev - 1,
    pg_temp.bank(9), 'generate'), 'changed');
  if before_q <> (select string_agg(id || question_text || question_type || review_status, ',' order by id) from public.comprehension_questions where module_id = m)
     or before_rev <> (select collection_revision from public.modules where id = m) then
    raise exception 'a refused save changed data'; end if;

  -- Publication through the real trigger, then the bank is immutable.
  update public.modules set status = 'published' where id = m;
  if (select published_at from public.modules where id = m) is null then raise exception 'publication timestamp missing'; end if;
  select collection_revision into rev from public.modules where id = m;
  perform pg_temp.expect_error(format('select public.m3_save_passage_bank(%L, %L, %s, %L, %L)', m, passage.id, rev, pg_temp.bank(9), 'generate'), 'never-published');
  raise notice 'PASS admin: 6/9/12 generate, ID-preserving review, readiness, refusals, publication and immutability';
end $test$;

-- Teacher and Student cannot write or read Admin readiness; anon cannot read the gate.
select pg_temp.act_as(current_setting('test.teacher'));
select pg_temp.expect_error(format('select public.m3_save_passage_bank(%L, gen_random_uuid(), 1, %L, %L)', current_setting('test.module'), pg_temp.bank(9), 'generate'), 'admin|not allowed|permission|access');
select public.m3_passage_bank_sizes() as teacher_can_read_gate;
select pg_temp.act_as(current_setting('test.student'));
select pg_temp.expect_error(format('select public.m3_collection_publish_issues(%L)', current_setting('test.module')), 'admin|access');
select pg_temp.expect_error(format('select public.m3_save_passage_bank(%L, gen_random_uuid(), 1, %L, %L)', current_setting('test.module'), pg_temp.bank(12), 'generate'), 'admin|not allowed|permission|access');
reset role;
set local role anon;
select pg_temp.expect_error('select public.m3_passage_bank_sizes()', 'permission denied');
reset role;
select 'PASS roles: Teacher/Student refused, anon cannot read the gate' as result;
rollback;
