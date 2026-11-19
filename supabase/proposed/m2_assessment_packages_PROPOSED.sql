-- M2 F6 (initial diagnostic content) + F10 (reassessment materials): assessment packages -- PROPOSED. NOT APPLIED.
-- Requires explicit approval. Rollback: m2_assessment_packages_ROLLBACK_PROPOSED.sql
-- Verification: m2_assessment_packages_VERIFY_READONLY.sql
--
-- What this adds
--   m2_assessment_packages          one row per assessment (title, language, kind, audience, ownership scope).
--   m2_assessment_package_versions  immutable versions of a package: passage, questions, answer keys and the
--                                   draft -> in_review -> approved -> published -> retired lifecycle.
--
-- Kinds and ownership (enforced by a CHECK; the backend decides who may create which):
--   initial      / all_learners         / platform : the common initial diagnostic (System Admin, F6)
--   reassessment / independent_learners / platform : centrally approved Independent Learner packages (System Admin)
--   reassessment / classroom            / school   : classroom packages managed by School Admins (single school)
--   reassessment / classroom            / teacher  : a Teacher's private packages (owner_id = the Teacher)
--
-- Guarantees enforced in the DATABASE
--   * Browser roles have NO access (RLS on, no policies, no grants): learners can never read passages, questions or
--     answer keys from these tables. The backend (service role) authorizes every read and write.
--   * A version's content (passage, questions, answer keys, numbering, author) can change only while it is a DRAFT.
--     Submitting for review freezes it and records its SHA-256; changing approved or published content requires a new
--     version. Published and retired versions are never deleted or rewritten, so historical references stay valid.
--   * Lifecycle: draft -> in_review -> (approved | back to draft) ; approved -> published | retired ;
--     published -> retired. Approval needs a reviewer and a written educator-review attestation; it is never automatic.
--   * At most one published version per package; at most one active initial package per language.
--   * Packages are archived, never deleted. Only draft versions can be deleted.
--   * Educator review evidence is append-only (m2_assessment_educator_reviews). Library approval is not educational
--     validation; official use requires m2_version_educator_endorsed() (enforced by the reassessment foundation).
--   * A version is submitted for review only if its content is structurally valid (m2_assessment_content_issues).
--     Structural validity is software validation only; educational approval is the separate attestation above.
--
-- Not changed: diagnostic_results, scoring, thresholds, the code-defined version 3.0 diagnostic that learners take,
-- M3 modules/placement, M7, M8. Learner delivery from these tables is a later, separately approved step.
-- Single-school limitation: there is no school membership in the database. "school" scope means the one school
-- managed by every School Admin; no school rows are invented.
begin;

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'STOP: public.profiles is required';
  end if;
  if to_regclass('public.m2_assessment_packages') is not null
     or to_regclass('public.m2_assessment_package_versions') is not null
     or to_regprocedure('public.m2_assessment_content_issues(text,jsonb,jsonb)') is not null
     or to_regprocedure('public.m2_publish_assessment_version(uuid,uuid)') is not null
     or to_regclass('public.m2_assessment_educator_reviews') is not null then
    raise exception 'STOP: m2_assessment_packages is already (partly) installed';
  end if;
end $$;

create table public.m2_assessment_packages (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('initial', 'reassessment')),
  audience text not null check (audience in ('all_learners', 'independent_learners', 'classroom')),
  scope text not null check (scope in ('platform', 'school', 'teacher')),
  -- NULL once the owner's account is deleted: the package and its history are kept (shown as a removed account).
  owner_id uuid references public.profiles(id) on delete set null,
  language text not null check (language in ('en', 'fil')),
  title text not null check (length(btrim(title)) between 1 and 200),
  -- Set only for the package that mirrors a code-defined diagnostic (e.g. 'grade5-en-passage-v3').
  legacy_assessment_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint m2_package_kind_audience_scope check (
    (kind = 'initial' and audience = 'all_learners' and scope = 'platform')
    or (kind = 'reassessment' and audience = 'independent_learners' and scope = 'platform')
    or (kind = 'reassessment' and audience = 'classroom' and scope in ('school', 'teacher'))
  )
);
create unique index m2_one_active_initial_package_per_language
  on public.m2_assessment_packages(language) where kind = 'initial' and archived_at is null;
create index m2_assessment_packages_owner on public.m2_assessment_packages(owner_id);
create function public.m2_require_package_owner() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.owner_id is null then raise exception 'Record who owns the package' using errcode = '23502'; end if;
  return new;
