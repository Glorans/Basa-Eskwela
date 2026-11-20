-- M2 F6: INITIAL DIAGNOSTIC ACTIVATION WITHOUT A RECORDED EDUCATOR ENDORSEMENT -- PROPOSED.
-- Approved by the project owner on 2026-11-20 for the LOCAL M2 test database (basa-m2-manual) only.
-- NOT approved for Staging or Production. Requires: m2_initial_activation_PROPOSED.sql (applied).
-- Rollback: m2_initial_activation_no_endorsement_ROLLBACK_PROPOSED.sql
-- Verify:   m2_initial_activation_no_endorsement_VERIFY_READONLY.sql
--
-- Changes ONE thing: m2_activate_initial_version() no longer requires m2_version_educator_endorsed(). Every other rule
-- is kept unchanged: System Admin only; one language at a time; only an AUTHORED, PUBLISHED version of that language's
-- initial diagnostic lineage (package not archived); the caller must name the version it replaces (40001 on a
-- concurrent change); the built-in 3.0 is restored with NULL; every change is written to the append-only events table.
-- Unchanged: structural validation (submit), publishing, m2_version_educator_endorsed() itself and every reassessment
-- (F10) rule that uses it, all results, versions, reviews and activation history. Nothing is activated by this script.
-- The body below is the live body with only the endorsement check removed (generated, md5 6dce9f9cfc71174033da44590cea9abd -> ed9266fe09773b403031f46c9ba8050b).
begin;

do $$
begin
  if to_regprocedure('public.m2_activate_initial_version(text,uuid,uuid,uuid)') is null then
    raise exception 'STOP: apply m2_initial_activation_PROPOSED.sql first';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.m2_activate_initial_version(text,uuid,uuid,uuid)'::regprocedure) <> '6dce9f9cfc71174033da44590cea9abd' then
    raise exception 'STOP: m2_activate_initial_version() is not the reviewed original; review before applying';
  end if;
end $$;

create temporary table m2_fn_acl_before on commit drop as
  select proacl::text as acl, pg_get_userbyid(proowner) as owner, prosecdef from pg_proc
  where oid = 'public.m2_activate_initial_version(text,uuid,uuid,uuid)'::regprocedure;

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
    to_label := v.version_label;
  end if;
  select coalesce((select version_label from public.m2_assessment_package_versions where id = cur.package_version_id), '3.0 (built-in)') into from_label;
  update public.m2_initial_activation set package_version_id = p_version, activated_by = p_actor, activated_at = now() where language = p_language;
  insert into public.m2_initial_activation_events(language, from_version_id, to_version_id, from_label, to_label, actor)
    values (p_language, cur.package_version_id, p_version, from_label, to_label, p_actor);
end $fn$;

do $$
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.m2_activate_initial_version(text,uuid,uuid,uuid)'::regprocedure) <> 'ed9266fe09773b403031f46c9ba8050b' then
    raise exception 'STOP: the new body does not match the reviewed version';
  end if;
  if exists (select 1 from pg_proc p, m2_fn_acl_before b where p.oid = 'public.m2_activate_initial_version(text,uuid,uuid,uuid)'::regprocedure
             and (p.proacl::text is distinct from b.acl or pg_get_userbyid(p.proowner) <> b.owner or p.prosecdef <> b.prosecdef)) then
    raise exception 'STOP: owner, privileges or security definer changed';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
