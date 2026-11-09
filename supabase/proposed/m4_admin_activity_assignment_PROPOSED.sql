-- ============================================================================
-- PROPOSED - NOT APPLIED. Do not run without explicit approval.
-- M4 F7: Admin assigns reading activities on behalf of a room's approved Teacher.
-- DEPENDS ON supabase/proposed/m4_admin_room_management_PROPOSED.sql (apply that one first).
-- ============================================================================
--
-- Why F7 was blocked: Teacher activity assignment is a direct insert into reading_activity_assignments
-- under the M5 RLS policies "M5 assign activities" / "M5 activity insert boundary", both of which call
-- m5_can_assign_activity(room, material, student, assigned_by). That function only allows
-- assigned_by = auth.uid() = an approved Teacher who owns the room and uploaded the material.
-- Everything downstream already works for any activity whose assigned_by is the room's approved
-- Teacher: M6 completion access (m6_assert_learner_completion_access), the M6 question-set trigger
-- (material uploaded by assigned_by), M5 learner reads (m5_can_read_activity) and the M4 archived/
-- subject triggers. So the only cross-module change is ONE added branch in m5_can_assign_activity.
--
-- Changes:
--   1. M5 m5_can_assign_activity: + Admin-delegated branch. Allowed only when the caller is an Admin,
--      assigned_by is the room's APPROVED Teacher, the material is that Teacher's completed upload with
--      text, and the student is enrolled. The Teacher branch is unchanged. No RLS policy is changed;
--      the insert still passes both M5 policies, every trigger, the unique constraint and the archive lock.
--   2. M4 m4_admin_actions: + activity_id; actions assign_activity / unassign_activity / restore_activity.
--   3. M4 trigger m4_admin_activity_audit (AFTER INSERT on reading_activity_assignments): when the
--      session is an Admin, records the real Admin (auth.uid()) beside the effective Teacher
--      (assigned_by), in the same statement as the insert (atomic). Not callable by clients.
--   4. M4 m4_unassign_activity: + Admin branch (removed_by = the Admin), audited.
--   5. M4 m4_admin_classroom_actions: lists assign_activity / unassign_activity.
-- Not changed: M5 recording/scoring/history, M6 questions/scoring/attempts, M7, M8, M1, M3.
--
-- Fingerprints: md5 of pg_get_functiondef with CR removed. Preflight first (read-only):
-- supabase/tests/m4_admin_activity_assignment_preflight.sql

begin;
set local lock_timeout = '5s';

do $guard$
declare item record; found_md5 text;
begin
  for item in select * from (values
    ('public.m5_can_assign_activity(uuid,uuid,uuid,uuid)', 'e2cffc86cc5c3a41097e6eb2cbb6df3c'),
    ('public.m4_unassign_activity(uuid,boolean)', 'e190de08e733efbfe0b6cf4c44838b60'),
    ('public.m4_admin_classroom_actions()', '995e32bbb9432e307e27626925e7784b'),
    ('public.m6_check_activity_question_set()', '36ba72a7a0021710beda57996b7e9434'),
    ('public.m6_assert_learner_completion_access(uuid)', '795969b21c895ea830aba4a6bbcf035c'),
    ('public.m5_can_read_activity(uuid,uuid)', '3818cb82f4dc60a807688c80c8cea63a'),
    ('public.m4_admin_create_room(uuid,text,text,text,text,text)', 'dcfcba18278ec57b594b4c2df0d60101')
  ) as expected(signature, md5) loop
    if to_regprocedure(item.signature) is null then
      raise exception '% is missing; apply m4_admin_room_management first, or stop and re-review', item.signature;
    end if;
    found_md5 := md5(replace(pg_get_functiondef(item.signature::regprocedure), chr(13), ''));
    if found_md5 is distinct from item.md5 then
      raise exception '% differs from the reviewed definition (found %); stop and re-review', item.signature, found_md5;
    end if;
  end loop;
  if to_regprocedure('public.m4_audit_admin_activity()') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public'
                and table_name = 'm4_admin_actions' and column_name = 'activity_id') then
    raise exception 'M4 Admin activity assignment is already installed; nothing to do';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'reading_activity_assignments'
      and cmd = 'INSERT' and with_check like '%m5_can_assign_activity(room_id, material_id, student_id, assigned_by)%') <> 2 then
    raise exception 'The M5 activity insert policies differ from the reviewed ones; stop and re-review';
  end if;
end
$guard$;

-- 2. Audit table.
alter table public.m4_admin_actions add column activity_id uuid;
alter table public.m4_admin_actions drop constraint m4_admin_actions_action_check;
alter table public.m4_admin_actions add constraint m4_admin_actions_action_check check (action in
  ('remove_enrollment', 'create_room', 'update_room', 'assign_module', 'unassign_module', 'restore_module',
   'assign_activity', 'unassign_activity', 'restore_activity'));