end $$;
create trigger m2_require_package_owner before insert on public.m2_assessment_packages
  for each row execute function public.m2_require_package_owner();

create table public.m2_assessment_package_versions (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.m2_assessment_packages(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  version_label text not null check (version_label ~ '^[0-9]{1,4}(\.[0-9]{1,4})?$'),
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'published', 'retired')),
  -- 'code_import': a published copy of the code-defined diagnostic learners already take (version 3.0).
  source text not null default 'authored' check (source in ('authored', 'code_import')),
  based_on_version_id uuid references public.m2_assessment_package_versions(id) on delete restrict,
  passage_title text not null default '' check (length(passage_title) <= 200),
  paragraphs jsonb not null default '[]'::jsonb check (jsonb_typeof(paragraphs) = 'array'),
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array'),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(review_note) <= 2000),
  educator_review_attestation text check (educator_review_attestation is null or length(educator_review_attestation) <= 2000),
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  retired_by uuid references public.profiles(id) on delete set null,
  retired_at timestamptz,
  unique (package_id, version_number),
  unique (package_id, version_label),
  constraint m2_version_approval_evidence check (
    status not in ('approved', 'published', 'retired') or source = 'code_import'
    or (reviewed_at is not null and nullif(btrim(educator_review_attestation), '') is not null)
  ),
  constraint m2_version_frozen_has_hash check (status = 'draft' or content_sha256 is not null),
  constraint m2_version_published_evidence check (status <> 'published' or published_at is not null)
);
create unique index m2_one_published_version_per_package
  on public.m2_assessment_package_versions(package_id) where status = 'published';
create index m2_assessment_package_versions_package on public.m2_assessment_package_versions(package_id, version_number);

-- Structural (software) validation of a version's content. Educational quality is NOT judged here.
-- Returns the list of problems; an empty array means the content can be submitted for review.
create function public.m2_assessment_content_issues(p_title text, p_paragraphs jsonb, p_questions jsonb)
returns text[] language plpgsql immutable set search_path = '' as $$
declare
  issues text[] := '{}';
  q jsonb; c jsonb; i integer := 0; words integer := 0; ids text[] := '{}'; choice_ids text[];
  types text[] := '{}';
begin
  if nullif(btrim(coalesce(p_title, '')), '') is null then issues := array_append(issues, 'Add a passage title.'); end if;
  if jsonb_typeof(p_paragraphs) <> 'array' or jsonb_array_length(p_paragraphs) not between 1 and 10 then
    issues := array_append(issues, 'The passage needs 1 to 10 paragraphs.');
  else
    for i in 0 .. jsonb_array_length(p_paragraphs) - 1 loop
      if jsonb_typeof(p_paragraphs -> i) <> 'string' or nullif(btrim(p_paragraphs ->> i), '') is null then
        issues := array_append(issues, format('Paragraph %s is empty.', i + 1));
      else
        words := words + coalesce(array_length(regexp_split_to_array(btrim(p_paragraphs ->> i), '\s+'), 1), 0);
      end if;
    end loop;
    if words not between 20 and 600 then issues := array_append(issues, 'The passage needs 20 to 600 words.'); end if;
  end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) <> 6 then
    issues := array_append(issues, 'Add exactly 6 comprehension questions.');
    return issues;
  end if;
  for i in 0 .. 5 loop
    q := p_questions -> i;
    if jsonb_typeof(q) <> 'object' then issues := array_append(issues, format('Question %s is invalid.', i + 1)); continue; end if;
    if nullif(btrim(coalesce(q ->> 'id', '')), '') is null or (q ->> 'id') = any(ids) then
      issues := array_append(issues, format('Question %s needs a unique id.', i + 1));
    else ids := ids || (q ->> 'id'); end if;
    if coalesce(q ->> 'type', '') not in ('literal', 'inferential', 'critical') then
      issues := array_append(issues, format('Question %s needs a type (literal, inferential or critical).', i + 1));
    else types := types || (q ->> 'type'); end if;
    if nullif(btrim(coalesce(q ->> 'prompt', '')), '') is null then issues := array_append(issues, format('Question %s needs a prompt.', i + 1)); end if;
    if jsonb_typeof(q -> 'choices') <> 'array' or jsonb_array_length(q -> 'choices') <> 4 then
      issues := array_append(issues, format('Question %s needs exactly 4 answer choices.', i + 1));
      continue;
    end if;
    choice_ids := '{}';
    for c in select value from jsonb_array_elements(q -> 'choices') loop
      if nullif(btrim(coalesce(c ->> 'label', '')), '') is null then issues := array_append(issues, format('Question %s has an empty answer choice.', i + 1)); end if;
      if coalesce(c ->> 'id', '') not in ('a', 'b', 'c', 'd') or (c ->> 'id') = any(choice_ids) then
        issues := array_append(issues, format('Question %s answer choices must be a, b, c and d.', i + 1));
      else choice_ids := choice_ids || (c ->> 'id'); end if;
    end loop;
    if coalesce(q ->> 'correctChoiceId', '') <> all(choice_ids) or q ->> 'correctChoiceId' is null then
      issues := array_append(issues, format('Question %s needs one correct answer.', i + 1));
    end if;
  end loop;
  if not ('literal' = any(types) and 'inferential' = any(types) and 'critical' = any(types)) then
    issues := array_append(issues, 'Include at least one literal, one inferential and one critical question.');
  end if;
  return issues;
