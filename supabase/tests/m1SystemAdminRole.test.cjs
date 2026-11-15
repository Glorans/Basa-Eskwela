// Real PostgreSQL in memory (PGlite) only. No credentials, no Supabase connection.
// Covers supabase/proposed/m1_system_admin_role_{PROPOSED,ROLLBACK_PROPOSED,VERIFY_READONLY}.sql with the real
// Staging baseline, the real is_admin() and the real M1 role protections (trigger + assign_own_role).
const { PGlite } = require('../../server/node_modules/@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const sql = file => readFileSync(resolve(__dirname, '../..', file), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const between = (text, start, end) => { const i = text.indexOf(start); assert.ok(i >= 0, start); return text.slice(i, text.indexOf(end, i) + end.length); };

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
  `);
  await db.exec(sql('supabase/staging/00_core_baseline.sql'));
  await db.exec(sql('readflow/supabase/migrations/20261005_m4_classroom_management.sql'));
  // Staging's constraint is NOT VALID (2026-11-15 schema backup); reproduce it exactly so PREFLIGHT matches Staging.
  await db.exec(`alter table public.profiles drop constraint profiles_role_check;
    alter table public.profiles add constraint profiles_role_check
      check (role is null or role in ('admin', 'teacher', 'student', 'general_user')) not valid;`);
  const teacher = sql('supabase/m1_teacher_verification.sql');
  await db.exec(between(teacher, 'alter table public.profiles add column teacher_status text;', 'grant select (teacher_status) on public.profiles to authenticated;'));
  await db.exec(between(teacher, 'create or replace function public.m1_protect_profile_authorization_fields()', 'end $$;'));
  await db.exec(between(teacher, 'create or replace function public.assign_own_role(selected_role text)', 'end $$;'));
  const onboarding = sql('supabase/m1_onboarding_security_migration.sql');
  await db.exec(between(onboarding, 'create policy "M1 users read own profile"', ');'));
  const updateOwn = onboarding.match(/create policy "M1 users update own display name"[\s\S]*?with check \(\s*id = auth\.uid\(\)\s*\);/);
  assert.ok(updateOwn, 'own-profile update policy found');
  await db.exec(updateOwn[0]);
  await db.exec(`create trigger profiles_protect_authorization_fields before update on public.profiles
                 for each row execute function public.m1_protect_profile_authorization_fields();
                 grant select, update on public.profiles to authenticated;`);
  await db.exec(`insert into auth.users(id) values ('${id(1)}'), ('${id(2)}'), ('${id(3)}'), ('${id(4)}');
    insert into public.profiles(id, role) values ('${id(1)}', 'admin'), ('${id(2)}', null), ('${id(3)}', 'student'), ('${id(4)}', null);`);
  return db;
}
const as = async (db, user) => {
  await db.exec('reset role');
  await db.query("select set_config('test.uid', $1, false)", [user ? id(user) : '']);
  await db.exec(user ? 'set role authenticated' : 'set role anon');
};
const verify = async (db, section) => {
  const text = sql('supabase/proposed/m1_system_admin_role_VERIFY_READONLY.sql');
  const part = section === 'pre' ? text.slice(text.indexOf('-- PREFLIGHT'), text.indexOf('-- POST-APPLY')) : text.slice(text.indexOf('-- POST-APPLY'));
  await db.exec('reset role');
  return (await db.query(part.slice(part.indexOf('select')))).rows;
};
const rejects = async (promise, code) => assert.rejects(promise, error => { assert.equal(error.code, code, error.message); return true; });

test('preflight passes on the current schema, the migration applies, and post-apply verification passes', async t => {
  const db = await database();
  t.after(() => db.close());
  assert.deepEqual((await verify(db, 'pre')).filter(r => !r.ok), []);
  const before = (await db.query('select id, role from public.profiles order by id')).rows;
  await db.exec(sql('supabase/proposed/m1_system_admin_role_PROPOSED.sql'));
  assert.deepEqual((await verify(db, 'post')).filter(r => !r.ok), []);
  assert.deepEqual((await db.query('select id, role from public.profiles order by id')).rows, before, 'no existing row changes');
});

test('nobody becomes a System Admin or School Admin by themselves; only the database owner can provision one', async t => {
  const db = await database();
  t.after(() => db.close());
  await db.exec(sql('supabase/proposed/m1_system_admin_role_PROPOSED.sql'));
  for (const role of ['system_admin', 'admin']) {
    await as(db, 2);
    await rejects(db.query('select public.assign_own_role($1)', [role]), '22023');
    await rejects(db.query(`update public.profiles set role = $1 where id = '${id(2)}'`, [role]), '42501');
    await as(db, 3);
    await rejects(db.query(`update public.profiles set role = $1 where id = '${id(3)}'`, [role]), '42501');
  }
  await as(db, 2);
  assert.equal((await db.query("select public.assign_own_role('student') as r")).rows[0].r, 'student', 'normal registration still works');
  await db.exec('reset role');
  await rejects(db.query(`update public.profiles set role = 'superadmin' where id = '${id(4)}'`), '23514');
  await db.exec(`update public.profiles set role = 'system_admin' where id = '${id(4)}'`);
  await as(db, 4);
  assert.equal((await db.query('select public.is_system_admin() as s, public.is_admin() as a')).rows[0].s, true);
  assert.equal((await db.query('select public.is_admin() as a')).rows[0].a, false, 'a System Admin is NOT a School Admin to existing policies');
  await as(db, 1);
  assert.deepEqual((await db.query('select public.is_system_admin() as s, public.is_admin() as a')).rows[0], { s: false, a: true }, 'existing Admin = School Admin');
  await as(db, null);
  await rejects(db.query('select public.is_system_admin()'), '42501');
});

test('rollback refuses while a System Admin exists, then restores the original four-role check', async t => {
  const db = await database();
  t.after(() => db.close());
  await db.exec(sql('supabase/proposed/m1_system_admin_role_PROPOSED.sql'));
  await db.exec(`update public.profiles set role = 'system_admin' where id = '${id(4)}'`);
  const rollback = sql('supabase/proposed/m1_system_admin_role_ROLLBACK_PROPOSED.sql');
  await rejects(db.exec(rollback), '55000');
  await db.exec('rollback');
  assert.ok((await db.query("select to_regprocedure('public.is_system_admin()') as f")).rows[0].f, 'refused rollback changed nothing');
  await db.exec(`update public.profiles set role = null where id = '${id(4)}'`);
  await db.exec(rollback);
  assert.deepEqual((await verify(db, 'pre')).filter(r => !r.ok), [], 'schema is back to the pre-migration state');
});

test('direct profile reads: a School Admin or System Admin cannot read an Independent Learner profile through Supabase', async t => {
  const db = await database();
  t.after(() => db.close());
  await db.exec(sql('supabase/proposed/m1_system_admin_role_PROPOSED.sql'));
  await db.exec(`insert into auth.users(id) values ('${id(5)}'); insert into public.profiles(id, role, full_name) values ('${id(5)}', 'general_user', 'Learner');
                 update public.profiles set role = 'system_admin' where id = '${id(4)}';`);
  for (const manager of [1, 4]) {
    await as(db, manager);
    const visible = (await db.query('select id from public.profiles')).rows.map(r => r.id);
    assert.deepEqual(visible, [id(manager)], `manager ${manager} sees only their own profile`);
    assert.equal((await db.query(`update public.profiles set full_name = 'x' where id = '${id(5)}'`)).affectedRows, 0);
  }
  await db.exec('reset role');
});
