-- Full-schema test for supabase/proposed/m3_module_trash_PROPOSED.sql.
-- DISPOSABLE DATABASE ONLY (restore of the 2026-11-04 staging backup). One transaction, rolled back.
\set ON_ERROR_STOP 1
begin;

select id as admin from public.profiles where role = 'admin' limit 1 \gset
select r.id as room, r.teacher_id as teacher from public.rooms r where r.room_name = 'Grade 5 Filipino Class' \gset
select (array_agg(student_id order by student_id))[1] as s1 from public.enrollments where room_id = :'room' \gset
select set_config('t.admin', :'admin', true), set_config('t.teacher', :'teacher', true), set_config('t.s1', :'s1', true),
  set_config('t.room', :'room', true);

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
create function pg_temp.content(m uuid) returns text language sql as $$
  select coalesce((select string_agg(p::text, '|' order by p.id) from public.module_passages p where p.module_id=m), '')
    || coalesce((select string_agg(q::text, '|' order by q.id) from public.comprehension_questions q where q.module_id=m), '')
    || coalesce((select string_agg(a::text, '|' order by a.question_id) from public.comprehension_question_answers a
        join public.comprehension_questions q on q.id=a.question_id where q.module_id=m), '')
$$;
create function pg_temp.bank() returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('type', (array['literal','inferential','critical'])[1 + (i-1)/2],
    'questionText','Question '||i,'options',jsonb_build_array('A','B','C','D'),'correctAnswer','A',
    'scaffoldingHint','Read again.','answerExplanation','In the story.','supportingEvidence','Isang kuwento.') order by i)
  from generate_series(1,6) i
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- Fixtures: two never-published drafts (created as the Admin), one published module with classroom history.
select pg_temp.act_as(current_setting('t.admin'));
set local role authenticated;
select public.m3_create_collection_draft('00000000-0000-4000-8000-0000000000c1', 'TEST trash draft', '6e712165-b161-4463-a2a6-7cba4123f06b', 'Easy',
  '[{"id":"00000000-0000-4000-8000-0000000000d1","title":"P1","passageText":"Isang kuwento."}]');
select public.m3_create_collection_draft('00000000-0000-4000-8000-0000000000c2', 'TEST purge draft', '6e712165-b161-4463-a2a6-7cba4123f06b', 'Easy',
  '[{"id":"00000000-0000-4000-8000-0000000000d2","title":"P1","passageText":"Isang kuwento."}]');
select public.m3_create_collection_draft('00000000-0000-4000-8000-0000000000c4', 'TEST legacy delete draft', '6e712165-b161-4463-a2a6-7cba4123f06b', 'Easy',
  '[{"id":"00000000-0000-4000-8000-0000000000d4","title":"P1","passageText":"Isang kuwento."}]');
select public.m3_create_collection_draft('00000000-0000-4000-8000-0000000000c5', 'TEST archive and purge bank', '6e712165-b161-4463-a2a6-7cba4123f06b', 'Easy',
  '[{"id":"00000000-0000-4000-8000-0000000000d5","title":"P1","passageText":"Isang kuwento."}]');
select public.m3_create_collection_draft('00000000-0000-4000-8000-0000000000c6', 'TEST protected learner progress', '6e712165-b161-4463-a2a6-7cba4123f06b', 'Easy',
  '[{"id":"00000000-0000-4000-8000-0000000000d6","title":"P1","passageText":"Isang kuwento."}]');
-- The original purge fixture had no questions/keys, so neither bank-change trigger ran.
do $$ declare p record; rev bigint; ids uuid[];
begin
  for p in select module_id,id from public.module_passages where id in
    ('00000000-0000-4000-8000-0000000000d2',
     '00000000-0000-4000-8000-0000000000d4','00000000-0000-4000-8000-0000000000d5','00000000-0000-4000-8000-0000000000d6') loop
    select collection_revision into rev from public.modules where id=p.module_id;
    perform public.m3_save_passage_bank(p.module_id,p.id,rev,pg_temp.bank(),'generate');
    if p.id='00000000-0000-4000-8000-0000000000d5' then
      select array_agg(id order by display_order) into ids from public.comprehension_questions where passage_id=p.id;
      select collection_revision into rev from public.modules where id=p.module_id;
      perform public.m3_save_passage_bank(p.module_id,p.id,rev,
        (select jsonb_agg(x || jsonb_build_object('id',ids[o]) order by o) from jsonb_array_elements(pg_temp.bank()) with ordinality t(x,o)), 'review');
      update public.modules set status='published' where id=p.module_id;
    end if;
  end loop;
