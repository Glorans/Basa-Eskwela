-- ReadFlow M3 content schema extension.
-- REVIEW ONLY: do not run this file until the live schema and assumptions in
-- the accompanying review report have been confirmed.

begin;

s.
create table if not exists public.uploaded_materials (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid not null
    references public.profiles (id)
    on delete restrict,
  title text not null,
  language text not null,
  original_filename text not null,
  storage_path text not null unique,
  mime_type text not null,
  file_size_bytes bigint not null,
  raw_extracted_text text null,
  content_text text null,
  ocr_confidence numeric(5, 2) null,
  extraction_status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uploaded_materials_title_check
    check (length(btrim(title)) between 1 and 200),
  constraint uploaded_materials_language_check
    check (language in ('en', 'fil')),
  constraint uploaded_materials_original_filename_check
    check (length(btrim(original_filename)) > 0),
  constraint uploaded_materials_storage_path_check
    check (
      storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|docx|jpg|jpeg|png)$'
      and split_part(storage_path, '/', 1) = uploaded_by::text
    ),
  constraint uploaded_materials_mime_type_check
    check (
      mime_type in (
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg',
        'image/png'
      )
    ),
  constraint uploaded_materials_extension_matches_mime_check
    check (
      (mime_type = 'application/pdf' and storage_path like '%.pdf')
      or (
        mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        and storage_path like '%.docx'
      )
      or (
        mime_type = 'image/jpeg'
        and (storage_path like '%.jpg' or storage_path like '%.jpeg')
      )
      or (mime_type = 'image/png' and storage_path like '%.png')
    ),
  constraint uploaded_materials_file_size_check
    check (
      file_size_bytes > 0
      and file_size_bytes <= 26214400 -- 25 MiB
    ),
  constraint uploaded_materials_raw_text_check
    check (
      raw_extracted_text is null
      or nullif(btrim(raw_extracted_text), '') is not null
    ),
  constraint uploaded_materials_content_text_check
    check (
      content_text is null
      or nullif(btrim(content_text), '') is not null
    ),
  constraint uploaded_materials_ocr_confidence_check
    check (
      ocr_confidence is null
      or (
        mime_type in ('image/jpeg', 'image/png')
        and ocr_confidence between 0 and 100
      )
    ),
  constraint uploaded_materials_extraction_status_check
    check (
      extraction_status in ('pending', 'processing', 'completed', 'failed')
    ),
  constraint uploaded_materials_completed_text_check
    check (
      extraction_status <> 'completed'
      or nullif(btrim(raw_extracted_text), '') is not null
    ),
  constraint uploaded_materials_reviewed_text_status_check
    check (content_text is null or extraction_status = 'completed')
);

comment on table public.uploaded_materials is
  'Uploader-owned PDF, DOCX, JPG/JPEG, or PNG source metadata for M3. File bytes live in private Supabase Storage.';
comment on column public.uploaded_materials.language is
  'Application language code: en or fil.';
comment on column public.uploaded_materials.storage_path is
  'Required format: <auth-user-uuid>/<generated-object-uuid>.<extension>; the original filename is metadata only.';
comment on column public.uploaded_materials.raw_extracted_text is
  'Original normalized PDF/DOCX extraction or image OCR output. Managed by the trusted extraction service.';
comment on column public.uploaded_materials.content_text is
  'Uploader-reviewed/corrected text used for question generation.';
comment on column public.uploaded_materials.ocr_confidence is
  'Nullable Tesseract confidence percentage (0-100) for image OCR only; PDF and DOCX rows must remain null.';

create index if not exists uploaded_materials_uploaded_by_idx
  on public.uploaded_materials (uploaded_by);
create index if not exists uploaded_materials_extraction_status_idx
  on public.uploaded_materials (extraction_status);


alter table public.modules
  add column if not exists passage text null,
  add column if not exists source_material_id uuid null,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.modules'::regclass
      and conname = 'modules_source_material_id_fkey'
  ) then
    alter table public.modules
      add constraint modules_source_material_id_fkey
      foreign key (source_material_id)
      references public.uploaded_materials (id)
      on delete restrict;
  end if;
end;
$$;

create index if not exists modules_source_material_id_idx
  on public.modules (source_material_id)
  where source_material_id is not null;

alter table public.progress
  drop constraint if exists progress_module_id_fkey;

alter table public.progress
  add constraint progress_module_id_fkey
  foreign key (module_id)
  references public.modules (id)
  on delete restrict;

alter table public.room_modules
  drop constraint if exists room_modules_module_id_fkey;

alter table public.room_modules
  add constraint room_modules_module_id_fkey
  foreign key (module_id)
  references public.modules (id)
  on delete restrict;


alter table public.modules
  drop constraint if exists modules_status_check;

alter table public.modules
  add constraint modules_status_check
  check (status in ('draft', 'published', 'archived'));


