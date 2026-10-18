-- Run only through validate_m3_passages.py in an approved disposable database.
-- Baseline migrations must already exist. Never substitute a fabricated baseline.
do $$ begin
  if to_regclass('public.module_passages') is not null then
    raise exception 'Use a pre-Phase-1 disposable baseline; passage table already exists';
  end if;
  if to_regprocedure('public.m3_current_role()') is null or to_regclass('auth.users') is null then
    raise exception 'Existing Supabase ReadFlow schema/RLS is required';
  end if;
  if exists (select 1 from auth.users where id::text like 'fa310001-%')
    or exists (select 1 from public.modules where id::text like 'fa310001-%') then
    raise exception 'Validation fixture IDs already exist; refusing to overwrite them';
  end if;
end $$;

-- Auth users are fake fixture identities, with no passwords or real email addresses.
insert into auth.users(id, email) values
('fa310001-0000-4000-8000-000000000001', 'm3-admin@example.invalid'),
('fa310001-0000-4000-8000-000000000002', 'm3-teacher@example.invalid'),
('fa310001-0000-4000-8000-000000000003', 'm3-student@example.invalid'),
('fa310001-0000-4000-8000-000000000004', 'm3-general@example.invalid');
-- Existing auth signup trigger may have already inserted profiles.
insert into public.profiles(id, full_name, nickname, role) values
('fa310001-0000-4000-8000-000000000001', 'Test Admin', 'Admin', 'admin'),
('fa310001-0000-4000-8000-000000000002', 'Test Teacher', 'Teacher', 'teacher'),
('fa310001-0000-4000-8000-000000000003', 'Test Student', 'Student', 'student'),
('fa310001-0000-4000-8000-000000000004', 'Test General', 'General', 'general_user')
on conflict (id) do update set full_name = excluded.full_name, nickname = excluded.nickname, role = excluded.role;

insert into public.learning_paths(id, path_name, language, reading_level, difficulty_tier)
values ('fa310001-0000-4000-8000-000000000010', 'M3 validation path', 'en', 'Independent', 'Easy');
insert into public.modules(id, title, path_id, difficulty, status, created_by, passage) values
('fa310001-0000-4000-8000-000000000011', 'Legacy published', 'fa310001-0000-4000-8000-000000000010', 'Easy', 'published', 'fa310001-0000-4000-8000-000000000001', E'  Exact legacy text\nwith spacing.  '),
('fa310001-0000-4000-8000-000000000012', 'Legacy draft', 'fa310001-0000-4000-8000-000000000010', 'Easy', 'draft', 'fa310001-0000-4000-8000-000000000001', 'Another passage.');
insert into public.uploaded_materials(id, uploaded_by, title, language, original_filename, storage_path, mime_type, file_size_bytes)
values ('fa310001-0000-4000-8000-000000000020', 'fa310001-0000-4000-8000-000000000002', 'Teacher source', 'en', 'fixture.pdf', 'fa310001-0000-4000-8000-000000000002/fa310001-0000-4000-8000-000000000020.pdf', 'application/pdf', 100);
insert into public.comprehension_questions(id, module_id, material_id, question_type, question_text, options, scaffolding_hint, display_order, generated_by_ai, review_status, reviewed_by) values
('fa310001-0000-4000-8000-000000000031', 'fa310001-0000-4000-8000-000000000011', null, 'literal', 'Published question?', '["One","Two","Three","Four"]', 'Read again.', 1, true, 'reviewed', 'fa310001-0000-4000-8000-000000000001'),
('fa310001-0000-4000-8000-000000000032', 'fa310001-0000-4000-8000-000000000012', null, 'literal', 'Draft question?', '["One","Two","Three","Four"]', 'Read again.', 1, true, 'generated', null),
('fa310001-0000-4000-8000-000000000033', null, 'fa310001-0000-4000-8000-000000000020', 'literal', 'Material question?', '["One","Two","Three","Four"]', 'Read again.', 1, true, 'reviewed', 'fa310001-0000-4000-8000-000000000002');
insert into public.comprehension_question_answers(question_id, correct_answer)
select id, 'One' from public.comprehension_questions where id::text like 'fa310001-%';
-- Flush fixture events, then restore the real migration's deferred-trigger context.
set constraints all immediate;
set constraints all deferred;
create temp table m3_before_questions as select * from public.comprehension_questions;
create temp table m3_before_answers as select * from public.comprehension_question_answers;
create temp table m3_before_modules as select * from public.modules;
