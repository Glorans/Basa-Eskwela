-- ============================================================================
-- PROPOSED - NOT APPLIED. Do not run without explicit approval.
-- M4: Admin classroom management (Admin creates a room for an approved Teacher, edits it,
-- assigns/removes reading modules). Module 4 objects only.
-- ============================================================================
--
-- Ownership model (unchanged): every room has exactly one owner, rooms.teacher_id, an approved Teacher.
-- M5, M6, M7 and M8 rely on it, so:
--   * An Admin-created room is OWNED by the Teacher the Admin selects. The Admin is recorded as the
--     creator in m4_admin_actions (action create_room, actor_id = the Admin, teacher_id = the owner).
--   * An Admin module assignment keeps room_modules.assigned_by = the room's Teacher (the value M4
--     learner visibility and M6 completion require); the Admin is the audited actor (assign_module).
--   * Admin removal/restore of a module sets removed_by = the Admin (the real actor) and is audited.
-- No enrollment is ever created for an Admin or a Teacher. No existing room, code, enrollment,
-- assignment or learner record is changed. No M1/M3/M5/M6/M7/M8 object is touched.
--
-- Changes:
--   1. m4_admin_actions: student_id nullable; new nullable teacher_id / room_module_id (no foreign keys,
--      so audit rows never block account deletion); allowed actions widened; per-action shape check.
--   2. new m4_admin_classroom_teachers()   Admin-only list of APPROVED Teachers (id + display name).
--   3. new m4_admin_create_room(...)       Admin-only; owner must be an approved Teacher; same validation
--      as the Teacher form (name + English/Filipino subject); room code from the existing client
--      generator, format re-checked here and unique by the existing constraint.
--   4. new m4_admin_update_room(...)       Admin-only; name/section/description only (never owner,
--      code or subject); archived rooms stay locked by the existing trigger.
--   5. m4_assign_module                    + Admin branch (see above); Teacher path unchanged.
--   6. m4_unassign_module                  + Admin branch; Teacher path unchanged.
--   7. m4_admin_classroom_actions          lists the new Admin actions.
-- Not included: Admin reading-activity assignment (F7). It is authorized by M5/M6 rules
-- (m5_can_assign_activity, m6_check_activity_question_set) that require the assigning Teacher's own
-- materials; an M4-only change would have to bypass them.
--
-- Fingerprints: md5 of pg_get_functiondef with CR removed. Preflight first (read-only):
-- supabase/tests/m4_admin_room_management_preflight.sql

begin;
set local lock_timeout = '5s';

do $guard$
declare item record; found_md5 text;
begin
  for item in select * from (values
    ('public.m4_assign_module(uuid,uuid,text,uuid[],timestamptz)', '970dec9a9d96b30aa3f5671d2008ce17'),
    ('public.m4_unassign_module(uuid,boolean)', '43ef9941420a770cf4b74a40b1ed2489'),
    ('public.m4_admin_classroom_actions()', '17a1d55db25c55e849535e80ed4c32b8'),
    ('public.m4_admin_remove_enrollment(uuid)', '5ae5e9b42aa1720c5b0c8c5672834e6d')
  ) as expected(signature, md5) loop
    if to_regprocedure(item.signature) is null then
      raise exception '% is missing; stop and re-review', item.signature;
    end if;
    found_md5 := md5(replace(pg_get_functiondef(item.signature::regprocedure), chr(13), ''));
    if found_md5 is distinct from item.md5 then
      raise exception '% differs from the reviewed definition (found %); stop and re-review', item.signature, found_md5;
    end if;
  end loop;
  if to_regprocedure('public.m4_admin_create_room(uuid,text,text,text,text,text)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public'
                and table_name = 'm4_admin_actions' and column_name = 'teacher_id') then
    raise exception 'M4 Admin room management is already installed; nothing to do';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'm4_admin_actions_action_check'
      and conrelid = 'public.m4_admin_actions'::regclass) is distinct from 'CHECK ((action = ''remove_enrollment''::text))' then
    raise exception 'm4_admin_actions action check differs from the reviewed definition; stop and re-review';
  end if;
end
$guard$;

-- 1. Audit table.
alter table public.m4_admin_actions alter column student_id drop not null;
alter table public.m4_admin_actions add column teacher_id uuid, add column room_module_id uuid;
alter table public.m4_admin_actions drop constraint m4_admin_actions_action_check;
alter table public.m4_admin_actions add constraint m4_admin_actions_action_check check (action in
  ('remove_enrollment', 'create_room', 'update_room', 'assign_module', 'unassign_module', 'restore_module'));
