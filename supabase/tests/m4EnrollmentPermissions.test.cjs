// Real PostgreSQL RLS in memory only. No credentials or Supabase connection.
const { PGlite } = require('../../server/node_modules/@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const sql = file => readFileSync(resolve(__dirname, '../..', file), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('M4 enrollment removal respects authenticated role and classroom ownership', async t => {
  const db = new PGlite();
  t.after(() => db.close());
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
  // Install the actual approval helper and restriction, without onboarding writes.
  await db.exec('alter table public.profiles add column teacher_status text');
  const approval = sql('supabase/m1_teacher_verification.sql');
  const start = approval.indexOf('create function public.m1_teacher_access_allowed()');
  await db.exec(approval.slice(start, approval.indexOf('$$;', start) + 3));
  const restriction = approval.match(/create policy "M1 Teacher approval required" on public\.%I[^']+/)[0];
  await db.exec(restriction.replace('%I', 'enrollments'));
  await db.exec(`
    insert into auth.users values ('${id(1)}'), ('${id(2)}'), ('${id(3)}'), ('${id(4)}'), ('${id(5)}');
    insert into public.profiles(id, role, teacher_status) values
      ('${id(1)}','admin',null), ('${id(2)}','teacher','approved'),
      ('${id(3)}','teacher','approved'), ('${id(4)}','student',null), ('${id(5)}','student',null);
    insert into public.rooms(id, teacher_id, room_name, room_code) values
      ('${id(10)}','${id(2)}','English','ENROOM'), ('${id(11)}','${id(3)}','Filipino','FILROOM');
    insert into public.enrollments(id, room_id, student_id) values
      ('${id(20)}','${id(10)}','${id(4)}'), ('${id(21)}','${id(11)}','${id(4)}');
  `);
  const as = async user => {
    await db.exec('reset role');
    await db.query("select set_config('test.uid', $1, false)", [id(user)]);
    await db.exec('set role authenticated');
  };
  const remove = async enrollment => (await db.query('delete from public.enrollments where id=$1 returning id', [id(enrollment)])).rows;
  await t.test('Admin sees the roster but DELETE returns zero rows', async () => {
    await as(1);
    assert.equal((await db.query('select * from public.enrollments')).rows.length, 2);
    assert.deepEqual(await remove(20), []);
  });
  await t.test('another Teacher and a Student cannot remove an enrollment', async () => {
    for (const user of [3, 4]) { await as(user); assert.deepEqual(await remove(20), []); }
  });
  await t.test('an unapproved owning Teacher cannot remove a student', async () => {
    await db.exec(`reset role; update public.profiles set teacher_status='pending' where id='${id(2)}'`);
    await as(2); assert.deepEqual(await remove(20), []);
    await db.exec(`reset role; update public.profiles set teacher_status='approved' where id='${id(2)}'`);
  });
  await t.test('the owning approved Teacher removes only the selected enrollment', async () => {
    await as(2); assert.deepEqual(await remove(20), [{ id: id(20) }]);
    await db.exec('reset role');
    assert.deepEqual((await db.query('select id from public.enrollments')).rows, [{ id: id(21) }]);
    assert.equal((await db.query('select * from public.profiles')).rows.length, 5);
    assert.equal((await db.query('select * from public.rooms')).rows.length, 2);
  });
  await t.test('joining uses the authenticated Student and duplicate joins are idempotent', async () => {
    await as(5);
    const first = (await db.query("select * from public.join_room_by_code(' enroom ')")).rows[0];
    assert.equal(first.student_id, id(5)); assert.equal(first.room_id, id(10));
    const second = (await db.query("select * from public.join_room_by_code('ENROOM')")).rows[0];
    assert.equal(second.id, first.id);
    await assert.rejects(db.query(`insert into public.enrollments(room_id, student_id) values ('${id(11)}','${id(5)}')`), { code: '42501' });
  });
  await t.test('Admin cannot join by code as a Teacher or Student', async () => {
    await as(1);
    await assert.rejects(db.query("select * from public.join_room_by_code('ENROOM')"), /Only students/);
  });
});
