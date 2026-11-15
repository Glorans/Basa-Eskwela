// PGlite stand-in for the Staging M3 material tables, with the CURRENT Staging policies (taken verbatim from the
// rollback file, which copies them from the 2026-11-15 Staging schema backup) and the real m3_current_role /
// m3_owns_material / m3_material_is_unreferenced definitions. Helpers unrelated to the Admin branch are stubbed.
const { PGlite } = require('../../../server/node_modules/@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const sql = (file) => readFileSync(resolve(__dirname, '../../..', file), 'utf8');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const SETUP = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create schema storage;
  create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  create table public.profiles(id uuid primary key, role text, teacher_status text);
  create table public.uploaded_materials(id uuid primary key, uploaded_by uuid, title text, storage_path text,
    extraction_status text, raw_extracted_text text, content_text text, ocr_confidence numeric);
  create table public.material_question_sets(id uuid primary key, material_id uuid);
  create table public.modules(id uuid primary key, source_material_id uuid);
  create table public.comprehension_questions(id uuid primary key, material_id uuid, module_id uuid,
    review_status text, generated_by_ai boolean default false);
  create table public.comprehension_question_answers(id uuid primary key, question_id uuid);
  create function public.m3_current_role() returns text language sql stable security definer set search_path = '' as $$
    select role from public.profiles where id = auth.uid() and (role <> 'teacher' or teacher_status = 'approved'); $$;
  create function public.m3_owns_material(target_material_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
    select exists (select 1 from public.uploaded_materials as material where material.id = target_material_id and material.uploaded_by = auth.uid()) $$;
  create function public.m3_material_is_unreferenced(target_material_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
    select not exists (select 1 from public.modules as module_row where module_row.source_material_id = target_material_id)
      and not exists (select 1 from public.comprehension_questions as question where question.material_id = target_material_id) $$;
  create function public.m3_material_file_is_absent(uuid) returns boolean language sql stable as $$ select true $$;
  create function public.m3_can_read_module(uuid) returns boolean language sql stable as $$ select false $$;
  create function public.m3_storage_object_is_deletable(text) returns boolean language sql stable as $$ select true $$;
  alter table public.uploaded_materials enable row level security;
  alter table public.material_question_sets enable row level security;
  alter table public.comprehension_questions enable row level security;
  alter table public.comprehension_question_answers enable row level security;
  alter table storage.objects enable row level security;
  grant usage on schema public, auth, storage to authenticated, anon;
  grant select, insert, update, delete on public.uploaded_materials, public.material_question_sets,
    public.comprehension_questions, public.comprehension_question_answers, storage.objects to authenticated;
`;

// People: 1 School Admin, 2 approved Teacher, 3 Independent Learner, 4 Student, 5 System Admin, 6 second Independent Learner.
// Materials: 10 Teacher upload, 11 Independent Learner upload (each with a question set, a question and an answer key).
const SEED = `
  insert into public.profiles values ('${id(1)}','admin',null), ('${id(2)}','teacher','approved'),
    ('${id(3)}','general_user',null), ('${id(4)}','student',null), ('${id(5)}','system_admin',null), ('${id(6)}','general_user',null);
  insert into public.uploaded_materials(id, uploaded_by, title) values ('${id(10)}','${id(2)}','Teacher text'), ('${id(11)}','${id(3)}','Learner text'),
    ('${id(12)}','${id(6)}','Unused learner text'), ('${id(13)}','${id(2)}','Unused teacher text');
  insert into public.material_question_sets values ('${id(20)}','${id(10)}'), ('${id(21)}','${id(11)}');
  insert into public.comprehension_questions(id, material_id, review_status, generated_by_ai) values
    ('${id(30)}','${id(10)}','reviewed',true), ('${id(31)}','${id(11)}','reviewed',true), ('${id(32)}',null,'reviewed',false);
  insert into public.comprehension_question_answers values ('${id(40)}','${id(30)}'), ('${id(41)}','${id(31)}'), ('${id(42)}','${id(32)}');
  insert into storage.objects(bucket_id, name) values ('reading-materials','${id(2)}/a.pdf'), ('reading-materials','${id(3)}/b.pdf');
`;

function currentPolicies() {
  return sql('supabase/proposed/m1_school_admin_learner_scope_ROLLBACK_PROPOSED.sql')
    .match(/^CREATE POLICY[\s\S]*?;$/gm).join('\n');
}

async function database({ seed = true } = {}) {
  const db = new PGlite();
  await db.exec(SETUP);
  await db.exec(currentPolicies());
  if (seed) await db.exec(SEED);
  return db;
}

async function as(db, user) {
  await db.exec('reset role');
  await db.query("select set_config('test.uid', $1, false)", [user ? id(user) : '']);
  await db.exec(user ? 'set role authenticated' : 'set role anon');
}

module.exports = { as, database, id, sql };
