-- M2 F6 CONTROLLED INITIAL DIAGNOSTIC ACTIVATION -- PROPOSED. NOT APPLIED. Requires explicit approval.
-- Requires: m2_assessment_packages_PROPOSED.sql (packages, versions, educator reviews).
-- Rollback: m2_initial_activation_ROLLBACK_PROPOSED.sql   Verification: m2_initial_activation_VERIFY_READONLY.sql
--
-- What this adds:
--   m2_initial_activation          one row per language: which initial diagnostic version learners take.
--                                  package_version_id NULL = the built-in, code-defined version 3.0 (the default).
--   m2_initial_activation_events   append-only history of every change (who, when, from, to).
--   m2_activate_initial_version()  the ONLY way to change it: System Admin only, one language at a time, refuses a
--                                  concurrent change (the caller states which version it expects to replace), and
--                                  accepts only a PUBLISHED, EDUCATOR-ENDORSED version of that language's initial
--                                  diagnostic lineage (the package that holds the imported 3.0). Passing NULL returns
--                                  the language to the built-in 3.0.
-- Publishing in the library never activates anything. Nothing is activated by this migration: both languages start
-- on the built-in 3.0, so learners, scoring, placement and M8 behave exactly as today.
-- Existing results are never changed. A learner with a verified initial result is never asked to retake (the backend
-- and the app count every verified result of the lineage, any version).
begin;

do $$
begin
  if to_regclass('public.m2_assessment_package_versions') is null or to_regprocedure('public.m2_version_educator_endorsed(uuid)') is null then
    raise exception 'STOP: apply m2_assessment_packages_PROPOSED.sql first';
  end if;
  -- One official initial diagnostic per learner per language (enforced below): refuse if the data already breaks it.
  if exists (select 1 from public.diagnostic_results where assessment_type = 'initial' and verification_status = 'server_verified'
             group by user_id, language having count(*) > 1) then
    raise exception 'STOP: a learner already has more than one verified initial diagnostic in a language; review before activation';
  end if;
  if to_regclass('public.m2_initial_activation') is not null or to_regclass('public.m2_initial_activation_events') is not null
     or to_regprocedure('public.m2_activate_initial_version(text,uuid,uuid,uuid)') is not null then
    raise exception 'STOP: initial activation is already (partly) installed';
  end if;
end $$;

-- Once a newer initial version can be activated, a learner must never hold two official initial results in a language
-- (the backend also refuses it). Existing data has at most one, checked above.
create unique index diagnostic_results_one_verified_initial_per_language
  on public.diagnostic_results(user_id, language) where assessment_type = 'initial' and verification_status = 'server_verified';

create table public.m2_initial_activation (
  language text primary key check (language in ('en', 'fil')),
  package_version_id uuid references public.m2_assessment_package_versions(id) on delete restrict,
  activated_by uuid references public.profiles(id) on delete set null,
  activated_at timestamptz
);
insert into public.m2_initial_activation(language) values ('en'), ('fil');

create table public.m2_initial_activation_events (
  id uuid primary key default gen_random_uuid(),
  language text not null check (language in ('en', 'fil')),
  from_version_id uuid references public.m2_assessment_package_versions(id) on delete restrict,
  to_version_id uuid references public.m2_assessment_package_versions(id) on delete restrict,
  from_label text not null,
  to_label text not null,
  actor uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index m2_initial_activation_events_language on public.m2_initial_activation_events(language, changed_at desc);

create function public.m2_guard_initial_activation_events() returns trigger language plpgsql set search_path = '' as $$
begin
  -- Account deletion may clear the actor (ON DELETE SET NULL); nothing else may change.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 and new.actor is null
     and (new.id, new.language, new.from_version_id, new.to_version_id, new.from_label, new.to_label, new.changed_at)
         is not distinct from (old.id, old.language, old.from_version_id, old.to_version_id, old.from_label, old.to_label, old.changed_at) then
    return new;
  end if;
  raise exception 'Activation history is permanent' using errcode = '42501';
end $$;
create trigger m2_guard_initial_activation_events before update or delete on public.m2_initial_activation_events
  for each row execute function public.m2_guard_initial_activation_events();

create function public.m2_guard_initial_activation() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' or tg_op = 'INSERT' then
    raise exception 'There is exactly one activation row per language' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger m2_guard_initial_activation before insert or delete on public.m2_initial_activation
  for each row execute function public.m2_guard_initial_activation();

create function public.m2_activate_initial_version(p_language text, p_version uuid, p_expected uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  cur public.m2_initial_activation;
  v record;
  from_label text;
  to_label text := '3.0 (built-in)';
begin
  if p_language not in ('en', 'fil') then raise exception 'Choose English or Filipino' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = p_actor and role = 'system_admin') then
    raise exception 'Only a System Admin can activate an initial diagnostic version' using errcode = '42501';
  end if;
  select * into cur from public.m2_initial_activation where language = p_language for update;
  if cur.package_version_id is distinct from p_expected then
    raise exception 'The active version changed since you loaded it. Reload and try again.' using errcode = '40001';
  end if;
  if p_version is not distinct from cur.package_version_id then
    raise exception 'This version is already active' using errcode = '42501';
  end if;
  if p_version is not null then
    select ver.id, ver.status, ver.source, ver.version_label, p.kind, p.audience, p.language, p.legacy_assessment_id, p.archived_at
      into v from public.m2_assessment_package_versions ver join public.m2_assessment_packages p on p.id = ver.package_id
      where ver.id = p_version;
    if v.id is null or v.kind <> 'initial' or v.audience <> 'all_learners' or v.language <> p_language
       or v.legacy_assessment_id is null or v.archived_at is not null then
      raise exception 'Only a version of this language''s initial diagnostic can be activated' using errcode = '42501';
    end if;
    if v.source <> 'authored' then
      raise exception 'The imported 3.0 is the built-in version: return to the built-in version instead' using errcode = '42501';
    end if;
    if v.status <> 'published' then
      raise exception 'Only the version published in the library can be activated' using errcode = '42501';
    end if;
    if not public.m2_version_educator_endorsed(p_version) then
      raise exception 'This version has no documented educator endorsement' using errcode = '42501';
    end if;
    to_label := v.version_label;
  end if;
  select coalesce((select version_label from public.m2_assessment_package_versions where id = cur.package_version_id), '3.0 (built-in)') into from_label;
  update public.m2_initial_activation set package_version_id = p_version, activated_by = p_actor, activated_at = now() where language = p_language;
  insert into public.m2_initial_activation_events(language, from_version_id, to_version_id, from_label, to_label, actor)
    values (p_language, cur.package_version_id, p_version, from_label, to_label, p_actor);
end $$;

alter table public.m2_initial_activation enable row level security;
alter table public.m2_initial_activation_events enable row level security;
revoke all on public.m2_initial_activation, public.m2_initial_activation_events from public, anon, authenticated, service_role;
-- The backend reads; only the activation function writes.
grant select on public.m2_initial_activation, public.m2_initial_activation_events to service_role;
revoke all on function public.m2_guard_initial_activation_events() from public, anon, authenticated, service_role;
revoke all on function public.m2_guard_initial_activation() from public, anon, authenticated, service_role;
revoke all on function public.m2_activate_initial_version(text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.m2_activate_initial_version(text, uuid, uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
