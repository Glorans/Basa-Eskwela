-- PROPOSAL ONLY. NOT APPLIED. Review docs/M3_M4_FOLLOWUP_REPORT.md first.
-- Lets the approved owning Teacher explicitly set the subject of a legacy (subject = NULL) room,
-- once, when everything ever assigned to the room (including soft-removed assignments) is in that
-- language. Mixed or unknown-language rooms are refused and keep the legacy language selector.
--
-- No backfill: no room is converted by this migration, nothing is inferred from room names, and no
-- assignment, attempt, analytics or XP row is touched. A conversion changes rooms.subject only and
-- records who did it in m4_room_subject_conversions.
-- Admins can see the options (view-only, as today) but cannot convert; widen only by an explicit
-- product decision.
--
-- Capability gate: the app offers "Set classroom subject" only when m4_legacy_room_subject_options()
-- exists. Before this migration nothing changes in the UI.
--
-- Rollback: drop the two RPCs (closes the gate), restore m4_protect_room_subject and
-- m4_check_assignment_subject from supabase/proposed/m4_room_subject_PROPOSED.sql. Converted rooms keep
-- their subject (they then behave exactly like new rooms); never set them back to NULL silently.
-- Keep m4_room_subject_conversions as the audit record.
begin;
set local lock_timeout = '5s';

-- Refuse to run unless the replaced functions are exactly the reviewed live definitions.
do $guard$
begin
  if md5(pg_get_functiondef('public.m4_protect_room_subject()'::regprocedure)) is distinct from '23a738db0fc11ac4de3faf3e79c882af'
    or md5(pg_get_functiondef('public.m4_check_assignment_subject()'::regprocedure)) is distinct from '4411c692d39a8aaf31f22b418b60e872' then
    raise exception 'M4 subject functions are not the reviewed definitions; stop and re-review';
  end if;
end $guard$;

create table public.m4_room_subject_conversions (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  subject text not null check (subject in ('en', 'fil')),
  converted_by uuid not null references public.profiles(id),
  converted_at timestamptz not null default now(),
  module_assignments integer not null,
  activity_assignments integer not null
);
alter table public.m4_room_subject_conversions enable row level security;
revoke all on table public.m4_room_subject_conversions from public, anon, authenticated;
grant select on table public.m4_room_subject_conversions to authenticated;
grant all on table public.m4_room_subject_conversions to service_role;
create policy "M4 room owners and Admins read subject conversions" on public.m4_room_subject_conversions
  for select to authenticated
  using (public.is_admin() or exists (select 1 from public.rooms r where r.id = room_id and r.teacher_id = auth.uid()));

-- Languages of everything ever assigned to a room, including soft-removed assignments (they can be
-- restored). 'unknown' marks content whose language cannot be verified. Internal helper.
create function public.m4_room_content_languages(target_room uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct coalesce(lang, 'unknown') order by coalesce(lang, 'unknown')), '{}')
  from (
    select public.m4_normalize_subject(p.language) as lang
      from public.room_modules rm
      join public.modules m on m.id = rm.module_id
      left join public.learning_paths p on p.id = m.path_id
     where rm.room_id = target_room
    union all
    select public.m4_normalize_subject(u.language)
      from public.reading_activity_assignments a
      left join public.uploaded_materials u on u.id = a.material_id
     where a.room_id = target_room
  ) content;
$$;
revoke all on function public.m4_room_content_languages(uuid) from public, anon, authenticated;

create function public.m4_room_subject_choices(languages text[]) returns text[]
language sql immutable set search_path = '' as $$
  select case
    when 'unknown' = any(languages) or ('en' = any(languages) and 'fil' = any(languages)) then '{}'::text[]
    when 'en' = any(languages) then array['en']
    when 'fil' = any(languages) then array['fil']
    else array['en', 'fil'] end;
$$;
revoke all on function public.m4_room_subject_choices(text[]) from public, anon, authenticated;

