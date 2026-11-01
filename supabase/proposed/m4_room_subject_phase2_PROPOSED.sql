-- PHASE 2 OF 2 — PROPOSAL ONLY. Do not execute without separate approval.
-- Apply only after phase 1 is installed and the subject-aware frontend is live and stable, so no
-- client that omits the subject is still creating rooms. Replaces one function: new rooms must be
-- English or Filipino. Existing legacy rooms (subject NULL) are untouched and keep working, and a
-- saved subject still cannot be changed. Re-runnable; nothing else changes.
begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.m4_protect_room_subject()') is null
    or not exists (select 1 from pg_trigger where tgname = 'm4_protect_room_subject' and tgrelid = 'public.rooms'::regclass) then
    raise exception 'Apply m4_room_subject_phase1_PROPOSED.sql first.';
  end if;
end $$;

create or replace function public.m4_protect_room_subject() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    if new.subject is null then
      raise exception using errcode = '23514', message = 'Select English or Filipino for the room subject.';
    end if;
  elsif new.subject is distinct from old.subject then
    -- Includes legacy NULL rooms; no silent reclassification of old assignments.
    raise exception using errcode = '23514', message = 'The saved room subject cannot be changed.';
  end if;
  return new;
end;
$$;
revoke all on function public.m4_protect_room_subject() from public, anon, authenticated;
commit;

-- VERIFY after applying (read-only):
--   select position('Select English or Filipino' in pg_get_functiondef('public.m4_protect_room_subject()'::regprocedure)) > 0;  -- true
--   select count(*) from public.rooms where subject is null;  -- unchanged legacy rooms
--
-- ROLLBACK TO PHASE 1 (old clients can create subject-less rooms again; nothing else changes):
--   begin;
--   create or replace function public.m4_protect_room_subject() returns trigger
--   language plpgsql set search_path = '' as $f$
--   begin
--     if TG_OP = 'UPDATE' and new.subject is distinct from old.subject then
--       raise exception using errcode = '23514', message = 'The saved room subject cannot be changed.';
--     end if;
--     return new;
--   end;
--   $f$;
--   revoke all on function public.m4_protect_room_subject() from public, anon, authenticated;
--   commit;