alter table public.m4_admin_actions add constraint m4_admin_actions_shape_check check (
  (action <> 'remove_enrollment' or student_id is not null)
  and (action <> 'create_room' or teacher_id is not null)
  and (action not in ('assign_module', 'unassign_module', 'restore_module') or room_module_id is not null));

-- 2. Approved Teachers an Admin may make a room owner (profiles RLS does not show Teachers to Admins).
create function public.m4_admin_classroom_teachers()
returns table (id uuid, display_name text)
language plpgsql stable security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access is required.';
  end if;
  return query
    select p.id, coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.nickname), ''), 'Teacher')
    from public.profiles p
    where p.role = 'teacher' and p.teacher_status = 'approved'
    order by 2, 1;
end
$function$;
revoke all on function public.m4_admin_classroom_teachers() from public, anon;
grant execute on function public.m4_admin_classroom_teachers() to authenticated;

-- 3. Admin creates a room owned by an approved Teacher (atomic: room + audit row).
create function public.m4_admin_create_room(p_teacher_id uuid, p_room_name text, p_section text,
  p_description text, p_subject text, p_room_code text)
returns public.rooms
language plpgsql security definer
set search_path to ''
as $function$
declare created public.rooms;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access is required.';
  end if;
  perform 1 from public.profiles t
    where t.id = p_teacher_id and t.role = 'teacher' and t.teacher_status = 'approved' for share;
  if p_teacher_id is null or not found then
    raise exception using errcode = '22023', message = 'Select an approved Teacher for this learning room.';
  end if;
  if nullif(btrim(p_room_name), '') is null then
    raise exception using errcode = '22023', message = 'Room name is required.';
  end if;
  if p_subject is null or p_subject not in ('en', 'fil') then
    raise exception using errcode = '22023', message = 'Please select English or Filipino.';
  end if;
  if p_room_code is null or p_room_code !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$' then
    raise exception using errcode = '22023', message = 'Invalid room code.';
  end if;
  insert into public.rooms(teacher_id, subject, room_name, section, description, room_code)
    values (p_teacher_id, p_subject, btrim(p_room_name), nullif(btrim(p_section), ''),
            nullif(btrim(p_description), ''), p_room_code)
    returning * into created;
  insert into public.m4_admin_actions(action, room_id, teacher_id, actor_id)
    values ('create_room', created.id, p_teacher_id, auth.uid());
  return created;
end
$function$;
revoke all on function public.m4_admin_create_room(uuid,text,text,text,text,text) from public, anon;
grant execute on function public.m4_admin_create_room(uuid,text,text,text,text,text) to authenticated;

-- 4. Admin edits a room's name, section and description (owner, code and subject never change here).
create function public.m4_admin_update_room(p_room_id uuid, p_room_name text, p_section text, p_description text)
returns public.rooms
language plpgsql security definer
set search_path to ''
as $function$
declare updated public.rooms;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access is required.';
  end if;
  if nullif(btrim(p_room_name), '') is null then
    raise exception using errcode = '22023', message = 'Room name is required.';
  end if;
  update public.rooms
     set room_name = btrim(p_room_name), section = nullif(btrim(p_section), ''),
         description = nullif(btrim(p_description), '')
   where id = p_room_id
  returning * into updated;
  if updated.id is null then
    raise exception using errcode = '22023', message = 'Learning room not found; refresh the list.';
  end if;
  insert into public.m4_admin_actions(action, room_id, teacher_id, actor_id)
    values ('update_room', updated.id, updated.teacher_id, auth.uid());
  return updated;
end
$function$;
revoke all on function public.m4_admin_update_room(uuid,text,text,text) from public, anon;
grant execute on function public.m4_admin_update_room(uuid,text,text,text) to authenticated;