-- Read-only options for the owning Teacher (who may act) and Admins (view-only).
create function public.m4_legacy_room_subject_options(target_room uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  room public.rooms;
  owner boolean;
  languages text[];
begin
  select * into room from public.rooms where id = target_room;
  owner := room.id is not null and room.teacher_id = auth.uid()
    and public.m4_current_role() = 'teacher' and public.m1_teacher_access_allowed();
  if room.id is null or not (owner or public.is_admin()) then
    raise exception using errcode = '42501', message = 'Room access is required.';
  end if;
  languages := public.m4_room_content_languages(target_room);
  return jsonb_build_object(
    'subject', room.subject,
    'contentLanguages', to_jsonb(languages),
    'choices', to_jsonb(case when room.subject is null then public.m4_room_subject_choices(languages) else '{}'::text[] end),
    'canSet', owner and room.subject is null and cardinality(public.m4_room_subject_choices(languages)) > 0
  );
end $$;
revoke all on function public.m4_legacy_room_subject_options(uuid) from public, anon;
grant execute on function public.m4_legacy_room_subject_options(uuid) to authenticated, service_role;

create function public.m4_set_legacy_room_subject(target_room uuid, new_subject text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  room public.rooms;
  languages text[];
  module_count integer;
  activity_count integer;
begin
  if public.m4_current_role() is distinct from 'teacher' or not public.m1_teacher_access_allowed() then
    raise exception using errcode = '42501', message = 'Only the room''s approved Teacher can set its subject.';
  end if;
  -- Locks the room first: assignment inserts read the subject FOR SHARE and wait for this.
  select * into room from public.rooms where id = target_room for update;
  if room.id is null or room.teacher_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Only the room''s approved Teacher can set its subject.';
  end if;
  if new_subject is null or new_subject not in ('en', 'fil') then
    raise exception using errcode = '22023', message = 'Select English or Filipino for the room subject.';
  end if;
  if room.subject is not null then
    raise exception using errcode = '23514', message = 'This room already has a saved subject.';
  end if;
  -- Hold the assigned content's languages steady until commit (m4_protect_assigned_language
  -- then sees the new subject).
  perform 1 from public.room_modules rm join public.modules m on m.id = rm.module_id
    join public.learning_paths p on p.id = m.path_id where rm.room_id = target_room for share of m, p;
  perform 1 from public.reading_activity_assignments a join public.uploaded_materials u on u.id = a.material_id
    where a.room_id = target_room for share of u;
  languages := public.m4_room_content_languages(target_room);
  if not new_subject = any(public.m4_room_subject_choices(languages)) then
    raise exception using errcode = '23514', message = case
      when 'unknown' = any(languages) then 'Some readings in this room have no recognised language, so its subject cannot be set.'
      when cardinality(public.m4_room_subject_choices(languages)) = 0 then 'This room has both English and Filipino readings, so its subject cannot be set. Keep choosing the language for each assignment.'
      else 'This room''s readings are in another language, so that subject cannot be set.' end;
  end if;
  select count(*) into module_count from public.room_modules where room_id = target_room;
  select count(*) into activity_count from public.reading_activity_assignments where room_id = target_room;

  perform set_config('m4.legacy_subject_room', target_room::text, true);
  update public.rooms set subject = new_subject where id = target_room;
  perform set_config('m4.legacy_subject_room', '', true);
  insert into public.m4_room_subject_conversions(room_id, subject, converted_by, module_assignments, activity_assignments)
    values (target_room, new_subject, auth.uid(), module_count, activity_count);
  return new_subject;
end $$;
revoke all on function public.m4_set_legacy_room_subject(uuid, text) from public, anon;
grant execute on function public.m4_set_legacy_room_subject(uuid, text) to authenticated, service_role;

-- Same rules as before, plus one exemption: NULL -> en/fil inside m4_set_legacy_room_subject.
-- The setting is transaction-local and cannot be set through the Data API.
create or replace function public.m4_protect_room_subject() returns trigger
language plpgsql set search_path = '' as $function$
begin
  if TG_OP = 'INSERT' then
    if new.subject is null then
      raise exception using errcode = '23514', message = 'Select English or Filipino for the room subject.';
    end if;
  elsif new.subject is distinct from old.subject then
    if old.subject is null and new.subject in ('en', 'fil')
       and current_setting('m4.legacy_subject_room', true) = new.id::text then
      return new;
    end if;
    -- Includes legacy NULL rooms; no silent reclassification of old assignments.
    raise exception using errcode = '23514', message = 'The saved room subject cannot be changed.';
  end if;
  return new;
end;
$function$;

-- Unchanged except FOR SHARE on the room, so a new assignment and a subject conversion of the same
-- room cannot pass their checks concurrently.
create or replace function public.m4_check_assignment_subject() returns trigger
language plpgsql security definer set search_path = '' as $function$
declare room_subject text; source_language text;
begin
  select subject into room_subject from public.rooms where id = new.room_id for share;
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
$function$;

notify pgrst, 'reload schema';
commit;
