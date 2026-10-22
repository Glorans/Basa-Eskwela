-- PREPARED ONLY. Requires approval. Staging oudfrdeqwotynihkkmze ONLY. Run ONCE, after B7.
-- B8 = supabase/m3_content_rls.sql, byte-for-byte, with the B8a REVOKE statement inserted
-- before its COMMIT, so both run in ONE transaction. B8a removes the anon EXECUTE that
-- Supabase default grants leave on the seven SECURITY DEFINER helpers (B8 revokes only PUBLIC);
-- authenticated keeps EXECUTE. Use this file INSTEAD OF the plain B8 step.
-- B8's three storage.objects policies are created by the SQL editor's postgres role through
-- Supabase's supautils policy_grants, not through table ownership. Nothing here alters
-- storage.objects, its owner, its RLS setting or storage.buckets. If any statement fails, the
-- whole file rolls back: STOP and report, do not split the file or retry pieces.
-- Before: verify_b8.sql P4a-P4c. After: V4a-V4i, audit A1-A8.
-- ReadFlow M3 Row Level Security and future Storage policies.
-- REVIEW ONLY: do not run this file until m3_content_schema.sql has been
-- reviewed and applied in a controlled Supabase migration.
--
-- Identity assumption requiring confirmation before application:
-- public.profiles.id is the same UUID as auth.users.id/auth.uid(). The supplied
-- live schema strongly implies this through existing foreign keys, but the
-- repository does not contain the profiles -> auth.users constraint itself.
-- profiles.status is intentionally not checked because its active-value
-- vocabulary has not been supplied. Add that check only after confirming it.
-- Expected role values are exactly: admin, teacher, student, general_user.
--
-- Existing-column assumptions requiring live verification:
--   rooms.id
--   room_modules.room_id, room_modules.module_id
--   progress.module_id
-- The existing RLS/grants for rooms, enrollments, room_modules, and progress
-- are deliberately left untouched by this M3 migration.
--
-- PostgreSQL ORs permissive policies. Before applying this file, inspect
-- pg_policies for pre-existing policies on public.modules and storage.objects.
-- Reconcile/remove any broad authenticated policies that would weaken these
-- rules. This file cannot safely guess the names or intent of live policies.

begin;

create or replace function public.m3_current_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select profile.role
  from public.profiles as profile
  where profile.id = auth.uid()
  limit 1
$$;

create or replace function public.m3_can_read_module(target_module_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.modules as module_row
    where module_row.id = target_module_id
      and (
        public.m3_current_role() = 'admin'
        or (
          module_row.status = 'published'
          and public.m3_current_role() in ('teacher', 'student', 'general_user')
        )
      )
  )
$$;

comment on function public.m3_can_read_module(uuid) is
  'Admin sees all modules. Teacher, Student, and General User see published modules. Student assignment restrictions are intentionally deferred until M4 Classroom Management is enforced.';

create or replace function public.m3_owns_material(target_material_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.uploaded_materials as material
    where material.id = target_material_id
      and material.uploaded_by = auth.uid()
  )
$$;

