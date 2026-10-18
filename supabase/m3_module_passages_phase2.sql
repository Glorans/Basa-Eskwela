-- Apply only after Phase 1. Staging validation is rollback-only.
begin;
alter table public.modules add column collection_revision bigint not null default 0;
alter table public.comprehension_questions add constraint comprehension_questions_require_passage
  check (module_id is null or passage_id is not null);

create function public.m3_collection_revision_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.collection_revision := old.collection_revision + 1;
  return new;
end; $$;
create trigger modules_collection_revision before update on public.modules
for each row execute function public.m3_collection_revision_trigger();

-- Every editor mutation locks the parent; a revision covers metadata, all
-- passages and banks. Historical modules remain immutable in this editor.
create function public.m3_lock_collection(target_id uuid, expected_revision bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.modules%rowtype; has_history boolean;
begin
  if public.m3_current_role() is distinct from 'admin' then raise exception 'Admin access required'; end if;
  select * into m from public.modules where id=target_id for update;
  if not found then raise exception 'Module not found'; end if;
  if m.collection_revision is distinct from expected_revision then raise exception 'This module changed. Reload before saving.'; end if;
  if m.status <> 'draft' or m.published_at is not null then raise exception 'Only never-published drafts can be edited; preserve historical content'; end if;
  if exists(select 1 from public.progress where module_id=target_id)
    or exists(select 1 from public.room_modules where module_id=target_id) then
    raise exception 'Referenced module content must be preserved';
  end if;
  -- M5 is optional in older installations. Inspect existing history only;
  -- this migration does not alter M5 schema or scoring/delivery behavior.
  if to_regclass('public.oral_reading_attempts') is not null then
    execute 'select exists(select 1 from public.oral_reading_attempts where module_id=$1)' into has_history using target_id;
    if has_history then raise exception 'Oral-reading history must be preserved'; end if;
  end if;
end; $$;

create function public.m3_save_collection(target_id uuid, expected_revision bigint,
  module_title text, target_path uuid, module_difficulty text,
  passage_drafts jsonb, removed_ids uuid[] default '{}')
returns bigint language plpgsql security definer set search_path = '' as $$
declare item jsonb; existing_passage public.module_passages%rowtype; position integer:=0; revision bigint;
begin
  perform public.m3_lock_collection(target_id,expected_revision);
  if nullif(btrim(module_title),'') is null then raise exception 'Module title is required'; end if;
  if not exists(select 1 from public.learning_paths where id=target_path) then raise exception 'Select a valid learning path'; end if;
  if module_difficulty is null or module_difficulty not in ('Easy','Medium','Hard') then raise exception 'Select a valid difficulty'; end if;
  if jsonb_typeof(passage_drafts) is distinct from 'array' or removed_ids is null then raise exception 'Invalid passage changes'; end if;
  if exists(select 1 from unnest(removed_ids) as removed(id) where not exists(select 1 from public.module_passages p where p.id=removed.id and p.module_id=target_id)) then raise exception 'Removal belongs to another module'; end if;
  if exists(select 1 from public.comprehension_questions where passage_id=any(removed_ids)) then raise exception 'Remove a passage only after explicitly deleting its question bank'; end if;
  -- Require explicit removal; stale/partial submissions must never delete children.
  if exists(select 1 from public.module_passages p where p.module_id=target_id and not(p.id=any(removed_ids))
    and not exists(select 1 from jsonb_array_elements(passage_drafts) j where j->>'id'=p.id::text)) then raise exception 'Passage omitted; reload or explicitly remove it'; end if;
  if (select count(*) from jsonb_array_elements(passage_drafts)) <> (select count(distinct j->>'id') from jsonb_array_elements(passage_drafts) j) then raise exception 'Duplicate passage IDs'; end if;
  set constraints public.module_passages_order deferred;
  delete from public.module_passages where module_id=target_id and id=any(removed_ids);
  for item in select value from jsonb_array_elements(passage_drafts) loop
    position:=position+1;
    if jsonb_typeof(item->'title') is distinct from 'string' or jsonb_typeof(item->'passageText') is distinct from 'string' or nullif(item->>'id','') is null
      or (item->>'id')::uuid=any(removed_ids) then raise exception 'Invalid passage content or identity'; end if;
    select * into existing_passage from public.module_passages where id=(item->>'id')::uuid;
    if found then
      if existing_passage.module_id<>target_id then raise exception 'Passage belongs to another module'; end if;
      if existing_passage.passage_text is distinct from btrim(item->>'passageText')
        or target_path is distinct from (select path_id from public.modules where id=target_id) then
        update public.comprehension_questions set review_status='generated' where passage_id=existing_passage.id;
      end if;
      update public.module_passages set title=btrim(item->>'title'),passage_text=btrim(item->>'passageText'),display_order=position
      where id=existing_passage.id;
      -- Existing provenance is deliberately preserved; text extraction has none.
      if nullif(item->>'sourceMaterialId','')::uuid is distinct from existing_passage.source_material_id then raise exception 'Existing source provenance cannot be changed here'; end if;
    else
      insert into public.module_passages(id,module_id,title,passage_text,display_order,source_material_id)
      values((item->>'id')::uuid,target_id,btrim(item->>'title'),btrim(item->>'passageText'),position,nullif(item->>'sourceMaterialId','')::uuid);
    end if;
  end loop;
  insert into public.m3_pending_collection_delivery values(target_id) on conflict do nothing;
  -- Keep legacy text unchanged; this collection cannot publish until M5 cutover.
  update public.modules set title=btrim(module_title),path_id=target_path,difficulty=module_difficulty
    where id=target_id returning collection_revision into revision;
  set constraints public.module_passages_order immediate;
  return revision;
end; $$;

-- A single snapshot avoids pairing an old bank with a newer revision.
create function public.m3_admin_collection(target_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if public.m3_current_role() is distinct from 'admin' then raise exception 'Admin access required'; end if;
  select jsonb_build_object('id',m.id,'title',m.title,'learningPathId',m.path_id,'difficulty',m.difficulty,
    'status',m.status,'publishedAt',m.published_at,'revision',m.collection_revision,
    'language',(select language from public.learning_paths where id=m.path_id),
    'passages',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'passageText',p.passage_text,
      'sourceMaterialId',p.source_material_id,'displayOrder',p.display_order,
      'questions',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'type',q.question_type,'questionText',q.question_text,
        'options',q.options,'scaffoldingHint',q.scaffolding_hint,'correctAnswer',a.correct_answer,'reviewStatus',q.review_status) order by q.display_order)
        from public.comprehension_questions q left join public.comprehension_question_answers a on a.question_id=q.id
        where q.passage_id=p.id and q.module_id=m.id and q.material_id is null),'[]'::jsonb)) order by p.display_order)
      from public.module_passages p where p.module_id=m.id),'[]'::jsonb)) into result from public.modules m where m.id=target_id;
  if result is null then raise exception 'Module not found'; end if;
  return result;
