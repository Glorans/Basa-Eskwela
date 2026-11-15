-- READ-ONLY. Run before applying (PREFLIGHT section) and after applying (POST-APPLY section).
-- Every row should report ok = true. Nothing here changes data.

-- PREFLIGHT: the objects the migration depends on exist, and it is not installed yet.
select 'enrollments unique (room_id, student_id)' as check_name,
       exists (select 1 from pg_constraint c
               where c.conrelid = 'public.enrollments'::regclass and c.contype in ('u', 'p')
                 and (select array_agg(a.attname::text order by a.attname::text)
                        from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k)
                     = array['room_id', 'student_id']) as ok
union all
select 'rooms.archived_at exists (Teacher archive installed)',
       exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'rooms' and column_name = 'archived_at')
union all
select 'public.m4_current_role() exists', to_regprocedure('public.m4_current_role()') is not null
union all
select 'PREFLIGHT ONLY: not installed yet (false after apply)', to_regclass('public.m4_student_room_archives') is null;

-- POST-APPLY: shape, RLS, grants and function settings.
select 'table exists' as check_name, to_regclass('public.m4_student_room_archives') is not null as ok
union all
select 'RLS enabled', coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.m4_student_room_archives')), false)
union all
select 'exactly one policy, SELECT own rows',
       (select count(*) = 1 and bool_and(cmd = 'SELECT' and qual like '%auth.uid()%')
          from pg_policies where schemaname = 'public' and tablename = 'm4_student_room_archives')
union all
select 'authenticated: SELECT only, no write privileges',
       has_table_privilege('authenticated', 'public.m4_student_room_archives', 'SELECT')
       and not has_table_privilege('authenticated', 'public.m4_student_room_archives', 'INSERT')
       and not has_table_privilege('authenticated', 'public.m4_student_room_archives', 'UPDATE')
       and not has_table_privilege('authenticated', 'public.m4_student_room_archives', 'DELETE')
union all
select 'anon: no access', not has_table_privilege('anon', 'public.m4_student_room_archives', 'SELECT')
union all
select 'FK to enrollments(room_id, student_id) ON DELETE CASCADE',
       exists (select 1 from pg_constraint where conname = 'm4_student_room_archives_enrollment_fkey'
               and confrelid = 'public.enrollments'::regclass and confdeltype = 'c')
union all
select 'function is SECURITY DEFINER with empty search_path',
       coalesce((select prosecdef and proconfig @> array['search_path=""']
                   from pg_proc where oid = to_regprocedure('public.m4_set_my_room_archived(uuid,boolean)')), false)
union all
select 'function: authenticated may execute, anon may not',
       has_function_privilege('authenticated', 'public.m4_set_my_room_archived(uuid,boolean)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.m4_set_my_room_archived(uuid,boolean)', 'EXECUTE')
union all
select 'Teacher archive untouched (rooms.archived_at still present)',
       exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'rooms' and column_name = 'archived_at');
