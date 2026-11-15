-- PROPOSAL ONLY. NOT APPLIED. M1 School Admin scope: no access to Independent Learner uploads.
--
-- Why: Appendix N M1 gives the School Admin (role 'admin') Teacher and Student accounts only. Today RLS still lets a
-- School Admin read and delete every uploaded material, its question sets, questions and answer keys, and its storage
-- object, including an Independent Learner's personal uploads (the server API now refuses them; this closes the
-- direct Supabase path).
--
-- What changes: in 13 existing policies, ONLY the Admin branch `m3_current_role() = 'admin'` is replaced by a helper
-- that is true for a School Admin except when the row belongs to an Independent Learner. Every Teacher, Independent
-- Learner and Student branch keeps its current expression. No row is changed. Four helpers are added; each returns
-- false for anyone who is not a School Admin, so no other caller learns anything from them.
--
-- Preflight / verify: m1_school_admin_learner_scope_VERIFY_READONLY.sql. Rollback:
-- m1_school_admin_learner_scope_ROLLBACK_PROPOSED.sql (restores the exact current policies).
begin;
set local lock_timeout = '5s';

create function public.m1_school_admin_sees_owner(owner_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.m3_current_role() = 'admin'
    and not exists (select 1 from public.profiles p where p.id = owner_id and p.role = 'general_user');
$$;

create function public.m1_school_admin_sees_material(target_material_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.m3_current_role() = 'admin'
    and not exists (
      select 1 from public.uploaded_materials m join public.profiles p on p.id = m.uploaded_by
      where m.id = target_material_id and p.role = 'general_user');
$$;

create function public.m1_school_admin_sees_question(target_question_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.m3_current_role() = 'admin'
    and not exists (
      select 1 from public.comprehension_questions q
        join public.uploaded_materials m on m.id = q.material_id
        join public.profiles p on p.id = m.uploaded_by
      where q.id = target_question_id and p.role = 'general_user');
$$;

create function public.m1_school_admin_sees_storage_owner(owner_folder text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.m3_current_role() = 'admin'
    and not exists (select 1 from public.profiles p where p.id::text = owner_folder and p.role = 'general_user');
$$;

revoke all on function public.m1_school_admin_sees_owner(uuid), public.m1_school_admin_sees_material(uuid),
  public.m1_school_admin_sees_question(uuid), public.m1_school_admin_sees_storage_owner(text) from public, anon;
grant execute on function public.m1_school_admin_sees_owner(uuid), public.m1_school_admin_sees_material(uuid),
  public.m1_school_admin_sees_question(uuid), public.m1_school_admin_sees_storage_owner(text) to authenticated;

-- uploaded_materials
drop policy "M3 material owners and admins read materials" on public.uploaded_materials;
create policy "M3 material owners and admins read materials" on public.uploaded_materials for select to authenticated
  using (public.m1_school_admin_sees_owner(uploaded_by)
    or ((public.m3_current_role() = any (array['teacher'::text, 'general_user'::text])) and (uploaded_by = auth.uid())));
drop policy "M3 material owners and admins delete safe materials" on public.uploaded_materials;
create policy "M3 material owners and admins delete safe materials" on public.uploaded_materials for delete to authenticated
  using ((public.m1_school_admin_sees_owner(uploaded_by)
      or ((public.m3_current_role() = any (array['teacher'::text, 'general_user'::text])) and (uploaded_by = auth.uid())))
    and public.m3_material_is_unreferenced(id) and public.m3_material_file_is_absent(id));

-- material_question_sets
drop policy "M3 admins and owning teachers read saved sets" on public.material_question_sets;
create policy "M3 admins and owning teachers read saved sets" on public.material_question_sets for select to authenticated
  using (public.m1_school_admin_sees_material(material_id)
    or ((public.m3_current_role() = 'teacher'::text) and public.m3_owns_material(material_id)));

-- comprehension_questions
drop policy "M3 role-aware safe question reads" on public.comprehension_questions;
create policy "M3 role-aware safe question reads" on public.comprehension_questions for select to authenticated
  using (public.m1_school_admin_sees_material(material_id)
    or ((module_id is not null) and (review_status = 'reviewed'::text) and public.m3_can_read_module(module_id))
    or ((material_id is not null) and public.m3_owns_material(material_id)
      and ((public.m3_current_role() = 'teacher'::text)
        or ((public.m3_current_role() = 'general_user'::text) and (review_status = 'reviewed'::text)))));
drop policy "M3 admins create questions" on public.comprehension_questions;
create policy "M3 admins create questions" on public.comprehension_questions for insert to authenticated
  with check (public.m1_school_admin_sees_material(material_id));
drop policy "M3 admins update all questions" on public.comprehension_questions;
create policy "M3 admins update all questions" on public.comprehension_questions for update to authenticated
  using (public.m1_school_admin_sees_material(material_id)) with check (public.m1_school_admin_sees_material(material_id));
drop policy "M3 admins delete questions" on public.comprehension_questions;
create policy "M3 admins delete questions" on public.comprehension_questions for delete to authenticated
  using (public.m1_school_admin_sees_material(material_id));

-- comprehension_question_answers
drop policy "M3 admins and owning teachers read answer keys" on public.comprehension_question_answers;
create policy "M3 admins and owning teachers read answer keys" on public.comprehension_question_answers for select to authenticated
  using (public.m1_school_admin_sees_question(question_id)
    or ((public.m3_current_role() = 'teacher'::text) and (exists (select 1 from public.comprehension_questions question
      where ((question.id = comprehension_question_answers.question_id) and question.generated_by_ai
        and (question.material_id is not null) and public.m3_owns_material(question.material_id))))));
drop policy "M3 admins create answer keys" on public.comprehension_question_answers;
create policy "M3 admins create answer keys" on public.comprehension_question_answers for insert to authenticated
  with check (public.m1_school_admin_sees_question(question_id));
drop policy "M3 admins update all answer keys" on public.comprehension_question_answers;
create policy "M3 admins update all answer keys" on public.comprehension_question_answers for update to authenticated
  using (public.m1_school_admin_sees_question(question_id)) with check (public.m1_school_admin_sees_question(question_id));
drop policy "M3 admins delete answer keys" on public.comprehension_question_answers;
create policy "M3 admins delete answer keys" on public.comprehension_question_answers for delete to authenticated
  using (public.m1_school_admin_sees_question(question_id));

-- storage.objects (reading-materials bucket; the first folder is the uploader's user id)
drop policy "M3 owners and admins read reading material objects" on storage.objects;
create policy "M3 owners and admins read reading material objects" on storage.objects for select to authenticated
  using ((bucket_id = 'reading-materials'::text)
    and (public.m1_school_admin_sees_storage_owner((storage.foldername(name))[1])
      or ((public.m3_current_role() = any (array['teacher'::text, 'general_user'::text]))
        and ((storage.foldername(name))[1] = (auth.uid())::text))));
drop policy "M3 owners and admins delete reading material objects" on storage.objects;
create policy "M3 owners and admins delete reading material objects" on storage.objects for delete to authenticated
  using ((bucket_id = 'reading-materials'::text)
    and (public.m1_school_admin_sees_storage_owner((storage.foldername(name))[1])
      or ((public.m3_current_role() = any (array['teacher'::text, 'general_user'::text]))
        and ((storage.foldername(name))[1] = (auth.uid())::text)))
    and public.m3_storage_object_is_deletable(name));

commit;
