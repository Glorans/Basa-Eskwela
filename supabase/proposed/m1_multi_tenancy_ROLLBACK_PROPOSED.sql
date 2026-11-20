-- ROLLBACK for m1_multi_tenancy_PROPOSED.sql -- PROPOSED. NOT APPLIED. Requires explicit approval.
-- Restores every replaced function byte-for-byte (bodies taken from a restored copy of Staging), removes the school
-- policies, triggers and helpers, then the school columns and tables.
-- REFUSES once a second school exists: removing schools would merge their accounts and data into one undivided
-- school again. In that case keep the migration and fix forward.
begin;
set local lock_timeout = '5s';
do $$ begin
  if (select count(*) from public.schools) > 1 then
    raise exception 'STOP: more than one school exists; rolling back would remove school isolation. Fix forward instead.';
  end if;
end $$;
drop policy "M1 school isolation" on public.profiles;
drop policy "M1 school isolation" on public.rooms;
drop policy "M1 school isolation" on public.enrollments;
drop policy "M1 school isolation" on public.room_modules;
drop policy "M1 school isolation" on public.room_module_recipients;
drop policy "M1 school isolation" on public.reading_activity_assignments;
drop policy "M1 school isolation" on public.m4_admin_actions;
drop policy "M1 school isolation" on public.modules;
drop policy "M1 school isolation" on public.module_passages;
drop policy "M1 school isolation" on public.m3_module_trash;
drop policy "M1 school isolation" on public.uploaded_materials;
drop policy "M1 school isolation" on public.material_question_sets;
drop policy "M1 school isolation" on public.comprehension_questions;
drop policy "M1 school isolation" on public.comprehension_question_answers;
drop policy "M1 school isolation" on public.oral_reading_attempts;
drop policy "M1 school isolation" on public.diagnostic_results;
drop policy "M1 members read their school" on public.schools;
drop trigger m1_school_write_guard on public.rooms;
drop trigger m1_school_write_guard on public.enrollments;
drop trigger m1_school_write_guard on public.room_modules;
drop trigger m1_school_write_guard on public.room_module_recipients;
drop trigger m1_school_write_guard on public.reading_activity_assignments;
drop trigger m1_school_write_guard on public.modules;
drop trigger m1_school_write_guard on public.module_passages;
drop trigger m1_school_write_guard on public.m3_module_trash;
drop trigger m1_school_write_guard on public.uploaded_materials;
drop trigger m1_school_write_guard_revision on public.modules;
drop trigger m1_enrollment_school on public.enrollments;
drop trigger m1_room_school_fixed on public.rooms;
drop trigger m1_profile_school_fixed on public.profiles;
drop function public.m1_create_school_admin_invitation(uuid, uuid, text, text, text, text, text, text, integer, uuid);
CREATE OR REPLACE FUNCTION public.m1_protect_profile_authorization_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if current_user in ('authenticated', 'anon') and (
    new.id is distinct from old.id or new.role is distinct from old.role
    or new.status is distinct from old.status or new.created_at is distinct from old.created_at
    or new.teacher_status is distinct from old.teacher_status
  ) then
    raise exception 'profile authorization fields are server-managed' using errcode = '42501';
  end if;
  return new;
