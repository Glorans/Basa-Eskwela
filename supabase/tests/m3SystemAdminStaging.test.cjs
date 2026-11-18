// Disposable in-memory PostgreSQL only. Never connects to a Supabase project.
// Rehearses m3_system_admin_PROPOSED.sql and its ROLLBACK against the EXACT function definitions read from
// ReadFlow-Staging by the read-only preflight (2026-11-18, m3_system_admin_staging_definitions.json): the proposal pins
// those fingerprints, so this is the only fixture it can apply to. Table stubs carry only the columns these checks use.
const { PGlite } = require('../../server/node_modules/@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const read = file => readFileSync(resolve(__dirname, '..', file), 'utf8');
const staging = JSON.parse(readFileSync(resolve(__dirname, 'm3_system_admin_staging_definitions.json'), 'utf8'));
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SYSTEM_ADMIN = id(1), SCHOOL_ADMIN = id(2), TEACHER = id(3), OTHER_TEACHER = id(4), LEARNER = id(5), STUDENT = id(7);
const REWRITTEN = ['m3_can_manage_module', 'm3_can_read_module', 'm3_create_collection_draft', 'm3_delete_module', 'm3_require_admin',
  'm3_trash_manager', 'm3_trashed_modules', 'm3_revise_module', 'm3_module_revisions'];
const PINNED = [...REWRITTEN, 'm3_write_material_question_set'];
const Q = 'm3_write_material_question_set(uuid,uuid,uuid,text,integer,jsonb)';
// Execute grants as installed on Staging (preflight): everything else is owner/service_role only.
const AUTH_EXEC = ['m3_current_role()', 'm3_can_read_module(uuid)', 'm3_create_collection_draft(uuid,text,uuid,text,jsonb)',
  'm3_delete_module(uuid)', 'm3_trashed_modules()', 'm3_revise_module(uuid)', 'm3_module_revisions(uuid)',
  'm3_storage_object_is_deletable(text)', 'm3_owns_material(uuid)', 'm3_material_is_unreferenced(uuid)'];

async function freshDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema auth, storage to authenticated;
    create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
    create function storage.foldername(name text) returns text[] language sql immutable as
      $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
    alter table storage.objects enable row level security;
    grant select, insert, delete on storage.objects to authenticated;
    create table profiles(id uuid primary key, role text, teacher_status text);
    create table learning_paths(id uuid primary key);
    create table uploaded_materials(id uuid primary key, uploaded_by uuid, storage_path text, next_question_set_number int default 1);
    create table modules(id uuid primary key, title text, path_id uuid, difficulty text, status text, created_by uuid, passage text,
      published_at timestamptz, deleted_at timestamptz, source_material_id uuid, collection_revision bigint default 0);
    create table module_passages(id uuid primary key, module_id uuid, title text, passage_text text, display_order int, source_material_id uuid);
    create table progress(module_id uuid); create table room_modules(module_id uuid);
    create table reading_activity_assignments(id uuid, question_set_id uuid, material_id uuid);
    create table material_question_sets(id uuid primary key default gen_random_uuid(), material_id uuid, created_by uuid, name text,
      sequence_number int, revision int default 0, updated_at timestamptz);
    create table comprehension_questions(id uuid primary key default gen_random_uuid(), module_id uuid, material_id uuid, question_set_id uuid,
      question_type text, question_text text, options jsonb, scaffolding_hint text, display_order int, generated_by_ai boolean,
      review_status text, reviewed_by uuid, reviewed_at timestamptz);
    create table comprehension_question_answers(question_id uuid primary key, correct_answer text);
    alter table modules enable row level security;
    grant select, update(title, status) on modules to authenticated;
    insert into profiles values ('${SYSTEM_ADMIN}', 'system_admin', null), ('${SCHOOL_ADMIN}', 'admin', null),
      ('${TEACHER}', 'teacher', 'approved'), ('${OTHER_TEACHER}', 'teacher', 'approved'), ('${LEARNER}', 'general_user', null),
      ('${STUDENT}', 'student', null), ('${id(6)}', 'teacher', 'pending');
    insert into uploaded_materials(id, uploaded_by, storage_path) values
      ('${id(20)}', '${SYSTEM_ADMIN}', '${SYSTEM_ADMIN}/a.pdf'), ('${id(21)}', '${LEARNER}', '${LEARNER}/b.pdf'),
      ('${id(22)}', '${TEACHER}', '${TEACHER}/c.pdf');
    insert into modules(id, title, status, created_by) values
      ('${id(30)}', 'Teacher draft', 'draft', '${TEACHER}'), ('${id(31)}', 'Published', 'published', '${SCHOOL_ADMIN}');
    set check_function_bodies = off;`);
  for (const [name, { definition }] of Object.entries(staging)) await db.exec(definition);
  await db.exec('reset check_function_bodies; revoke execute on all functions in schema public from public;');
  // The two module policies the checks touch, as installed on Staging ("M3 role-aware module reads", "M3 admins update modules").
  await db.exec(`create policy module_reads on modules for select to authenticated using (public.m3_can_read_module(id));
    create policy school_update on modules for update to authenticated using (public.m3_current_role() = 'admin') with check (public.m3_current_role() = 'admin');`);
  for (const fn of AUTH_EXEC) await db.exec(`grant execute on function public.${fn} to authenticated`);
  await db.exec(`grant execute on function public.${Q} to service_role`);
  return db;
}

const md5 = async (db, name) => (await db.query(
  `select md5(pg_get_functiondef(p.oid)) as h from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`,
  [name])).rows[0].h;
const as = async (db, uid, work) => {
  await db.query("select set_config('test.uid', $1, false)", [uid]);
  await db.exec('set role authenticated');
  try { return await work(); } finally { await db.exec('reset role'); }
};
const roleMatrix = async db => {
  const out = {};
  for (const [label, uid] of Object.entries({ SYSTEM_ADMIN, SCHOOL_ADMIN, TEACHER, OTHER_TEACHER, LEARNER, STUDENT, pending: id(6) })) {
    await db.query("select set_config('test.uid', $1, false)", [uid]);
    const row = (await db.query(`select public.m3_can_manage_module('${id(30)}') as manage_draft, public.m3_can_read_module('${id(30)}') as read_draft,
      public.m3_can_read_module('${id(31)}') as read_published, public.m3_current_role() as role`)).rows[0];
    out[label] = row;
  }
  return out;
};
// The question RPC's ownership gates run before it validates `operation`: 22023 means both gates were passed.
const questionGate = async (db, actor, material) => {
  try { await db.query(`select public.${Q.split('(')[0]}($1, $2, null, 'probe', 0, '[]'::jsonb)`, [actor, material]); return 'passed'; }
  catch (error) { return error.code === '22023' ? 'passed' : error.message; }
};

test('fixture: PGlite renders the Staging definitions with the same fingerprints the proposal pins', async () => {
  const db = await freshDatabase();
  try {
    for (const name of Object.keys(staging)) assert.equal(await md5(db, name), staging[name].hash, name);
  } finally { await db.close(); }
});

test('apply, verify behaviour, roll back to byte-identical originals, re-apply', async () => {
  const db = await freshDatabase();
  try {
    const before = await roleMatrix(db);
    assert.equal(before.SYSTEM_ADMIN.manage_draft, false, 'System Admin has no module access before the proposal');
    assert.match(await questionGate(db, SYSTEM_ADMIN, id(20)), /requires a Teacher or Admin/);

    await db.exec(read('proposed/m3_system_admin_PROPOSED.sql'));

    // Only System Admin changes; every other role gets exactly the same answers.
    const after = await roleMatrix(db);
    for (const label of Object.keys(before)) if (label !== 'SYSTEM_ADMIN') assert.deepEqual(after[label], before[label], label);
    assert.deepEqual(after.SYSTEM_ADMIN, { manage_draft: true, read_draft: true, read_published: true, role: 'system_admin' });
    assert.equal(await md5(db, 'm3_current_role'), staging.m3_current_role.hash, 'm3_current_role() untouched');
    for (const name of REWRITTEN) {
      const body = (await db.query(`select pg_get_functiondef('public.${name}'::regproc) as b`)).rows[0].b;
      assert.ok(body.includes('public.m3_module_author_role()') && !body.includes('public.m3_current_role()'), name);
      assert.equal(body.replaceAll('public.m3_module_author_role()', 'public.m3_current_role()'), staging[name].definition, `${name}: only the role lookup changed`);
    }
    const grants = (await db.query(`select has_function_privilege('authenticated', 'public.${Q}', 'EXECUTE') as auth,
      has_function_privilege('anon', 'public.${Q}', 'EXECUTE') as anon, has_function_privilege('authenticated', 'public.m3_module_author_role()', 'EXECUTE') as helper`)).rows[0];
    assert.deepEqual(grants, { auth: false, anon: false, helper: false }, 'no new execute grants');

    // Material questions: own uploads only; never another user's (Independent Learner or Teacher).
    assert.equal(await questionGate(db, SYSTEM_ADMIN, id(20)), 'passed');
    assert.match(await questionGate(db, SYSTEM_ADMIN, id(21)), /Material unavailable/);
    assert.match(await questionGate(db, SYSTEM_ADMIN, id(22)), /Material unavailable/);
    assert.equal(await questionGate(db, SCHOOL_ADMIN, id(21)), 'passed', 'School Admin branch unchanged');
    assert.equal(await questionGate(db, TEACHER, id(22)), 'passed', 'Teacher own material unchanged');
    assert.match(await questionGate(db, TEACHER, id(21)), /Material unavailable/, 'Teacher still limited to own material');

    // Forged source IDs: System Admin may attach only its own upload; other roles are not affected by this trigger.
    await db.query("select set_config('test.uid', $1, false)", [SYSTEM_ADMIN]);
    await assert.rejects(db.query(`insert into module_passages(id, module_id, source_material_id) values ('${id(40)}', '${id(31)}', '${id(21)}')`), /Use only reading materials you uploaded/);
    await assert.rejects(db.query(`update modules set source_material_id = '${id(22)}' where id = '${id(31)}'`), /Use only reading materials you uploaded/);
    await db.query(`insert into module_passages(id, module_id, source_material_id) values ('${id(41)}', '${id(31)}', '${id(20)}')`);
    await db.query("select set_config('test.uid', $1, false)", [SCHOOL_ADMIN]);
    await db.query(`insert into module_passages(id, module_id, source_material_id) values ('${id(42)}', '${id(31)}', '${id(21)}')`);

    // Storage: own folder only.
    const name = `${SYSTEM_ADMIN}/${id(50)}.pdf`;
    await as(db, SYSTEM_ADMIN, () => db.query(`insert into storage.objects(bucket_id, name) values ('reading-materials', $1)`, [name]));
    await assert.rejects(as(db, SYSTEM_ADMIN, () => db.query(`insert into storage.objects(bucket_id, name) values ('reading-materials', $1)`, [`${LEARNER}/${id(51)}.pdf`])), /row-level security/);
    await db.query(`insert into storage.objects(bucket_id, name) values ('reading-materials', $1)`, [`${LEARNER}/${id(52)}.pdf`]);
    const visible = await as(db, SYSTEM_ADMIN, () => db.query(`select name from storage.objects`));
    assert.deepEqual(visible.rows.map(r => r.name), [name], 'System Admin sees only its own files');

    // Direct module update: live modules only, through the policy (School Admin policy untouched).
    const updated = await as(db, SYSTEM_ADMIN, () => db.query(`update modules set title = 'Renamed' where id = '${id(31)}' returning id`));
    assert.equal(updated.rows.length, 1);
    await db.query(`update modules set deleted_at = now() where id = '${id(30)}'`);
    const trashed = await as(db, SYSTEM_ADMIN, () => db.query(`update modules set title = 'x' where id = '${id(30)}' returning id`));
    assert.equal(trashed.rows.length, 0, 'a module in the Trash is not directly editable');

    // Rollback restores every pinned function byte-for-byte and removes every System Admin object.
    await db.exec(read('proposed/m3_system_admin_ROLLBACK_PROPOSED.sql'));
    for (const fn of PINNED) assert.equal(await md5(db, fn), staging[fn].hash, `${fn} restored`);
    const leftovers = (await db.query(`select (select count(*) from pg_policies where policyname like 'M3 System Admin%')::int as policies,
      (select count(*) from pg_trigger where tgname like 'm3_system_admin%')::int as triggers,
      (select count(*) from pg_proc where proname in ('m3_module_author_role', 'm3_guard_system_admin_source'))::int as functions`)).rows[0];
    assert.deepEqual(leftovers, { policies: 0, triggers: 0, functions: 0 });
    assert.match(await questionGate(db, SYSTEM_ADMIN, id(20)), /requires a Teacher or Admin/, 'System Admin access removed again');

    // The proposal applies again after a rollback; a second apply is refused.
    await db.exec(read('proposed/m3_system_admin_PROPOSED.sql'));
    await assert.rejects(db.exec(read('proposed/m3_system_admin_PROPOSED.sql')), /changed since the reviewed preflight|already/);
  } finally { await db.close(); }
});
