-- PROPOSAL ONLY. Do not execute without separate approval. Optional hardening; the app already
-- refuses (and undoes) language corrections for materials that are assigned or have results.
--
-- Purpose: make "a material's language cannot change once it is assigned or has student results"
-- atomic in the database for ALL rooms. Phase 1 (m4_room_subject_phase1) already serializes this
-- for subject rooms; legacy (subjectless) rooms are skipped by m4_check_assignment_subject, so a
-- legacy assignment created at the same moment as a language correction is not blocked by SQL.
--
-- How it serializes:
--   * A language change takes FOR NO KEY UPDATE on the material row, and the BEFORE UPDATE trigger
--     below refuses when any assignment or attempt references the material.
--   * A new or re-pointed assignment takes FOR SHARE on the same row (second trigger below). FOR SHARE
--     conflicts with FOR NO KEY UPDATE, so whichever commits second sees the first: an assignment
--     waits for the change and then uses the new language; a change waits for the assignment and
--     is then refused. (FK checks only take FOR KEY SHARE, which does not conflict, hence the trigger.)
-- Attempts always require an assignment, so locking assignment writes is enough.
-- No grants, policies, data, scores, XP or attempts change. Re-runnable.
begin;
set local lock_timeout = '5s';

create or replace function public.m3_refuse_locked_material_language() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.language is not distinct from old.language then return new; end if;
  if exists (select 1 from public.reading_activity_assignments where material_id = new.id)
    or exists (select 1 from public.oral_reading_attempts where material_id = new.id)
    or exists (select 1 from public.m6_comprehension_attempts where material_id = new.id) then
    raise exception using errcode = '23514',
      message = 'This material is already assigned in a classroom or has student reading results, so its language cannot be changed.';
  end if;
  return new;
end;
$$;

create or replace function public.m3_share_lock_assigned_material() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Waits for a concurrent language change of this material (see header).
  perform 1 from public.uploaded_materials where id = new.material_id for share;
  return new;
end;
$$;

drop trigger if exists m3_refuse_locked_material_language on public.uploaded_materials;
create trigger m3_refuse_locked_material_language before update of language
  on public.uploaded_materials for each row execute function public.m3_refuse_locked_material_language();

drop trigger if exists m3_share_lock_assigned_material on public.reading_activity_assignments;
create trigger m3_share_lock_assigned_material before insert or update of material_id
  on public.reading_activity_assignments for each row execute function public.m3_share_lock_assigned_material();

revoke all on function public.m3_refuse_locked_material_language(), public.m3_share_lock_assigned_material()
  from public, anon, authenticated;
commit;

-- VERIFY after applying (read-only):
--   select tgname from pg_trigger where tgname in ('m3_refuse_locked_material_language', 'm3_share_lock_assigned_material');  -- 2 rows
--
-- ROLLBACK (the application check remains in place):
--   begin;
--   drop trigger if exists m3_share_lock_assigned_material on public.reading_activity_assignments;
--   drop trigger if exists m3_refuse_locked_material_language on public.uploaded_materials;
--   drop function if exists public.m3_share_lock_assigned_material(), public.m3_refuse_locked_material_language();
--   commit;