end $$;
reset role;
insert into public.progress(user_id,module_id,status,score)
  values (:'s1','00000000-0000-4000-8000-0000000000c6','completed',80);
insert into public.modules(id, path_id, title, difficulty, status, created_by, published_at, passage) values
  ('00000000-0000-4000-8000-0000000000c3', '6e712165-b161-4463-a2a6-7cba4123f06b', 'TEST published with history', 'Easy', 'published', :'admin', now(), 'Isang kuwento.');
insert into public.room_modules(room_id, module_id, assigned_by) values (:'room', '00000000-0000-4000-8000-0000000000c3', :'teacher');
select set_config('t.content', pg_temp.content('00000000-0000-4000-8000-0000000000c1'), true);

-- Only Admins.
set local role authenticated;
select pg_temp.act_as(current_setting('t.teacher'));
select pg_temp.expect_error($s$select public.m3_trash_module('00000000-0000-4000-8000-0000000000c1')$s$, 'Admin access');
select pg_temp.expect_error($s$select * from public.m3_trashed_modules()$s$, 'Admin access');
select pg_temp.expect_error($s$select public.m3_purge_module('00000000-0000-4000-8000-0000000000c2')$s$, 'Admin access');
select pg_temp.act_as(current_setting('t.s1'));
select pg_temp.expect_error($s$select public.m3_restore_module('00000000-0000-4000-8000-0000000000c1')$s$, 'Admin access');
select pg_temp.expect_error($s$select public.m3_purge_module('00000000-0000-4000-8000-0000000000c2')$s$, 'Admin access');

-- Trash a draft: hidden, protected, listed; restore brings it back unchanged as a draft.
select pg_temp.act_as(current_setting('t.admin'));
do $$ begin
  if public.m3_trash_module('00000000-0000-4000-8000-0000000000c1') <> 'trashed' then raise exception 'trash'; end if;
  if public.m3_trash_module('00000000-0000-4000-8000-0000000000c1') <> 'trashed' then raise exception 'trash is idempotent'; end if;
  if not exists (select 1 from public.m3_trashed_modules() where id = '00000000-0000-4000-8000-0000000000c1' and not has_history and status_before = 'draft')
    then raise exception 'trash list'; end if;
end $$;
select pg_temp.expect_error($s$update public.modules set title = 'x' where id = '00000000-0000-4000-8000-0000000000c1'$s$, 'cannot be changed');
select pg_temp.expect_error($s$delete from public.modules where id = '00000000-0000-4000-8000-0000000000c1'$s$, 'retain their historical');
select pg_temp.expect_error($s$insert into public.m3_deletion_context values ('00000000-0000-4000-8000-0000000000c1',txid_current())$s$, 'permission denied');
do $$ begin
  if public.m3_restore_module('00000000-0000-4000-8000-0000000000c1') <> 'draft' then raise exception 'restore as draft'; end if;
  if (select deleted_at from public.modules where id = '00000000-0000-4000-8000-0000000000c1') is not null then raise exception 'still trashed'; end if;
  if pg_temp.content('00000000-0000-4000-8000-0000000000c1') <> current_setting('t.content') then raise exception 'restore changed passages'; end if;
end $$;
select pg_temp.expect_error($s$select public.m3_restore_module('00000000-0000-4000-8000-0000000000c1')$s$, 'not in the Trash');

-- A published module with history: hidden while trashed, cannot be assigned, restores as archived (not re-exposed).
do $$ begin perform public.m3_trash_module('00000000-0000-4000-8000-0000000000c3'); end $$;
select pg_temp.act_as(current_setting('t.s1'));
do $$ begin if exists (select 1 from public.modules where id = '00000000-0000-4000-8000-0000000000c3') then raise exception 'student sees trashed module'; end if; end $$;
reset role;
select pg_temp.expect_error(format($s$insert into public.room_modules(room_id, module_id, assigned_by) values (%L, '00000000-0000-4000-8000-0000000000c3', %L)$s$,
  (select id from public.rooms where room_name = 'Baitang 5'), current_setting('t.teacher')), 'deleted and cannot be assigned|archived');
set local role authenticated;
select pg_temp.act_as(current_setting('t.admin'));
select pg_temp.expect_error($s$select public.m3_purge_module('00000000-0000-4000-8000-0000000000c3')$s$, 'learner or classroom history');
do $$ begin
  if public.m3_restore_module('00000000-0000-4000-8000-0000000000c3') <> 'archived' then raise exception 'published must restore as archived'; end if;
  if (select published_at from public.modules where id = '00000000-0000-4000-8000-0000000000c3') is null then raise exception 'publication history lost'; end if;
