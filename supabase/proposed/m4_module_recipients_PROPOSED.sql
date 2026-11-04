-- PROPOSAL ONLY. NOT APPLIED. See docs/M3_M4_FINAL_REPORT.md and docs/M3_M4_ROLLOUT_RUNBOOK.md.
-- Selected-student module assignments. Enforcement for the service-role M5/M6 paths is in the
-- database itself: m4_enforce_module_recipient() rejects any oral-reading or comprehension attempt
-- on a selected-students assignment by a non-recipient, for every caller including service_role.
-- The rollout gate defaults OFF: installing this file creates no selected assignments and shows no
-- UI. Enabling is the separate m4_module_recipients_ENABLE_PROPOSED.sql step.
-- Prerequisites: core M4, Teacher approval, room subjects, module deletion and unassign columns.
-- Existing assignment IDs, due dates, Remove/Restore, attempts, history and XP are retained.
begin;
set local lock_timeout = '5s';

alter table public.room_modules add column targeting_mode text not null default 'whole_class'
  check (targeting_mode in ('whole_class','selected_students'));
create table public.m4_targeting_rollout (
  singleton boolean primary key default true check (singleton), enabled boolean not null default false
);
insert into public.m4_targeting_rollout values (true, false);
alter table public.m4_targeting_rollout enable row level security;
revoke all on public.m4_targeting_rollout from public, anon, authenticated, service_role;

create table public.room_module_recipients (
  room_module_id uuid not null references public.room_modules(id) on delete restrict,
  student_id uuid not null references public.profiles(id) on delete restrict,
  primary key (room_module_id, student_id)
);
alter table public.room_module_recipients enable row level security;
revoke all on public.room_module_recipients from public, anon, authenticated;
grant select on public.room_module_recipients to authenticated, service_role;

-- This predicate is for NEW activity access. Do not use it to retroactively erase
-- completed results or revoke an already-started attempt's existing completion contract.
create function public.m4_module_assigned_to(p_assignment_id uuid, p_student_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room_modules rm
    join public.rooms r on r.id = rm.room_id
    join public.modules m on m.id = rm.module_id
    join public.learning_paths lp on lp.id = m.path_id
    join public.profiles t on t.id = r.teacher_id
    join public.profiles s on s.id = p_student_id and s.role = 'student'
    join public.enrollments e on e.room_id = r.id and e.student_id = s.id
    where rm.id = p_assignment_id and rm.assigned_by = r.teacher_id
      and t.role = 'teacher' and t.teacher_status = 'approved'
      and m.status = 'published' and m.deleted_at is null and rm.removed_at is null
      and (r.subject is null or r.subject = public.m4_normalize_subject(lp.language))
      and (auth.role() = 'service_role' or auth.uid() = p_student_id
        or public.is_admin() or (auth.uid() = r.teacher_id and public.m1_teacher_access_allowed()))
      and (rm.targeting_mode = 'whole_class' or exists (
        select 1 from public.room_module_recipients target
        where target.room_module_id = rm.id and target.student_id = p_student_id
      ))
  );
$$;
revoke all on function public.m4_module_assigned_to(uuid,uuid) from public, anon;
grant execute on function public.m4_module_assigned_to(uuid,uuid) to authenticated, service_role;

create policy "M4 recipients visible to authorized users" on public.room_module_recipients
for select to authenticated using (
  student_id = auth.uid() or public.is_admin() or exists (
    select 1 from public.room_modules rm join public.rooms r on r.id = rm.room_id
    where rm.id = room_module_id and r.teacher_id = auth.uid()
      and public.m4_current_role() = 'teacher' and public.m1_teacher_access_allowed()
  )
);
-- AND the existing policies: never add a new permissive path to room assignments.
create policy "M4 selected module recipient restriction" on public.room_modules
as restrictive for select to authenticated using (
  public.m4_current_role() <> 'student' or targeting_mode = 'whole_class'
  or public.m4_module_assigned_to(id, auth.uid())
);

create function public.m4_protect_module_targeting() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' and new.targeting_mode is distinct from old.targeting_mode then
    raise exception 'Assignment targeting is immutable; preserve existing history' using errcode = '42501';
  end if;
  if TG_OP = 'INSERT' and new.targeting_mode <> 'whole_class' and current_user in ('anon','authenticated') then
    raise exception 'Use the authorized module assignment action' using errcode = '42501';
  end if;
  return new;
end; $$;
create trigger m4_protect_module_targeting before insert or update on public.room_modules
for each row execute function public.m4_protect_module_targeting();
revoke all on function public.m4_protect_module_targeting() from public, anon, authenticated;

create function public.m4_assign_module(p_room_id uuid, p_module_id uuid,
  p_mode text default 'whole_class', p_students uuid[] default '{}', p_due_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
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
end; $$;
revoke all on function public.m4_assign_module(uuid,uuid,text,uuid[],timestamptz) from public, anon;
grant execute on function public.m4_assign_module(uuid,uuid,text,uuid[],timestamptz) to authenticated;
-- Hard enforcement for every attempt writer (the M5/M6 backends use the service role and bypass RLS).
-- Whole-class and non-classroom attempts are unaffected. Existing attempts are never re-checked.
create function public.m4_enforce_module_recipient() returns trigger
language plpgsql security definer set search_path = '' as $$
declare mode text;
begin
  if new.assignment_id is null then return new; end if;
  if TG_OP = 'UPDATE' and new.assignment_id is not distinct from old.assignment_id
     and new.user_id is not distinct from old.user_id then return new; end if;
  select targeting_mode into mode from public.room_modules where id = new.assignment_id for share;
  if mode = 'selected_students' and not exists (
    select 1 from public.room_module_recipients
    where room_module_id = new.assignment_id and student_id = new.user_id
  ) then
    raise exception using errcode = '42501',
      message = 'This reading module was assigned to selected students only.';
  end if;
  return new;
end; $$;
revoke all on function public.m4_enforce_module_recipient() from public, anon, authenticated;
create trigger m4_enforce_module_recipient before insert or update of assignment_id, user_id
  on public.oral_reading_attempts for each row execute function public.m4_enforce_module_recipient();
create trigger m4_enforce_module_recipient before insert or update of assignment_id, user_id
  on public.m6_comprehension_attempts for each row execute function public.m4_enforce_module_recipient();

-- UI/backend capability gate: false until the separate enable step.
create function public.m4_module_targeting_enabled() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select enabled from public.m4_targeting_rollout where singleton), false)
$$;
revoke all on function public.m4_module_targeting_enabled() from public, anon;
grant execute on function public.m4_module_targeting_enabled() to authenticated, service_role;

notify pgrst, 'reload schema';
commit;

-- Activation is the SEPARATE reviewed step m4_module_recipients_ENABLE_PROPOSED.sql, after the
-- backend with the recipient-aware start filter and the targeting UI are deployed and verified.
-- Whole Class is dynamic: future enrolled Students inherit access. Selected Students is an
-- immutable list of user IDs; removal from enrollment blocks NEW starts, rejoining restores
-- their original eligibility. Unassign/Restore applies to the assignment and retains targets.
-- Rollback: m4_module_recipients_ROLLBACK_PROPOSED.sql (disables; removes objects only when no
-- selected assignment exists). Keep helpers/recipient restrictions while selected rows exist.
-- Never drop targeting_mode or recipient policies while selected assignments exist, since
-- that would silently broaden access. Preserve IDs/history; prefer a forward fix.