end $$;

create function public.m2_assessment_content_sha256(p_title text, p_paragraphs jsonb, p_questions jsonb)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(jsonb_build_object('title', p_title, 'paragraphs', p_paragraphs, 'questions', p_questions)::text, 'UTF8')), 'hex')
$$;

-- Packages: identity is fixed; only the title and archive state change. Never deleted.
create function public.m2_guard_assessment_package() returns trigger language plpgsql set search_path = '' as $$
declare probe public.m2_assessment_packages;
begin
  -- Account deletion (ON DELETE SET NULL) may clear the owner and nothing else.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 and new.owner_id is null then
    probe := new; probe.owner_id := old.owner_id;
    if probe is not distinct from old then return new; end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Assessment packages are archived, never deleted' using errcode = '42501';
  end if;
  if (new.id, new.kind, new.audience, new.scope, new.owner_id, new.language, new.legacy_assessment_id, new.created_at)
     is distinct from (old.id, old.kind, old.audience, old.scope, old.owner_id, old.language, old.legacy_assessment_id, old.created_at) then
    raise exception 'An assessment package''s kind, audience, owner, language and identity cannot change' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger m2_guard_assessment_package before update or delete on public.m2_assessment_packages
  for each row execute function public.m2_guard_assessment_package();

-- Versions: content is editable only as a draft; the lifecycle only moves forward; history is preserved.
create function public.m2_guard_assessment_version() returns trigger language plpgsql set search_path = '' as $$
declare issues text[]; probe public.m2_assessment_package_versions;
begin
  -- Account deletion (ON DELETE SET NULL) may clear who created/submitted/reviewed/published/retired, nothing else.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    probe := new;
    probe.created_by := old.created_by; probe.submitted_by := old.submitted_by; probe.reviewed_by := old.reviewed_by;
    probe.published_by := old.published_by; probe.retired_by := old.retired_by;
    if probe is not distinct from old
       and (new.created_by is null or new.created_by = old.created_by) and (new.submitted_by is null or new.submitted_by = old.submitted_by)
       and (new.reviewed_by is null or new.reviewed_by = old.reviewed_by) and (new.published_by is null or new.published_by = old.published_by)
       and (new.retired_by is null or new.retired_by = old.retired_by) then
      return new;
    end if;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Only draft versions can be deleted; submitted, approved and published versions are kept' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.created_by is null then raise exception 'Record who created the version' using errcode = '23502'; end if;
    if new.source = 'code_import' then
      if new.status <> 'published' or not exists (
        select 1 from public.m2_assessment_packages p where p.id = new.package_id and p.legacy_assessment_id is not null) then
        raise exception 'Only the code-defined diagnostic can be imported, as its published version' using errcode = '42501';
      end if;
      issues := public.m2_assessment_content_issues(new.passage_title, new.paragraphs, new.questions);
      if cardinality(issues) > 0 then raise exception 'Imported content is invalid: %', array_to_string(issues, ' ') using errcode = '23514'; end if;
      new.content_sha256 := public.m2_assessment_content_sha256(new.passage_title, new.paragraphs, new.questions);
      new.published_at := coalesce(new.published_at, now());
    elsif new.status <> 'draft' or new.submitted_at is not null or new.reviewed_at is not null or new.published_at is not null then
      raise exception 'New versions start as drafts' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if (new.id, new.package_id, new.version_number, new.version_label, new.source, new.based_on_version_id, new.created_by, new.created_at)
     is distinct from (old.id, old.package_id, old.version_number, old.version_label, old.source, old.based_on_version_id, old.created_by, old.created_at) then
    raise exception 'A version''s identity cannot change' using errcode = '42501';
  end if;
  if old.status <> 'draft' and (new.passage_title, new.paragraphs, new.questions, new.content_sha256)
     is distinct from (old.passage_title, old.paragraphs, old.questions, old.content_sha256) then
    raise exception 'Only draft content can be edited; create a new version to change submitted, approved or published content'
      using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status, new.status) in (('draft', 'in_review'), ('in_review', 'draft'), ('in_review', 'approved'),
                                          ('approved', 'published'), ('approved', 'retired'), ('published', 'retired'))) then
      raise exception 'A version cannot move from % to %', old.status, new.status using errcode = '42501';
    end if;
    if new.status = 'in_review' then
      issues := public.m2_assessment_content_issues(new.passage_title, new.paragraphs, new.questions);
      if cardinality(issues) > 0 then raise exception 'This version is not ready for review: %', array_to_string(issues, ' ') using errcode = '23514'; end if;
      if new.submitted_by is null then raise exception 'Record who submitted the version' using errcode = '23502'; end if;
      new.submitted_at := now();
      new.content_sha256 := public.m2_assessment_content_sha256(new.passage_title, new.paragraphs, new.questions);
      new.reviewed_by := null; new.reviewed_at := null; new.educator_review_attestation := null;
    elsif new.status = 'draft' then
      -- Returned for changes: the review note is kept; the freeze is lifted.
      new.content_sha256 := null; new.submitted_at := null; new.submitted_by := null;
    elsif new.status = 'approved' then
      if new.reviewed_by is null or nullif(btrim(coalesce(new.educator_review_attestation, '')), '') is null then
        raise exception 'Approval needs a reviewer and a written educator-review attestation' using errcode = '23502';
      end if;
      new.reviewed_at := now();
    elsif new.status = 'published' then
      if new.published_by is null then raise exception 'Record who published the version' using errcode = '23502'; end if;
      new.published_at := now();
    elsif new.status = 'retired' then
      if new.retired_by is null then raise exception 'Record who retired the version' using errcode = '23502'; end if;
      new.retired_at := now();
    end if;
  elsif old.status <> 'draft' and (new.submitted_by, new.submitted_at, new.reviewed_by, new.reviewed_at, new.review_note,
         new.educator_review_attestation, new.published_by, new.published_at, new.retired_by, new.retired_at)
       is distinct from (old.submitted_by, old.submitted_at, old.reviewed_by, old.reviewed_at, old.review_note,
         old.educator_review_attestation, old.published_by, old.published_at, old.retired_by, old.retired_at) then
    raise exception 'Review and publication records cannot be rewritten' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger m2_guard_assessment_version before insert or update or delete on public.m2_assessment_package_versions
  for each row execute function public.m2_guard_assessment_version();

