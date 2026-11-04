-- PROPOSAL ONLY. NOT APPLIED. Rollback for m4_legacy_room_subject_PROPOSED.sql.
-- Closes the gate and restores the previous trigger functions. Rooms that were converted KEEP their
-- subject (they behave like new rooms); never set them back to NULL silently. The audit table
-- m4_room_subject_conversions is kept as the record of who converted which room.
begin;
set local lock_timeout = '5s';
drop function if exists public.m4_set_legacy_room_subject(uuid, text);
drop function if exists public.m4_legacy_room_subject_options(uuid);
drop function if exists public.m4_room_subject_choices(text[]);
drop function if exists public.m4_room_content_languages(uuid);

-- Verbatim from supabase/proposed/m4_room_subject_PROPOSED.sql (the installed definitions).
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

create or replace function public.m4_check_assignment_subject() returns trigger
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

notify pgrst, 'reload schema';
commit;