do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.modules'::regclass
      and conname = 'modules_published_passage_check'
  ) then
    alter table public.modules
      add constraint modules_published_passage_check
      check (
        status <> 'published'
        or nullif(btrim(passage), '') is not null
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.modules'::regclass
      and conname = 'modules_published_at_check'
  ) then
    alter table public.modules
      add constraint modules_published_at_check
      check (status <> 'published' or published_at is not null) not valid;
  end if;
end;
$$;

comment on column public.modules.passage is
  'Reading passage for the module; required before publication.';
comment on column public.modules.source_material_id is
  'Optional provenance link when an Admin creates a module from an uploaded source. Pre-made modules remain null.';
comment on column public.modules.updated_at is
  'Last M3-visible module update timestamp, maintained by trigger.';


create table if not exists public.comprehension_questions (
  id uuid primary key default gen_random_uuid(),
  module_id uuid null
    references public.modules (id)
    on delete restrict,
  material_id uuid null
    references public.uploaded_materials (id)
    on delete restrict,
  question_type text not null,
  question_text text not null,
  options jsonb not null,
  scaffolding_hint text not null,
  display_order integer not null default 1,
  generated_by_ai boolean not null default false,
  review_status text not null default 'generated',
  reviewed_by uuid null
    references public.profiles (id)
    on delete set null,
  reviewed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint comprehension_questions_exactly_one_source_check
    check ((module_id is not null) <> (material_id is not null)),
  constraint comprehension_questions_type_check
    check (question_type in ('literal', 'inferential', 'critical')),
  constraint comprehension_questions_text_check
    check (length(btrim(question_text)) > 0),
  constraint comprehension_questions_scaffolding_hint_check
    check (length(btrim(scaffolding_hint)) > 0),
  constraint comprehension_questions_options_check
    check (
      jsonb_typeof(options) = 'array'
      and jsonb_array_length(options) = 4
      and jsonb_typeof(options -> 0) = 'string'
      and jsonb_typeof(options -> 1) = 'string'
      and jsonb_typeof(options -> 2) = 'string'
      and jsonb_typeof(options -> 3) = 'string'
      and length(btrim(options ->> 0)) > 0
      and length(btrim(options ->> 1)) > 0
      and length(btrim(options ->> 2)) > 0
      and length(btrim(options ->> 3)) > 0
      and lower(btrim(options ->> 0)) <> lower(btrim(options ->> 1))
      and lower(btrim(options ->> 0)) <> lower(btrim(options ->> 2))
      and lower(btrim(options ->> 0)) <> lower(btrim(options ->> 3))
      and lower(btrim(options ->> 1)) <> lower(btrim(options ->> 2))
      and lower(btrim(options ->> 1)) <> lower(btrim(options ->> 3))
      and lower(btrim(options ->> 2)) <> lower(btrim(options ->> 3))
    ),
  constraint comprehension_questions_display_order_check
    check (display_order > 0),
  constraint comprehension_questions_review_status_check
    check (review_status in ('generated', 'reviewed')),
  constraint comprehension_questions_review_metadata_check
    check (
      (
        review_status = 'generated'
        and reviewed_by is null
        and reviewed_at is null
      )
      or (
        review_status = 'reviewed'
        and reviewed_at is not null
      )
    )
);

comment on table public.comprehension_questions is
  'Answer-free question prompts. Each row belongs to exactly one module or uploaded material.';
comment on column public.comprehension_questions.material_id is
  'Generated material questions stay material-scoped. If promoted into a module bank, create module-scoped copies; do not attach one row to both sources.';
comment on column public.comprehension_questions.review_status is
  'Maps directly to the current frontend workflow: generated until an Admin or owning Teacher saves the reviewed set, then reviewed.';

create unique index if not exists comprehension_questions_module_order_key
  on public.comprehension_questions (module_id, display_order)
  where module_id is not null;
create unique index if not exists comprehension_questions_material_order_key
  on public.comprehension_questions (material_id, display_order)
  where material_id is not null;
create index if not exists comprehension_questions_review_status_idx
  on public.comprehension_questions (review_status);

.
create table if not exists public.comprehension_question_answers (
  question_id uuid primary key
    references public.comprehension_questions (id)
    on delete cascade,
  correct_answer text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint comprehension_question_answers_value_check
    check (length(btrim(correct_answer)) > 0)
);

comment on table public.comprehension_question_answers is
  'Privileged answer keys. Student and General User clients must validate answers through a later trusted service/RPC with attempt controls.';


create or replace function public.m3_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.m3_set_module_metadata()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
    then
      raise exception 'modules creation metadata is immutable';
    end if;


    if old.published_at is not null then
      new.published_at = old.published_at;
    end if;
  end if;

  if new.status = 'published' and new.published_at is null then
    new.published_at = now();
  end if;

  return new;
end;
$$;

create or replace function public.m3_protect_material_file_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.uploaded_by is distinct from old.uploaded_by
    or new.original_filename is distinct from old.original_filename
    or new.storage_path is distinct from old.storage_path
    or new.mime_type is distinct from old.mime_type
    or new.file_size_bytes is distinct from old.file_size_bytes
    or new.created_at is distinct from old.created_at
  then
    raise exception 'uploaded material file identity is immutable';
  end if;

  return new;