-- Publish atomically: the package's current published version (if any) is retired and the approved version is
-- published in ONE transaction, so a package is never left with zero or two published versions.
create function public.m2_publish_assessment_version(p_version uuid, p_actor uuid)
returns void language plpgsql set search_path = '' as $$
declare v_package uuid;
begin
  if p_actor is null then raise exception 'Record who published the version' using errcode = '23502'; end if;
  select v.package_id into v_package from public.m2_assessment_package_versions v
    join public.m2_assessment_packages p on p.id = v.package_id
    where v.id = p_version and v.status = 'approved' and p.archived_at is null
    for update of v;
  if v_package is null then
    raise exception 'Only an approved version of an active package can be published' using errcode = '42501';
  end if;
  update public.m2_assessment_package_versions set status = 'retired', retired_by = p_actor
    where package_id = v_package and status = 'published';
  update public.m2_assessment_package_versions set status = 'published', published_by = p_actor where id = p_version;
end $$;

-- Educator review evidence (append-only). The application RECORDS what a reviewer states; it cannot verify a
-- reviewer's professional qualification. Library approval (status 'approved', by a System Admin or School Admin
-- account) is NOT educational validation: a version is educator-endorsed only when its most recent educator review
-- is 'endorsed' with all four checks passed (m2_version_educator_endorsed).
create table public.m2_assessment_educator_reviews (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.m2_assessment_package_versions(id) on delete restrict,
  reviewer_name text not null check (length(btrim(reviewer_name)) between 1 and 200),
  reviewer_qualification text not null check (length(btrim(reviewer_qualification)) between 1 and 500),
  reviewed_on date not null,
  passage_suitable boolean not null,
  questions_sound boolean not null,
  answer_keys_correct boolean not null,
  language_accurate boolean not null,
  outcome text not null check (outcome in ('endorsed', 'changes_requested')),
  notes text check (notes is null or length(notes) <= 2000),
  recorded_by uuid references public.profiles(id) on delete set null,
  recorded_at timestamptz not null default now(),
  constraint m2_review_endorsement_needs_all_checks check (
    outcome <> 'endorsed' or (passage_suitable and questions_sound and answer_keys_correct and language_accurate))
);
create index m2_assessment_educator_reviews_version on public.m2_assessment_educator_reviews(version_id, recorded_at);

