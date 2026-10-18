-- REVIEW / DEPLOYMENT REQUIRED. Do not run automatically.

-- Apply after M3 content, RLS, passage Phase 1/2 and collection publication migrations.

-- No new cascading FK or permissive RLS policies. Existing read policies remain

-- so assigned/historical reading can still resolve the retained content.

begin;

alter table public.modules add column deleted_at timestamptz;

create index modules_active_created_idx on public.modules(created_at desc) where deleted_at is null;



-- Private transaction-scoped authorization marker, never client-writable.

-- Allows ONLY this checked RPC to remove an unused published question bank.

create table public.m3_deletion_context (

  module_id uuid primary key, transaction_id bigint not null

);

alter table public.m3_deletion_context enable row level security;

revoke all on public.m3_deletion_context from public, anon, authenticated;



create function public.m3_protect_deleted_module() returns trigger

language plpgsql security definer set search_path = '' as $$

begin

  if tg_op='DELETE' then

    if old.deleted_at is not null then raise exception 'Deleted modules must retain their historical records'; end if;

    return old;

  elsif tg_op='INSERT' then

    if new.deleted_at is not null then raise exception 'Modules cannot be created deleted'; end if;

  elsif old.deleted_at is not null then

    raise exception 'Deleted modules are retained for history and cannot be changed';

  elsif new.deleted_at is not null and not exists (

    select 1 from public.m3_deletion_context where module_id=old.id and transaction_id=txid_current()

  ) then

    raise exception 'Use the Admin module deletion operation';

  end if;

  return new;

end; $$;

create trigger modules_protect_deleted before insert or update or delete on public.modules

for each row execute function public.m3_protect_deleted_module();



-- New assignments serialize with deletion on the module row. Existing

-- assignments are neither removed nor changed and keep their completion rules.

create function public.m3_reject_deleted_assignment() returns trigger

language plpgsql security definer set search_path = '' as $$

declare removed timestamptz;

begin

  if tg_op='UPDATE' then

    if new.module_id is not distinct from old.module_id then return new; end if;

  end if;

  select deleted_at into removed from public.modules where id=new.module_id for key share;

  if removed is not null then raise exception 'This reading module was deleted and cannot be assigned'; end if;

  return new;

end; $$;

create trigger room_modules_reject_deleted before insert or update of module_id on public.room_modules

for each row execute function public.m3_reject_deleted_assignment();



create or replace function public.m3_collection_bank_changed() returns trigger

language plpgsql security definer set search_path = '' as $$

declare parent_id uuid; question_id uuid; revision bigint;

begin

  if tg_table_name='comprehension_questions' then

    if tg_op='DELETE' then parent_id:=old.module_id; else parent_id:=new.module_id; end if;

  else

    if tg_op='DELETE' then question_id:=old.question_id; else question_id:=new.question_id; end if;

    select module_id into parent_id from public.comprehension_questions where id=question_id;

  end if;

  if tg_op='DELETE' and exists(select 1 from public.m3_deletion_context where module_id=parent_id and transaction_id=txid_current()) then return old; end if;

  if parent_id is not null then

    select collection_revision into revision from public.modules where id=parent_id for update;

    perform public.m3_lock_collection(parent_id,revision);

    update public.modules set title=title where id=parent_id;

  end if;

  if tg_op='DELETE' then return old; else return new; end if;

end; $$;



-- Called only by the checked RPC. Enumerate incoming FKs to the module AND

-- owned children, including extension tables, before deleting anything. Any

-- unknown composite relationship conservatively requires soft deletion.

create function public.m3_deletion_has_history(target_id uuid) returns boolean

language plpgsql security definer set search_path = '' as $$

declare edge record; found_reference boolean; owned_ids uuid[];

