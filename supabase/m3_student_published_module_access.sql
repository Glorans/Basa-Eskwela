-- Student access before classroom assignment enforcement to published Admin-created modules.
-- Apply after m3_content_rls.sql in environments where the earlier
-- enrollment/room_modules version of m3_can_read_module is already installed.
-- M4 may later replace only this helper to enforce classroom assignments.

begin;

create or replace function public.m3_can_read_module(target_module_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.modules as module_row
    where module_row.id = target_module_id
      and (
        public.m3_current_role() = 'admin'
        or (
          module_row.status = 'published'
          and public.m3_current_role() in ('teacher', 'student', 'general_user')
        )
      )
  )
$$;

comment on function public.m3_can_read_module(uuid) is
  'Admin sees all modules. Teacher, Student, and General User see published modules. Student assignment restrictions are intentionally deferred until M4 Classroom Management is enforced.';

revoke all on function public.m3_can_read_module(uuid) from public;
grant execute on function public.m3_can_read_module(uuid) to authenticated;

commit;
