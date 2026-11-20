-- M1 Minimum Viable Multi-Tenancy (Appendix N F7-F11) -- PROPOSED. NOT APPLIED. Requires explicit approval.
--
-- One database, many schools. Ownership is normalized: a school is recorded ONCE per account (profiles.school_id) and
-- on the two invitation records that create school accounts. Every other school-owned row (Learning Rooms,
-- enrollments, room assignments, modules, materials, assessment packages, results) belongs to the school of the account
-- that owns it (rooms.teacher_id, modules.created_by, m2_assessment_packages.owner_id, diagnostic_results.user_id ...).
-- No school_id is copied into those tables, so they can never disagree with their owner.
--
-- What this changes
--   1. public.schools (name, unique code, status active/inactive, is_legacy) + public.m1_school_events (audit).
--      Schools are never deleted (trigger + no grant); nothing references them with ON DELETE CASCADE.
--   2. profiles.school_id (FK ON DELETE RESTRICT). Rules (CHECK): System Admins and Independent Learners never have a
--      school; School Admins and Teachers always have one; a Student gets one from the first Learning Room they join.
--      Once set it never changes (trigger) and the browser can never set it (existing protection trigger, extended).
--   3. School 1 (is_legacy): the existing single school. Backfill: every School Admin, Teacher and Student -> School 1;
--      every Teacher invitation code and School Admin invitation -> School 1. System Admins, Independent Learners and
--      role-less accounts are NOT assigned (reported by the VERIFY script).
--   4. School-aware flows: Teacher invitation codes belong to a school and give the redeeming Teacher that school
--      (F10); Teacher approval only inside the School Admin's school (F11); School Admin invitations name a school and
--      acceptance assigns it (F9); joining a Learning Room binds/checks the Student's school; deactivate/reactivate
--      (F7): System Admin for every non-System-Admin account, School Admin only inside their school.
--   5. Database isolation for direct browser access (RLS) and SECURITY DEFINER RPCs:
--      - restrictive policies "M1 school isolation" (AND with every existing policy): a signed-in account that has a
--        school never sees or writes another school's rows. Accounts without a school (System Admin, Independent
--        Learner, a Student before joining a room) are unaffected: the check is true for them.
--      - write guards (triggers) on the classroom/content tables, because SECURITY DEFINER RPCs bypass RLS.
--      - the School Admin helper functions (m1_school_admin_sees_*, m4_admin_classroom_teachers, m3_trashed_modules,
--        m3_module_revisions, m3_can_manage_module, m5_can_read_activity) are limited to the caller's school.
--      - m3_collection_publish_issues authorizes itself first (unknown id and other school's module: same refusal).
--   The backend uses the service role (bypasses RLS); its school checks are in server/services/schoolScope.js.
--
-- Not changed: Modules 2-8 logic, scores, M2 switches, user ids, existing rows other than the backfilled school_id.
-- Rollback: m1_multi_tenancy_ROLLBACK_PROPOSED.sql (refuses once a second school exists).

begin;
set local lock_timeout = '5s';
lock table public.profiles in share row exclusive mode;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Schools
create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = btrim(name) and length(name) between 2 and 120),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{0,30}[A-Z0-9]$'),
  status text not null default 'active' check (status in ('active', 'inactive')),
  is_legacy boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index schools_code_key on public.schools (code);
create unique index schools_name_key on public.schools (lower(name));
create unique index schools_one_legacy_key on public.schools (is_legacy) where is_legacy;

