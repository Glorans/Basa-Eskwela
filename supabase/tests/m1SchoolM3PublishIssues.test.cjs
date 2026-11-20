// Real PostgreSQL in memory (PGlite) only. No credentials, no Supabase connection.
// M1 multi-tenancy: m3_collection_publish_issues (callable by signed-in accounts) must never answer about another
// school's module, and an unknown id must get the same refusal (no existence oracle). The school helpers,
// m3_can_manage_module and m3_collection_publish_issues are taken verbatim from m1_multi_tenancy_PROPOSED.sql;
// the readiness rules (phase 1) verbatim from m3_teacher_module_management_PROPOSED.sql (applied on Staging).
const { PGlite } = require('../../server/node_modules/@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const sql = (file) => readFileSync(resolve(__dirname, '../..', file), 'utf8');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fn = (source, head) => {
  const start = source.indexOf(head);
  assert.ok(start >= 0, `missing ${head}`);
  return source.slice(start, source.indexOf('$$;', start) + 3);
};
const MIGRATION = sql('supabase/proposed/m1_multi_tenancy_PROPOSED.sql');
const DENY = /Module owner or Admin access required/;
const [S1, S2] = [id(1), id(2)];
const U = { sa: id(10), admin1: id(11), teacher1: id(12), student1: id(13), admin2: id(21), teacher2: id(22), il: id(30), teacher1b: id(14) };
const [M1, M2, MP, UNKNOWN] = [id(100), id(200), id(300), id(999)];

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.profiles(id uuid primary key, role text, teacher_status text, school_id uuid);
    create table public.learning_paths(id uuid primary key);
    create table public.modules(id uuid primary key, title text, path_id uuid, difficulty text, created_by uuid);
    create table public.module_passages(id uuid primary key, module_id uuid, title text, passage_text text, display_order integer);
    create table public.comprehension_questions(id uuid primary key, module_id uuid, passage_id uuid, question_type text, review_status text);
    create table public.comprehension_question_answers(question_id uuid primary key, correct_answer text);
    -- Same contract as the deployed helpers: approved Teachers only; the System Admin authors as an Admin.
    create function public.m3_current_role() returns text language sql stable security definer set search_path = '' as $$
      select case when p.role = 'teacher' and p.teacher_status is distinct from 'approved' then null else p.role end
      from public.profiles p where p.id = auth.uid() $$;
    create function public.m3_module_author_role() returns text language sql stable security definer set search_path = '' as $$
      select case public.m3_current_role() when 'system_admin' then 'admin' else public.m3_current_role() end $$;
    insert into public.profiles values
      ('${U.sa}', 'system_admin', null, null), ('${U.admin1}', 'admin', null, '${S1}'), ('${U.teacher1}', 'teacher', 'approved', '${S1}'),
      ('${U.teacher1b}', 'teacher', 'approved', '${S1}'), ('${U.student1}', 'student', null, '${S1}'), ('${U.admin2}', 'admin', null, '${S2}'),
      ('${U.teacher2}', 'teacher', 'approved', '${S2}'), ('${U.il}', 'general_user', null, null);
    insert into public.learning_paths values ('${id(50)}');
    insert into public.modules values ('${M1}', 'School 1 private module', '${id(50)}', 'Easy', '${U.teacher1}'),
      ('${M2}', 'School 2 private module', '${id(50)}', 'Easy', '${U.teacher2}'), ('${MP}', 'Platform module', '${id(50)}', 'Easy', '${U.sa}');
  `);
  await db.exec(fn(MIGRATION, 'create function public.m1_school_visible('));
  await db.exec(fn(MIGRATION, 'create function public.m1_module_visible('));
  await db.exec(fn(MIGRATION, 'create or replace function public.m3_can_manage_module('));
  // The installed readiness rules (phase 1) as Staging has them: owner Teacher or Admin via m3_can_manage_module.
  const teacherMgmt = sql('supabase/proposed/m3_teacher_module_management_PROPOSED.sql');
  const p1 = teacherMgmt.indexOf('CREATE OR REPLACE FUNCTION public.m3_collection_publish_issues_phase1(');
  assert.ok(p1 >= 0);
  await db.exec(teacherMgmt.slice(p1, teacherMgmt.indexOf('$function$;', p1) + '$function$;'.length));
  await db.exec(fn(MIGRATION, 'create or replace function public.m3_collection_publish_issues('));
  await db.exec(`revoke all on function public.m3_collection_publish_issues_phase1(uuid) from public;
    grant execute on function public.m3_collection_publish_issues(uuid) to authenticated;
    grant select on all tables in schema public to authenticated; grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;`);
  return db;
}

async function issues(db, user, moduleId) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? '']);
  await db.exec(user ? 'set role authenticated' : 'set role service_role');
  try {
    return { ok: (await db.query('select public.m3_collection_publish_issues($1) i', [moduleId])).rows[0].i };
  } catch (error) {
    return { error: error.message };
  } finally {
    await db.exec('reset role');
  }
}

test('M3 publish readiness: authorized accounts are answered for their own school (and the System Admin for all)', async (t) => {
  const db = await database(); t.after(() => db.close());
  for (const [user, moduleId] of [[U.teacher1, M1], [U.admin1, M1], [U.sa, M1], [U.teacher2, M2], [U.admin2, M2], [U.sa, M2], [U.sa, MP]]) {
    const r = await issues(db, user, moduleId);
    assert.ok(Array.isArray(r.ok), `${user} on ${moduleId}: ${r.error}`);
    assert.ok(r.ok.includes('At least one passage is required'), 'readiness rules still run');
  }
});

test('M3 publish readiness: no cross-school answer in either direction; Students, ILs and other Teachers refused', async (t) => {
  const db = await database(); t.after(() => db.close());
  for (const [user, moduleId] of [[U.admin1, M2], [U.teacher1, M2], [U.student1, M2], [U.il, M2],
    [U.admin2, M1], [U.teacher2, M1], [U.teacher1b, M1], [U.il, M1], [null, M1]]) {
    const r = await issues(db, user, moduleId);
    assert.match(r.error ?? `answered: ${JSON.stringify(r.ok)}`, DENY, `${user} on ${moduleId}`);
  }
});

test('M3 publish readiness: an unknown id gets the same refusal as a foreign module (no existence oracle)', async (t) => {
  const db = await database(); t.after(() => db.close());
  for (const user of [U.admin1, U.admin2, U.sa, U.teacher1]) {
    const unknown = await issues(db, user, UNKNOWN);
    assert.match(unknown.error ?? `answered: ${JSON.stringify(unknown.ok)}`, DENY, user);
  }
  const foreign = await issues(db, U.admin1, M2);
  const unknown = await issues(db, U.admin1, UNKNOWN);
  assert.equal(foreign.error, unknown.error);
});
