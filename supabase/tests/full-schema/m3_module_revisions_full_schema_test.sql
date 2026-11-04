-- Full-schema test for supabase/proposed/m3_module_revisions_PROPOSED.sql.
-- DISPOSABLE DATABASE ONLY (restore of the 2026-11-04 staging backup). One transaction, rolled back.
\set ON_ERROR_STOP 1
begin;

select id as admin from public.profiles where role = 'admin' limit 1 \gset
select r.id as room, r.teacher_id as teacher from public.rooms r where r.room_name = 'Grade 5 Filipino Class' \gset
select set_config('t.admin', :'admin', true), set_config('t.teacher', :'teacher', true), set_config('t.room', :'room', true);

create function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', uid, true);
$$;
create function pg_temp.expect_error(statement text, pattern text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlerrm !~* pattern then raise exception 'expected /%/ but got: %', pattern, sqlerrm; end if;
    return;
  end;
  raise exception 'expected /%/ but the statement succeeded: %', pattern, statement;
end $$;
create function pg_temp.bank() returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('type', (array['literal','inferential','critical'])[1 + (i - 1) / 2],
    'questionText', 'Tanong ' || i, 'options', jsonb_build_array('A' || i, 'B', 'C', 'D'), 'correctAnswer', 'A' || i,
    'scaffoldingHint', 'Basahin muli.', 'answerExplanation', 'Nasa kuwento.', 'supportingEvidence', 'Isang kuwento.') order by i)
  from generate_series(1, 6) i
$$;
-- Everything that makes up a module, keyed by ID: proves the original is untouched.
create function pg_temp.snapshot(m uuid) returns text language sql as $$
  select md5(coalesce((select string_agg(x::text, '|' order by x::text) from public.modules x where x.id = m), '')
    || coalesce((select string_agg(x::text, '|' order by x::text) from public.module_passages x where x.module_id = m), '')
    || coalesce((select string_agg(x::text, '|' order by x::text) from public.comprehension_questions x where x.module_id = m), '')
    || coalesce((select string_agg(a::text, '|' order by a::text) from public.comprehension_question_answers a
         join public.comprehension_questions q on q.id = a.question_id where q.module_id = m), ''))
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- Build a real published source through the existing RPCs (two passages, reviewed six-question banks).
select pg_temp.act_as(current_setting('t.admin'));
set local role authenticated;
select public.m3_create_collection_draft('00000000-0000-4000-8000-0000000000e1', 'TEST revisable set', '6e712165-b161-4463-a2a6-7cba4123f06b', 'Easy',
  '[{"id":"00000000-0000-4000-8000-0000000000f1","title":"Unang bahagi","passageText":"Isang kuwento."},
    {"id":"00000000-0000-4000-8000-0000000000f2","title":"Ikalawang bahagi","passageText":"Isang kuwento."}]');
-- Dedicated draft fixture; never depend on an existing staging module title.
select public.m3_create_collection_draft('00000000-0000-4000-8000-0000000000e2', 'TEST unrevisable draft', '6e712165-b161-4463-a2a6-7cba4123f06b', 'Easy',
  '[{"id":"00000000-0000-4000-8000-0000000000f3","title":"Draft passage","passageText":"Isang kuwento."}]');
do $$
declare p uuid; rev bigint; ids uuid[];
begin
  foreach p in array array['00000000-0000-4000-8000-0000000000f1','00000000-0000-4000-8000-0000000000f2']::uuid[] loop
    select collection_revision into rev from public.modules where id = '00000000-0000-4000-8000-0000000000e1';
    perform public.m3_save_passage_bank('00000000-0000-4000-8000-0000000000e1', p, rev, pg_temp.bank(), 'generate');
    select array_agg(id order by display_order) into ids from public.comprehension_questions where passage_id = p;
    select collection_revision into rev from public.modules where id = '00000000-0000-4000-8000-0000000000e1';
    perform public.m3_save_passage_bank('00000000-0000-4000-8000-0000000000e1', p, rev,
      (select jsonb_agg(x || jsonb_build_object('id', ids[o]) order by o) from jsonb_array_elements(pg_temp.bank()) with ordinality t(x, o)), 'review');
  end loop;
  update public.modules set status = 'published' where id = '00000000-0000-4000-8000-0000000000e1';
end $$;
reset role;
insert into public.room_modules(room_id, module_id, assigned_by) values (:'room', '00000000-0000-4000-8000-0000000000e1', :'teacher');
select set_config('t.source', pg_temp.snapshot('00000000-0000-4000-8000-0000000000e1'), true),
  set_config('t.assignments', (select string_agg(x::text, '|') from public.room_modules x where module_id = '00000000-0000-4000-8000-0000000000e1'), true);

