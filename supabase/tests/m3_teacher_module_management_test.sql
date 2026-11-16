-- Permission and regression test for supabase/proposed/m3_teacher_module_management_PROPOSED.sql.
-- Run ONLY on a disposable local database that already has the migration (never Staging).
-- Everything happens inside one transaction that is ROLLED BACK: synthetic users, modules,
-- materials and history rows never persist. Each check runs as a signed-in user the way
-- PostgREST does (role authenticated + JWT claims), so RLS and function checks are real.
\set ON_ERROR_STOP on
begin;

create temp table m3t(n serial primary key, label text, expect text, got text, detail text);
create temp table m3k(k text primary key, v uuid);
grant select, insert on m3t to authenticated; grant usage on sequence m3t_n_seq to authenticated;
grant select on m3k to authenticated, anon;

insert into m3k values
  ('admin','00000000-0000-4000-8000-0000000c0001'), ('t1','00000000-0000-4000-8000-0000000c0002'),
  ('t2','00000000-0000-4000-8000-0000000c0003'), ('pending','00000000-0000-4000-8000-0000000c0004'),
  ('rejected','00000000-0000-4000-8000-0000000c0005'), ('student','00000000-0000-4000-8000-0000000c0006'),
  ('learner','00000000-0000-4000-8000-0000000c0007'),
  ('m_t1','00000000-0000-4000-8000-0000000d0001'), ('m_admin','00000000-0000-4000-8000-0000000d0002'),
  ('m_t2','00000000-0000-4000-8000-0000000d0003'), ('m_pending','00000000-0000-4000-8000-0000000d0004'),
  ('m_fil','00000000-0000-4000-8000-0000000d0005'), ('m_hist','00000000-0000-4000-8000-0000000d0006'),
  ('m_spoof','00000000-0000-4000-8000-0000000d0007'), ('m_bad_src','00000000-0000-4000-8000-0000000d0008'),
  ('p_t1','00000000-0000-4000-8000-0000000e0001'), ('p_admin','00000000-0000-4000-8000-0000000e0002'),
  ('p_t2','00000000-0000-4000-8000-0000000e0003'), ('p_pending','00000000-0000-4000-8000-0000000e0004'),
  ('p_fil','00000000-0000-4000-8000-0000000e0005'), ('p_hist','00000000-0000-4000-8000-0000000e0006'),
  ('p_bad_src','00000000-0000-4000-8000-0000000e0008'),
  ('mat_t1','00000000-0000-4000-8000-0000000f0001'), ('mat_t2','00000000-0000-4000-8000-0000000f0002');
insert into m3k select 'path_en', id from public.learning_paths where language in ('English','en') and reading_level = 'Instructional';
insert into m3k select 'path_fil', id from public.learning_paths where language in ('Filipino','fil') and reading_level = 'Independent';

-- Synthetic accounts (profiles come from the on_auth_user_created trigger).
insert into auth.users(id, email, aud, role)
select v, k || '.m3test@example.test', 'authenticated', 'authenticated'
from m3k where k in ('admin','t1','t2','pending','rejected','student','learner');
update public.profiles p set full_name = 'M3 test ' || k.k, nickname = 'M3' || k.k,
  role = case k.k when 'admin' then 'admin' when 'student' then 'student' when 'learner' then 'general_user' else 'teacher' end,
  teacher_status = case k.k when 't1' then 'approved' when 't2' then 'approved' when 'pending' then 'pending'
                            when 'rejected' then 'rejected' else null end
from m3k k where p.id = k.v;

-- Two uploaded materials (cloned shape of an existing row), owned by T1 and T2.
insert into public.uploaded_materials
select (jsonb_populate_record(null::public.uploaded_materials, to_jsonb(m) || jsonb_build_object(
  'id', o.mat, 'uploaded_by', o.owner, 'storage_path', o.owner::text || '/' || o.mat::text || substring(m.storage_path from '\.[a-z]+$'))
)).*
from (select * from public.uploaded_materials order by created_at limit 1) m
cross join (values ((select v from m3k where k='mat_t1'), (select v from m3k where k='t1')),
                   ((select v from m3k where k='mat_t2'), (select v from m3k where k='t2'))) o(mat, owner);