-- 5-7. Existing functions: Teacher paths unchanged; Admin branches added. Existing grants are kept.
CREATE OR REPLACE FUNCTION public.m4_assign_module(p_room_id uuid, p_module_id uuid, p_mode text DEFAULT 'whole_class'::text, p_students uuid[] DEFAULT '{}'::uuid[], p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare room public.rooms%rowtype; module public.modules%rowtype;
  assignment_id uuid; expected integer; found_students integer; source_language text;
  acting_admin boolean := public.is_admin();
begin
  if auth.uid() is null or (not acting_admin and (public.m4_current_role() is distinct from 'teacher'
    or not public.m1_teacher_access_allowed())) then
    raise exception 'Approved classroom Teacher required' using errcode = '42501';
  end if;
  select * into room from public.rooms where id = p_room_id for share;
  if not found or (not acting_admin and room.teacher_id <> auth.uid()) then
    raise exception 'Only the classroom owner can assign modules' using errcode = '42501';
  end if;
  -- Learners only see modules assigned under an approved classroom Teacher (M4/M5/M6 rules).
  if acting_admin and not exists (select 1 from public.profiles t where t.id = room.teacher_id
      and t.role = 'teacher' and t.teacher_status = 'approved') then
    raise exception 'This learning room''s Teacher is not approved, so students could not see the module' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('whole_class','selected_students') or p_students is null then
    raise exception 'Invalid assignment targeting' using errcode = '22023';
  end if;
  if p_mode = 'selected_students' and not (select enabled from public.m4_targeting_rollout where singleton) then
    raise exception 'Selected module assignments are not enabled' using errcode = '55000';
  end if;
  if p_due_at is not null and p_due_at <= now() then
    raise exception 'Choose a future deadline or no deadline' using errcode = '22023';
  end if;
  select * into module from public.modules where id = p_module_id for share;
  if not found or module.status <> 'published' or module.deleted_at is not null then
    raise exception 'Choose an available published module' using errcode = '22023';
  end if;
  select public.m4_normalize_subject(language) into source_language from public.learning_paths
    where id = module.path_id for share;
  if source_language is null or (room.subject is not null and room.subject <> source_language) then
    raise exception 'Module language does not match the classroom subject' using errcode = '23514';
  end if;
  if p_mode = 'whole_class' and cardinality(p_students) <> 0 then
    raise exception 'Whole Class does not accept a selected-student list' using errcode = '22023';
  end if;
  if p_mode = 'selected_students' then
    expected := cardinality(p_students);
    if expected = 0 or array_position(p_students,null) is not null
      or (select count(distinct s) from unnest(p_students) s) <> expected then
      raise exception 'Select one or more distinct enrolled students' using errcode = '22023';
    end if;
    -- Hold enrollment locks until recipients and their parent are committed together.
    perform e.id from public.enrollments e join public.profiles p on p.id = e.student_id
      where e.room_id = p_room_id and e.student_id = any(p_students) and p.role = 'student'
      for share of e, p;
    get diagnostics found_students = row_count;
    if found_students <> expected then
      raise exception 'Every selected student must currently be enrolled' using errcode = '42501';
    end if;
  end if;
  insert into public.room_modules(room_id,module_id,assigned_by,due_at,targeting_mode)
    values (p_room_id,p_module_id,room.teacher_id,p_due_at,p_mode) returning id into assignment_id;
  if p_mode = 'selected_students' then
    insert into public.room_module_recipients select assignment_id, s from unnest(p_students) s;
  end if;
  if acting_admin then
    insert into public.m4_admin_actions(action, room_id, teacher_id, room_module_id, actor_id)
      values ('assign_module', p_room_id, room.teacher_id, assignment_id, auth.uid());
  end if;
  return assignment_id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.m4_unassign_module(p_room_module_id uuid, p_restore boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare changed integer; acting_admin boolean := public.is_admin(); target_room uuid;
begin
  if auth.uid() is null or (not acting_admin and (public.m4_current_role() is distinct from 'teacher'
     or not public.m1_teacher_access_allowed())) then
    raise exception using errcode = '42501', message = 'Only the classroom teacher can change this module.';
  end if;
  update public.room_modules m
     set removed_at = case when p_restore then null else now() end,
         removed_by = case when p_restore then null else auth.uid() end
   where m.id = p_room_module_id
     and (m.removed_at is null) = (not p_restore)
     and exists (select 1 from public.rooms r where r.id = m.room_id and (acting_admin or r.teacher_id = auth.uid()))
  returning m.room_id into target_room;
  get diagnostics changed = row_count;
  if changed = 0 and not exists (
    select 1 from public.room_modules m join public.rooms r on r.id = m.room_id
     where m.id = p_room_module_id and (acting_admin or r.teacher_id = auth.uid())) then
    raise exception using errcode = '42501', message = 'Only the classroom teacher can change this module.';
  end if;
  if acting_admin and changed = 1 then
    insert into public.m4_admin_actions(action, room_id, room_module_id, actor_id)
      values (case when p_restore then 'restore_module' else 'unassign_module' end, target_room, p_room_module_id, auth.uid());
  end if;
  return changed = 1;
end; $function$
;

CREATE OR REPLACE FUNCTION public.m4_admin_classroom_actions()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when public.m4_current_role() = 'admin' then array['remove_enrollment','create_room','update_room','assign_module','unassign_module'] else '{}'::text[] end
$function$
;

commit;
