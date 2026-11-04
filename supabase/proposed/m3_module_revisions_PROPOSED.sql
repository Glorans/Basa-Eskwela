-- PROPOSAL ONLY. NOT APPLIED. See docs/M3_M4_FINAL_REPORT.md and docs/M3_M4_ROLLOUT_RUNBOOK.md.
-- "Revise Module": an Admin creates a separate editable draft copy of a published module.
--   * The published original is never changed (no UPDATE of it, its passages, questions or keys).
--   * The revision gets NEW module, passage and question IDs; answer keys, explanations and evidence
--     are copied; every copied question is set back to 'generated', so the bank must be reviewed again.
--   * The revision is published through the normal readiness checks and trigger.
--   * Existing classroom assignments, attempts, results and XP keep referencing the original IDs.
-- Approved policy: the original stays published and visible; the revision is a separate draft.
-- Publishing the revision does not hide the original. Learners may earn module XP for the new
-- module ID under the existing M8 once-per-module rule; all existing history is preserved.
-- No M8, M5 or M6 function is changed.
-- Gate: the app shows "Revise Module" only when m3_module_revisions(uuid) exists.
-- Rollback: m3_module_revisions_ROLLBACK_PROPOSED.sql (refuses while revision links exist).
begin;
set local lock_timeout = '5s';

alter table public.modules
  add column revision_of uuid references public.modules(id) on delete restrict,
  add column revision_root uuid references public.modules(id) on delete restrict,
  add column revision_number integer,
  add constraint modules_revision_consistent check (
    (revision_of is null and revision_root is null and revision_number is null)
    or (revision_of is not null and revision_root is not null and revision_number >= 2));
create unique index modules_revision_number on public.modules(revision_root, revision_number) where revision_root is not null;
-- At most one open (draft, not in Trash) revision per source.
create unique index modules_one_open_revision on public.modules(revision_of)
  where revision_of is not null and status = 'draft' and deleted_at is null;

-- Revision links are written once, by m3_revise_module, and never changed.
create function public.m3_protect_revision_link() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    if new.revision_of is not null and current_setting('m3.revise_module', true) is distinct from new.revision_of::text then
      raise exception using errcode = '42501', message = 'Use Revise Module to create a module revision';
    end if;
  elsif new.revision_of is distinct from old.revision_of or new.revision_root is distinct from old.revision_root
     or new.revision_number is distinct from old.revision_number then
    raise exception using errcode = '42501', message = 'Module revision links cannot be changed';
  end if;
  return new;
end $$;
revoke all on function public.m3_protect_revision_link() from public, anon, authenticated;
create trigger m3_protect_revision_link before insert or update of revision_of, revision_root, revision_number
  on public.modules for each row execute function public.m3_protect_revision_link();

create function public.m3_revise_module(source_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  source public.modules%rowtype;
  open_revision uuid;
  new_id uuid := gen_random_uuid();
  root uuid;
  next_number integer;
  p record;
  q record;
  passage_map jsonb := '{}'::jsonb;
  new_passage uuid;
  new_question uuid;
begin
  if auth.uid() is null or public.m3_current_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Admin access is required to revise reading modules';
  end if;
  -- FOR SHARE: the original cannot change or be deleted while it is copied.
  select * into source from public.modules where id = source_id for share;
  if not found then raise exception 'Reading module not found; refresh the list'; end if;
  if source.deleted_at is not null then
    raise exception using errcode = '22023', message = 'Restore this module from the Trash before revising it';
  end if;
  if source.published_at is null then
    raise exception using errcode = '22023', message = 'Only published modules are revised; edit the draft directly';
  end if;
  select id into open_revision from public.modules
    where revision_of = source_id and status = 'draft' and deleted_at is null;
  if open_revision is not null then return open_revision; end if; -- continue the existing draft

  perform 1 from public.module_passages where module_id = source_id for share;
  perform 1 from public.comprehension_questions where module_id = source_id for share;
  root := coalesce(source.revision_root, source.id);
  perform 1 from public.modules where id = root for update; -- serializes numbering within a family
  select coalesce(max(revision_number), 1) + 1 into next_number from public.modules where revision_root = root;

  perform set_config('m3.revise_module', source_id::text, true);
  insert into public.modules(id, title, path_id, difficulty, status, created_by, passage, source_material_id,
                             revision_of, revision_root, revision_number)
  values (new_id, source.title, source.path_id, source.difficulty, 'draft', auth.uid(), source.passage,
          source.source_material_id, source_id, root, next_number);
  perform set_config('m3.revise_module', '', true);
  insert into public.m3_pending_collection_delivery(module_id) values (new_id) on conflict do nothing;

  for p in select * from public.module_passages where module_id = source_id order by display_order loop
    new_passage := gen_random_uuid();
    passage_map := passage_map || jsonb_build_object(p.id::text, new_passage);
    insert into public.module_passages(id, module_id, title, passage_text, display_order, source_material_id)
    values (new_passage, new_id, p.title, p.passage_text, p.display_order, p.source_material_id);
  end loop;

  for q in select cq.*, a.correct_answer, a.answer_explanation, a.supporting_evidence
           from public.comprehension_questions cq
           left join public.comprehension_question_answers a on a.question_id = cq.id
           where cq.module_id = source_id and cq.material_id is null
           order by cq.display_order loop
    new_question := gen_random_uuid();
    insert into public.comprehension_questions(id, module_id, passage_id, question_type, question_text, options,
      scaffolding_hint, display_order, generated_by_ai, review_status)
    values (new_question, new_id, (passage_map->>(q.passage_id::text))::uuid, q.question_type, q.question_text,
      q.options, q.scaffolding_hint, q.display_order, q.generated_by_ai, 'generated');
    if q.correct_answer is not null then
      insert into public.comprehension_question_answers(question_id, correct_answer, answer_explanation, supporting_evidence)
      values (new_question, q.correct_answer, q.answer_explanation, q.supporting_evidence);
    end if;
  end loop;
  return new_id;
end $$;

-- Versions of a module's family (Admin view; also the UI capability gate).
create function public.m3_module_revisions(target_id uuid) returns table (
  id uuid, title text, status text, revision_number integer, revision_of uuid, published_at timestamptz,
  created_at timestamptz, in_trash boolean
) language plpgsql stable security definer set search_path = '' as $$
declare root uuid;
begin
  if auth.uid() is null or public.m3_current_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Admin access is required';
  end if;
  select coalesce(m.revision_root, m.id) into root from public.modules m where m.id = target_id;
  return query
    select m.id, m.title, m.status, coalesce(m.revision_number, 1), m.revision_of, m.published_at, m.created_at, m.deleted_at is not null
    from public.modules m where m.id = root or m.revision_root = root
    order by coalesce(m.revision_number, 1);
end $$;

revoke all on function public.m3_revise_module(uuid) from public, anon;
revoke all on function public.m3_module_revisions(uuid) from public, anon;
grant execute on function public.m3_revise_module(uuid), public.m3_module_revisions(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
