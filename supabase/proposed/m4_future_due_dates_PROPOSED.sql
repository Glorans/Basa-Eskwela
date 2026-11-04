-- PROPOSED — NOT APPLIED ANYWHERE. Optional; needs approval before running on ReadFlow-Staging.
-- M4: refuse NEW classroom assignments whose deadline has already passed.
--
-- Why a migration: Teachers insert room_modules and reading_activity_assignments directly through
-- Supabase (RLS), not through the Express backend, so the only server-side place to enforce
-- "the deadline must be in the future" is the database. The app already checks it in the form and
-- in classroomService before inserting; this makes the rule hold for every client.
--
-- Scope: BEFORE INSERT only. Existing rows (including deadlines that are now in the past), UPDATEs
-- such as Remove/Restore, and student completion after a deadline are not affected. due_at stays
-- optional (NULL = no deadline). now() is an absolute instant, so time zones do not matter here.
--
-- ROLLBACK:
--   drop trigger m4_reject_past_due_activity on public.reading_activity_assignments;
--   drop trigger m4_reject_past_due_module on public.room_modules;
--   drop function public.m4_reject_past_due_date();

begin;

create function public.m4_reject_past_due_date() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.due_at is not null and new.due_at <= now() then
    raise exception 'This due date and time has already passed. Choose a date and time in the future (Philippine time), or leave it empty.'
      using errcode = '22007';
  end if;
  return new;
end;
$$;

revoke all on function public.m4_reject_past_due_date() from public, anon, authenticated;

create trigger m4_reject_past_due_activity before insert on public.reading_activity_assignments
  for each row execute function public.m4_reject_past_due_date();
create trigger m4_reject_past_due_module before insert on public.room_modules
  for each row execute function public.m4_reject_past_due_date();

commit;