-- Only Admins; drafts are edited directly, not revised.
set local role authenticated;
select pg_temp.act_as(current_setting('t.teacher'));
select pg_temp.expect_error($s$select public.m3_revise_module('00000000-0000-4000-8000-0000000000e1')$s$, 'Admin access');
select pg_temp.act_as(current_setting('t.admin'));
select pg_temp.expect_error($s$select public.m3_revise_module(source_id => '00000000-0000-4000-8000-0000000000e2')$s$, 'edit the draft directly');
-- authenticated has no column privilege on the link columns at all.
select pg_temp.expect_error($s$update public.modules set revision_number = 9 where id = '00000000-0000-4000-8000-0000000000e1'$s$, 'permission denied');

-- Revise: a separate draft with new IDs, copied keys, questions back to review; the original untouched.
select set_config('t.rev', public.m3_revise_module(source_id => '00000000-0000-4000-8000-0000000000e1')::text, true);
do $$
declare r uuid := current_setting('t.rev')::uuid; src uuid := '00000000-0000-4000-8000-0000000000e1';
begin
  if r = src then raise exception 'revision reused the source ID'; end if;
  if public.m3_revise_module(src) <> r then raise exception 'second call must return the open revision'; end if;
  if (select (status, published_at is null, revision_of, revision_number)::text from public.modules where id = r) <> format('(draft,t,%s,2)', src) then
    raise exception 'revision row wrong'; end if;
  if (select count(*) from public.module_passages where module_id = r) <> 2
     or exists (select 1 from public.module_passages where module_id = r and id in (select id from public.module_passages where module_id = src)) then
    raise exception 'passages must be copied with new IDs'; end if;
  if (select count(*) from public.comprehension_questions where module_id = r) <> 12
     or exists (select 1 from public.comprehension_questions where module_id = r and review_status <> 'generated')
     or (select count(*) from public.comprehension_question_answers a join public.comprehension_questions q on q.id = a.question_id where q.module_id = r) <> 12 then
    raise exception 'questions and keys must be copied, all needing review'; end if;
  if exists (select 1 from public.comprehension_questions q join public.module_passages p on p.id = q.passage_id where q.module_id = r and p.module_id <> r) then
    raise exception 'copied questions must point at copied passages'; end if;
  if pg_temp.snapshot(src) <> current_setting('t.source') then raise exception 'the published original changed'; end if;
  if not exists (select 1 from unnest(public.m3_collection_publish_issues(r)) i where i ~* 'need review') then raise exception 'revision must need review'; end if;
  if (select count(*) from public.m3_module_revisions(src)) <> 2 then raise exception 'revision list'; end if;
end $$;

-- Review and publish the revision normally; the original stays published and still assigned.
do $$
declare r uuid := current_setting('t.rev')::uuid; p uuid; rev bigint; ids uuid[]; next_draft uuid; parent_snapshot text;
begin
  for p in select id from public.module_passages where module_id = r loop
    select array_agg(id order by display_order) into ids from public.comprehension_questions where passage_id = p;
    select collection_revision into rev from public.modules where id = r;
    perform public.m3_save_passage_bank(r, p, rev,
      (select jsonb_agg(x || jsonb_build_object('id', ids[o]) order by o) from jsonb_array_elements(pg_temp.bank()) with ordinality t(x, o)), 'review');
  end loop;
  update public.modules set status = 'published' where id = r;
  if (select status from public.modules where id = '00000000-0000-4000-8000-0000000000e1') <> 'published' then raise exception 'original must stay published'; end if;
  if (select string_agg(x::text, '|') from public.room_modules x where module_id = '00000000-0000-4000-8000-0000000000e1') <> current_setting('t.assignments') then
    raise exception 'assignments of the original changed'; end if;
  -- Revising a revision continues the family numbering.
  next_draft := public.m3_revise_module(r);
  if (select revision_number from public.modules where id = next_draft) <> 3 then raise exception 'family numbering'; end if;
  -- Regression: a copied question bank can be trashed/purged without changing its published parents.
  parent_snapshot := pg_temp.snapshot(r);
  perform public.m3_trash_module(next_draft);
  if public.m3_purge_module(next_draft) <> 'deleted' then raise exception 'draft revision purge'; end if;
  if exists(select 1 from public.modules where id=next_draft)
    or pg_temp.snapshot(r) <> parent_snapshot
    or pg_temp.snapshot('00000000-0000-4000-8000-0000000000e1') <> current_setting('t.source') then
    raise exception 'revision purge changed published parent or source'; end if;
end $$;
reset role;
select pg_temp.expect_error($s$insert into public.modules(id, path_id, title, difficulty, status, created_by, revision_of, revision_root, revision_number)
  values (gen_random_uuid(), '6e712165-b161-4463-a2a6-7cba4123f06b', 'x', 'Easy', 'draft', current_setting('t.admin')::uuid,
  '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e1', 9)$s$, 'Use Revise Module');
select pg_temp.expect_error(format('update public.modules set revision_number = 7 where id = %L', current_setting('t.rev')), 'cannot be changed');
set local role anon;
select pg_temp.expect_error($s$select * from public.m3_module_revisions('00000000-0000-4000-8000-0000000000e1')$s$, 'permission denied');
reset role;
select 'PASS m3 revisions: Admin-only, new IDs, copied keys needing review, original and its assignments unchanged, one open revision, normal publish, family numbering, protected links' as result;
rollback;
