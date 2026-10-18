-- STAGING ONLY, MANUAL, NOT EXECUTED BY THE APP OR TEST RUNNER.
-- Apply the proposed migration to an isolated staging database first.
-- psql -v ON_ERROR_STOP=1 -v admin_id=<staging-admin-uuid> -f this-file
-- Uses an existing Admin profile; all fixture writes/DDL are rolled back.
-- Run as staging database owner, never against production.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select set_config('request.jwt.claim.sub', :'admin_id', true);
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role','authenticated')::text,true);
do $$ begin
  if public.m3_current_role() is distinct from 'admin' then raise exception 'Supply a staging Admin UUID'; end if;
end; $$;

create temporary table deletion_fixtures(kind text primary key, module_id uuid, passage_id uuid);
insert into deletion_fixtures values
  ('draft',gen_random_uuid(),gen_random_uuid()),
  ('published',gen_random_uuid(),gen_random_uuid()),
  ('history',gen_random_uuid(),gen_random_uuid());
grant select on deletion_fixtures to authenticated;
-- Synthetic protected records deliberately use CASCADE, demonstrating that
-- the RPC detects references before a cascade can destroy history.
create table public.m3_deletion_test_history(id uuid primary key, question_id uuid
  references public.comprehension_questions(id) on delete cascade);

do $$
declare f record; path uuid:=gen_random_uuid(); n integer; q uuid;
begin
  insert into public.learning_paths(id,path_name,language,reading_level,difficulty_tier)
    values(path,'Deletion test path','en','Independent','Easy');
  for f in select * from deletion_fixtures loop
    perform public.m3_create_collection_draft(f.module_id,'Deletion fixture '||f.kind,path,'Easy',
      jsonb_build_array(jsonb_build_object('id',f.passage_id,'title','Test passage','passageText','A cat sleeps in a garden.')));
    for n in 1..6 loop
      q:=gen_random_uuid();
      insert into public.comprehension_questions(id,module_id,passage_id,question_type,question_text,options,
        scaffolding_hint,display_order,review_status)
      values(q,f.module_id,f.passage_id,case when n<3 then 'literal' when n<5 then 'inferential' else 'critical' end,
        'Question '||n,'["One","Two","Three","Four"]','Read the story.',n,'reviewed');
      insert into public.comprehension_question_answers(question_id,correct_answer) values(q,'One');
    end loop;
    if f.kind in ('published','history') then
      update public.modules set status='published' where id=f.module_id;
    end if;
    if f.kind='history' then insert into public.m3_deletion_test_history values(gen_random_uuid(),q); end if;
  end loop;
end; $$;
set constraints all immediate;
set local role authenticated;
do $$
declare f record; result text;
begin
  for f in select * from deletion_fixtures loop
    result:=public.m3_delete_module(f.module_id);
    if result is distinct from (case when f.kind='history' then 'soft' else 'permanent' end) then
      raise exception 'Wrong deletion result for %: %',f.kind,result;
    end if;
  end loop;
end; $$;
reset role;
do $$
declare f record;
begin
  for f in select * from deletion_fixtures loop
    if f.kind='history' then
      if not exists(select 1 from public.modules where id=f.module_id and deleted_at is not null and status='published')
        or (select count(*) from public.comprehension_questions where module_id=f.module_id)<>6
        or (select count(*) from public.m3_deletion_test_history)<>1 then raise exception 'History was not preserved'; end if;
    elsif exists(select 1 from public.modules where id=f.module_id)
      or exists(select 1 from public.module_passages where module_id=f.module_id)
      or exists(select 1 from public.comprehension_questions where module_id=f.module_id) then
      raise exception 'Unused content was not permanently deleted';
    end if;
  end loop;
  if exists(select 1 from public.m3_deletion_context) then raise exception 'Authorization marker leaked'; end if;
  begin
    update public.modules set deleted_at=null where id=(select module_id from deletion_fixtures where kind='history');
    raise exception 'Undelete unexpectedly succeeded' using errcode='XX000';
  exception when raise_exception then null;
  end;
end; $$;
-- Authenticated caller without an Admin profile must be rejected, including
-- retries against already-soft-deleted records.
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  begin
    perform public.m3_delete_module((select module_id from deletion_fixtures where kind='history'));
    raise exception 'Non-Admin deletion unexpectedly succeeded' using errcode='XX000';
  exception when insufficient_privilege then null;
  end;
end; $$;
reset role;
rollback;
-- Additional live-schema checks: real room_modules/progress/oral attempts,
-- shared uploaded sources, assignment insert races, existing assigned delivery,
-- and two-session concurrent history insertion. See docs/m3-admin-module-actions.md.
