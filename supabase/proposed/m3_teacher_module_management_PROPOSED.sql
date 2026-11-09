-- ============================================================================
-- PROPOSED - NOT APPLIED. Do not run without explicit approval.
-- M3: approved Teachers manage (create, edit, delete, publish) the reading modules they created.
-- ============================================================================
--
-- Scope: Module 3 objects only. Admin access is unchanged. No M1/M4/M5/M6/M7/M8 object,
-- policy, trigger or data is changed, and no row is written.
--
-- Who may manage a module: m3_can_manage_module(target) = Admin, or an APPROVED Teacher
-- who is modules.created_by. m3_current_role() already returns 'teacher' only when
-- teacher_status = 'approved', so pending/rejected Teachers, Students and Independent
-- Learners are refused everywhere below.
--
-- Changes (each replaced function keeps its body; only the access gate line changes):
--   1. new  m3_can_manage_module(uuid)            internal helper, not callable by clients
--   2.      m3_create_collection_draft            Admin or approved Teacher; created_by is
--                                                 still auth.uid() (never client-supplied)
--   3.      m3_lock_collection                    Admin or owner (covers m3_save_collection and
--                                                 m3_save_passage_bank; history checks unchanged)
--   4.      m3_admin_collection                   Admin or owner (editor load, AI generation route)
--   5.      m3_collection_publish_issues_phase1   Admin or owner (also used by the publish trigger)
--   6.      m3_delete_module                      Admin or owner; history-preserving logic unchanged
--   7.      m3_can_read_module                    + a Teacher reads their own modules (drafts too)
--   8. new  policy "M3 approved teachers publish own drafts" (UPDATE on modules): only their own,
--           never-published, not-deleted drafts; the row must stay theirs, undeleted, and
--           draft or published. Publication validation stays in the existing role-agnostic
--           triggers (m3_validate_collection_publish), so Teachers meet exactly the Admin rules.
--   9. new  trigger on module_passages: a Teacher's passage may only reference source
--           materials they uploaded (no attributing content to another owner).
-- Not changed: Trash, Revisions, unpublish/archive (Admin only), question tables' RLS
-- (bank writes stay inside the SECURITY DEFINER m3_save_passage_bank), learner visibility.
--
-- Fingerprints are md5 of pg_get_functiondef with CR removed (live installs may contain CRs).
-- Preflight first: supabase/tests/m3_teacher_module_management_preflight.sql (read-only).

begin;
set local lock_timeout = '5s';

do $guard$
declare
  item record;
  found_md5 text;
begin
  for item in select * from (values
    ('public.m3_create_collection_draft(uuid,text,uuid,text,jsonb)', 'dfcfdebd82a85d5a12e5bc3b63b0f185'),
    ('public.m3_lock_collection(uuid,bigint)', '7b91c008be95ba86d47da4d98685e003'),
    ('public.m3_admin_collection(uuid)', 'f248bf1f321f4599a4a04c4420e7617e'),
    ('public.m3_collection_publish_issues_phase1(uuid)', '57a9c46a4b66e8d713e2a94239dfe083'),
    ('public.m3_delete_module(uuid)', '08d598518d825b6a62f3ad5de15aab64'),
    ('public.m3_can_read_module(uuid)', '11e39d7e06d36886d2248e90637e950f')
  ) as expected(signature, md5) loop
    if to_regprocedure(item.signature) is null then
      raise exception '% is missing; stop and re-review', item.signature;
    end if;
    found_md5 := md5(replace(pg_get_functiondef(item.signature::regprocedure), chr(13), ''));
    if found_md5 is distinct from item.md5 then
      raise exception '% differs from the reviewed definition (found %); stop and re-review', item.signature, found_md5;
    end if;
  end loop;
  if to_regprocedure('public.m3_can_manage_module(uuid)') is not null
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'modules'
                and policyname = 'M3 approved teachers publish own drafts')
     or exists (select 1 from pg_trigger where tgname = 'm3_teacher_passage_source'
                and tgrelid = 'public.module_passages'::regclass) then
    raise exception 'M3 Teacher module management is already installed; nothing to do';
  end if;
end
$guard$;

-- 1. Who may manage one module.
create function public.m3_can_manage_module(target_id uuid)
returns boolean
language sql stable security definer
set search_path to ''
as $function$
  select case public.m3_current_role()
    when 'admin' then true
    when 'teacher' then exists (
      select 1 from public.modules as module_row
      where module_row.id = target_id and module_row.created_by = auth.uid()
    )
    else false
  end
$function$;
revoke all on function public.m3_can_manage_module(uuid) from public, anon, authenticated;

