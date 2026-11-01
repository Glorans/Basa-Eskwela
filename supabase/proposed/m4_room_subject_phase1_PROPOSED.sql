-- PHASE 1 OF 2 — PROPOSAL ONLY. Do not execute against Staging, production, or a team database
-- without separate approval. Derived from the tested m4_room_subject_PROPOSED.sql; the only change
-- is m4_protect_room_subject, which here still lets older clients create rooms without a subject.
-- Prerequisites: M3 learning_paths/modules/uploaded_materials, M4 rooms/room_modules,
-- and M5 reading_activity_assignments. Review against the target schema first.
-- No backfill: existing rooms remain NULL and existing assignments are untouched.
-- Not re-runnable: a second run fails on the existing column and rolls back unchanged.
-- Apply m4_room_subject_phase2_PROPOSED.sql only after the subject-aware frontend is live and stable.
begin;
-- Fail fast instead of queueing behind live traffic for the rooms ALTER TABLE lock.
set local lock_timeout = '5s';

alter table public.rooms add column subject text
  constraint rooms_subject_check check (subject in ('en', 'fil'));

-- Same aliases as the frontend normalizeLanguageAlias (module3/services/moduleModel.ts).
create function public.m4_normalize_subject(value text) returns text
language sql immutable set search_path = '' as $$
  select case lower(btrim(value))
    when 'en' then 'en' when 'english' then 'en'
    when 'fil' then 'fil' when 'filipino' then 'fil' when 'tagalog' then 'fil'
    else null end;
$$;

create function public.m4_protect_room_subject() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Phase 1: the previous frontend sends no subject, so new rooms may still be legacy (NULL).
  -- rooms_subject_check accepts only 'en' or 'fil'; phase 2 makes the subject required.
  if TG_OP = 'UPDATE' and new.subject is distinct from old.subject then
    -- Includes legacy NULL rooms; no silent reclassification of old assignments.
    raise exception using errcode = '23514', message = 'The saved room subject cannot be changed.';
  end if;
  return new;
end;
$$;
create trigger m4_protect_room_subject before insert or update of subject
  on public.rooms for each row execute function public.m4_protect_room_subject();

-- Database-side validation covers direct Supabase writes, not just the picker.
-- This adds no grants or policies and leaves existing authorization checks intact.
create function public.m4_check_assignment_subject() returns trigger
language plpgsql security definer set search_path = '' as $$
declare room_subject text; source_language text;
begin
  select subject into room_subject from public.rooms where id = new.room_id;
  if room_subject is null then return new; end if; -- legacy compatibility
  -- FOR SHARE waits for, then rereads, a concurrent language change of the source;
  -- m4_protect_assigned_language covers the opposite order.
  if TG_TABLE_NAME = 'room_modules' then
    select public.m4_normalize_subject(p.language) into source_language
      from public.modules m join public.learning_paths p on p.id = m.path_id
      where m.id = new.module_id for share of m, p;
  else
    select public.m4_normalize_subject(language) into source_language
      from public.uploaded_materials where id = new.material_id for share;
  end if;
  if source_language is distinct from room_subject then
    raise exception using errcode = '23514', message = 'The reading language must match the saved room subject.';
  end if;
  return new;
end;
$$;
create trigger m4_check_module_subject before insert or update of room_id, module_id
  on public.room_modules for each row execute function public.m4_check_assignment_subject();
create trigger m4_check_material_subject before insert or update of room_id, material_id
  on public.reading_activity_assignments for each row execute function public.m4_check_assignment_subject();

-- An assigned source must not later switch to the other language (module path edits,
-- material or learning-path language edits). Only subject rooms are protected; edits
-- that keep the normalized language, and sources assigned only to legacy rooms, pass.
create function public.m4_protect_assigned_language() returns trigger
language plpgsql security definer set search_path = '' as $$
declare conflict boolean;
begin
  if TG_TABLE_NAME = 'modules' then
    if new.path_id is not distinct from old.path_id then return new; end if;
    select exists(select 1 from public.room_modules rm join public.rooms r on r.id = rm.room_id
      where rm.module_id = new.id and r.subject is not null
        and r.subject is distinct from (select public.m4_normalize_subject(p.language)
          from public.learning_paths p where p.id = new.path_id)) into conflict;
  elsif TG_TABLE_NAME = 'uploaded_materials' then
    if new.language is not distinct from old.language then return new; end if;
    select exists(select 1 from public.reading_activity_assignments a join public.rooms r on r.id = a.room_id
      where a.material_id = new.id and r.subject is not null
        and r.subject is distinct from public.m4_normalize_subject(new.language)) into conflict;
  else
    if new.language is not distinct from old.language then return new; end if;
    select exists(select 1 from public.modules m join public.room_modules rm on rm.module_id = m.id
      join public.rooms r on r.id = rm.room_id
      where m.path_id = new.id and r.subject is not null
        and r.subject is distinct from public.m4_normalize_subject(new.language)) into conflict;
  end if;
  if conflict then
    raise exception using errcode = '23514',
      message = 'This reading is assigned to a room with a different subject. Its language cannot be changed.';
  end if;
  return new;
end;
$$;
create trigger m4_protect_module_language before update of path_id
  on public.modules for each row execute function public.m4_protect_assigned_language();
create trigger m4_protect_material_language before update of language
  on public.uploaded_materials for each row execute function public.m4_protect_assigned_language();
create trigger m4_protect_path_language before update of language
  on public.learning_paths for each row execute function public.m4_protect_assigned_language();

revoke all on function public.m4_normalize_subject(text), public.m4_protect_room_subject(),
  public.m4_check_assignment_subject(), public.m4_protect_assigned_language()
  from public, anon, authenticated;
-- Room protection is invoker security but uses no other functions/tables.
notify pgrst, 'reload schema';
commit;

-- VERIFY after applying (read-only):
--   select column_name, data_type, is_nullable from information_schema.columns
--     where table_schema = 'public' and table_name = 'rooms' and column_name = 'subject';
--   select tgname, tgrelid::regclass from pg_trigger where tgname like 'm4\_%' order by 1;  -- 6 rows
--   select count(*) filter (where subject is not null) from public.rooms;  -- 0 immediately after
--   select proname, prosecdef from pg_proc where proname like 'm4\_%' order by 1;           -- 4 rows
--
-- ROLLBACK OF PHASE 1 (roll back phase 2 first if it was applied; only if no subject room has been
-- created, or after exporting `select id, subject from public.rooms where subject is not null`):
--   begin;
--   drop trigger m4_protect_module_language on public.modules;
--   drop trigger m4_protect_material_language on public.uploaded_materials;
--   drop trigger m4_protect_path_language on public.learning_paths;
--   drop trigger m4_check_module_subject on public.room_modules;
--   drop trigger m4_check_material_subject on public.reading_activity_assignments;
--   drop trigger m4_protect_room_subject on public.rooms;
--   drop function public.m4_protect_assigned_language(), public.m4_check_assignment_subject(),
--     public.m4_protect_room_subject(), public.m4_normalize_subject(text);
--   alter table public.rooms drop column subject;
--   notify pgrst, 'reload schema';
--   commit;
