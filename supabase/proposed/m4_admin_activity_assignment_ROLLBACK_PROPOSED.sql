-- ============================================================================
-- ROLLBACK for m4_admin_activity_assignment_PROPOSED.sql. PROPOSED - NOT APPLIED. Run only with approval.
-- Restores m5_can_assign_activity, m4_unassign_activity and m4_admin_classroom_actions exactly, drops the
-- audit trigger and, when no activity audit rows exist, the activity_id column. Activities an Admin
-- assigned stay: they are ordinary activities attributed to the room's Teacher. Nothing is deleted.
-- Run this BEFORE rolling back m4_admin_room_management.
-- ============================================================================
begin;
set local lock_timeout = '5s';

do $guard$
begin
  if md5(replace(pg_get_functiondef('public.m5_can_assign_activity(uuid,uuid,uuid,uuid)'::regprocedure), chr(13), '')) <> 'd84b5e4ce650c2e95b5819436c49dc5b'
     or md5(replace(pg_get_functiondef('public.m4_unassign_activity(uuid,boolean)'::regprocedure), chr(13), '')) <> '8065fa7e40c9cdee59933bcb6b135a55'
     or md5(replace(pg_get_functiondef('public.m4_admin_classroom_actions()'::regprocedure), chr(13), '')) <> '15d2440b4501fe3b245e40c33289a6af' then
    raise exception 'The installed functions are not the reviewed F7 versions; stop and re-review';
  end if;
end
$guard$;

drop trigger m4_admin_activity_audit on public.reading_activity_assignments;
drop function public.m4_audit_admin_activity();

CREATE OR REPLACE FUNCTION public.m5_can_assign_activity(r uuid, m uuid, s uuid, t uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select t = auth.uid() and exists (
    select 1 from public.profiles p join public.rooms room on room.teacher_id=p.id
    join public.enrollments e on e.room_id=room.id
    join public.profiles learner on learner.id=e.student_id
    join public.uploaded_materials material on material.id=m
    where p.id=auth.uid() and p.role='teacher' and p.teacher_status='approved'
      and room.id=r and e.student_id=s and learner.role='student'
      and material.uploaded_by=p.id and material.extraction_status='completed'
      and nullif(btrim(material.content_text),'') is not null
  );
$function$
;

CREATE OR REPLACE FUNCTION public.m4_unassign_activity(p_assignment_id uuid, p_restore boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare changed integer;
begin
  if auth.uid() is null or public.m4_current_role() is distinct from 'teacher'
     or not public.m1_teacher_access_allowed() then
    raise exception using errcode = '42501', message = 'Only the classroom teacher can change this activity.';
  end if;
  update public.reading_activity_assignments a
     set removed_at = case when p_restore then null else now() end,
         removed_by = case when p_restore then null else auth.uid() end
   where a.id = p_assignment_id
     and (a.removed_at is null) = (not p_restore)
     and exists (select 1 from public.rooms r where r.id = a.room_id and r.teacher_id = auth.uid());
  get diagnostics changed = row_count;
  if changed = 0 and not exists (
    select 1 from public.reading_activity_assignments a join public.rooms r on r.id = a.room_id
     where a.id = p_assignment_id and r.teacher_id = auth.uid()) then
    raise exception using errcode = '42501', message = 'Only the classroom teacher can change this activity.';
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
  select case when public.m4_current_role() = 'admin' then array['remove_enrollment','create_room','update_room','assign_module','unassign_module'] else '{}'::text[] end
$function$
;

do $table$
begin
  if exists (select 1 from public.m4_admin_actions where activity_id is not null) then
    raise notice 'Activity audit rows exist; m4_admin_actions keeps activity_id so the audit trail is preserved';
  else
    alter table public.m4_admin_actions drop constraint m4_admin_actions_shape_check;
    alter table public.m4_admin_actions drop constraint m4_admin_actions_action_check;
    alter table public.m4_admin_actions add constraint m4_admin_actions_action_check check (action in
      ('remove_enrollment', 'create_room', 'update_room', 'assign_module', 'unassign_module', 'restore_module'));
    alter table public.m4_admin_actions add constraint m4_admin_actions_shape_check check (
      (action <> 'remove_enrollment' or student_id is not null)
      and (action <> 'create_room' or teacher_id is not null)
      and (action not in ('assign_module', 'unassign_module', 'restore_module') or room_module_id is not null));
    alter table public.m4_admin_actions drop column activity_id;
  end if;
end
$table$;

commit;