end;
$$;

create or replace function public.m3_set_question_metadata()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  should_stamp_review boolean := false;
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.module_id is distinct from old.module_id
      or new.material_id is distinct from old.material_id
      or new.generated_by_ai is distinct from old.generated_by_ai
      or new.created_at is distinct from old.created_at
    then
      raise exception 'question source and generation provenance are immutable';
    end if;
  end if;

  if new.review_status = 'generated' then
    new.reviewed_by = null;
    new.reviewed_at = null;
  else
    if tg_op = 'INSERT' then
      should_stamp_review = true;
    else
      should_stamp_review =
        old.review_status is distinct from new.review_status
        or old.question_type is distinct from new.question_type
        or old.question_text is distinct from new.question_text
        or old.options is distinct from new.options
        or old.scaffolding_hint is distinct from new.scaffolding_hint
        or old.display_order is distinct from new.display_order;
    end if;
  end if;

  if should_stamp_review then
    new.reviewed_by = coalesce(auth.uid(), new.reviewed_by);

    if new.reviewed_by is null then
      raise exception 'reviewed questions require a reviewer identity';
    end if;

    new.reviewed_at = now();
  end if;

  return new;
end;
$$;

create or replace function public.m3_validate_answer_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  question_options jsonb;
  saved_answer text;
begin
  select question.options, answer.correct_answer
    into question_options, saved_answer
  from public.comprehension_question_answers as answer
  join public.comprehension_questions as question
    on question.id = answer.question_id
  where answer.question_id = new.question_id;

  
  if not found then
    return new;
  end if;

  if question_options is null
    or not (question_options ? saved_answer)
  then
    raise exception 'correct_answer must exactly match one of the question options';
  end if;

  return new;
end;
$$;

create or replace function public.m3_validate_changed_options()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_options jsonb;
  saved_answer text;
begin
  select question.options, answer.correct_answer
    into current_options, saved_answer
  from public.comprehension_questions as question
  join public.comprehension_question_answers as answer
    on answer.question_id = question.id
  where question.id = new.id;

  if found and not (current_options ? saved_answer) then
    raise exception 'question options must continue to contain the saved correct answer';
  end if;

  return new;
end;
$$;

revoke all on function public.m3_set_updated_at() from public;
revoke all on function public.m3_set_module_metadata() from public;
revoke all on function public.m3_protect_material_file_identity() from public;
revoke all on function public.m3_set_question_metadata() from public;
revoke all on function public.m3_validate_answer_key() from public;
revoke all on function public.m3_validate_changed_options() from public;

drop trigger if exists modules_m3_metadata on public.modules;
create trigger modules_m3_metadata
before insert or update on public.modules
for each row execute function public.m3_set_module_metadata();

drop trigger if exists modules_m3_set_updated_at on public.modules;
create trigger modules_m3_set_updated_at
before insert or update on public.modules
for each row execute function public.m3_set_updated_at();

drop trigger if exists uploaded_materials_protect_file_identity
  on public.uploaded_materials;
create trigger uploaded_materials_protect_file_identity
before update on public.uploaded_materials
for each row execute function public.m3_protect_material_file_identity();

drop trigger if exists uploaded_materials_set_updated_at
  on public.uploaded_materials;
create trigger uploaded_materials_set_updated_at
before insert or update on public.uploaded_materials
for each row execute function public.m3_set_updated_at();

drop trigger if exists comprehension_questions_set_metadata
  on public.comprehension_questions;
create trigger comprehension_questions_set_metadata
before insert or update on public.comprehension_questions
for each row execute function public.m3_set_question_metadata();


drop trigger if exists comprehension_questions_validate_changed_options
  on public.comprehension_questions;
create constraint trigger comprehension_questions_validate_changed_options
after update on public.comprehension_questions
deferrable initially deferred
for each row execute function public.m3_validate_changed_options();

drop trigger if exists comprehension_questions_set_updated_at
  on public.comprehension_questions;
create trigger comprehension_questions_set_updated_at
before insert or update on public.comprehension_questions
for each row execute function public.m3_set_updated_at();

drop trigger if exists comprehension_question_answers_validate
  on public.comprehension_question_answers;
create constraint trigger comprehension_question_answers_validate
after insert or update on public.comprehension_question_answers
deferrable initially deferred
for each row execute function public.m3_validate_answer_key();

drop trigger if exists comprehension_question_answers_set_updated_at
  on public.comprehension_question_answers;
create trigger comprehension_question_answers_set_updated_at
before insert or update on public.comprehension_question_answers
for each row execute function public.m3_set_updated_at();


alter table public.uploaded_materials enable row level security;
alter table public.comprehension_questions enable row level security;
alter table public.comprehension_question_answers enable row level security;

commit;
