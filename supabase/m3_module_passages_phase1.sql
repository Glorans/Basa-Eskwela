-- REVIEW-ONLY PHASE 1. DO NOT APPLY AUTOMATICALLY.
-- Requires m3_content_schema.sql and the audited live M3 RLS helpers.
-- Apply once, in a maintenance window with content writes stopped. Phase 2
-- must replace legacy module writers before writes resume. See docs/m3-module-passages.md.
begin;
lock table public.modules, public.comprehension_questions in share row exclusive mode;

-- Abort rather than orphan module questions that have no passage to assess.
do $$
begin
  if exists (
    select 1 from public.comprehension_questions q join public.modules m on m.id = q.module_id
    where nullif(btrim(m.passage), '') is null
  ) then
    raise exception 'Repair module question banks with missing legacy passage text before migration';
  end if;
end;
$$;

create table public.module_passages (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.modules(id) on delete restrict,
  title text not null default '',
  passage_text text not null default '',
  display_order integer not null check (display_order > 0),
  source_material_id uuid references public.uploaded_materials(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint module_passages_title_length check (length(btrim(title)) <= 200),
  constraint module_passages_identity unique (id, module_id),
  constraint module_passages_order unique (module_id, display_order) deferrable initially deferred
);
-- RESTRICT is intentional: deleting source material cannot remove final content;
-- an Admin can explicitly clear provenance before following existing deletion rules.
create index module_passages_source_idx on public.module_passages(source_material_id)
  where source_material_id is not null;

-- A legacy first passage uses its module UUID in a separate ID namespace.
-- Text, provenance and timestamps are copied exactly, without trimming/OCR.
insert into public.module_passages (id, module_id, title, passage_text, display_order, source_material_id, created_at, updated_at)
select id, id, title, passage, 1, source_material_id, created_at, updated_at
from public.modules where nullif(btrim(passage), '') is not null;

alter table public.comprehension_questions add column passage_id uuid;
-- module_id stays as a compatibility parent relation (NOT a second bank).
-- The existing module/material XOR remains in force. Composite FK prevents a
-- passage in another module from being used with this compatibility link.
alter table public.comprehension_questions
  add constraint comprehension_questions_passage_parent_fkey
    foreign key (passage_id, module_id) references public.module_passages(id, module_id) on delete restrict,
  add constraint comprehension_questions_passage_source_check
    check (passage_id is null or (module_id is not null and material_id is null));

-- Existing metadata trigger permits this newly added field; it does not change
-- review metadata. Suspend only the timestamp trigger during the locked backfill.
alter table public.comprehension_questions disable trigger comprehension_questions_set_updated_at;
update public.comprehension_questions set passage_id = module_id where module_id is not null;
-- UPDATE queues the existing deferred option/key check even when options are
-- unchanged. Drain it before ALTER TABLE restores the timestamp trigger.
set constraints public.comprehension_questions_validate_changed_options immediate;
set constraints public.comprehension_questions_validate_changed_options deferred;
alter table public.comprehension_questions enable trigger comprehension_questions_set_updated_at;

do $$
begin
  if exists (
    select 1 from public.modules m left join public.module_passages p on p.id = m.id and p.module_id = m.id
    where nullif(btrim(m.passage), '') is not null
      and (p.id is null or p.passage_text is distinct from m.passage or p.display_order <> 1)
  ) or exists (
    select 1 from public.comprehension_questions where module_id is not null and passage_id is distinct from module_id
  ) then raise exception 'Legacy passage/question backfill verification failed'; end if;
end;
$$;


-- Each passage starts its own question ordering. Legacy unassigned module banks
-- keep their existing uniqueness constraint during the compatibility period.
drop index public.comprehension_questions_module_order_key;
create unique index comprehension_questions_module_order_key
  on public.comprehension_questions(module_id, display_order) where module_id is not null and passage_id is null;
create unique index comprehension_questions_passage_order_key
  on public.comprehension_questions(passage_id, display_order) where passage_id is not null;

create function public.m3_protect_passage_identity()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.module_id is distinct from old.module_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Passage identity and module are immutable';
  end if;
  return new;
end;
$$;
create trigger module_passages_identity before update on public.module_passages
  for each row execute function public.m3_protect_passage_identity();
create trigger module_passages_updated_at before update on public.module_passages
  for each row execute function public.m3_set_updated_at();

create function public.m3_protect_question_passage()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.passage_id is distinct from old.passage_id then
    raise exception 'Question passage is immutable; copy questions into a different bank';
  end if;
  return new;
end;
$$;
create trigger comprehension_questions_passage_identity before update on public.comprehension_questions
  for each row execute function public.m3_protect_question_passage();

alter table public.module_passages enable row level security;
revoke all on public.module_passages from public, anon, authenticated;
grant select on public.module_passages to authenticated;
create policy "M3 authorized passage reads" on public.module_passages for select to authenticated
  using (public.m3_can_read_module(module_id));
-- No direct client writes in this expansion phase. The transaction below is
-- the only new write surface. Old module/material/answer-key policies stay intact.

create table public.m3_pending_collection_delivery (
  module_id uuid primary key references public.modules(id) on delete cascade
);
alter table public.m3_pending_collection_delivery enable row level security;
revoke all on public.m3_pending_collection_delivery from public, anon, authenticated;

-- Transactional creation of a normalized draft. Not wired to the current UI.
-- All IDs are supplied once by the caller; retries cannot create duplicate IDs.
create function public.m3_create_collection_draft(target_id uuid, module_title text, target_path uuid,
  module_difficulty text, passage_drafts jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare item jsonb; position integer := 0;
begin
  if public.m3_current_role() is distinct from 'admin' then raise exception 'Admin access required'; end if;
  if target_id is null or nullif(btrim(module_title), '') is null then raise exception 'Module ID and title are required'; end if;
  if not exists (select 1 from public.learning_paths where id = target_path) then raise exception 'Select a valid learning path'; end if;
  if module_difficulty is null or module_difficulty not in ('Easy', 'Medium', 'Hard') then raise exception 'Select a valid difficulty'; end if;
  if passage_drafts is null or jsonb_typeof(passage_drafts) <> 'array' then raise exception 'Passages must be an array'; end if;
  -- No automatic publication. Blank passage drafts and empty question banks are valid.
  insert into public.modules(id, title, path_id, difficulty, status, created_by, passage)
  values (target_id, btrim(module_title), target_path, module_difficulty, 'draft', auth.uid(),
    case when jsonb_array_length(passage_drafts) = 1 then passage_drafts->0->>'passageText' else null end);
  insert into public.m3_pending_collection_delivery(module_id) values (target_id);
  for item in select value from jsonb_array_elements(passage_drafts) loop
    position := position + 1;
    if jsonb_typeof(item) <> 'object' or nullif(item->>'id', '') is null
      or jsonb_typeof(item->'title') is distinct from 'string'
      or jsonb_typeof(item->'passageText') is distinct from 'string' then
      raise exception 'Passage % has invalid identity or content', position;
    end if;
    insert into public.module_passages(id, module_id, title, passage_text, display_order, source_material_id)
    values ((item->>'id')::uuid, target_id, btrim(item->>'title'), btrim(item->>'passageText'), position,
      nullif(item->>'sourceMaterialId', '')::uuid);
  end loop;
  return target_id;
end;
$$;

-- Authoritative readiness check for the future Admin publish transaction.
-- Admin-only and answer-free: never return answer rows, even to authenticated learners.
create function public.m3_collection_publish_issues(target_id uuid)
returns text[] language plpgsql security definer set search_path = '' as $$
declare m public.modules%rowtype; p public.module_passages%rowtype;
  issues text[] := '{}'; category text; total integer;
begin
  if public.m3_current_role() is distinct from 'admin' then raise exception 'Admin access required'; end if;
  select * into m from public.modules where id = target_id;
  if not found then return array['Module not found']; end if;
  if nullif(btrim(m.title), '') is null then issues := array_append(issues, 'Module title is required'); end if;
  if not exists (select 1 from public.learning_paths where id = m.path_id) then issues := array_append(issues, 'Valid learning path is required'); end if;
  if m.difficulty is null or m.difficulty not in ('Easy', 'Medium', 'Hard') then issues := array_append(issues, 'Valid difficulty is required'); end if;
  if not exists (select 1 from public.module_passages where module_id = target_id) then
    issues := array_append(issues, 'At least one passage is required');
  end if;
  for p in select * from public.module_passages where module_id = target_id order by display_order loop
    if nullif(btrim(p.title), '') is null then issues := array_append(issues, format('Passage %s needs a title', p.display_order)); end if;
    if nullif(btrim(p.passage_text), '') is null then issues := array_append(issues, format('Passage %s needs reading text', p.display_order)); end if;
    select count(*) into total from public.comprehension_questions where passage_id = p.id;
    if total = 0 then issues := array_append(issues, format('Passage %s has no reviewed comprehension questions', p.display_order)); end if;
    if exists (select 1 from public.comprehension_questions where passage_id = p.id and review_status <> 'reviewed') then
      issues := array_append(issues, format('Passage %s has questions that need review', p.display_order));
    end if;
    foreach category in array array['literal', 'inferential', 'critical'] loop
      if (select count(*) from public.comprehension_questions where passage_id = p.id and question_type = category) < 2 then
        issues := array_append(issues, format('Passage %s needs at least 2 %s questions', p.display_order, category));
      end if;
    end loop;
    if exists (
      select 1 from public.comprehension_questions q left join public.comprehension_question_answers a on a.question_id = q.id
      where q.passage_id = p.id and (a.question_id is null or not (q.options ? a.correct_answer))
    ) then issues := array_append(issues, format('Passage %s has missing or invalid answer keys', p.display_order)); end if;
  end loop;
  return issues;
end;
$$;

-- Fail closed for newly created normalized drafts until the coordinated UI/M5/M6
-- cutover supplies transactional edits, question persistence and passage delivery.
-- Existing backfilled module behavior is not altered by this guard.
create function public.m3_mark_pending_collection()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Legacy backfill ran before this trigger was installed.
  insert into public.m3_pending_collection_delivery(module_id) values (new.module_id) on conflict do nothing;
  return new;
end;
$$;
create trigger module_passages_pending_delivery after insert on public.module_passages
  for each row execute function public.m3_mark_pending_collection();
create function public.m3_block_pending_collection_publish()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'published' and exists (
    select 1 from public.m3_pending_collection_delivery where module_id = new.id
  ) then raise exception 'Passage-aware learner delivery is not enabled; keep this collection as a draft'; end if;
  return new;
end;
$$;
create trigger modules_pending_collection_publish before update on public.modules
  for each row execute function public.m3_block_pending_collection_publish();

revoke all on function public.m3_protect_passage_identity() from public, anon, authenticated;
revoke all on function public.m3_protect_question_passage() from public, anon, authenticated;
revoke all on function public.m3_mark_pending_collection() from public, anon, authenticated;
revoke all on function public.m3_block_pending_collection_publish() from public, anon, authenticated;
revoke all on function public.m3_create_collection_draft(uuid, text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.m3_collection_publish_issues(uuid) from public, anon, authenticated;
grant execute on function public.m3_create_collection_draft(uuid, text, uuid, text, jsonb) to authenticated;
grant execute on function public.m3_collection_publish_issues(uuid) to authenticated;

comment on column public.comprehension_questions.passage_id is 'Canonical bank identity for normalized module passages; module_id is a transitional compatibility parent.';
comment on table public.module_passages is 'Individual reviewed reading texts within a module. No recording or learner answering belongs here.';
-- No changes to modules.passage, source-material deletion rules or answer-key grants.
commit;
