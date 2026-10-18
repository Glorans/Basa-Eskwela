-- Apply after M1 teacher verification, M3 content/RLS/passages/deletion and M4.
-- Incompatible schemas or duplicate rows abort the transaction without deleting data.
begin;
create table if not exists public.reading_activity_assignments (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id),
  material_id uuid not null references public.uploaded_materials(id),
  student_id uuid not null references public.profiles(id),
  assigned_by uuid not null references public.profiles(id),
  assigned_at timestamptz not null default now(),
  due_at timestamptz,
  status text not null default 'assigned' check (status in ('assigned','in_progress','completed'))
);
create unique index if not exists reading_activity_room_material_student_unique
  on public.reading_activity_assignments(room_id,material_id,student_id);
alter table public.reading_activity_assignments enable row level security;

-- Definer helpers avoid recursive policies between materials and assignments.
create or replace function public.m5_can_assign_activity(r uuid, m uuid, s uuid, t uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select t = auth.uid() and exists (
    select 1 from public.profiles p join public.rooms room on room.teacher_id=p.id
    join public.enrollments e on e.room_id=room.id
    join public.profiles learner on learner.id=e.student_id
    join public.uploaded_materials material on material.id=m
    where p.id=auth.uid() and p.role='teacher' and p.teacher_status='approved'
      and room.id=r and e.student_id=s and learner.role='student'
      and material.uploaded_by=p.id and material.extraction_status='completed'
      and nullif(btrim(material.content_text),'') is not null
  );
$$;
create or replace function public.m5_can_read_activity(r uuid, s uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and (
    p.role='admin' or
    (p.role='student' and p.id=s and exists(select 1 from public.enrollments e where e.room_id=r and e.student_id=p.id)) or
    (p.role='teacher' and p.teacher_status='approved' and exists(select 1 from public.rooms room where room.id=r and room.teacher_id=p.id))
  ));
$$;
revoke all on function public.m5_can_assign_activity(uuid,uuid,uuid,uuid), public.m5_can_read_activity(uuid,uuid) from public, anon;
grant execute on function public.m5_can_assign_activity(uuid,uuid,uuid,uuid), public.m5_can_read_activity(uuid,uuid) to authenticated;
drop policy if exists "M5 read activities" on public.reading_activity_assignments;
create policy "M5 read activities" on public.reading_activity_assignments for select to authenticated
  using (public.m5_can_read_activity(room_id,student_id));
drop policy if exists "M5 activity read boundary" on public.reading_activity_assignments;
create policy "M5 activity read boundary" on public.reading_activity_assignments as restrictive for select to authenticated
  using (public.m5_can_read_activity(room_id,student_id));
drop policy if exists "M5 assign activities" on public.reading_activity_assignments;
create policy "M5 assign activities" on public.reading_activity_assignments for insert to authenticated
  with check (public.m5_can_assign_activity(room_id,material_id,student_id,assigned_by));
drop policy if exists "M5 activity insert boundary" on public.reading_activity_assignments;
create policy "M5 activity insert boundary" on public.reading_activity_assignments as restrictive for insert to authenticated
  with check (status='assigned' and public.m5_can_assign_activity(room_id,material_id,student_id,assigned_by));
drop policy if exists "M5 student activity progress" on public.reading_activity_assignments;
create policy "M5 student activity progress" on public.reading_activity_assignments for update to authenticated
  using (student_id=auth.uid() and public.m5_can_read_activity(room_id,student_id))
  with check (student_id=auth.uid() and public.m5_can_read_activity(room_id,student_id));
drop policy if exists "M5 activity update boundary" on public.reading_activity_assignments;
create policy "M5 activity update boundary" on public.reading_activity_assignments as restrictive for update to authenticated
  using (student_id=auth.uid() and public.m5_can_read_activity(room_id,student_id))
  with check (student_id=auth.uid() and public.m5_can_read_activity(room_id,student_id));

create or replace function public.m5_protect_activity_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and
    (new.id,new.room_id,new.material_id,new.student_id,new.assigned_by,new.assigned_at,new.due_at)
    is distinct from (old.id,old.room_id,old.material_id,old.student_id,old.assigned_by,old.assigned_at,old.due_at)
  then raise exception using errcode='42501', message='Reading assignment identity cannot be changed'; end if;
  return new;
end; $$;
drop trigger if exists m5_activity_identity on public.reading_activity_assignments;
create trigger m5_activity_identity before update on public.reading_activity_assignments
  for each row execute function public.m5_protect_activity_identity();
grant select, insert on public.reading_activity_assignments to authenticated;
grant update(status) on public.reading_activity_assignments to authenticated;
drop policy if exists "M5 students read assigned materials" on public.uploaded_materials;
create policy "M5 students read assigned materials" on public.uploaded_materials for select to authenticated
  using (exists(select 1 from public.reading_activity_assignments a
    where a.material_id=uploaded_materials.id and a.student_id=auth.uid()
      and public.m5_can_read_activity(a.room_id,a.student_id)));
notify pgrst, 'reload schema';
-- Learner direct reads must not reopen removed/draft content via old URLs.
-- Historical attempts use snapshots through the authenticated Node service.
drop policy if exists "M5 learners read available modules" on public.modules;
create policy "M5 learners read available modules" on public.modules as restrictive for select to authenticated
  using (public.m3_current_role() not in ('student','general_user') or (deleted_at is null and status='published'));
drop policy if exists "M5 learners read available passages" on public.module_passages;
create policy "M5 learners read available passages" on public.module_passages as restrictive for select to authenticated
  using (public.m3_current_role() not in ('student','general_user') or exists (
    select 1 from public.modules m where m.id=module_id and m.deleted_at is null and m.status='published'
  ));
commit;
