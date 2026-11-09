-- ============================================================================
-- ROLLBACK for m4_admin_room_management_PROPOSED.sql. PROPOSED - NOT APPLIED. Run only with approval.
-- Restores the three replaced functions exactly, drops the three new Admin functions and, when no
-- Admin room/module audit rows exist, restores the original m4_admin_actions shape. Rooms an Admin
-- created stay: they are ordinary rooms owned by their Teacher. Assignments are never deleted.
-- ============================================================================
begin;
set local lock_timeout = '5s';

do $guard$
begin
  if md5(replace(pg_get_functiondef('public.m4_assign_module(uuid,uuid,text,uuid[],timestamptz)'::regprocedure), chr(13), '')) <> '50c6b0f2f0bd205f6b59b88659b5dc38'
     or md5(replace(pg_get_functiondef('public.m4_unassign_module(uuid,boolean)'::regprocedure), chr(13), '')) <> 'bf5be25173b3baa6ca2fbaf4af3469cd'
     or md5(replace(pg_get_functiondef('public.m4_admin_classroom_actions()'::regprocedure), chr(13), '')) <> '995e32bbb9432e307e27626925e7784b' then
    raise exception 'The installed functions are not the reviewed M4 Admin versions; stop and re-review';
  end if;
end
$guard$;

CREATE OR REPLACE FUNCTION public.m4_assign_module(p_room_id uuid, p_module_id uuid, p_mode text DEFAULT 'whole_class'::text, p_students uuid[] DEFAULT '{}'::uuid[], p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare room public.rooms%rowtype; module public.modules%rowtype;
  assignment_id uuid; expected integer; found_students integer; source_language text;
begin
  if auth.uid() is null or public.m4_current_role() is distinct from 'teacher'
    or not public.m1_teacher_access_allowed() then
    raise exception 'Approved classroom Teacher required' using errcode = '42501';
  end if;
  select * into room from public.rooms where id = p_room_id for share;
  if not found or room.teacher_id <> auth.uid() then
    raise exception 'Only the classroom owner can assign modules' using errcode = '42501';
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
    values (p_room_id,p_module_id,auth.uid(),p_due_at,p_mode) returning id into assignment_id;
  if p_mode = 'selected_students' then
    insert into public.room_module_recipients select assignment_id, s from unnest(p_students) s;
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
declare changed integer;
begin
  if auth.uid() is null or public.m4_current_role() is distinct from 'teacher'
     or not public.m1_teacher_access_allowed() then
    raise exception using errcode = '42501', message = 'Only the classroom teacher can change this module.';
  end if;
  update public.room_modules m
     set removed_at = case when p_restore then null else now() end,
         removed_by = case when p_restore then null else auth.uid() end
   where m.id = p_room_module_id
     and (m.removed_at is null) = (not p_restore)
     and exists (select 1 from public.rooms r where r.id = m.room_id and r.teacher_id = auth.uid());
  get diagnostics changed = row_count;
  if changed = 0 and not exists (
    select 1 from public.room_modules m join public.rooms r on r.id = m.room_id
     where m.id = p_room_module_id and r.teacher_id = auth.uid()) then
    raise exception using errcode = '42501', message = 'Only the classroom teacher can change this module.';
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
  select case when public.m4_current_role() = 'admin' then array['remove_enrollment'] else '{}'::text[] end
$function$
;

drop function public.m4_admin_update_room(uuid,text,text,text);
drop function public.m4_admin_create_room(uuid,text,text,text,text,text);
drop function public.m4_admin_classroom_teachers();

do $table$
begin
  if exists (select 1 from public.m4_admin_actions where action <> 'remove_enrollment') then
    raise notice 'Admin room/module audit rows exist; m4_admin_actions keeps its extended shape so the audit trail is preserved';
  else
    alter table public.m4_admin_actions drop constraint m4_admin_actions_shape_check;
    alter table public.m4_admin_actions drop constraint m4_admin_actions_action_check;
    alter table public.m4_admin_actions add constraint m4_admin_actions_action_check check (action = 'remove_enrollment');
    alter table public.m4_admin_actions drop column room_module_id, drop column teacher_id;
    alter table public.m4_admin_actions alter column student_id set not null;
  end if;
end
$table$;

commit;
