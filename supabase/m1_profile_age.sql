-- DRAFT: review and approve before applying to Supabase.
-- Requires the existing M1 onboarding and teacher verification migrations.
-- Existing records retain NULL age; no data, role, RLS policy or routing changes.
begin;
set local lock_timeout = '5s';

-- Existing M1 grants SELECT per column. A broad table grant would expose age
-- through other modules' profile-read policies; stop rather than change them.
do $$
begin
  if has_table_privilege('anon', 'public.profiles', 'SELECT')
    or has_table_privilege('authenticated', 'public.profiles', 'SELECT') then
    raise exception 'Review broad profile SELECT grants before adding private age.';
  end if;
end $$;

alter table public.profiles
  add column age integer constraint profiles_age_check check (age between 1 and 120);

-- Reuse the existing own-profile UPDATE policy; never grant direct age SELECT.
grant update (age) on public.profiles to authenticated;

create function public.get_own_profile_age(profile_id uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select age from public.profiles where id = profile_id and id = auth.uid();
$$;
revoke all on function public.get_own_profile_age(uuid) from public, anon;
grant execute on function public.get_own_profile_age(uuid) to authenticated;

commit;
