-- REVIEW BEFORE APPLYING. Apply after m3_material_question_sets.sql,
-- m5_reading_activity_assignments.sql and 20261012_m5_m6_uploaded_reading.sql.
-- Lets a class reading activity name one reviewed question set.
-- NULL with read_aloud_only=false keeps legacy behavior. No existing row is
-- changed and no existing policy is replaced or weakened.
begin;
set local lock_timeout = '5s';

alter table public.reading_activity_assignments
  add column question_set_id uuid null
    references public.material_question_sets(id) on delete no action,
  add column read_aloud_only boolean not null default false,
  add constraint reading_activity_assignments_mode_check
    check (not read_aloud_only or question_set_id is null);

-- Keep M5 RLS, UPDATE(status) privileges and m5_activity_identity unchanged.
-- Defense in depth if a deployment also has a table-level UPDATE grant.
-- A missing JWT subject must not exempt an authenticated/anonymous SQL role.
-- Subjectless service-role/server writes remain trusted: callers MUST verify
-- the actor, assignment ownership and enrollment before making any change.
create function public.m6_protect_activity_assignment_mode() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (auth.uid() is not null or current_user in ('authenticated', 'anon')) and
    (new.id, new.room_id, new.material_id, new.student_id, new.assigned_by,
     new.assigned_at, new.due_at, new.question_set_id, new.read_aloud_only)
    is distinct from
    (old.id, old.room_id, old.material_id, old.student_id, old.assigned_by,
     old.assigned_at, old.due_at, old.question_set_id, old.read_aloud_only)
  then
    raise exception using errcode = '42501',
      message = 'Reading assignment identity and mode cannot be changed';
  end if;
  return new;
end; $$;

create trigger m6_activity_assignment_mode
  before update on public.reading_activity_assignments
  for each row execute function public.m6_protect_activity_assignment_mode();

revoke all on function public.m6_protect_activity_assignment_mode() from public, anon, authenticated;

create index reading_activity_assignments_question_set_idx
  on public.reading_activity_assignments(question_set_id)
  where question_set_id is not null;

-- Runs in addition to the existing M5 insert policies, which already require an
-- approved Teacher who owns the room and the material. A set may be attached
-- only when it belongs to the same material, that material is owned by the
-- assigning Teacher, and every question in the set is reviewed.
create function public.m6_check_activity_question_set() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.question_set_id is null then
    return new;
  end if;
  if not exists (
    select 1
    from public.material_question_sets s
    join public.uploaded_materials m on m.id = s.material_id
    where s.id = new.question_set_id
      and s.material_id = new.material_id
      and m.uploaded_by = new.assigned_by
  ) then
    raise exception using errcode = '23514',
      message = 'Question set does not belong to this material and teacher';
  end if;
  if not exists (
    select 1 from public.comprehension_questions q
    where q.question_set_id = new.question_set_id
  ) or exists (
    select 1 from public.comprehension_questions q
    where q.question_set_id = new.question_set_id
      and q.review_status is distinct from 'reviewed'
  ) then
    raise exception using errcode = '23514',
      message = 'Question set must be reviewed before it is assigned';
  end if;
  return new;
end; $$;

create trigger m6_activity_question_set_check
  before insert or update of question_set_id, material_id, assigned_by
  on public.reading_activity_assignments
  for each row execute function public.m6_check_activity_question_set();

revoke all on function public.m6_check_activity_question_set() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
