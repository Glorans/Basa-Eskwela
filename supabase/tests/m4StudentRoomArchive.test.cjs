// Real PostgreSQL RLS in memory only (PGlite). No credentials, no Supabase connection.
// Covers supabase/proposed/m4_student_room_archive_{PROPOSED,ROLLBACK_PROPOSED,VERIFY_READONLY}.sql.
const { PGlite } = require('../../server/node_modules/@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const sql = file => readFileSync(resolve(__dirname, '../..', file), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN = 1, TEACHER = 2, S1 = 4, S2 = 5, ROOM_A = 10, ROOM_B = 11, ROOM_C = 12;

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid
    $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
  `);
  await db.exec(sql('supabase/staging/00_core_baseline.sql'));
  await db.exec(sql('readflow/supabase/migrations/20261005_m4_classroom_management.sql'));
  // The Teacher archive column as installed on Staging by m4_room_archive (shape only).
  await db.exec('alter table public.rooms add column archived_at timestamptz, add column archived_by uuid');
  await db.exec(`
    insert into auth.users values ('${id(ADMIN)}'), ('${id(TEACHER)}'), ('${id(S1)}'), ('${id(S2)}');
    insert into public.profiles(id, role) values
      ('${id(ADMIN)}','admin'), ('${id(TEACHER)}','teacher'), ('${id(S1)}','student'), ('${id(S2)}','student');
    insert into public.rooms(id, teacher_id, room_name, room_code) values
      ('${id(ROOM_A)}','${id(TEACHER)}','English','ROOMA'), ('${id(ROOM_B)}','${id(TEACHER)}','Filipino','ROOMB'),
      ('${id(ROOM_C)}','${id(TEACHER)}','Science','ROOMC');
    insert into public.enrollments(id, room_id, student_id) values
      ('${id(20)}','${id(ROOM_A)}','${id(S1)}'), ('${id(21)}','${id(ROOM_A)}','${id(S2)}'),
      ('${id(22)}','${id(ROOM_B)}','${id(S1)}');
  `);
  return db;
}

async function as(db, user) {
  await db.exec('reset role');
  await db.query("select set_config('test.uid', $1, false)", [user ? id(user) : '']);
  await db.exec(user ? 'set role authenticated' : 'set role anon');
}
const setArchived = (db, room, archive) =>
  db.query('select public.m4_set_my_room_archived($1, $2) as changed', [id(room), archive]).then(r => r.rows[0].changed);
const myRows = db => db.query('select room_id from public.m4_student_room_archives order by room_id').then(r => r.rows.map(x => x.room_id));
const rejects = async (promise, code) => {
  await assert.rejects(promise, error => { assert.equal(error.code, code, error.message); return true; });
};
async function snapshot(db) {
  await db.exec('reset role');
  const q = text => db.query(text).then(r => r.rows);
  return {
    rooms: await q('select id, room_name, archived_at, archived_by from public.rooms order by id'),
    enrollments: await q('select id, room_id, student_id, enrolled_at from public.enrollments order by id'),
  };
}

test('a Student archives and restores only their own view of a joined Learning Room', async t => {
  const db = await database();
  t.after(() => db.close());
  await db.exec(sql('supabase/proposed/m4_student_room_archive_PROPOSED.sql'));
  const before = await snapshot(db);

  await as(db, S1);
  assert.equal(await setArchived(db, ROOM_A, true), true);
  assert.equal(await setArchived(db, ROOM_A, true), false, 'archiving twice changes nothing');
  assert.deepEqual(await myRows(db), [id(ROOM_A)]);

  // Other Student and Teacher: unaffected, and cannot see S1's personal archive.
  await as(db, S2);
  assert.deepEqual(await myRows(db), []);
  await as(db, TEACHER);
  assert.deepEqual(await myRows(db), []);
  // The shared room, its enrollments and the Teacher archive are unchanged.
  assert.deepEqual(await snapshot(db), before);

  await as(db, S1);
  assert.equal(await setArchived(db, ROOM_A, false), true);
  assert.equal(await setArchived(db, ROOM_A, false), false, 'restoring twice changes nothing');
  assert.deepEqual(await myRows(db), []);
});

test('only an enrolled Student may change their own personal archive', async t => {
  const db = await database();
  t.after(() => db.close());
  await db.exec(sql('supabase/proposed/m4_student_room_archive_PROPOSED.sql'));

  await as(db, S2);
  await rejects(setArchived(db, ROOM_B, true), '42501');  // not enrolled in ROOM_B
  await rejects(setArchived(db, ROOM_C, true), '42501');  // nobody enrolled
  for (const user of [TEACHER, ADMIN]) {
    await as(db, user);
    await rejects(setArchived(db, ROOM_A, true), '42501');
  }
  await as(db, null);
  await rejects(setArchived(db, ROOM_A, true), '42501');  // anon: no execute privilege

  // No direct writes, even for one's own row: only the function changes the table.
  await as(db, S1);
  await rejects(db.query(`insert into public.m4_student_room_archives(room_id, student_id) values ($1, $2)`, [id(ROOM_A), id(S1)]), '42501');
  assert.equal(await setArchived(db, ROOM_A, true), true);
  await rejects(db.query('delete from public.m4_student_room_archives'), '42501');
  await rejects(db.query('update public.m4_student_room_archives set archived_at = now()'), '42501');
  // Another Student can neither see nor remove S1's row through the function (it uses auth.uid()).
  await as(db, S2);
  assert.equal(await setArchived(db, ROOM_A, false), false);
  await as(db, S1);
  assert.deepEqual(await myRows(db), [id(ROOM_A)]);
});

test('a Teacher-archived room cannot be restored by a Student, and removal clears the personal mark', async t => {
  const db = await database();
  t.after(() => db.close());
  await db.exec(sql('supabase/proposed/m4_student_room_archive_PROPOSED.sql'));

  await as(db, S1);
  assert.equal(await setArchived(db, ROOM_A, true), true);
  await db.exec(`reset role; update public.rooms set archived_at = now(), archived_by = '${id(TEACHER)}' where id = '${id(ROOM_A)}'`);
  await as(db, S1);
  await rejects(setArchived(db, ROOM_A, false), '55000');
  assert.deepEqual(await myRows(db), [id(ROOM_A)], 'the personal mark stays while the Teacher archive is on');
  // Teacher restores the room: the Student may now restore their own view.
  await db.exec(`reset role; update public.rooms set archived_at = null, archived_by = null where id = '${id(ROOM_A)}'`);
  await as(db, S1);
  assert.equal(await setArchived(db, ROOM_A, false), true);

  // Removing the Student from the room removes their personal archive row with the enrollment.
  assert.equal(await setArchived(db, ROOM_B, true), true);
  await db.exec(`reset role; delete from public.enrollments where id = '${id(22)}'`);
  await as(db, S1);
  assert.deepEqual(await myRows(db), []);
});

test('read-only verification passes after apply, and the rollback removes only the new objects', async t => {
  const db = await database();
  t.after(() => db.close());
  const verify = sql('supabase/proposed/m4_student_room_archive_VERIFY_READONLY.sql');
  const [preflightSql, postSql] = verify.split('-- POST-APPLY');
  const preflight = (await db.query(preflightSql.slice(preflightSql.indexOf('select')))).rows;
  assert.deepEqual(preflight.filter(r => !r.ok), [], JSON.stringify(preflight));

  await db.exec(sql('supabase/proposed/m4_student_room_archive_PROPOSED.sql'));
  const post = (await db.query(postSql.slice(postSql.indexOf('select')))).rows;
  assert.deepEqual(post.filter(r => !r.ok), [], JSON.stringify(post));

  await as(db, S1);
  await setArchived(db, ROOM_A, true);
  const before = await snapshot(db);
  await db.exec(sql('supabase/proposed/m4_student_room_archive_ROLLBACK_PROPOSED.sql'));
  assert.equal((await db.query("select to_regclass('public.m4_student_room_archives') as t")).rows[0].t, null);
  assert.equal((await db.query("select to_regprocedure('public.m4_set_my_room_archived(uuid,boolean)') as f")).rows[0].f, null);
  assert.deepEqual(await snapshot(db), before, 'rooms and enrollments untouched by the rollback');
});
