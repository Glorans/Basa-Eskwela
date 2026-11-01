-- PROPOSAL ONLY. Do not execute against Staging, production, or a team database without approval.
-- Team feedback C: let a teacher remove (unassign) a classroom activity or module, and undo it.
-- Soft removal, never DELETE: oral_reading_attempts, m6_comprehension_attempts, M7 analytics,
-- teacher review, reading history and M8 XP keep referring to these assignment ids (without
-- foreign keys), so deleting rows would orphan completed results. Removed rows stay readable
-- exactly as today; no existing policy, grant, trigger or XP rule is changed.
-- Teachers get no new table privilege. The only write path is the two functions below, which
-- check that the caller is an approved teacher who owns the classroom.
-- Not re-runnable: a second run fails on the existing columns/functions and rolls back unchanged.
--
-- Matching application behaviour (already in the local code, safe before and after this SQL):
--   * Student activity/module lists hide rows whose removed_at is set.
--   * The server refuses to START new work from a removed assignment (assignedReadingSource,
--     loadAccessiblePublishedModule); saved and in-progress attempts still reopen and complete.
--   * m6_assert_completion_access is intentionally unchanged, so an attempt started before the
--     removal can still be completed and keeps its XP.
--   * The teacher confirms before removing and can restore a removed item.
begin;
set local lock_timeout = '5s';

alter table public.reading_activity_assignments
  add column removed_at timestamptz null,
  add column removed_by uuid null references public.profiles(id),
  add constraint reading_activity_assignments_removed_check
    check ((removed_at is null) = (removed_by is null));
alter table public.room_modules
  add column removed_at timestamptz null,
  add column removed_by uuid null references public.profiles(id),
  add constraint room_modules_removed_check
    check ((removed_at is null) = (removed_by is null));

-- Defense in depth: room_modules has a table-level UPDATE grant (no UPDATE policy today, so RLS
-- blocks it), and a new column inherits table-level grants. API roles may never change the removal
-- columns directly; only the security-definer functions below (which run as the owner) can.
create function public.m4_protect_removal_columns() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.removed_at, new.removed_by) is distinct from (old.removed_at, old.removed_by) then
    raise exception using errcode = '42501', message = 'Use the classroom remove or restore action.';
  end if;
  return new;
end; $$;
create trigger m4_protect_activity_removal before update of removed_at, removed_by
  on public.reading_activity_assignments for each row execute function public.m4_protect_removal_columns();
create trigger m4_protect_module_removal before update of removed_at, removed_by
  on public.room_modules for each row execute function public.m4_protect_removal_columns();
revoke all on function public.m4_protect_removal_columns() from public, anon, authenticated;

-- m6_protect_activity_assignment_mode guards identity/mode columns only; removed_at/removed_by
-- are not in its list, so these functions can set them. Direct client UPDATEs stay limited to
-- the existing UPDATE(status) grant. p_restore = true undoes a removal.
create function public.m4_unassign_activity(p_assignment_id uuid, p_restore boolean default false)
returns boolean
language plpgsql security definer set search_path = '' as $$
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
end; $$;

create function public.m4_unassign_module(p_room_module_id uuid, p_restore boolean default false)
returns boolean
language plpgsql security definer set search_path = '' as $$
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
end; $$;

revoke all on function public.m4_unassign_activity(uuid, boolean), public.m4_unassign_module(uuid, boolean)
  from public, anon;
grant execute on function public.m4_unassign_activity(uuid, boolean), public.m4_unassign_module(uuid, boolean)
  to authenticated;

notify pgrst, 'reload schema';
commit;

-- ROLLBACK (restores every removed assignment to active; export removals first if needed:
--   select id, removed_at, removed_by from public.reading_activity_assignments where removed_at is not null
--   select id, removed_at, removed_by from public.room_modules where removed_at is not null):
--   begin;
--   drop function public.m4_unassign_activity(uuid, boolean), public.m4_unassign_module(uuid, boolean);
--   drop trigger m4_protect_activity_removal on public.reading_activity_assignments;
--   drop trigger m4_protect_module_removal on public.room_modules;
--   drop function public.m4_protect_removal_columns();
--   alter table public.reading_activity_assignments drop column removed_at, drop column removed_by;
--   alter table public.room_modules drop column removed_at, drop column removed_by;
--   notify pgrst, 'reload schema';
--   commit;