create or replace function public.m3_module_is_unreferenced(target_module_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    not exists (
      select 1
      from public.room_modules as room_module
      where room_module.module_id = target_module_id
    )
    and not exists (
      select 1
      from public.progress as progress_row
      where progress_row.module_id = target_module_id
    )
    and not exists (
      select 1
      from public.comprehension_questions as question
      where question.module_id = target_module_id
    )
$$;

create or replace function public.m3_material_is_unreferenced(
  target_material_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    not exists (
      select 1
      from public.modules as module_row
      where module_row.source_material_id = target_material_id
    )
    and not exists (
      select 1
      from public.comprehension_questions as question
      where question.material_id = target_material_id
    )
$$;

create or replace function public.m3_material_file_is_absent(
  target_material_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.uploaded_materials as material
    join storage.objects as object
      on object.bucket_id = 'reading-materials'
      and object.name = material.storage_path
    where material.id = target_material_id
  )
$$;

create or replace function public.m3_storage_object_is_deletable(
  target_storage_path text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    not exists (
      select 1
      from public.uploaded_materials as material
      where material.storage_path = target_storage_path
    )
    or exists (
      select 1
      from public.uploaded_materials as material
      where material.storage_path = target_storage_path
        and public.m3_material_is_unreferenced(material.id)
    )
$$;

revoke all on function public.m3_current_role() from public;
revoke all on function public.m3_can_read_module(uuid) from public;
revoke all on function public.m3_owns_material(uuid) from public;
revoke all on function public.m3_module_is_unreferenced(uuid) from public;
revoke all on function public.m3_material_is_unreferenced(uuid) from public;
revoke all on function public.m3_material_file_is_absent(uuid) from public;
revoke all on function public.m3_storage_object_is_deletable(text) from public;

grant execute on function public.m3_current_role() to authenticated;
grant execute on function public.m3_can_read_module(uuid) to authenticated;
grant execute on function public.m3_owns_material(uuid) to authenticated;
grant execute on function public.m3_module_is_unreferenced(uuid) to authenticated;
grant execute on function public.m3_material_is_unreferenced(uuid) to authenticated;
grant execute on function public.m3_material_file_is_absent(uuid) to authenticated;
grant execute on function public.m3_storage_object_is_deletable(text) to authenticated;

alter table public.modules enable row level security;
alter table public.uploaded_materials enable row level security;
alter table public.comprehension_questions enable row level security;
alter table public.comprehension_question_answers enable row level security;

revoke all on table public.modules from anon, authenticated;
revoke all on table public.uploaded_materials from anon, authenticated;
revoke all on table public.comprehension_questions from anon, authenticated;
revoke all on table public.comprehension_question_answers from anon, authenticated;

-- Column-scoped grants complement RLS so normal authenticated clients cannot
-- write server-managed extraction data, source/provenance IDs, review audit
-- fields, timestamps, or module publication timestamps directly.
grant select, delete on table public.modules to authenticated;
grant insert (
  path_id,
  title,
  difficulty,
  status,
  created_by,
  passage,
  source_material_id
) on public.modules to authenticated;
grant update (
  path_id,
  title,
  difficulty,
  status,
  passage,
  source_material_id
) on public.modules to authenticated;

grant select, delete on table public.uploaded_materials to authenticated;
grant insert (
  uploaded_by,
  title,
  language,
  original_filename,
  storage_path,
  mime_type,
  file_size_bytes
) on public.uploaded_materials to authenticated;
grant update (
  title,
  content_text
) on public.uploaded_materials to authenticated;

grant select, delete on table public.comprehension_questions to authenticated;
grant insert (
  module_id,
  material_id,
  question_type,
  question_text,
  options,
  scaffolding_hint,
  display_order,
  generated_by_ai,
  review_status
) on public.comprehension_questions to authenticated;
grant update (
  question_type,
  question_text,
  options,
  scaffolding_hint,
  display_order,
  review_status
) on public.comprehension_questions to authenticated;

grant select, delete on table public.comprehension_question_answers
  to authenticated;
grant insert (question_id, correct_answer)
  on public.comprehension_question_answers to authenticated;
grant update (correct_answer)
  on public.comprehension_question_answers to authenticated;

-- MODULES -------------------------------------------------------------------

drop policy if exists "M3 role-aware module reads" on public.modules;
create policy "M3 role-aware module reads"
on public.modules
for select
to authenticated
using (public.m3_can_read_module(id));

drop policy if exists "M3 admins create draft modules" on public.modules;
create policy "M3 admins create draft modules"
on public.modules
for insert
to authenticated
with check (
  public.m3_current_role() = 'admin'
  and created_by = auth.uid()
  and status = 'draft'
  and published_at is null
  and nullif(btrim(passage), '') is not null
);

drop policy if exists "M3 admins update modules" on public.modules;
create policy "M3 admins update modules"
on public.modules
for update
to authenticated
using (public.m3_current_role() = 'admin')
with check (public.m3_current_role() = 'admin');

-- Only never-published, unassigned, progress-free drafts may be hard-deleted.
-- Published/referenced modules must be moved to `archived` through UPDATE.
drop policy if exists "M3 admins delete unused drafts" on public.modules;
create policy "M3 admins delete unused drafts"
on public.modules
for delete
to authenticated
using (
  public.m3_current_role() = 'admin'
  and status = 'draft'
  and published_at is null
  and public.m3_module_is_unreferenced(id)
);

-- UPLOADED MATERIALS --------------------------------------------------------

drop policy if exists "M3 material owners and admins read materials"
  on public.uploaded_materials;
create policy "M3 material owners and admins read materials"
on public.uploaded_materials
for select
to authenticated
using (
  public.m3_current_role() = 'admin'
  or (
    public.m3_current_role() in ('teacher', 'general_user')
    and uploaded_by = auth.uid()
  )
);

-- Admin is deliberately absent: the permission matrix forbids normal Admin
-- uploads. A trusted extraction service may use service-role access to advance
-- status and persist raw extraction/OCR results after this pending insert.
drop policy if exists "M3 teachers and general users upload own materials"
  on public.uploaded_materials;
create policy "M3 teachers and general users upload own materials"
on public.uploaded_materials
for insert
to authenticated
with check (
  public.m3_current_role() in ('teacher', 'general_user')
  and uploaded_by = auth.uid()
  and storage_path like auth.uid()::text || '/%'
  and extraction_status = 'pending'
  and raw_extracted_text is null
  and content_text is null
  and ocr_confidence is null
);

-- The column grants limit normal owners to title/content_text. Language, raw
-- extraction, OCR confidence, status, file identity, and ownership are not
-- client-writable.
drop policy if exists "M3 material owners update own materials"
  on public.uploaded_materials;
create policy "M3 material owners update own materials"
on public.uploaded_materials
for update
to authenticated
using (
  public.m3_current_role() in ('teacher', 'general_user')
  and uploaded_by = auth.uid()
)
with check (
  public.m3_current_role() in ('teacher', 'general_user')
  and uploaded_by = auth.uid()
);

-- Deletion is an orchestrated trusted-service workflow:
--   1. remove generated question rows (answer rows cascade with questions),
--   2. clear any module provenance reference,
--   3. delete the Storage object,
--   4. delete this metadata row.
-- The two helper checks enforce steps 1-3. This never cascades into modules,
-- room_modules, progress, or other learner history.
drop policy if exists "M3 material owners and admins delete safe materials"
  on public.uploaded_materials;
create policy "M3 material owners and admins delete safe materials"
on public.uploaded_materials
for delete
to authenticated
using (
  (
    public.m3_current_role() = 'admin'
    or (
      public.m3_current_role() in ('teacher', 'general_user')
      and uploaded_by = auth.uid()
    )
  )
  and public.m3_material_is_unreferenced(id)
  and public.m3_material_file_is_absent(id)
);

-- QUESTIONS -----------------------------------------------------------------

-- comprehension_questions intentionally contains no correct-answer column.
-- Students see reviewed questions only for modules they are authorized to
-- read. General Users may see reviewed prompts for their own material, but
-- cannot edit them and never receive answer rows.
drop policy if exists "M3 role-aware safe question reads"
  on public.comprehension_questions;
create policy "M3 role-aware safe question reads"
on public.comprehension_questions
for select
to authenticated
using (
  public.m3_current_role() = 'admin'
  or (
    module_id is not null
    and review_status = 'reviewed'
    and public.m3_can_read_module(module_id)
  )
  or (
    material_id is not null
    and public.m3_owns_material(material_id)
    and (
      public.m3_current_role() = 'teacher'
      or (
        public.m3_current_role() = 'general_user'
        and review_status = 'reviewed'
      )
    )
  )
);

-- AI generation is expected to persist through a trusted service. Normal
-- authenticated inserts are Admin-only; Teachers review/update generated rows
-- belonging to their own materials.
drop policy if exists "M3 admins create questions"
  on public.comprehension_questions;
create policy "M3 admins create questions"
on public.comprehension_questions
for insert
to authenticated
with check (public.m3_current_role() = 'admin');

drop policy if exists "M3 admins update all questions"
  on public.comprehension_questions;
create policy "M3 admins update all questions"
on public.comprehension_questions
for update
to authenticated
using (public.m3_current_role() = 'admin')
with check (public.m3_current_role() = 'admin');

drop policy if exists "M3 teachers review generated questions"
  on public.comprehension_questions;
create policy "M3 teachers review generated questions"
on public.comprehension_questions
for update
to authenticated
using (
  public.m3_current_role() = 'teacher'
  and generated_by_ai
  and material_id is not null
  and public.m3_owns_material(material_id)
)
with check (
  public.m3_current_role() = 'teacher'
  and generated_by_ai
  and material_id is not null
  and public.m3_owns_material(material_id)
);

drop policy if exists "M3 admins delete questions"
  on public.comprehension_questions;
create policy "M3 admins delete questions"
on public.comprehension_questions
for delete
to authenticated
using (public.m3_current_role() = 'admin');

-- ANSWER KEYS ---------------------------------------------------------------

drop policy if exists "M3 admins and owning teachers read answer keys"
  on public.comprehension_question_answers;
create policy "M3 admins and owning teachers read answer keys"
on public.comprehension_question_answers
for select
to authenticated
using (
  public.m3_current_role() = 'admin'
  or (
    public.m3_current_role() = 'teacher'
    and exists (
      select 1
      from public.comprehension_questions as question
      where question.id = comprehension_question_answers.question_id
        and question.generated_by_ai
        and question.material_id is not null
        and public.m3_owns_material(question.material_id)
    )
  )
);

drop policy if exists "M3 admins create answer keys"
  on public.comprehension_question_answers;
create policy "M3 admins create answer keys"
on public.comprehension_question_answers
for insert
to authenticated
with check (public.m3_current_role() = 'admin');

drop policy if exists "M3 admins update all answer keys"
  on public.comprehension_question_answers;
create policy "M3 admins update all answer keys"
on public.comprehension_question_answers
for update
to authenticated
using (public.m3_current_role() = 'admin')
with check (public.m3_current_role() = 'admin');

drop policy if exists "M3 teachers review generated answer keys"
  on public.comprehension_question_answers;
create policy "M3 teachers review generated answer keys"
on public.comprehension_question_answers
for update
to authenticated
using (
  public.m3_current_role() = 'teacher'
  and exists (
    select 1
    from public.comprehension_questions as question
    where question.id = comprehension_question_answers.question_id
      and question.generated_by_ai
      and question.material_id is not null
      and public.m3_owns_material(question.material_id)
  )
)
with check (
  public.m3_current_role() = 'teacher'
  and exists (
    select 1
    from public.comprehension_questions as question
    where question.id = comprehension_question_answers.question_id
      and question.generated_by_ai
      and question.material_id is not null
      and public.m3_owns_material(question.material_id)
  )
);

drop policy if exists "M3 admins delete answer keys"
  on public.comprehension_question_answers;
create policy "M3 admins delete answer keys"
on public.comprehension_question_answers
for delete
to authenticated
using (public.m3_current_role() = 'admin');

-- FUTURE PRIVATE STORAGE BUCKET ---------------------------------------------
-- This migration intentionally does NOT insert or update storage.buckets.
-- After review, create `reading-materials` as a PRIVATE bucket with:
--   file size limit: 26214400 bytes (25 MiB)
--   allowed MIME types:
--     application/pdf
--     application/vnd.openxmlformats-officedocument.wordprocessingml.document
--     image/jpeg
--     image/png
-- Object path format: <auth-user-uuid>/<generated-object-uuid>.<extension>.
-- Original filenames remain metadata and are never object keys. Server-side
-- magic-byte validation remains mandatory; extensions/MIME claims alone are
-- not sufficient validation.

drop policy if exists "M3 uploaders create own reading material objects"
  on storage.objects;
create policy "M3 uploaders create own reading material objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'reading-materials'
  and public.m3_current_role() in ('teacher', 'general_user')
  and name ~ (
    '^'
    || auth.uid()::text
    || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|docx|jpg|jpeg|png)$'
  )
);

drop policy if exists "M3 owners and admins read reading material objects"
  on storage.objects;
create policy "M3 owners and admins read reading material objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'reading-materials'
  and (
    public.m3_current_role() = 'admin'
    or (
      public.m3_current_role() in ('teacher', 'general_user')
      and (storage.foldername(name))[1] = auth.uid()::text
    )
  )
);

drop policy if exists "M3 owners and admins delete reading material objects"
  on storage.objects;
create policy "M3 owners and admins delete reading material objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'reading-materials'
  and (
    public.m3_current_role() = 'admin'
    or (
      public.m3_current_role() in ('teacher', 'general_user')
      and (storage.foldername(name))[1] = auth.uid()::text
    )
  )
  and public.m3_storage_object_is_deletable(name)
);

-- No UPDATE policy is intentional: clients cannot overwrite or move objects.
-- Replace/delete workflows must use a new generated UUID object key.


-- B8a (staging correction, REVOKE only).
REVOKE EXECUTE ON FUNCTION public.m3_current_role (), public.m3_can_read_module (uuid), public.m3_owns_material (uuid), public.m3_module_is_unreferenced (uuid), public.m3_material_is_unreferenced (uuid), public.m3_material_file_is_absent (uuid), public.m3_storage_object_is_deletable (text) FROM anon;

commit;