end $function$;
CREATE OR REPLACE FUNCTION public.m1_school_admin_sees_owner(owner_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.m3_current_role() = 'admin'
    and not exists (select 1 from public.profiles p where p.id = owner_id and p.role = 'general_user');
$function$;
CREATE OR REPLACE FUNCTION public.m1_school_admin_sees_material(target_material_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.m3_current_role() = 'admin'
    and not exists (
      select 1 from public.uploaded_materials m join public.profiles p on p.id = m.uploaded_by
      where m.id = target_material_id and p.role = 'general_user');
$function$;
CREATE OR REPLACE FUNCTION public.m1_school_admin_sees_question(target_question_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.m3_current_role() = 'admin'
    and not exists (
      select 1 from public.comprehension_questions q
        join public.uploaded_materials m on m.id = q.material_id
        join public.profiles p on p.id = m.uploaded_by
      where q.id = target_question_id and p.role = 'general_user');
$function$;
CREATE OR REPLACE FUNCTION public.m1_school_admin_sees_storage_owner(owner_folder text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.m3_current_role() = 'admin'
    and not exists (select 1 from public.profiles p where p.id::text = owner_folder and p.role = 'general_user');
$function$;
CREATE OR REPLACE FUNCTION public.m4_admin_classroom_teachers()
 RETURNS TABLE(id uuid, display_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
CREATE OR REPLACE FUNCTION public.m3_trashed_modules()
 RETURNS TABLE(id uuid, title text, status_before text, trashed_at timestamp with time zone, trashed_by_name text, ever_published boolean, has_history boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    order by coalesce(t.trashed_at, m.deleted_at) desc;
end $function$;
CREATE OR REPLACE FUNCTION public.m3_module_revisions(target_id uuid)
 RETURNS TABLE(id uuid, title text, status text, revision_number integer, revision_of uuid, published_at timestamp with time zone, created_at timestamp with time zone, in_trash boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare root uuid;
begin
  if auth.uid() is null or public.m3_module_author_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Admin access is required';
  end if;
  select coalesce(m.revision_root, m.id) into root from public.modules m where m.id = target_id;
  return query
    select m.id, m.title, m.status, coalesce(m.revision_number, 1), m.revision_of, m.published_at, m.created_at, m.deleted_at is not null
    from public.modules m where m.id = root or m.revision_root = root
    order by coalesce(m.revision_number, 1);
end $function$;
CREATE OR REPLACE FUNCTION public.m3_can_manage_module(target_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case public.m3_module_author_role()
    when 'admin' then true
    when 'teacher' then exists (
      select 1 from public.modules as module_row
      where module_row.id = target_id and module_row.created_by = auth.uid()
    )
    else false
  end
$function$;
CREATE OR REPLACE FUNCTION public.m5_can_read_activity(r uuid, s uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and (
    p.role='admin' or
    (p.role='student' and p.id=s and exists(select 1 from public.enrollments e where e.room_id=r and e.student_id=p.id)) or
    (p.role='teacher' and p.teacher_status='approved' and exists(select 1 from public.rooms room where room.id=r and room.teacher_id=p.id))
  ));
$function$;
CREATE OR REPLACE FUNCTION public.register_teacher_with_invite(invite_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  update public.profiles set role = 'teacher', teacher_status = 'pending' where id = auth.uid();
  update public.teacher_invite_codes set use_count = use_count + 1 where id = code_row.id;
  return true;
end $function$;
CREATE OR REPLACE FUNCTION public.review_teacher_registration(target_user uuid, decision text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  if decision is null or decision not in ('approved','rejected') then
    raise exception 'Invalid Teacher review decision.' using errcode = '22023';
  end if;
  update public.profiles set teacher_status = decision
    where id = target_user and role = 'teacher' and teacher_status = 'pending'
      and nullif(btrim(full_name), '') is not null
    returning teacher_status into result;
  if result is null then
    raise exception 'Teacher is no longer pending or has not completed their profile.' using errcode = '40001';
  end if;
  return result;
end $function$;
CREATE OR REPLACE FUNCTION public.m1_accept_school_admin_invitation(p_user uuid, p_link_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$  -- definer: reads auth.users; service_role-only
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
  perform 1 from public.profiles where id = p_user and role is null and status = 'active' for update;
  if not found then raise exception 'm1_invite_target_not_unassigned'; end if;

  perform set_config('m1.school_admin_activation', p_user::text, true);
  update public.profiles set role = 'admin' where id = p_user and role is null;
  perform set_config('m1.school_admin_activation', '', true);
  update public.m1_school_admin_invitations set status = 'accepted', accepted_at = now() where id = v_row.id;
  insert into public.m1_school_admin_invitation_events (invitation_id, target_id, actor_id, action)
    values (v_row.id, p_user, p_user, 'accepted'), (v_row.id, p_user, null, 'role_activated');
  return 'admin';
end $function$;
CREATE OR REPLACE FUNCTION public.m1_set_account_status(p_actor uuid, p_target uuid, p_status text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_actor_role text;
  v_target_role text;
  v_old text;
begin
  if p_status is null or p_status not in ('active', 'inactive') then
    raise exception 'm1_invalid_status';
  end if;
  if p_actor is null or p_target is null or p_actor = p_target then
    raise exception 'm1_target_missing';
  end if;

  select role into v_actor_role from public.profiles where id = p_actor and status = 'active';
  if v_actor_role is null or v_actor_role not in ('system_admin', 'admin') then
    raise exception 'm1_actor_not_manager';
  end if;

  select role, status into v_target_role, v_old from public.profiles where id = p_target for update;
  if not found or not (
       (v_actor_role = 'system_admin' and v_target_role in ('general_user', 'admin'))
    or (v_actor_role = 'admin' and v_target_role in ('teacher', 'student'))
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
$function$;
CREATE OR REPLACE FUNCTION public.m1_create_school_admin_invitation(p_actor uuid, p_user uuid, p_email text, p_full_name text, p_reference text, p_method text, p_position text, p_note text DEFAULT NULL::text, p_valid_days integer DEFAULT 7)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$  -- definer: reads auth.users; service_role-only
declare v_id uuid; v_email text := lower(btrim(p_email)); v_name text := regexp_replace(btrim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
begin
  if not public.m1_is_active_system_admin(p_actor) then raise exception 'm1_invite_actor_not_system_admin'; end if;
  if p_valid_days is null or p_valid_days not between 1 and 14 then raise exception 'm1_invite_invalid_validity'; end if;
  if length(v_name) not between 1 and 100 then raise exception 'm1_invite_invalid_name'; end if;
  perform 1 from public.profiles where id = p_user and role is null and status = 'active' for update;
  if not found then raise exception 'm1_invite_target_not_unassigned'; end if;
  if not exists (select 1 from auth.users where id = p_user and lower(email) = v_email) then raise exception 'm1_invite_email_mismatch'; end if;
  if exists (select 1 from public.m1_school_admin_invitations where user_id = p_user) then raise exception 'm1_invite_duplicate'; end if;
  update public.profiles set full_name = v_name where id = p_user;
  insert into public.m1_school_admin_invitations (user_id, email, authorized_by, authorization_reference, confirmation_method,
      authorizing_position, note, expires_at)
    values (p_user, v_email, p_actor, btrim(p_reference), p_method, btrim(p_position), nullif(btrim(coalesce(p_note, '')), ''),
      now() + make_interval(days => p_valid_days))
    returning id into v_id;
  insert into public.m1_school_admin_invitation_events (invitation_id, target_id, actor_id, action) values (v_id, p_user, p_actor, 'authorized');
  return v_id;
end $function$;
revoke all on function public.m1_create_school_admin_invitation(uuid, uuid, text, text, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.m1_create_school_admin_invitation(uuid, uuid, text, text, text, text, text, text, integer) to service_role;
drop function public.m1_create_school(uuid, text, text, text);
drop function public.m1_update_school(uuid, uuid, text, text);
drop function public.m1_guard_school_write();
drop function public.m1_bind_enrollment_school();
drop function public.m1_guard_room_school();
drop function public.m1_guard_profile_school();
drop function public.m1_question_visible(uuid);
drop function public.m1_material_visible(uuid);
drop function public.m1_module_visible(uuid);
drop function public.m1_room_visible(uuid);
drop function public.m1_school_visible(uuid);
drop function public.m1_school_of(uuid);
drop function public.m1_current_school();
alter table public.m1_school_admin_invitations drop column school_id;
alter table public.teacher_invite_codes drop column school_id;
alter table public.profiles drop constraint profiles_school_role_check;
alter table public.profiles drop column school_id;
drop table public.m1_school_events;
drop table public.schools;
drop function public.m1_guard_school_delete();
commit;
