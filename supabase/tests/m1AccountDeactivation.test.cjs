// Disposable in-memory PostgreSQL only. Never connects to a Supabase project.
// Rehearses m1_account_deactivation_PROPOSED.sql and its ROLLBACK. Table stubs carry only the columns these checks use;
// profiles.status matches Staging (text, NOT NULL, default 'active'; 2026-11-18 read-only preflight).
const { PGlite } = require('../../server/node_modules/@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const read = file => readFileSync(resolve(__dirname, '..', file), 'utf8');
const PROPOSAL = read('proposed/m1_account_deactivation_PROPOSED.sql');
const ROLLBACK = read('proposed/m1_account_deactivation_ROLLBACK_PROPOSED.sql');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SA = id(1), SA2 = id(9), SCHOOL = id(2), TEACHER = id(3), STUDENT = id(4), LEARNER = id(5), SCHOOL2 = id(6);

async function freshDatabase({ extraSystemAdmin = false } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create role service_role; create role authenticator;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema auth, storage, public to authenticated, anon, service_role;
    create table profiles(id uuid primary key, role text, teacher_status text, full_name text, status text not null default 'active');
    grant select (id, role, status) on profiles to authenticated;
    alter table profiles enable row level security;
    create policy own on profiles for select to authenticated using (id = auth.uid());
    create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid);
    alter table storage.objects enable row level security;
    grant select, insert on storage.objects to authenticated;
    create policy "owner reads" on storage.objects for select to authenticated using (owner = auth.uid());
    create policy "owner writes" on storage.objects for insert to authenticated with check (owner = auth.uid());
    create table oral_reading_attempts(id uuid primary key default gen_random_uuid(), user_id uuid, pronunciation_accuracy numeric);
    insert into profiles(id, role, teacher_status) values
      ('${SA}','system_admin',null), ('${SCHOOL}','admin',null), ('${SCHOOL2}','admin',null), ('${TEACHER}','teacher','approved'),
      ('${STUDENT}','student',null), ('${LEARNER}','general_user',null) ${extraSystemAdmin ? `, ('${SA2}','system_admin',null)` : ''};
    insert into oral_reading_attempts(user_id, pronunciation_accuracy) values ('${STUDENT}', 91.5), ('${LEARNER}', 72.25);
    insert into storage.objects(name, owner) values ('student/file.pdf', '${STUDENT}');
  `);
  return db;
}
// Like psql with ON_ERROR_STOP: a failed script leaves nothing behind (the open transaction is rolled back).
const runScript = async (db, sql) => { try { await db.exec(sql); } catch (error) { await db.exec('rollback'); throw error; } };
const install = db => runScript(db, PROPOSAL);
const setStatus = (db, actor, target, status) =>
  db.query('select public.m1_set_account_status($1, $2, $3) as previous', [actor, target, status]).then(r => r.rows[0].previous);
const statusOf = async (db, who) => (await db.query('select status from profiles where id = $1', [who])).rows[0].status;
const events = async db => (await db.query('select target_id, target_role, actor_id, actor_role, action, status_changed from public.m1_account_status_events order by acted_at, id')).rows;
async function asUser(db, uid, sql, params = []) {
  await db.exec(`set test.uid = '${uid}'; set role authenticated;`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role; reset test.uid;'); }
}

test('install: existing accounts stay active, nothing else changes, and it refuses to run twice or on unknown statuses', async () => {
  const db = await freshDatabase();
  await install(db);
  assert.deepEqual((await db.query("select distinct status from profiles")).rows, [{ status: 'active' }]);
  assert.deepEqual((await db.query('select pronunciation_accuracy::text from oral_reading_attempts order by 1')).rows.map(r => r.pronunciation_accuracy), ['72.25', '91.5']);
  assert.deepEqual(await events(db), []);
  const config = (await db.query("select array_to_string(rolconfig, ',') as c from pg_roles where rolname = 'authenticator'")).rows[0].c;
  assert.match(config, /pgrst\.db_pre_request=public\.m1_reject_deactivated_request/);
  await assert.rejects(install(db), /already \(partly\) installed/);
  await assert.rejects(db.query("update profiles set status = 'banned' where id = $1", [LEARNER]), /profiles_status_check/);

  const unexpected = await freshDatabase();
  await unexpected.exec(`update profiles set status = 'pending' where id = '${LEARNER}'`);
  await assert.rejects(install(unexpected), /every profile must be active/);
});

test('System Admin deactivates and reactivates Independent Learners and School Admins, with an audit row per change', async () => {
  const db = await freshDatabase();
  await install(db);
  assert.equal(await setStatus(db, SA, LEARNER, 'inactive'), 'active');
  assert.equal(await statusOf(db, LEARNER), 'inactive');
  assert.equal(await setStatus(db, SA, LEARNER, 'inactive'), 'inactive', 'repeat is a no-op');
  assert.equal(await setStatus(db, SA, SCHOOL, 'inactive'), 'active');
  assert.equal(await setStatus(db, SA, LEARNER, 'active'), 'inactive');
  assert.equal(await statusOf(db, LEARNER), 'active');
  const logged = (await events(db)).map(e => [e.target_id, e.target_role, e.actor_id, e.actor_role, e.action, e.status_changed]);
  assert.equal(logged.length, 4, 'every administrator action is recorded, including the retry');
  for (const row of [[LEARNER, 'general_user', SA, 'system_admin', 'deactivate', true], [LEARNER, 'general_user', SA, 'system_admin', 'deactivate', false],
    [SCHOOL, 'admin', SA, 'system_admin', 'deactivate', true], [LEARNER, 'general_user', SA, 'system_admin', 'reactivate', true]]) {
    assert.ok(logged.some(l => JSON.stringify(l) === JSON.stringify(row)), JSON.stringify(row));
  }
  // Role, Teacher verification and learning records are never touched.
  assert.deepEqual((await db.query('select role, teacher_status from profiles order by id')).rows.map(r => r.role),
    ['system_admin', 'admin', 'teacher', 'student', 'general_user', 'admin']);
  assert.equal((await db.query('select count(*)::int as n from oral_reading_attempts')).rows[0].n, 2);
});

test('scope: System Admin cannot change Teachers, Students, System Admins or itself; School Admin only Teachers and Students', async () => {
  const db = await freshDatabase({ extraSystemAdmin: true });
  await install(db);
  for (const target of [TEACHER, STUDENT, SA2, SA, id(999)]) {
    await assert.rejects(setStatus(db, SA, target, 'inactive'), /m1_target_missing/, target);
  }
  assert.equal(await setStatus(db, SCHOOL, TEACHER, 'inactive'), 'active');
  assert.equal(await setStatus(db, SCHOOL, STUDENT, 'inactive'), 'active');
  assert.equal(await setStatus(db, SCHOOL, TEACHER, 'active'), 'inactive');
  assert.equal((await db.query('select teacher_status from profiles where id = $1', [TEACHER])).rows[0].teacher_status, 'approved', 'verification kept');
  for (const target of [SA, SCHOOL2, LEARNER, SCHOOL]) {
    await assert.rejects(setStatus(db, SCHOOL, target, 'inactive'), /m1_target_missing/, target);
  }
  for (const actor of [TEACHER, STUDENT, LEARNER, id(998)]) {
    await assert.rejects(setStatus(db, actor, actor === STUDENT ? TEACHER : STUDENT, 'inactive'), /m1_actor_not_manager/, actor);
  }
  await setStatus(db, SA, SCHOOL2, 'inactive');
  await assert.rejects(setStatus(db, SCHOOL2, TEACHER, 'inactive'), /m1_actor_not_manager/, 'a deactivated administrator manages nothing');
  await assert.rejects(setStatus(db, SA, LEARNER, 'deleted'), /m1_invalid_status/);
});

test('browser roles cannot call the status function or read the audit history', async () => {
  const db = await freshDatabase();
  await install(db);
  await assert.rejects(asUser(db, SA, 'select public.m1_set_account_status($1, $2, $3)', [SA, LEARNER, 'inactive']), /permission denied/);
  await assert.rejects(asUser(db, SA, 'select * from public.m1_account_status_events'), /permission denied/);
  await db.exec('set role anon');
  await assert.rejects(db.query('select public.m1_set_account_status($1, $2, $3)', [SA, LEARNER, 'inactive']), /permission denied/);
  await db.exec('reset role');
});

test('tokens issued before deactivation: the pre-request check refuses the account; storage is narrowed; reactivation restores it', async () => {
  const db = await freshDatabase();
  await install(db);
  const preRequest = uid => asUser(db, uid, 'select public.m1_reject_deactivated_request()');
  await preRequest(STUDENT);
  await db.exec('set role anon'); await db.query('select public.m1_reject_deactivated_request()'); await db.exec('reset role');
  assert.equal((await asUser(db, STUDENT, 'select count(*)::int as n from storage.objects')).rows[0].n, 1);

  await setStatus(db, SCHOOL, STUDENT, 'inactive');
  await assert.rejects(preRequest(STUDENT), e => e.code === 'PT403' && /deactivated/.test(e.message));
  assert.equal((await asUser(db, STUDENT, 'select public.m1_account_active() as a')).rows[0].a, false);
  assert.equal((await asUser(db, STUDENT, 'select count(*)::int as n from storage.objects')).rows[0].n, 0, 'storage reads refused');
  await assert.rejects(asUser(db, STUDENT, "insert into storage.objects(name, owner) values ('student/new.pdf', $1)", [STUDENT]), /row-level security/);
  await preRequest(TEACHER); // other accounts unaffected

  await setStatus(db, SCHOOL, STUDENT, 'active');
  await preRequest(STUDENT);
  assert.equal((await asUser(db, STUDENT, 'select count(*)::int as n from storage.objects')).rows[0].n, 1, 'access restored');
  assert.deepEqual((await db.query("select pronunciation_accuracy::text from oral_reading_attempts where user_id = $1", [STUDENT])).rows, [{ pronunciation_accuracy: '91.5' }]);
});

test('rollback refuses while an account is deactivated, then removes everything except the audit history', async () => {
  const db = await freshDatabase();
  await install(db);
  await setStatus(db, SA, LEARNER, 'inactive');
  await assert.rejects(runScript(db, ROLLBACK), /reactivate every deactivated account/);
  await setStatus(db, SA, LEARNER, 'active');
  await runScript(db, ROLLBACK);
  const left = (await db.query(`select to_regprocedure('public.m1_set_account_status(uuid,uuid,text)') is null as fn,
    to_regprocedure('public.m1_reject_deactivated_request()') is null as pre, to_regprocedure('public.m1_account_active()') is null as active,
    not exists (select 1 from pg_constraint where conname = 'profiles_status_check') as check_gone,
    not exists (select 1 from pg_policies where policyname = 'M1 active account required') as policy_gone,
    coalesce((select array_to_string(rolconfig, ',') from pg_roles where rolname = 'authenticator'), '') !~ 'db_pre_request' as config_gone`)).rows[0];
  assert.deepEqual(left, { fn: true, pre: true, active: true, check_gone: true, policy_gone: true, config_gone: true });
  assert.equal((await db.query('select count(*)::int as n from public.m1_account_status_events')).rows[0].n, 2, 'audit history kept');
  await assert.rejects(install(db), /already \(partly\) installed/, 'audit table kept, so a reinstall needs review');
});