create function public.m2_guard_educator_review() returns trigger language plpgsql set search_path = '' as $$
declare v_status text; probe public.m2_assessment_educator_reviews;
begin
  -- Account deletion (ON DELETE SET NULL) may clear who recorded the review, nothing else.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 and new.recorded_by is null then
    probe := new; probe.recorded_by := old.recorded_by;
    if probe is not distinct from old then return new; end if;
  end if;
  if tg_op = 'INSERT' and new.recorded_by is null then
    raise exception 'Record which account entered the review' using errcode = '23502';
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'Educator reviews are permanent records; add a new review instead' using errcode = '42501';
  end if;
  select status into v_status from public.m2_assessment_package_versions where id = new.version_id;
  -- Only frozen content can be reviewed, so a review always refers to exactly one fingerprinted text.
  if v_status is null or v_status = 'draft' then
    raise exception 'Only submitted, approved, published or retired versions can be reviewed' using errcode = '42501';
  end if;
  -- The pilot school's calendar day (as M8 reading days), not the database server's UTC day.
  if new.reviewed_on > (now() at time zone 'Asia/Manila')::date then
    raise exception 'The review date cannot be in the future' using errcode = '23514';
  end if;
  new.recorded_at := now();
  return new;
end $$;
create trigger m2_guard_educator_review before insert or update or delete on public.m2_assessment_educator_reviews
  for each row execute function public.m2_guard_educator_review();

-- Endorsed = the MOST RECENT review (by review date, then recording time) is an endorsement. A later
-- 'changes_requested' review withdraws the endorsement until a new endorsement is recorded.
create function public.m2_version_educator_endorsed(p_version uuid)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((
    select r.outcome = 'endorsed' from public.m2_assessment_educator_reviews r
    where r.version_id = p_version order by r.reviewed_on desc, r.recorded_at desc, r.id desc limit 1), false)
$$;

-- Access: backend only. RLS on with no policies, and Supabase's default grants to browser roles removed.
alter table public.m2_assessment_packages enable row level security;
alter table public.m2_assessment_package_versions enable row level security;
alter table public.m2_assessment_educator_reviews enable row level security;
revoke all on public.m2_assessment_packages, public.m2_assessment_package_versions from public, anon, authenticated;
grant select, insert, update, delete on public.m2_assessment_packages, public.m2_assessment_package_versions to service_role;
revoke all on public.m2_assessment_educator_reviews from public, anon, authenticated, service_role;
grant select, insert on public.m2_assessment_educator_reviews to service_role;
revoke all on function public.m2_guard_educator_review() from public, anon, authenticated, service_role;
revoke all on function public.m2_version_educator_endorsed(uuid) from public, anon, authenticated;
grant execute on function public.m2_version_educator_endorsed(uuid) to service_role;
revoke all on function public.m2_assessment_content_issues(text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.m2_assessment_content_sha256(text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.m2_guard_assessment_package() from public, anon, authenticated, service_role;
revoke all on function public.m2_require_package_owner() from public, anon, authenticated, service_role;
revoke all on function public.m2_guard_assessment_version() from public, anon, authenticated, service_role;
grant execute on function public.m2_assessment_content_issues(text, jsonb, jsonb) to service_role;
-- The version guard runs as the backend (service role) and computes the content hash with this function.
grant execute on function public.m2_assessment_content_sha256(text, jsonb, jsonb) to service_role;
revoke all on function public.m2_publish_assessment_version(uuid, uuid) from public, anon, authenticated;
grant execute on function public.m2_publish_assessment_version(uuid, uuid) to service_role;

commit;
