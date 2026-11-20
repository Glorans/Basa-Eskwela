-- ROLLBACK for m2_initial_activation_no_endorsement_PROPOSED.sql (LOCAL M2 test database).
-- Restores the original m2_activate_initial_version() byte-for-byte (md5 6dce9f9cfc71174033da44590cea9abd), which again requires a
-- documented educator endorsement before activation. Does not change which version is active: if a version was
-- activated while the endorsement rule was off, it stays active (return to the built-in 3.0 first if needed).
begin;

do $$
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.m2_activate_initial_version(text,uuid,uuid,uuid)'::regprocedure) <> 'ed9266fe09773b403031f46c9ba8050b' then
    raise exception 'STOP: m2_activate_initial_version() is not the no-endorsement version; nothing to roll back';
  end if;
end $$;

create or replace function public.m2_activate_initial_version(p_language text, p_version uuid, p_expected uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $fn$
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
end $fn$;

do $$
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.m2_activate_initial_version(text,uuid,uuid,uuid)'::regprocedure) <> '6dce9f9cfc71174033da44590cea9abd' then
    raise exception 'STOP: the restored body does not match the original';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