-- A module owned by the (formerly approved) pending Teacher, created directly as the owner role.
insert into public.modules(id, title, path_id, difficulty, status, created_by)
values ((select v from m3k where k='m_pending'), 'Pending teacher module', (select v from m3k where k='path_en'), 'Easy', 'draft',
        (select v from m3k where k='pending'));

create function pg_temp.run(label text, who text, stmt text, expect text) returns void language plpgsql as $f$
declare got text; detail text := ''; rc bigint; val text;
begin
  if who <> 'db' then
    perform set_config('request.jwt.claims', json_build_object('sub', (select v from m3k where k = who), 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', (select v from m3k where k = who)::text, true);
    perform set_config('role', 'authenticated', true);
  end if;
  begin
    if expect like 'value=%' then
      execute stmt into val; got := 'value=' || coalesce(val, 'null');
    else
      execute stmt; get diagnostics rc = row_count;
      got := case when expect like 'rows=%' then 'rows=' || rc else 'ok' end;
    end if;
  exception when others then
    got := 'denied'; detail := sqlerrm;
  end;
  reset role;
  insert into m3t(label, expect, got, detail) values (label, expect, got, detail);
end $f$;

-- Six reviewed-ready questions (2 per type) for one passage; evidence is an exact excerpt.
create function pg_temp.bank(seed int) returns jsonb language sql as $f$
  select jsonb_agg(jsonb_build_object(
    'id', ('00000000-0000-4000-8000-' || lpad((seed * 100 + i)::text, 12, '0'))::uuid,
    'type', (array['literal','literal','inferential','inferential','critical','critical'])[i],
    'questionText', 'Question ' || i || ' about the garden?',
    'options', jsonb_build_array('Seeds', 'Rocks', 'Sand', 'Snow'),
    'correctAnswer', 'Seeds', 'scaffoldingHint', 'Look at the first sentence.',
    'answerExplanation', 'The passage says Mia planted seeds.',
    'supportingEvidence', 'Mia planted three seeds'))
  from generate_series(1, 6) i
$f$;

create function pg_temp.draft(id_key text, passage_key text, path_key text, title text, source_key text) returns text language sql as $f$
  select format($s$select public.m3_create_collection_draft(%L, %L, %L, 'Medium', %L::jsonb)$s$,
    (select v from m3k where k = id_key), title, (select v from m3k where k = path_key),
    jsonb_build_array(jsonb_build_object('id', (select v from m3k where k = passage_key), 'title', 'The Garden',
      'passageText', 'Mia planted three seeds in a small pot. Every morning she gave them water.',
      'sourceMaterialId', (select v from m3k where k = source_key))))
$f$;

create function pg_temp.saved_bank(passage_key text) returns jsonb language sql as $f$
  select jsonb_agg(jsonb_build_object('id', q.id, 'type', q.question_type, 'questionText', q.question_text,
    'options', q.options, 'correctAnswer', a.correct_answer, 'scaffoldingHint', q.scaffolding_hint,
    'answerExplanation', a.answer_explanation, 'supportingEvidence', a.supporting_evidence) order by q.display_order)
  from public.comprehension_questions q join public.comprehension_question_answers a on a.question_id = q.id
  where q.passage_id = (select v from m3k where k = passage_key)
$f$;

create function pg_temp.save_bank(module_key text, passage_key text, action text, seed int) returns text language sql as $f$
  select format($s$select public.m3_save_passage_bank(%L, %L, (select collection_revision from public.modules where id = %L), %L::jsonb, %L)$s$,
    (select v from m3k where k = module_key), (select v from m3k where k = passage_key), (select v from m3k where k = module_key),
    case when action = 'review' then pg_temp.saved_bank(passage_key) else pg_temp.bank(seed) end, action)
$f$;

-- ---------------------------------------------------------------- F1 create
select pg_temp.run('F1 approved Teacher creates an English draft', 't1', pg_temp.draft('m_t1','p_t1','path_en','T1 English module','mat_t1'), 'ok');
select pg_temp.run('F1 created_by is the signed-in Teacher', 'admin', format('select created_by::text from public.modules where id = %L', (select v from m3k where k='m_t1')), 'value=' || (select v from m3k where k='t1'));
select pg_temp.run('F1 approved Teacher creates a Filipino draft', 't1', pg_temp.draft('m_fil','p_fil','path_fil','T1 Filipino module',null), 'ok');
select pg_temp.run('F1 second Teacher creates own draft', 't2', pg_temp.draft('m_t2','p_t2','path_en','T2 module',null), 'ok');
select pg_temp.run('F1 Admin still creates drafts', 'admin', pg_temp.draft('m_admin','p_admin','path_en','Admin module',null), 'ok');
select pg_temp.run('F1 pending Teacher cannot create', 'pending', pg_temp.draft('m_spoof','p_bad_src','path_en','x',null), 'denied');
select pg_temp.run('F1 rejected Teacher cannot create', 'rejected', pg_temp.draft('m_spoof','p_bad_src','path_en','x',null), 'denied');
select pg_temp.run('F1 Student cannot create', 'student', pg_temp.draft('m_spoof','p_bad_src','path_en','x',null), 'denied');
select pg_temp.run('F1 Independent Learner cannot create', 'learner', pg_temp.draft('m_spoof','p_bad_src','path_en','x',null), 'denied');
select pg_temp.run('F1 Teacher cannot cite another owner''s material', 't1', pg_temp.draft('m_bad_src','p_bad_src','path_en','x','mat_t2'), 'denied');
select pg_temp.run('F1 Teacher cannot insert a module owned by someone else', 't1',
  format($s$insert into public.modules(id,title,path_id,difficulty,status,created_by,passage) values (%L,'spoof',%L,'Easy','draft',%L,'text')$s$,
    (select v from m3k where k='m_spoof'), (select v from m3k where k='path_en'), (select v from m3k where k='t2')), 'denied');
select pg_temp.run('F1 Teacher cannot insert directly even as self', 't1',
  format($s$insert into public.modules(id,title,path_id,difficulty,status,created_by,passage) values (%L,'direct',%L,'Easy','draft',%L,'text')$s$,
    (select v from m3k where k='m_spoof'), (select v from m3k where k='path_en'), (select v from m3k where k='t1')), 'denied');

-- ---------------------------------------------------------------- draft privacy
select pg_temp.run('Privacy: owner reads own draft', 't1', format('select count(*)::text from public.modules where id = %L', (select v from m3k where k='m_t1')), 'value=1');
select pg_temp.run('Privacy: owner reads own draft passages', 't1', format('select count(*)::text from public.module_passages where module_id = %L', (select v from m3k where k='m_t1')), 'value=1');
select pg_temp.run('Privacy: other Teacher cannot read the draft', 't2', format('select count(*)::text from public.modules where id = %L', (select v from m3k where k='m_t1')), 'value=0');
select pg_temp.run('Privacy: other Teacher cannot read draft passages', 't2', format('select count(*)::text from public.module_passages where module_id = %L', (select v from m3k where k='m_t1')), 'value=0');
select pg_temp.run('Privacy: Student cannot read the draft', 'student', format('select count(*)::text from public.modules where id = %L', (select v from m3k where k='m_t1')), 'value=0');
select pg_temp.run('Privacy: Learner cannot read the draft', 'learner', format('select count(*)::text from public.modules where id = %L', (select v from m3k where k='m_t1')), 'value=0');
select pg_temp.run('Privacy: Teacher cannot read the Admin draft', 't1', format('select count(*)::text from public.modules where id = %L', (select v from m3k where k='m_admin')), 'value=0');
select pg_temp.run('Privacy: Admin reads the Teacher draft', 'admin', format('select count(*)::text from public.modules where id = %L', (select v from m3k where k='m_t1')), 'value=1');
select pg_temp.run('Privacy: pending Teacher cannot read own old draft', 'pending', format('select count(*)::text from public.modules where id = %L', (select v from m3k where k='m_pending')), 'value=0');

-- ---------------------------------------------------------------- F2/F3 edit (incl. difficulty, level, language)
select pg_temp.run('F3 owner opens the editor', 't1', format('select public.m3_admin_collection(%L)', (select v from m3k where k='m_t1')), 'ok');
select pg_temp.run('F3 other Teacher cannot open the editor', 't2', format('select public.m3_admin_collection(%L)', (select v from m3k where k='m_t1')), 'denied');
select pg_temp.run('F3 Teacher cannot open an Admin module', 't1', format('select public.m3_admin_collection(%L)', (select v from m3k where k='m_admin')), 'denied');
select pg_temp.run('F3 Student cannot open the editor', 'student', format('select public.m3_admin_collection(%L)', (select v from m3k where k='m_t1')), 'denied');
select pg_temp.run('F3 pending Teacher cannot open own old module', 'pending', format('select public.m3_admin_collection(%L)', (select v from m3k where k='m_pending')), 'denied');
select pg_temp.run('F2/F3 owner saves title, Independent level and Hard difficulty', 't1',
  format($s$select public.m3_save_collection(%L, (select collection_revision from public.modules where id=%L), 'T1 English module (edited)', %L, 'Hard',
    %L::jsonb, '{}'::uuid[])$s$, (select v from m3k where k='m_t1'), (select v from m3k where k='m_t1'),
    (select id from public.learning_paths where language in ('English','en') and reading_level='Independent'),
    jsonb_build_array(jsonb_build_object('id', (select v from m3k where k='p_t1'), 'title', 'The Garden',
      'passageText', 'Mia planted three seeds in a small pot. Every morning she gave them water.', 'sourceMaterialId', (select v from m3k where k='mat_t1')))), 'ok');
select pg_temp.run('F2 saved difficulty and level', 'admin', format($s$select m.difficulty || '/' || lp.reading_level from public.modules m join public.learning_paths lp on lp.id = m.path_id where m.id = %L$s$, (select v from m3k where k='m_t1')), 'value=Hard/Independent');
select pg_temp.run('F2 invalid difficulty still rejected', 't1',
  format($s$select public.m3_save_collection(%L, (select collection_revision from public.modules where id=%L), 'x', %L, 'Extreme', '[]'::jsonb, '{}'::uuid[])$s$,
    (select v from m3k where k='m_t1'), (select v from m3k where k='m_t1'), (select v from m3k where k='path_en')), 'denied');
select pg_temp.run('F3 other Teacher cannot save', 't2',
  format($s$select public.m3_save_collection(%L, 1, 'hijack', %L, 'Easy', '[]'::jsonb, '{}'::uuid[])$s$, (select v from m3k where k='m_t1'), (select v from m3k where k='path_en')), 'denied');
select pg_temp.run('F3 Teacher cannot save an Admin module', 't1',
  format($s$select public.m3_save_collection(%L, 1, 'hijack', %L, 'Easy', '[]'::jsonb, '{}'::uuid[])$s$, (select v from m3k where k='m_admin'), (select v from m3k where k='path_en')), 'denied');
select pg_temp.run('F3 direct update of another Teacher''s draft changes nothing', 't1', format($s$update public.modules set title = 'hijack' where id = %L$s$, (select v from m3k where k='m_t2')), 'rows=0');
select pg_temp.run('F3 Teacher cannot hand the module to another owner', 't1', format($s$update public.modules set created_by = %L where id = %L$s$, (select v from m3k where k='t2'), (select v from m3k where k='m_t1')), 'denied');
select pg_temp.run('F3 Teacher cannot soft-delete through a direct update', 't1', format($s$update public.modules set deleted_at = now() where id = %L$s$, (select v from m3k where k='m_t1')), 'denied');
select pg_temp.run('F3 Teacher cannot archive through a direct update', 't1', format($s$update public.modules set status = 'archived' where id = %L$s$, (select v from m3k where k='m_t1')), 'denied');

-- ---------------------------------------------------------------- question bank (generate → review)
select pg_temp.run('F5 owner saves a generated bank', 't1', pg_temp.save_bank('m_t1','p_t1','generate',71), 'ok');
select pg_temp.run('F5 other Teacher cannot save a bank', 't2', pg_temp.save_bank('m_t1','p_t1','generate',72), 'denied');
select pg_temp.run('F5 Student cannot save a bank', 'student', pg_temp.save_bank('m_t1','p_t1','generate',73), 'denied');
select pg_temp.run('F5 publish refused before review', 't1', format($s$update public.modules set status = 'published' where id = %L$s$, (select v from m3k where k='m_t1')), 'denied');
select pg_temp.run('F5 owner sees publish issues', 't1', format('select array_length(public.m3_collection_publish_issues(%L), 1)::text', (select v from m3k where k='m_t1')), 'value=1');
select pg_temp.run('F5 other Teacher cannot read publish issues', 't2', format('select public.m3_collection_publish_issues(%L)', (select v from m3k where k='m_t1')), 'denied');
select pg_temp.run('F5 owner marks the bank reviewed', 't1', pg_temp.save_bank('m_t1','p_t1','review',71), 'ok');
select pg_temp.run('F5 no publish issues after review', 't1', format('select coalesce(array_length(public.m3_collection_publish_issues(%L), 1), 0)::text', (select v from m3k where k='m_t1')), 'value=0');

-- ---------------------------------------------------------------- F5 publish + visibility
select pg_temp.run('F5 other Teacher cannot publish it', 't2', format($s$update public.modules set status = 'published' where id = %L$s$, (select v from m3k where k='m_t1')), 'rows=0');
select pg_temp.run('F5 Student cannot publish it', 'student', format($s$update public.modules set status = 'published' where id = %L$s$, (select v from m3k where k='m_t1')), 'rows=0');
select pg_temp.run('F5 owner publishes', 't1', format($s$update public.modules set status = 'published' where id = %L$s$, (select v from m3k where k='m_t1')), 'rows=1');
select pg_temp.run('F5 published_at set by the database', 'admin', format('select (published_at is not null)::text from public.modules where id = %L', (select v from m3k where k='m_t1')), 'value=true');
select pg_temp.run('Visibility: Student reads the published module', 'student', format('select count(*)::text from public.modules where id = %L', (select v from m3k where k='m_t1')), 'value=1');
select pg_temp.run('Visibility: Learner reads the published module', 'learner', format('select count(*)::text from public.modules where id = %L', (select v from m3k where k='m_t1')), 'value=1');
select pg_temp.run('Visibility: other Teacher reads the published module', 't2', format('select count(*)::text from public.modules where id = %L', (select v from m3k where k='m_t1')), 'value=1');
select pg_temp.run('After publish: owner cannot edit', 't1',
  format($s$select public.m3_save_collection(%L, (select collection_revision from public.modules where id=%L), 'late edit', %L, 'Easy', '[]'::jsonb, '{}'::uuid[])$s$,
    (select v from m3k where k='m_t1'), (select v from m3k where k='m_t1'), (select v from m3k where k='path_en')), 'denied');
select pg_temp.run('After publish: owner cannot unpublish', 't1', format($s$update public.modules set status = 'draft' where id = %L$s$, (select v from m3k where k='m_t1')), 'rows=0');
select pg_temp.run('After publish: owner cannot rename directly', 't1', format($s$update public.modules set title = 'renamed' where id = %L$s$, (select v from m3k where k='m_t1')), 'rows=0');

-- ---------------------------------------------------------------- F4 delete
select pg_temp.run('F4 other Teacher cannot delete', 't2', format('select public.m3_delete_module(%L)', (select v from m3k where k='m_fil')), 'denied');
select pg_temp.run('F4 Student cannot delete', 'student', format('select public.m3_delete_module(%L)', (select v from m3k where k='m_fil')), 'denied');
select pg_temp.run('F4 Teacher cannot delete an Admin module', 't1', format('select public.m3_delete_module(%L)', (select v from m3k where k='m_admin')), 'denied');
select pg_temp.run('F4 Teacher cannot delete directly', 't1', format('delete from public.modules where id = %L', (select v from m3k where k='m_fil')), 'rows=0');
-- m3_teacher_trash: Teachers never hard-delete; their Delete moves the module to the Trash (restorable).
select pg_temp.run('F4 Teacher hard delete refused', 't1', format('select public.m3_delete_module(%L)', (select v from m3k where k='m_fil')), 'denied');
select pg_temp.run('F4 owner moves an unused draft to the Trash', 't1', format('select public.m3_trash_module(%L)', (select v from m3k where k='m_fil')), 'value=trashed');
-- History: a learner's progress row on T1's published module must survive deletion.
reset role;
insert into public.progress(user_id, module_id)
select (select v from m3k where k='student'), id from public.modules where id = (select v from m3k where k='m_t1');
select pg_temp.run('F4 owner moves a module with history to the Trash: preserved, not purged', 't1', format('select public.m3_trash_module(%L)', (select v from m3k where k='m_t1')), 'value=trashed');
select pg_temp.run('F4 learner progress kept', 'db', format('select count(*)::text from public.progress where module_id = %L', (select v from m3k where k='m_t1')), 'value=1');
select pg_temp.run('F4 deleted module hidden from Student', 'student', format('select count(*)::text from public.modules where id = %L', (select v from m3k where k='m_t1')), 'value=0');

-- ---------------------------------------------------------------- Admin manages Teacher modules + helper
select pg_temp.run('Admin opens a Teacher draft', 'admin', format('select public.m3_admin_collection(%L)', (select v from m3k where k='m_t2')), 'ok');
select pg_temp.run('Admin edits a Teacher draft', 'admin',
  format($s$select public.m3_save_collection(%L, (select collection_revision from public.modules where id=%L), 'Admin edit', %L, 'Easy',
    %L::jsonb, '{}'::uuid[])$s$, (select v from m3k where k='m_t2'), (select v from m3k where k='m_t2'), (select v from m3k where k='path_en'),
    jsonb_build_array(jsonb_build_object('id', (select v from m3k where k='p_t2'), 'title', 'The Garden',
      'passageText', 'Mia planted three seeds in a small pot. Every morning she gave them water.', 'sourceMaterialId', null))), 'ok');
select pg_temp.run('Admin deletes a Teacher draft', 'admin', format('select public.m3_delete_module(%L)', (select v from m3k where k='m_t2')), 'value=permanent');
select pg_temp.run('Admin still deletes own draft', 'admin', format('select public.m3_delete_module(%L)', (select v from m3k where k='m_admin')), 'value=permanent');
select pg_temp.run('Helper is not callable by clients', 't1', format('select public.m3_can_manage_module(%L)', (select v from m3k where k='m_t1')), 'denied');

-- ---------------------------------------------------------------- report
select case when got = expect then 'PASS' else 'FAIL' end as result, n, label, expect, got,
       case when got = expect then '' else detail end as detail
from m3t order by n;
select count(*) filter (where got = expect) as passed, count(*) filter (where got <> expect) as failed from m3t;

rollback;