end; $$;

create function public.m3_save_passage_bank(target_id uuid, target_passage uuid, expected_revision bigint,
  bank jsonb, bank_action text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare item jsonb; position integer:=0; question_id uuid; revision bigint; category text;
begin
  perform public.m3_lock_collection(target_id,expected_revision);
  if not exists(select 1 from public.module_passages where id=target_passage and module_id=target_id) then raise exception 'Passage belongs to another module'; end if;
  if bank_action is null or bank_action not in ('generate','review','delete') or jsonb_typeof(bank) is distinct from 'array' then raise exception 'Invalid bank action'; end if;
  if bank_action='delete' then
    if jsonb_array_length(bank)<>0 then raise exception 'Delete requires an empty bank'; end if;
    delete from public.comprehension_questions where passage_id=target_passage and module_id=target_id;
  else
    if jsonb_array_length(bank)<>6 then raise exception 'Exactly six questions are required'; end if;
    foreach category in array array['literal','inferential','critical'] loop
      if (select count(*) from jsonb_array_elements(bank) j where j->>'type'=category)<>2 then raise exception 'Exactly two % questions are required',category; end if;
    end loop;
    if bank_action='generate' then
      delete from public.comprehension_questions where passage_id=target_passage and module_id=target_id;
    elsif (select count(*) from public.comprehension_questions where passage_id=target_passage)<>6
      or (select count(distinct j->>'id') from jsonb_array_elements(bank) j)<>6 then raise exception 'Review must preserve all six question IDs'; end if;
    for item in select value from jsonb_array_elements(bank) loop
      position:=position+1;
      if jsonb_typeof(item->'options') is distinct from 'array' then raise exception 'Invalid question options'; end if;
      if jsonb_array_length(item->'options')<>4 or (select count(distinct lower(btrim(v))) from jsonb_array_elements_text(item->'options') v)<>4
        or exists(select 1 from jsonb_array_elements(item->'options') v where jsonb_typeof(v)<>'string' or nullif(btrim(v#>>'{}'),'') is null)
        or nullif(btrim(item->>'questionText'),'') is null or nullif(btrim(item->>'scaffoldingHint'),'') is null
        or not coalesce((item->'options') ? (item->>'correctAnswer'),false) then raise exception 'Invalid question or answer key'; end if;
      if bank_action='generate' then
        question_id:=gen_random_uuid();
        insert into public.comprehension_questions(id,module_id,passage_id,question_type,question_text,options,scaffolding_hint,display_order,generated_by_ai,review_status)
        values(question_id,target_id,target_passage,item->>'type',item->>'questionText',item->'options',item->>'scaffoldingHint',position,true,'generated');
      else
        question_id:=(item->>'id')::uuid;
        if not exists(select 1 from public.comprehension_questions where id=question_id and passage_id=target_passage and module_id=target_id) then raise exception 'Question belongs to another passage'; end if;
        update public.comprehension_questions set question_type=item->>'type',question_text=item->>'questionText',options=item->'options',scaffolding_hint=item->>'scaffoldingHint',review_status='reviewed' where id=question_id;
      end if;
      insert into public.comprehension_question_answers(question_id,correct_answer) values(question_id,item->>'correctAnswer')
      on conflict on constraint comprehension_question_answers_pkey do update set correct_answer=excluded.correct_answer;
    end loop;
  end if;
  update public.modules set title=title where id=target_id returning collection_revision into revision;
  return revision;
end; $$;

-- Exact current generator policy; keep Phase 1 checks including isolated keys.
alter function public.m3_collection_publish_issues(uuid) rename to m3_collection_publish_issues_phase1;
revoke all on function public.m3_collection_publish_issues_phase1(uuid) from public,anon,authenticated;
create function public.m3_collection_publish_issues(target_id uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare issues text[]; p record; category text;
begin
  issues:=public.m3_collection_publish_issues_phase1(target_id);
  for p in select id,display_order from public.module_passages where module_id=target_id loop
    foreach category in array array['literal','inferential','critical'] loop
      if (select count(*) from public.comprehension_questions where passage_id=p.id and question_type=category)<>2 then
        issues:=array_append(issues,format('Passage %s requires exactly two %s questions',p.display_order,category));
      end if;
    end loop;
  end loop;
  return issues;
end; $$;

create function public.m3_validate_collection_publish() returns trigger
language plpgsql security definer set search_path = '' as $$
declare issues text[];
begin
  if new.status='published' and old.status is distinct from 'published' then
    issues:=public.m3_collection_publish_issues(new.id);
    if cardinality(issues)>0 then raise exception '%',array_to_string(issues,'; '); end if;
  end if;
  return new;
end; $$;
create trigger modules_collection_publish_validation before update on public.modules
for each row execute function public.m3_validate_collection_publish();

-- A direct Admin prompt/key write must also participate in concurrency and
-- historical protection; material workflows retain their existing behavior.
create function public.m3_collection_bank_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare parent_id uuid; question_id uuid; revision bigint;
begin
  if tg_table_name='comprehension_questions' then
    if tg_op='DELETE' then parent_id:=old.module_id; else parent_id:=new.module_id; end if;
  else
    if tg_op='DELETE' then question_id:=old.question_id; else question_id:=new.question_id; end if;
    select module_id into parent_id from public.comprehension_questions where id=question_id;
  end if;
  if parent_id is not null then
    select collection_revision into revision from public.modules where id=parent_id for update;
    perform public.m3_lock_collection(parent_id,revision);
    update public.modules set title=title where id=parent_id;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end; $$;
create trigger questions_collection_change before insert or update or delete on public.comprehension_questions
for each row execute function public.m3_collection_bank_changed();
create trigger answers_collection_change before insert or update or delete on public.comprehension_question_answers
for each row execute function public.m3_collection_bank_changed();

revoke all on function public.m3_collection_revision_trigger(), public.m3_lock_collection(uuid,bigint),
  public.m3_save_collection(uuid,bigint,text,uuid,text,jsonb,uuid[]),public.m3_admin_collection(uuid),
  public.m3_save_passage_bank(uuid,uuid,bigint,jsonb,text),public.m3_collection_publish_issues(uuid),
  public.m3_validate_collection_publish(),public.m3_collection_bank_changed() from public,anon,authenticated;
grant execute on function public.m3_save_collection(uuid,bigint,text,uuid,text,jsonb,uuid[]),
  public.m3_admin_collection(uuid),public.m3_save_passage_bank(uuid,uuid,bigint,jsonb,text),
  public.m3_collection_publish_issues(uuid) to authenticated;
commit;