begin

  -- Malformed cross-module passage links must never cause another module's

  -- questions to be deleted or left dangling.

  if exists(select 1 from public.comprehension_questions q join public.module_passages p on p.id=q.passage_id

    where p.module_id=target_id and q.module_id is distinct from target_id) then return true; end if;

  if exists(select 1 from public.room_modules where module_id=target_id)

    or exists(select 1 from public.progress where module_id=target_id) then return true; end if;

  if to_regclass('public.oral_reading_attempts') is not null then

    execute 'select exists(select 1 from public.oral_reading_attempts where module_id=$1)' into found_reference using target_id;

    if found_reference then return true; end if;

  end if;

  for edge in

    select c.conrelid, c.confrelid, c.conkey, c.confkey,

      a.attname as source_column, b.attname as target_column,

      array(select att.attname::text from unnest(c.conkey) with ordinality k(num,pos)

        join pg_catalog.pg_attribute att on att.attrelid=c.conrelid and att.attnum=k.num order by k.pos) as source_columns,

      array(select att.attname::text from unnest(c.confkey) with ordinality k(num,pos)

        join pg_catalog.pg_attribute att on att.attrelid=c.confrelid and att.attnum=k.num order by k.pos) as target_columns

    from pg_catalog.pg_constraint c

    left join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]

    left join pg_catalog.pg_attribute b on b.attrelid=c.confrelid and b.attnum=c.confkey[1]

    where c.contype='f' and c.confrelid in ('public.modules'::regclass,

      'public.module_passages'::regclass,'public.comprehension_questions'::regclass,

      'public.comprehension_question_answers'::regclass)

  loop

    if edge.confrelid='public.module_passages'::regclass and edge.conrelid='public.comprehension_questions'::regclass

      and edge.source_columns=array['passage_id','module_id'] and edge.target_columns=array['id','module_id'] then continue; end if;

    if cardinality(edge.conkey)<>1 or cardinality(edge.confkey)<>1 then return true; end if;

    -- Only these exact edges represent exclusively owned content.

    if edge.confrelid='public.modules'::regclass and edge.target_column='id' and edge.source_column='module_id'

      and edge.conrelid in ('public.module_passages'::regclass,'public.comprehension_questions'::regclass,'public.m3_pending_collection_delivery'::regclass) then continue; end if;

    if edge.confrelid='public.module_passages'::regclass and edge.target_column='id'

      and edge.conrelid='public.comprehension_questions'::regclass and edge.source_column='passage_id' then continue; end if;

    if edge.confrelid='public.comprehension_questions'::regclass and edge.target_column='id'

      and edge.conrelid='public.comprehension_question_answers'::regclass and edge.source_column='question_id' then continue; end if;

    if edge.confrelid='public.modules'::regclass then

      if edge.target_column<>'id' then return true; end if;

      owned_ids:=array[target_id];

    elsif edge.confrelid='public.module_passages'::regclass then

      if edge.target_column<>'id' then return true; end if;

      select array_agg(id) into owned_ids from public.module_passages where module_id=target_id;

    else

      if (edge.confrelid='public.comprehension_questions'::regclass and edge.target_column<>'id')

        or (edge.confrelid='public.comprehension_question_answers'::regclass and edge.target_column<>'question_id') then return true; end if;

      select array_agg(id) into owned_ids from public.comprehension_questions where module_id=target_id;

    end if;

    execute format('select exists(select 1 from %s where %I = any($1))',edge.conrelid::regclass,edge.source_column)

      into found_reference using owned_ids;

    if found_reference then return true; end if;

  end loop;

  return false;

end; $$;



create function public.m3_delete_module(target_id uuid) returns text

language plpgsql security definer set search_path = '' as $$

declare m public.modules%rowtype; preserve boolean;

begin

  if auth.uid() is null or public.m3_current_role() is distinct from 'admin' then

    raise exception using errcode='42501', message='Admin access is required to delete reading modules';

  end if;

  select * into m from public.modules where id=target_id for update;

  if not found then raise exception 'Reading module not found; refresh the list'; end if;

  if m.deleted_at is not null then return 'soft'; end if;

  -- Lock all owned records before checking incoming references. Concurrent FK

  -- inserts cannot acquire key-share locks until this operation commits.

  perform id from public.module_passages where module_id=target_id order by id for update;

  perform id from public.comprehension_questions where module_id=target_id order by id for update;

  perform a.question_id from public.comprehension_question_answers a join public.comprehension_questions q on q.id=a.question_id

    where q.module_id=target_id order by a.question_id for update of a;

  preserve:=public.m3_deletion_has_history(target_id);

  insert into public.m3_deletion_context values(target_id,txid_current());

  if not preserve then

    begin

      -- Shared uploaded_materials, their Storage files and material-scoped sets

      -- are independent uploader-owned sources, never owned by this module.

      delete from public.comprehension_question_answers where question_id in

        (select id from public.comprehension_questions where module_id=target_id);

      delete from public.comprehension_questions where module_id=target_id;

      delete from public.module_passages where module_id=target_id;

      delete from public.m3_pending_collection_delivery where module_id=target_id;

      delete from public.modules where id=target_id;

    exception when foreign_key_violation then

      -- Whole subtransaction rolls back, including all owned child deletions.

      preserve:=true;

    end;

  end if;

  if preserve then

    update public.modules set deleted_at=clock_timestamp() where id=target_id;

  end if;

  delete from public.m3_deletion_context where module_id=target_id;

  return case when preserve then 'soft' else 'permanent' end;

end; $$;

revoke all on function public.m3_protect_deleted_module(),public.m3_reject_deleted_assignment(),

  public.m3_deletion_has_history(uuid),public.m3_delete_module(uuid) from public,anon,authenticated;

grant execute on function public.m3_delete_module(uuid) to authenticated;

-- Clients may read deleted_at; no client write grant is introduced.

grant select (deleted_at) on public.modules to authenticated;

commit;