create table public.m1_school_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  actor_id uuid,
  action text not null check (action in ('created', 'renamed', 'activated', 'deactivated', 'legacy_backfill')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create function public.m1_guard_school_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Schools are never deleted; set the school to inactive instead' using errcode = '42501';
end $$;
create trigger m1_schools_never_deleted before delete on public.schools for each row execute function public.m1_guard_school_delete();
create trigger m1_school_events_never_deleted before delete on public.m1_school_events for each row execute function public.m1_guard_school_delete();

-- ---------------------------------------------------------------------------------------------------------------
-- 2. One primary school per School Admin, Teacher and school Student
alter table public.profiles add column school_id uuid references public.schools(id) on delete restrict;
create index profiles_school_id_idx on public.profiles (school_id) where school_id is not null;

-- 3. School 1 = the existing single school, and its backfill (only school-related accounts and records)
insert into public.schools (name, code, status, is_legacy) values ('School 1', 'SCHOOL-1', 'active', true);
update public.profiles set school_id = (select id from public.schools where is_legacy)
  where role in ('admin', 'teacher', 'student') and school_id is null;
insert into public.m1_school_events (school_id, action, detail)
  select id, 'legacy_backfill', jsonb_build_object(
    'school_admins', (select count(*) from public.profiles where school_id = s.id and role = 'admin'),
    'teachers', (select count(*) from public.profiles where school_id = s.id and role = 'teacher'),
    'students', (select count(*) from public.profiles where school_id = s.id and role = 'student'))
  from public.schools s where is_legacy;

alter table public.profiles add constraint profiles_school_role_check check (
  (role in ('system_admin', 'general_user') and school_id is null)
  or (role in ('admin', 'teacher') and school_id is not null)
  or role = 'student'
  or (role is null and school_id is null)
);
grant select (school_id) on public.profiles to authenticated;

alter table public.teacher_invite_codes add column school_id uuid references public.schools(id) on delete restrict;
update public.teacher_invite_codes set school_id = (select id from public.schools where is_legacy) where school_id is null;
alter table public.teacher_invite_codes alter column school_id set not null;
create index teacher_invite_codes_school_idx on public.teacher_invite_codes (school_id);

alter table public.m1_school_admin_invitations add column school_id uuid references public.schools(id) on delete restrict;
update public.m1_school_admin_invitations set school_id = (select id from public.schools where is_legacy) where school_id is null;
alter table public.m1_school_admin_invitations alter column school_id set not null;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. School helpers (STABLE, SECURITY DEFINER, read profiles only)
create function public.m1_current_school()
returns uuid language sql stable security definer set search_path = '' as $$
  select school_id from public.profiles where id = auth.uid();
$$;
create function public.m1_school_of(p_user uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select school_id from public.profiles where id = p_user;
$$;
-- True unless the signed-in account has a school AND the owner belongs to a different school. Owners without a school
-- (System Admin content, Independent Learners, missing rows) are left to the existing policies, unchanged.
-- Requests without a signed-in user (service role, migrations) are left to the backend's own checks.
create function public.m1_school_visible(p_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is null or p_owner is null
    or not exists (
      select 1 from public.profiles me join public.profiles owner_row on owner_row.id = p_owner
      where me.id = auth.uid() and me.school_id is not null and owner_row.school_id is not null
        and owner_row.school_id <> me.school_id);
$$;
create function public.m1_room_visible(p_room uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.m1_school_visible((select teacher_id from public.rooms where id = p_room));
$$;
create function public.m1_module_visible(p_module uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.m1_school_visible((select created_by from public.modules where id = p_module));
$$;
create function public.m1_material_visible(p_material uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.m1_school_visible((select uploaded_by from public.uploaded_materials where id = p_material));
$$;
create function public.m1_question_visible(p_question uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select public.m1_material_visible(q.material_id) and public.m1_module_visible(q.module_id)
                   from public.comprehension_questions q where q.id = p_question), true);
$$;
revoke all on function public.m1_current_school(), public.m1_school_of(uuid), public.m1_school_visible(uuid),
  public.m1_room_visible(uuid), public.m1_module_visible(uuid), public.m1_material_visible(uuid),
  public.m1_question_visible(uuid) from public, anon;
grant execute on function public.m1_current_school(), public.m1_school_visible(uuid), public.m1_room_visible(uuid),
  public.m1_module_visible(uuid), public.m1_material_visible(uuid), public.m1_question_visible(uuid) to authenticated, service_role;
grant execute on function public.m1_school_of(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Profile protection: the browser never sets school_id; a school, once set, never changes.
create or replace function public.m1_protect_profile_authorization_fields()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and (
    new.id is distinct from old.id or new.role is distinct from old.role
    or new.status is distinct from old.status or new.created_at is distinct from old.created_at
    or new.teacher_status is distinct from old.teacher_status
    or new.school_id is distinct from old.school_id
  ) then
    raise exception 'profile authorization fields are server-managed' using errcode = '42501';
  end if;
  return new;
end $$;

create function public.m1_guard_profile_school()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.school_id is not null and new.school_id is distinct from old.school_id then
    raise exception 'm1_school_fixed: an account''s school cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger m1_profile_school_fixed before insert or update of school_id on public.profiles
  for each row execute function public.m1_guard_profile_school();

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Learning Rooms: a Student joins only rooms of their own school; the first room gives a Student their school.
create function public.m1_bind_enrollment_school()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_room_school uuid; v_room_status text; v_student record;
begin
  select p.school_id, s.status into v_room_school, v_room_status
    from public.rooms r join public.profiles p on p.id = r.teacher_id left join public.schools s on s.id = p.school_id
    where r.id = new.room_id;
  if v_room_school is null then return new; end if;
  select id, role, school_id into v_student from public.profiles where id = new.student_id for update;
  if not found then return new; end if;
  if v_student.school_id is null then
    if v_student.role is distinct from 'student' then return new; end if;   -- existing role rules decide
    if v_room_status <> 'active' then
      raise exception 'm1_school_inactive: this classroom''s school is not active' using errcode = '42501';
    end if;
    update public.profiles set school_id = v_room_school where id = new.student_id and school_id is null;
  elsif v_student.school_id <> v_room_school then
    raise exception 'm1_cross_school_enrollment: this classroom belongs to a different school' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger m1_enrollment_school before insert or update of room_id, student_id on public.enrollments
  for each row execute function public.m1_bind_enrollment_school();

-- A room keeps its school: its Teacher can only be replaced by a Teacher of the same school.
create function public.m1_guard_room_school()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old uuid; v_new uuid;
begin
  if new.teacher_id is not distinct from old.teacher_id then return new; end if;
  v_old := public.m1_school_of(old.teacher_id); v_new := public.m1_school_of(new.teacher_id);
  if v_old is not null and v_new is distinct from v_old then
    raise exception 'm1_cross_school: a Learning Room cannot move to another school' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger m1_room_school_fixed before update of teacher_id on public.rooms
  for each row execute function public.m1_guard_room_school();

-- Write guard for SECURITY DEFINER RPCs (which bypass RLS): a signed-in account with a school never writes another
-- school's rows. Arguments: owner kind ('profile' | 'room' | 'module') and the column holding the owner reference.
create function public.m1_guard_school_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_mine uuid; v_row jsonb; v_ref uuid; v_school uuid;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  select school_id into v_mine from public.profiles where id = auth.uid();
  if v_mine is null then return coalesce(new, old); end if;
  foreach v_row in array array[case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end] loop
    continue when v_row is null;
    v_ref := nullif(v_row ->> tg_argv[1], '')::uuid;
    continue when v_ref is null;
    v_school := case tg_argv[0]
      when 'profile' then (select school_id from public.profiles where id = v_ref)
      when 'room' then (select p.school_id from public.rooms r join public.profiles p on p.id = r.teacher_id where r.id = v_ref)
      when 'module' then (select p.school_id from public.modules m join public.profiles p on p.id = m.created_by where m.id = v_ref)
    end;
    if v_school is not null and v_school <> v_mine then
      raise exception 'm1_cross_school: this record belongs to a different school' using errcode = '42501';
    end if;
  end loop;
  return coalesce(new, old);
end $$;
create trigger m1_school_write_guard before insert or update or delete on public.rooms
  for each row execute function public.m1_guard_school_write('profile', 'teacher_id');
create trigger m1_school_write_guard before insert or update or delete on public.enrollments
  for each row execute function public.m1_guard_school_write('room', 'room_id');
create trigger m1_school_write_guard before insert or update or delete on public.room_modules
  for each row execute function public.m1_guard_school_write('room', 'room_id');
create trigger m1_school_write_guard before insert or update or delete on public.room_module_recipients
  for each row execute function public.m1_guard_school_write('profile', 'student_id');
create trigger m1_school_write_guard before insert or update or delete on public.reading_activity_assignments
  for each row execute function public.m1_guard_school_write('room', 'room_id');
create trigger m1_school_write_guard before insert or update or delete on public.modules
  for each row execute function public.m1_guard_school_write('profile', 'created_by');
-- A revision copies its source module: never another school's module (m3_revise_module).
create trigger m1_school_write_guard_revision before insert or update of revision_of on public.modules
  for each row execute function public.m1_guard_school_write('module', 'revision_of');
create trigger m1_school_write_guard before insert or update or delete on public.module_passages
  for each row execute function public.m1_guard_school_write('module', 'module_id');
create trigger m1_school_write_guard before insert or update or delete on public.m3_module_trash
  for each row execute function public.m1_guard_school_write('module', 'module_id');
create trigger m1_school_write_guard before insert or update or delete on public.uploaded_materials
  for each row execute function public.m1_guard_school_write('profile', 'uploaded_by');

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Restrictive RLS (AND with every existing policy; grants nothing new)
create policy "M1 school isolation" on public.profiles as restrictive for all to authenticated
  using (public.m1_school_visible(id)) with check (public.m1_school_visible(id));
create policy "M1 school isolation" on public.rooms as restrictive for all to authenticated
  using (public.m1_school_visible(teacher_id)) with check (public.m1_school_visible(teacher_id));
create policy "M1 school isolation" on public.enrollments as restrictive for all to authenticated
  using (public.m1_room_visible(room_id)) with check (public.m1_room_visible(room_id));
create policy "M1 school isolation" on public.room_modules as restrictive for all to authenticated
  using (public.m1_room_visible(room_id)) with check (public.m1_room_visible(room_id));
create policy "M1 school isolation" on public.room_module_recipients as restrictive for all to authenticated
  using (public.m1_school_visible(student_id)) with check (public.m1_school_visible(student_id));
create policy "M1 school isolation" on public.reading_activity_assignments as restrictive for all to authenticated
  using (public.m1_room_visible(room_id)) with check (public.m1_room_visible(room_id));
create policy "M1 school isolation" on public.m4_admin_actions as restrictive for all to authenticated
  using (public.m1_room_visible(room_id)) with check (public.m1_room_visible(room_id));
create policy "M1 school isolation" on public.modules as restrictive for all to authenticated
  using (public.m1_school_visible(created_by)) with check (public.m1_school_visible(created_by));
create policy "M1 school isolation" on public.module_passages as restrictive for all to authenticated
  using (public.m1_module_visible(module_id)) with check (public.m1_module_visible(module_id));
create policy "M1 school isolation" on public.m3_module_trash as restrictive for all to authenticated
  using (public.m1_module_visible(module_id)) with check (public.m1_module_visible(module_id));
create policy "M1 school isolation" on public.uploaded_materials as restrictive for all to authenticated
  using (public.m1_school_visible(uploaded_by)) with check (public.m1_school_visible(uploaded_by));
create policy "M1 school isolation" on public.material_question_sets as restrictive for all to authenticated
  using (public.m1_material_visible(material_id)) with check (public.m1_material_visible(material_id));
create policy "M1 school isolation" on public.comprehension_questions as restrictive for all to authenticated
  using (public.m1_material_visible(material_id) and public.m1_module_visible(module_id))
  with check (public.m1_material_visible(material_id) and public.m1_module_visible(module_id));
create policy "M1 school isolation" on public.comprehension_question_answers as restrictive for all to authenticated
  using (public.m1_question_visible(question_id)) with check (public.m1_question_visible(question_id));
create policy "M1 school isolation" on public.oral_reading_attempts as restrictive for all to authenticated
  using (public.m1_school_visible(user_id) and public.m1_module_visible(module_id))
  with check (public.m1_school_visible(user_id) and public.m1_module_visible(module_id));
create policy "M1 school isolation" on public.diagnostic_results as restrictive for all to authenticated
  using (public.m1_school_visible(user_id)) with check (public.m1_school_visible(user_id));

alter table public.schools enable row level security;
alter table public.m1_school_events enable row level security;
revoke all on public.schools, public.m1_school_events from public, anon, authenticated;
grant select on public.schools to authenticated;
grant all on public.schools, public.m1_school_events to service_role;
create policy "M1 members read their school" on public.schools for select to authenticated
  using (id = public.m1_current_school() or public.is_system_admin());

-- ---------------------------------------------------------------------------------------------------------------
-- 8. School Admin helpers limited to the caller's school
create or replace function public.m1_school_admin_sees_owner(owner_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.m3_current_role() = 'admin'
    and not exists (select 1 from public.profiles p where p.id = owner_id and p.role = 'general_user')
    and public.m1_school_visible(owner_id);
$$;
create or replace function public.m1_school_admin_sees_material(target_material_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.m3_current_role() = 'admin'
    and not exists (
      select 1 from public.uploaded_materials m join public.profiles p on p.id = m.uploaded_by
      where m.id = target_material_id and p.role = 'general_user')
    and public.m1_material_visible(target_material_id);
$$;
create or replace function public.m1_school_admin_sees_question(target_question_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.m3_current_role() = 'admin'
    and not exists (
      select 1 from public.comprehension_questions q
        join public.uploaded_materials m on m.id = q.material_id
        join public.profiles p on p.id = m.uploaded_by
      where q.id = target_question_id and p.role = 'general_user')
    and public.m1_question_visible(target_question_id);
$$;
create or replace function public.m1_school_admin_sees_storage_owner(owner_folder text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.m3_current_role() = 'admin'
    and not exists (select 1 from public.profiles p where p.id::text = owner_folder and p.role = 'general_user')
    and public.m1_school_visible(case when owner_folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then owner_folder::uuid end);
$$;

create or replace function public.m4_admin_classroom_teachers()
returns table(id uuid, display_name text) language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access is required.';
  end if;
  return query
    select p.id, coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.nickname), ''), 'Teacher')
    from public.profiles p
    where p.role = 'teacher' and p.teacher_status = 'approved' and p.school_id = public.m1_current_school()
    order by 2, 1;
end
$$;

create or replace function public.m3_trashed_modules()
returns table(id uuid, title text, status_before text, trashed_at timestamptz, trashed_by_name text, ever_published boolean, has_history boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  -- Approved Teachers see only the modules they created AND moved to the Trash; everyone else needs Admin.
  if public.m3_module_author_role() is distinct from 'teacher' then perform public.m3_require_admin(); end if;
  return query
    select m.id, m.title, coalesce(t.status_before, m.status), coalesce(t.trashed_at, m.deleted_at),
      coalesce(nullif(p.full_name, ''), nullif(p.nickname, ''), 'Admin'),
      m.published_at is not null, public.m3_deletion_has_history(m.id)
    from public.modules m
    left join public.m3_module_trash t on t.module_id = m.id
    left join public.profiles p on p.id = t.trashed_by
    where m.deleted_at is not null
      and (public.m3_module_author_role() = 'admin' or (t.trashed_by = auth.uid() and m.created_by = auth.uid()))
      and public.m1_school_visible(m.created_by)
    order by coalesce(t.trashed_at, m.deleted_at) desc;
end $$;

create or replace function public.m3_module_revisions(target_id uuid)
returns table(id uuid, title text, status text, revision_number integer, revision_of uuid, published_at timestamptz, created_at timestamptz, in_trash boolean)
language plpgsql stable security definer set search_path = '' as $$
declare root uuid;
begin
  if auth.uid() is null or public.m3_module_author_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Admin access is required';
  end if;
  select coalesce(m.revision_root, m.id) into root from public.modules m where m.id = target_id;
  if not public.m1_module_visible(root) then
    raise exception using errcode = '42501', message = 'Admin access is required';
  end if;
  return query
    select m.id, m.title, m.status, coalesce(m.revision_number, 1), m.revision_of, m.published_at, m.created_at, m.deleted_at is not null
    from public.modules m where (m.id = root or m.revision_root = root) and public.m1_school_visible(m.created_by)
    order by coalesce(m.revision_number, 1);
end $$;

create or replace function public.m3_can_manage_module(target_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case public.m3_module_author_role()
    when 'admin' then public.m1_module_visible(target_id)
    when 'teacher' then exists (
      select 1 from public.modules as module_row
      where module_row.id = target_id and module_row.created_by = auth.uid()
    )
    else false
  end
$$;

-- M3 publish readiness (callable by signed-in accounts). It now authorizes on its own, before reading anything:
-- the module must exist and the caller must be able to manage it (owner Teacher, or an Admin of the author's
-- school; the System Admin keeps platform access). Another school's module and an unknown id get the SAME error,
-- so the answer never reveals whether another school's module exists. Body otherwise unchanged.
create or replace function public.m3_collection_publish_issues(target_id uuid)
returns text[] language plpgsql security definer set search_path = '' as $$
declare issues text[]; p record; category text; total integer;
begin
  if not exists (select 1 from public.modules where id = target_id) or not public.m3_can_manage_module(target_id) then
    raise exception 'Module owner or Admin access required';
  end if;
  -- Keep title/text/review/answer-key checks from the original readiness function.
  issues := public.m3_collection_publish_issues_phase1(target_id);
  for p in select id, display_order from public.module_passages where module_id = target_id loop
    select count(*) into total from public.comprehension_questions where passage_id = p.id;
    if total not in (6, 9, 12) then
      issues := array_append(issues, format('Passage %s requires 6, 9 or 12 questions', p.display_order));
    else
      foreach category in array array['literal','inferential','critical'] loop
        if (select count(*) from public.comprehension_questions where passage_id = p.id and question_type = category) <> total / 3 then
          issues := array_append(issues, format('Passage %s requires exactly %s %s questions', p.display_order, total / 3, category));
        end if;
      end loop;
    end if;
  end loop;
  return issues;
end; $$;

create or replace function public.m5_can_read_activity(r uuid, s uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and (
    (p.role='admin' and public.m1_room_visible(r)) or
    (p.role='student' and p.id=s and exists(select 1 from public.enrollments e where e.room_id=r and e.student_id=p.id)) or
    (p.role='teacher' and p.teacher_status='approved' and exists(select 1 from public.rooms room where room.id=r and room.teacher_id=p.id))
  ));
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 9. F10 Teacher invitation codes belong to a school; F11 approval only inside the School Admin's school.
create or replace function public.register_teacher_with_invite(invite_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare code_row public.teacher_invite_codes%rowtype; attempt_row public.teacher_invite_attempts%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null
  ) then raise exception 'Verify your email before selecting Teacher.' using errcode = '42501'; end if;
  -- Serializes concurrent submissions by the same user before consuming a code.
  perform 1 from public.profiles where id = auth.uid() and role is null for update;
  if not found then raise exception 'role has already been assigned' using errcode = '23514'; end if;
  insert into public.teacher_invite_attempts(user_id) values(auth.uid()) on conflict do nothing;
  select * into attempt_row from public.teacher_invite_attempts where user_id = auth.uid() for update;
  if attempt_row.window_start <= now() - interval '15 minutes' then
    update public.teacher_invite_attempts set window_start = now(), attempts = 0 where user_id = auth.uid();
    attempt_row.attempts := 0;
  end if;
  if attempt_row.attempts >= 5 then return false; end if;
  update public.teacher_invite_attempts set attempts = attempts + 1 where user_id = auth.uid();
  -- Return false (not an exception) so failed-attempt accounting commits.
  if invite_code is null or length(btrim(invite_code)) not between 16 and 256 then return false; end if;
  select * into code_row from public.teacher_invite_codes
    where code_hash = encode(sha256(convert_to(btrim(invite_code), 'UTF8')), 'hex') for update;
  if not found or not code_row.active or code_row.expires_at <= now()
    or (code_row.max_uses is not null and code_row.use_count >= code_row.max_uses) then return false; end if;
  -- M1 multi-tenancy: the code's school must be active; the Teacher joins that school.
  if not exists (select 1 from public.schools where id = code_row.school_id and status = 'active') then return false; end if;
  update public.profiles set role = 'teacher', teacher_status = 'pending', school_id = code_row.school_id where id = auth.uid();
  update public.teacher_invite_codes set use_count = use_count + 1 where id = code_row.id;
  return true;
end $$;

create or replace function public.review_teacher_registration(target_user uuid, decision text)
returns text language plpgsql security definer set search_path = '' as $$
declare result text; v_school uuid;
begin
  select school_id into v_school from public.profiles where id = auth.uid() and role = 'admin';
  if not found then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  if decision is null or decision not in ('approved','rejected') then
    raise exception 'Invalid Teacher review decision.' using errcode = '22023';
  end if;
  -- M1 multi-tenancy: only Teachers of the School Admin's own school (same answer for every other id).
  update public.profiles set teacher_status = decision
    where id = target_user and role = 'teacher' and teacher_status = 'pending'
      and nullif(btrim(full_name), '') is not null
      and v_school is not null and school_id = v_school
    returning teacher_status into result;
  if result is null then
    raise exception 'Teacher is no longer pending or has not completed their profile.' using errcode = '40001';
  end if;
  return result;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 10. F9 School Admin invitations name a school; acceptance assigns it.
drop function public.m1_create_school_admin_invitation(uuid, uuid, text, text, text, text, text, text, integer);
create function public.m1_create_school_admin_invitation(p_actor uuid, p_user uuid, p_email text, p_full_name text,
  p_reference text, p_method text, p_position text, p_note text default null, p_valid_days integer default 7,
  p_school uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$  -- definer: reads auth.users; service_role-only
declare v_id uuid; v_email text := lower(btrim(p_email)); v_name text := regexp_replace(btrim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
begin
  if not public.m1_is_active_system_admin(p_actor) then raise exception 'm1_invite_actor_not_system_admin'; end if;
  if p_valid_days is null or p_valid_days not between 1 and 14 then raise exception 'm1_invite_invalid_validity'; end if;
  if length(v_name) not between 1 and 100 then raise exception 'm1_invite_invalid_name'; end if;
  if p_school is null then raise exception 'm1_invite_school_required'; end if;
  perform 1 from public.schools where id = p_school and status = 'active' for share;
  if not found then raise exception 'm1_invite_school_inactive'; end if;
  perform 1 from public.profiles where id = p_user and role is null and status = 'active' and school_id is null for update;
  if not found then raise exception 'm1_invite_target_not_unassigned'; end if;
  if not exists (select 1 from auth.users where id = p_user and lower(email) = v_email) then raise exception 'm1_invite_email_mismatch'; end if;
  if exists (select 1 from public.m1_school_admin_invitations where user_id = p_user) then raise exception 'm1_invite_duplicate'; end if;
  update public.profiles set full_name = v_name where id = p_user;
  insert into public.m1_school_admin_invitations (user_id, email, authorized_by, authorization_reference, confirmation_method,
      authorizing_position, note, expires_at, school_id)
    values (p_user, v_email, p_actor, btrim(p_reference), p_method, btrim(p_position), nullif(btrim(coalesce(p_note, '')), ''),
      now() + make_interval(days => p_valid_days), p_school)
    returning id into v_id;
  insert into public.m1_school_admin_invitation_events (invitation_id, target_id, actor_id, action) values (v_id, p_user, p_actor, 'authorized');
  return v_id;
end $$;
revoke all on function public.m1_create_school_admin_invitation(uuid, uuid, text, text, text, text, text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.m1_create_school_admin_invitation(uuid, uuid, text, text, text, text, text, text, integer, uuid) to service_role;

create or replace function public.m1_accept_school_admin_invitation(p_user uuid, p_link_at timestamp with time zone)
returns text language plpgsql security definer set search_path = '' as $$  -- definer: reads auth.users; service_role-only
declare v_row public.m1_school_admin_invitations; v_auth record;
begin
  select * into v_row from public.m1_school_admin_invitations where user_id = p_user for update;
  if not found then raise exception 'm1_invite_none'; end if;
  if v_row.status = 'accepted' then raise exception 'm1_invite_already_accepted'; end if;
  if v_row.status = 'cancelled' then raise exception 'm1_invite_cancelled'; end if;
  if now() >= v_row.expires_at then raise exception 'm1_invite_expired'; end if;
  if v_row.last_sent_at is null or p_link_at is null or p_link_at < v_row.last_sent_at - interval '5 seconds' or p_link_at > now() + interval '1 minute' then
    raise exception 'm1_invite_link_not_current';
  end if;
  select email, email_confirmed_at, coalesce(encrypted_password, '') <> '' as has_password, banned_until into v_auth from auth.users where id = p_user;
  if not found or lower(v_auth.email) <> v_row.email then raise exception 'm1_invite_email_mismatch'; end if;
  if v_auth.email_confirmed_at is null then raise exception 'm1_invite_email_unconfirmed'; end if;
  if not v_auth.has_password then raise exception 'm1_invite_password_not_set'; end if;
  if v_auth.banned_until is not null and v_auth.banned_until > now() then raise exception 'm1_invite_cancelled'; end if;
  if not exists (select 1 from public.schools where id = v_row.school_id and status = 'active') then raise exception 'm1_invite_school_inactive'; end if;
  perform 1 from public.profiles where id = p_user and role is null and status = 'active' and school_id is null for update;
  if not found then raise exception 'm1_invite_target_not_unassigned'; end if;

  perform set_config('m1.school_admin_activation', p_user::text, true);
  update public.profiles set role = 'admin', school_id = v_row.school_id where id = p_user and role is null;
  perform set_config('m1.school_admin_activation', '', true);
  update public.m1_school_admin_invitations set status = 'accepted', accepted_at = now() where id = v_row.id;
  insert into public.m1_school_admin_invitation_events (invitation_id, target_id, actor_id, action)
    values (v_row.id, p_user, p_user, 'accepted'), (v_row.id, p_user, null, 'role_activated');
  return 'admin';
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 11. F7 Deactivate/Reactivate: System Admin for every non-System-Admin account (all schools); School Admin only for
--     Teachers and Students of their own school. Records are never deleted.
create or replace function public.m1_set_account_status(p_actor uuid, p_target uuid, p_status text)
returns text language plpgsql set search_path = '' as $$
declare
  v_actor_role text;
  v_actor_school uuid;
  v_target_role text;
  v_target_school uuid;
  v_old text;
begin
  if p_status is null or p_status not in ('active', 'inactive') then
    raise exception 'm1_invalid_status';
  end if;
  if p_actor is null or p_target is null or p_actor = p_target then
    raise exception 'm1_target_missing';
  end if;

  select role, school_id into v_actor_role, v_actor_school from public.profiles where id = p_actor and status = 'active';
  if v_actor_role is null or v_actor_role not in ('system_admin', 'admin') then
    raise exception 'm1_actor_not_manager';
  end if;

  select role, status, school_id into v_target_role, v_old, v_target_school from public.profiles where id = p_target for update;
  if not found or not (
       (v_actor_role = 'system_admin' and v_target_role in ('general_user', 'admin', 'teacher', 'student'))
    or (v_actor_role = 'admin' and v_target_role in ('teacher', 'student')
        and v_actor_school is not null and v_target_school = v_actor_school)
  ) then
    raise exception 'm1_target_missing';
  end if;

  -- Defense in depth: System Admin accounts are outside every scope above, but never leave zero active System Admins.
  if p_status = 'inactive' and v_target_role = 'system_admin' then
    perform pg_advisory_xact_lock(hashtext('m1_system_admin_status'));
    if not exists (select 1 from public.profiles where role = 'system_admin' and status = 'active' and id <> p_target) then
      raise exception 'm1_last_system_admin';
    end if;
  end if;

  if v_old is distinct from p_status then
    update public.profiles set status = p_status where id = p_target;
  end if;
  -- Every administrator action is recorded, including a retry that reconciles Supabase Auth after a partial failure.
  insert into public.m1_account_status_events (target_id, target_role, actor_id, actor_role, action, status_changed)
  values (p_target, v_target_role, p_actor, v_actor_role,
          case when p_status = 'inactive' then 'deactivate' else 'reactivate' end, v_old is distinct from p_status);
  return v_old;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 12. F8 Create School / update name or status (System Admin only; the backend calls these with the service role).
create function public.m1_create_school(p_actor uuid, p_name text, p_code text, p_status text default 'active')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'); v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if not public.m1_is_active_system_admin(p_actor) then raise exception 'm1_school_actor_not_system_admin'; end if;
  if length(v_name) not between 2 and 120 then raise exception 'm1_school_invalid_name'; end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{0,30}[A-Z0-9]$' then raise exception 'm1_school_invalid_code'; end if;
  if coalesce(p_status, '') not in ('active', 'inactive') then raise exception 'm1_school_invalid_status'; end if;
  if exists (select 1 from public.schools where code = v_code) then raise exception 'm1_school_duplicate_code'; end if;
  if exists (select 1 from public.schools where lower(name) = lower(v_name)) then raise exception 'm1_school_duplicate_name'; end if;
  begin
    insert into public.schools (name, code, status, created_by) values (v_name, v_code, p_status, p_actor) returning id into v_id;
  exception when unique_violation then
    raise exception 'm1_school_duplicate_code';
  end;
  insert into public.m1_school_events (school_id, actor_id, action, detail)
    values (v_id, p_actor, 'created', jsonb_build_object('name', v_name, 'code', v_code, 'status', p_status));
  return v_id;
end $$;

create function public.m1_update_school(p_actor uuid, p_school uuid, p_name text default null, p_status text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_row public.schools; v_name text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
begin
  if not public.m1_is_active_system_admin(p_actor) then raise exception 'm1_school_actor_not_system_admin'; end if;
  select * into v_row from public.schools where id = p_school for update;
  if not found then raise exception 'm1_school_missing'; end if;
  if v_name is not null and v_name is distinct from v_row.name then
    if length(v_name) not between 2 and 120 then raise exception 'm1_school_invalid_name'; end if;
    if exists (select 1 from public.schools where lower(name) = lower(v_name) and id <> p_school) then raise exception 'm1_school_duplicate_name'; end if;
    update public.schools set name = v_name, updated_at = now() where id = p_school;
    insert into public.m1_school_events (school_id, actor_id, action, detail) values (p_school, p_actor, 'renamed', jsonb_build_object('from', v_row.name, 'to', v_name));
  end if;
  if p_status is not null and p_status is distinct from v_row.status then
    if p_status not in ('active', 'inactive') then raise exception 'm1_school_invalid_status'; end if;
    update public.schools set status = p_status, updated_at = now() where id = p_school;
    insert into public.m1_school_events (school_id, actor_id, action) values (p_school, p_actor, case when p_status = 'active' then 'activated' else 'deactivated' end);
  end if;
  return coalesce(p_status, v_row.status);
end $$;

revoke all on function public.m1_create_school(uuid, text, text, text), public.m1_update_school(uuid, uuid, text, text),
  public.m1_guard_school_write(), public.m1_bind_enrollment_school(), public.m1_guard_room_school(),
  public.m1_guard_profile_school(), public.m1_guard_school_delete() from public, anon, authenticated;
grant execute on function public.m1_create_school(uuid, text, text, text), public.m1_update_school(uuid, uuid, text, text) to service_role;

commit;
