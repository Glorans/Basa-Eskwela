-- PROPOSAL ONLY. NOT APPLIED. See docs/M3_M4_FINAL_REPORT.md (Admin permission review).
-- Narrow Admin classroom permission: an Admin may remove an enrolled student from any learning room,
-- through an audited RPC. Nothing else is widened: Admins still cannot write enrollments, rooms or
-- assignments directly, and no Teacher is impersonated (the Admin is recorded as the actor).
-- Archive/Restore for Admins is part of m4_room_archive_PROPOSED.sql.
-- Admin module/activity ASSIGNMENT is deliberately NOT included: M6 completion
-- (m6_assert_completion_access) and m5_can_assign_activity require assigned_by to be the room's
-- Teacher, so it needs reviewed M5/M6 authorization changes first (see the report).
-- Removing an enrollment has the same effect as the Teacher's Remove today: the student loses access
-- to the room; attempts, results, analytics and XP are kept (M7 enqueues its usual recalculation).
-- Gate: the Admin page shows Remove only when m4_admin_classroom_actions() lists 'remove_enrollment'.
-- Rollback: m4_admin_classroom_actions_ROLLBACK_PROPOSED.sql (the audit table is kept by default).
begin;
set local lock_timeout = '5s';

create table public.m4_admin_actions (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('remove_enrollment')),
  room_id uuid not null,
  student_id uuid not null,
  actor_id uuid not null references public.profiles(id),
  acted_at timestamptz not null default now()
);
alter table public.m4_admin_actions enable row level security;
revoke all on table public.m4_admin_actions from public, anon, authenticated;
grant select on table public.m4_admin_actions to authenticated;
grant all on table public.m4_admin_actions to service_role;
create policy "M4 Admins read Admin classroom actions" on public.m4_admin_actions for select to authenticated
  using (public.is_admin());

create function public.m4_admin_remove_enrollment(p_enrollment_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare e public.enrollments;
begin
  if auth.uid() is null or public.m4_current_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Admin access is required.';
  end if;
  select * into e from public.enrollments where id = p_enrollment_id for update;
  if e.id is null then return false; end if;
  delete from public.enrollments where id = p_enrollment_id;
  insert into public.m4_admin_actions(action, room_id, student_id, actor_id)
    values ('remove_enrollment', e.room_id, e.student_id, auth.uid());
  return true;
end $$;

-- Capability list for the Admin UI (empty for everyone else).
create function public.m4_admin_classroom_actions() returns text[]
language sql stable security definer set search_path = '' as $$
  select case when public.m4_current_role() = 'admin' then array['remove_enrollment'] else '{}'::text[] end
$$;

revoke all on function public.m4_admin_remove_enrollment(uuid) from public, anon;
revoke all on function public.m4_admin_classroom_actions() from public, anon;
grant execute on function public.m4_admin_remove_enrollment(uuid), public.m4_admin_classroom_actions() to authenticated, service_role;
notify pgrst, 'reload schema';
commit;