-- 2-7. Existing functions: same bodies, owner-aware gates. Existing grants are kept.
CREATE OR REPLACE FUNCTION public.m3_create_collection_draft(target_id uuid, module_title text, target_path uuid, module_difficulty text, passage_drafts jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare item jsonb; position integer := 0;
begin
  if coalesce(public.m3_current_role(), '') not in ('admin', 'teacher') then raise exception 'Admin or approved Teacher access required'; end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.m3_lock_collection(target_id uuid, expected_revision bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.modules%rowtype; has_history boolean;
begin
  if not public.m3_can_manage_module(target_id) then raise exception 'Module owner or Admin access required'; end if;
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
end; $function$;

CREATE OR REPLACE FUNCTION public.m3_admin_collection(target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.m3_can_manage_module(target_id) THEN
    RAISE EXCEPTION 'Module owner or Admin access required';
  END IF;

  SELECT jsonb_build_object(
    'id', m.id,
    'title', m.title,
    'learningPathId', m.path_id,
    'difficulty', m.difficulty,
    'status', m.status,
    'publishedAt', m.published_at,
    'revision', m.collection_revision,
    'language', (
      SELECT language
      FROM public.learning_paths
      WHERE id = m.path_id
    ),
    'passages', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'title', p.title,
            'passageText', p.passage_text,
            'sourceMaterialId', p.source_material_id,
            'displayOrder', p.display_order,
            'questions', coalesce(
              (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'id', q.id,
                    'type', q.question_type,
                    'questionText', q.question_text,
                    'options', q.options,
                    'scaffoldingHint', q.scaffolding_hint,
                    'correctAnswer', a.correct_answer,
                    'reviewStatus', q.review_status
                  )
                  || CASE
                    WHEN a.answer_explanation IS NOT NULL THEN
                      jsonb_build_object(
                        'answerExplanation',
                        a.answer_explanation
                      )
                    ELSE '{}'::jsonb
                  END
                  || CASE
                    WHEN a.supporting_evidence IS NOT NULL THEN
                      jsonb_build_object(
                        'supportingEvidence',
                        a.supporting_evidence
                      )
                    ELSE '{}'::jsonb
                  END
                  ORDER BY q.display_order
                )
                FROM public.comprehension_questions AS q
                LEFT JOIN public.comprehension_question_answers AS a
                  ON a.question_id = q.id
                WHERE q.passage_id = p.id
                  AND q.module_id = m.id
                  AND q.material_id IS NULL
              ),
              '[]'::jsonb
            )
          )
          ORDER BY p.display_order
        )
        FROM public.module_passages AS p
        WHERE p.module_id = m.id
      ),
      '[]'::jsonb
    )
  )
  INTO result
  FROM public.modules AS m
  WHERE m.id = target_id;

  IF result IS NULL THEN
    RAISE EXCEPTION 'Module not found';
  END IF;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.m3_collection_publish_issues_phase1(target_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.modules%rowtype; p public.module_passages%rowtype;
  issues text[] := '{}'; category text; total integer;
begin
  if not public.m3_can_manage_module(target_id) then raise exception 'Module owner or Admin access required'; end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.m3_delete_module(target_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$

declare m public.modules%rowtype; preserve boolean;

begin

  if auth.uid() is null or not public.m3_can_manage_module(target_id) then

    raise exception using errcode='42501', message='Only the module owner or an Admin can delete this reading module';

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

end; $function$;

CREATE OR REPLACE FUNCTION public.m3_can_read_module(target_module_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.modules as module_row
    where module_row.id = target_module_id
      and (
        public.m3_current_role() = 'admin'
        -- An approved Teacher reads every module they created, drafts included.
        or (public.m3_current_role() = 'teacher' and module_row.created_by = auth.uid())
        or (
          module_row.status = 'published'
          and public.m3_current_role() in ('teacher', 'student', 'general_user')
        )
      )
  )
$function$;

-- 8. Publishing is a status update; Teachers may update only their own unpublished drafts.
create policy "M3 approved teachers publish own drafts"
on public.modules
as permissive
for update
to authenticated
using (
  public.m3_current_role() = 'teacher'
  and created_by = auth.uid()
  and status = 'draft'
  and published_at is null
  and deleted_at is null
)
with check (
  public.m3_current_role() = 'teacher'
  and created_by = auth.uid()
  and status in ('draft', 'published')
  and deleted_at is null
);

-- 9. A Teacher's passages may only cite source materials that Teacher uploaded.
create function public.m3_guard_teacher_passage_source()
returns trigger
language plpgsql security definer
set search_path to ''
as $function$
begin
  if new.source_material_id is not null
     and public.m3_current_role() = 'teacher'
     and (tg_op = 'INSERT' or new.source_material_id is distinct from old.source_material_id)
     and not public.m3_owns_material(new.source_material_id) then
    raise exception using errcode = '42501',
      message = 'A passage can only use reading materials you uploaded';
  end if;
  return new;
end
$function$;
revoke all on function public.m3_guard_teacher_passage_source() from public, anon, authenticated;
create trigger m3_teacher_passage_source
before insert or update of source_material_id on public.module_passages
for each row execute function public.m3_guard_teacher_passage_source();

commit;