alter table public.m4_admin_actions drop constraint m4_admin_actions_shape_check;
alter table public.m4_admin_actions add constraint m4_admin_actions_shape_check check (
  (action <> 'remove_enrollment' or student_id is not null)
  and (action <> 'create_room' or teacher_id is not null)
  and (action not in ('assign_module', 'unassign_module', 'restore_module') or room_module_id is not null)
  and (action not in ('assign_activity', 'unassign_activity', 'restore_activity')
       or (activity_id is not null and student_id is not null and teacher_id is not null)));

-- 1. M5 authorization: Admin-delegated branch.
CREATE OR REPLACE FUNCTION public.m5_can_assign_activity(r uuid, m uuid, s uuid, t uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (t = auth.uid() and exists (
    select 1 from public.profiles p join public.rooms room on room.teacher_id=p.id
    join public.enrollments e on e.room_id=room.id
    join public.profiles learner on learner.id=e.student_id
    join public.uploaded_materials material on material.id=m
    where p.id=auth.uid() and p.role='teacher' and p.teacher_status='approved'
      and room.id=r and e.student_id=s and learner.role='student'
      and material.uploaded_by=p.id and material.extraction_status='completed'
      and nullif(btrim(material.content_text),'') is not null
  ))
  -- M4 Admin-delegated assignment: an Admin assigns on behalf of the room's APPROVED Teacher (t). The
  -- row stays attributed to that Teacher, the material must be that Teacher's completed upload, and
  -- the student must be enrolled; M4 records the real Admin (trigger m4_admin_activity_audit).
  or (public.is_admin() and exists (
    select 1 from public.profiles p join public.rooms room on room.teacher_id=p.id
    join public.enrollments e on e.room_id=room.id
    join public.profiles learner on learner.id=e.student_id
    join public.uploaded_materials material on material.id=m
    where p.id=t and p.role='teacher' and p.teacher_status='approved'
      and room.id=r and e.student_id=s and learner.role='student'
      and material.uploaded_by=p.id and material.extraction_status='completed'
      and nullif(btrim(material.content_text),'') is not null
  ));
$function$
;

-- 3. Audit trigger.
CREATE OR REPLACE FUNCTION public.m4_audit_admin_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Only an Admin session can reach this branch (m5_can_assign_activity's Admin branch); the actor
  -- comes from the session, never from the row. Same statement, so assignment and audit are atomic.
  if auth.uid() is not null and public.is_admin() then
    insert into public.m4_admin_actions(action, room_id, student_id, teacher_id, activity_id, actor_id)
      values ('assign_activity', new.room_id, new.student_id, new.assigned_by, new.id, auth.uid());
  end if;
  return null;
end
$function$;
revoke all on function public.m4_audit_admin_activity() from public, anon, authenticated;
create trigger m4_admin_activity_audit after insert on public.reading_activity_assignments
for each row execute function public.m4_audit_admin_activity();

-- 4-5. M4 functions.
CREATE OR REPLACE FUNCTION public.m4_unassign_activity(p_assignment_id uuid, p_restore boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare changed integer; acting_admin boolean := public.is_admin(); target record;
begin
  if auth.uid() is null or (not acting_admin and (public.m4_current_role() is distinct from 'teacher'
     or not public.m1_teacher_access_allowed())) then
    raise exception using errcode = '42501', message = 'Only the classroom teacher can change this activity.';
  end if;
  update public.reading_activity_assignments a
     set removed_at = case when p_restore then null else now() end,
         removed_by = case when p_restore then null else auth.uid() end
   where a.id = p_assignment_id
     and (a.removed_at is null) = (not p_restore)
     and exists (select 1 from public.rooms r where r.id = a.room_id and (acting_admin or r.teacher_id = auth.uid()))
  returning a.room_id, a.student_id, a.assigned_by into target;
  get diagnostics changed = row_count;
  if changed = 0 and not exists (
    select 1 from public.reading_activity_assignments a join public.rooms r on r.id = a.room_id
     where a.id = p_assignment_id and (acting_admin or r.teacher_id = auth.uid())) then
    raise exception using errcode = '42501', message = 'Only the classroom teacher can change this activity.';
  end if;
  if acting_admin and changed = 1 then
    insert into public.m4_admin_actions(action, room_id, student_id, teacher_id, activity_id, actor_id)
      values (case when p_restore then 'restore_activity' else 'unassign_activity' end,
              target.room_id, target.student_id, target.assigned_by, p_assignment_id, auth.uid());
  end if;
  return changed = 1; -- false: it was already in the requested state (idempotent)
end; $function$
;

CREATE OR REPLACE FUNCTION public.m4_admin_classroom_actions()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when public.m4_current_role() = 'admin' then array['remove_enrollment','create_room','update_room','assign_module','unassign_module','assign_activity','unassign_activity'] else '{}'::text[] end
$function$
;

commit;
