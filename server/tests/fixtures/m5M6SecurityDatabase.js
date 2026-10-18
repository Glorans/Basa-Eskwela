// Real PostgreSQL (WASM), entirely in memory. Never reads Supabase credentials.
const { PGlite } = require("@electric-sql/pglite");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const root = resolve(__dirname, "../../..");
const sqlFile = path => readFileSync(resolve(root, path), "utf8");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function sqlFunction(source, name) {
  const start = source.search(new RegExp(`create(?: or replace)? function public\\.${name}\\(`, "i"));
  if (start < 0) throw new Error(`Missing actual SQL function: ${name}`);
  const end = source.indexOf("$$;", start);
  if (end < 0) throw new Error(`Missing SQL function terminator: ${name}`);
  return source.slice(start, end + 3);
}

async function createSecurityDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    -- Supabase identity interface, using local test claims only.
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
    $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.profiles(id uuid primary key, role text, teacher_status text);
    create table public.uploaded_materials(id uuid primary key, uploaded_by uuid);
    create table public.modules(id uuid primary key, status text);
    create table public.rooms(id uuid); create table public.enrollments(id uuid);
    create table public.room_modules(id uuid); create table public.reading_activity_assignments(id uuid);
    create table public.comprehension_questions(id uuid primary key, module_id uuid, material_id uuid,
      generated_by_ai boolean, review_status text, question_type text);
    create table public.comprehension_question_answers(question_id uuid primary key,
      correct_answer text, answer_explanation text, supporting_evidence text);
    alter table public.comprehension_questions enable row level security;
    alter table public.comprehension_question_answers enable row level security;
    grant select, insert, update, delete on public.comprehension_questions,
      public.comprehension_question_answers to authenticated;
  `);
  const m3 = sqlFile("supabase/m3_content_rls.sql");
  const m1 = sqlFile("supabase/m1_teacher_verification.sql");
  for (const name of ["m3_current_role", "m3_can_read_module", "m3_owns_material"]) {
    await db.exec(sqlFunction(m3, name));
  }
  await db.exec(m3.slice(m3.indexOf('drop policy if exists "M3 role-aware safe question reads"'), m3.indexOf("-- FUTURE PRIVATE STORAGE")));
  await db.exec(sqlFunction(m1, "m1_teacher_access_allowed"));
  await db.exec(sqlFunction(m1, "m3_current_role"));
  await db.exec(sqlFile("supabase/m5_oral_reading_schema.sql"));
  await db.exec(sqlFile("supabase/m5_selected_passage_security.sql"));
  await db.exec(sqlFile("readflow/supabase/m6_comprehension_schema.sql"));
  const functions = sqlFile("readflow/supabase/m6_comprehension_functions.sql");
  const start = functions.indexOf("CREATE OR REPLACE FUNCTION public.m6_apply_action");
  await db.exec(functions.slice(start, functions.indexOf("$function$;", start) + "$function$;".length));
  await db.exec(`revoke all on function public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid) from public, anon, authenticated;
    grant execute on function public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid) to service_role;`);
  const policyStart = m1.indexOf("do $$", m1.indexOf("-- Restrictive policies"));
  await db.exec(m1.slice(policyStart, m1.indexOf("end $$;", policyStart) + 7));
  await db.exec(`
    insert into public.profiles values
      ('${id(1)}','student',null), ('${id(2)}','general_user',null),
      ('${id(3)}','teacher','approved'), ('${id(4)}','teacher','approved'),
      ('${id(5)}','teacher','pending'), ('${id(6)}','teacher','rejected'),
      ('${id(7)}','teacher',null), ('${id(8)}','admin',null);
    insert into auth.users select id from public.profiles;
    insert into public.modules values ('${id(50)}','published');
    insert into public.uploaded_materials values ('${id(30)}','${id(3)}'), ('${id(40)}','${id(4)}');
    insert into public.comprehension_questions values
      ('${id(100)}',null,'${id(30)}',true,'reviewed','literal'),
      ('${id(101)}',null,'${id(40)}',true,'reviewed','literal'),
      ('${id(102)}',null,'${id(30)}',false,'reviewed','literal'),
      ('${id(103)}','${id(50)}',null,true,'reviewed','literal');
    insert into public.comprehension_question_answers select id,'protected',null,null from public.comprehension_questions;
  `);
  // Owning a generated material must NOT let learners or unapproved teachers see keys.
  for (const n of [1, 2, 5, 6, 7]) {
    await db.exec(`insert into public.uploaded_materials values ('${id(200+n)}','${id(n)}');
      insert into public.comprehension_questions values ('${id(300+n)}',null,'${id(200+n)}',true,'reviewed','literal');
      insert into public.comprehension_question_answers values ('${id(300+n)}','protected',null,null);`);
  }
  return db;
}

async function asUser(db, userId, sql, role = "authenticated") {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role })]);
    await db.exec(`set local role ${role}`);
    return await db.query(sql);
  } finally { await db.exec("rollback"); }
}

module.exports = { createSecurityDatabase, asUser, id, sqlFile };
