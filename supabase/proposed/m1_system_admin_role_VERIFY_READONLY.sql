-- READ-ONLY. Run the PREFLIGHT section before applying and the POST-APPLY section after. Every row must be ok = true.

-- PREFLIGHT
select 'profiles_role_check is the current four-role check' as check_name,
       (select pg_get_constraintdef(oid) from pg_constraint
         where conrelid = 'public.profiles'::regclass and conname = 'profiles_role_check')
       = 'CHECK (((role IS NULL) OR (role = ANY (ARRAY[''admin''::text, ''teacher''::text, ''student''::text, ''general_user''::text])))) NOT VALID' as ok
union all
select 'every existing profile already has an allowed role (informational: the NOT VALID check does not re-check them)',
       not exists (select 1 from public.profiles where role is not null and role not in ('admin', 'teacher', 'student', 'general_user'))
union all
select 'no profile already uses system_admin', not exists (select 1 from public.profiles where role = 'system_admin')
union all
select 'is_system_admin() not installed yet', to_regprocedure('public.is_system_admin()') is null
union all
select 'role-protection trigger present on profiles',
       exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_protect_authorization_fields' and tgenabled <> 'D')
union all
select 'assign_own_role allows only student/general_user',
       coalesce((select prosrc like '%selected_role not in (''student'',''general_user'')%' from pg_proc where oid = to_regprocedure('public.assign_own_role(text)')), false)
union all
select 'is_admin() means role = admin only',
       coalesce((select prosrc like '%role = ''admin''%' and prosrc not like '%system_admin%' from pg_proc where oid = to_regprocedure('public.is_admin()')), false);

-- POST-APPLY
select 'profiles_role_check accepts exactly the five roles' as check_name,
       (select pg_get_constraintdef(oid) from pg_constraint
         where conrelid = 'public.profiles'::regclass and conname = 'profiles_role_check')
       = 'CHECK (((role IS NULL) OR (role = ANY (ARRAY[''system_admin''::text, ''admin''::text, ''teacher''::text, ''student''::text, ''general_user''::text])))) NOT VALID' as ok
union all
select 'is_system_admin() is SECURITY DEFINER with empty search_path',
       coalesce((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = to_regprocedure('public.is_system_admin()')), false)
union all
select 'is_system_admin(): authenticated may execute, anon may not',
       has_function_privilege('authenticated', 'public.is_system_admin()', 'EXECUTE')
       and not has_function_privilege('anon', 'public.is_system_admin()', 'EXECUTE')
union all
select 'role-protection trigger still present',
       exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_protect_authorization_fields' and tgenabled <> 'D')
union all
select 'assign_own_role still allows only student/general_user',
       coalesce((select prosrc like '%selected_role not in (''student'',''general_user'')%' from pg_proc where oid = to_regprocedure('public.assign_own_role(text)')), false)
union all
select 'is_admin() still means School Admin only',
       coalesce((select prosrc like '%role = ''admin''%' and prosrc not like '%system_admin%' from pg_proc where oid = to_regprocedure('public.is_admin()')), false);