end $$;
select pg_temp.act_as(current_setting('t.s1'));
do $$ begin if exists (select 1 from public.modules where id = '00000000-0000-4000-8000-0000000000c3') then raise exception 'restored module must stay hidden until republished'; end if; end $$;

-- Permanent deletion: only from the Trash, only without history.
select pg_temp.act_as(current_setting('t.admin'));
select pg_temp.expect_error($s$select public.m3_purge_module('00000000-0000-4000-8000-0000000000c2')$s$, 'Move the reading module to the Trash');
do $$ begin
  perform public.m3_trash_module('00000000-0000-4000-8000-0000000000c2');
  -- A client-set purge GUC cannot authorize deleting keys; the private marker is required.
  perform set_config('m3.purge_module','00000000-0000-4000-8000-0000000000c2',true);
  perform pg_temp.expect_error($s$delete from public.comprehension_question_answers where question_id in
    (select id from public.comprehension_questions where module_id='00000000-0000-4000-8000-0000000000c2')$s$, 'cannot be changed');
  perform set_config('m3.purge_module','',true);
  if public.m3_purge_module('00000000-0000-4000-8000-0000000000c2') <> 'deleted' then raise exception 'purge'; end if;
  if exists (select 1 from public.m3_module_trash where module_id = '00000000-0000-4000-8000-0000000000c2') then raise exception 'purge left the Trash record'; end if;
  if exists (select 1 from public.modules where id = '00000000-0000-4000-8000-0000000000c2')
     or exists (select 1 from public.module_passages where module_id = '00000000-0000-4000-8000-0000000000c2') then raise exception 'purge left rows'; end if;
  -- The existing deletion function is unchanged and still works.
  if public.m3_delete_module('00000000-0000-4000-8000-0000000000c4') <> 'permanent' then raise exception 'm3_delete_module changed'; end if;
end $$;
-- Real learner progress is retained, independently of classroom assignments.
select set_config('t.progress_content',pg_temp.content('00000000-0000-4000-8000-0000000000c6'),true);
select public.m3_trash_module('00000000-0000-4000-8000-0000000000c6');
select pg_temp.expect_error($s$select public.m3_purge_module('00000000-0000-4000-8000-0000000000c6')$s$, 'learner or classroom history');
reset role;
do $$ begin
  if pg_temp.content('00000000-0000-4000-8000-0000000000c6') <> current_setting('t.progress_content')
    or not exists(select 1 from public.progress where module_id='00000000-0000-4000-8000-0000000000c6' and score=80)
    or not exists(select 1 from public.m3_module_trash where module_id='00000000-0000-4000-8000-0000000000c6') then
    raise exception 'protected learner history or content changed'; end if;
  if exists(select 1 from public.m3_deletion_context) then raise exception 'private deletion marker leaked'; end if;
end $$;
set local role authenticated;
-- Archive is a normal status change, not Trash. Restore of published content stays archived.
select set_config('t.archive_content',pg_temp.content('00000000-0000-4000-8000-0000000000c5'),true);
update public.modules set status='archived' where id='00000000-0000-4000-8000-0000000000c5';
select pg_temp.expect_error($s$select public.m3_purge_module('00000000-0000-4000-8000-0000000000c5')$s$, 'Move the reading module to the Trash');
do $$ begin
  if (select deleted_at is not null from public.modules where id='00000000-0000-4000-8000-0000000000c5') then raise exception 'Archive trashed module'; end if;
  perform public.m3_trash_module('00000000-0000-4000-8000-0000000000c5');
  if public.m3_restore_module('00000000-0000-4000-8000-0000000000c5') <> 'archived' then raise exception 'published restore changed'; end if;
  if pg_temp.content('00000000-0000-4000-8000-0000000000c5') <> current_setting('t.archive_content') then raise exception 'Archive/Restore changed bank'; end if;
  perform public.m3_trash_module('00000000-0000-4000-8000-0000000000c5');
  if public.m3_purge_module('00000000-0000-4000-8000-0000000000c5') <> 'deleted' then raise exception 'published bank purge'; end if;
end $$;
set local role anon;
select pg_temp.expect_error($s$select public.m3_purge_module('00000000-0000-4000-8000-0000000000c1')$s$, 'permission denied');
select pg_temp.expect_error($s$select * from public.m3_trashed_modules()$s$, 'permission denied');
reset role;
select 'PASS m3 trash: Admin-only, trash/restore (draft) unchanged content, published restores archived and hidden, no assignment while trashed, purge only from Trash without history, m3_delete_module unchanged' as result;
rollback;
