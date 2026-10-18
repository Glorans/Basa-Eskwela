// Runs only in a disposable in-memory PostgreSQL database; never connects to Supabase.
const { PGlite } = require('../../server/node_modules/@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const migration = readFileSync(join(__dirname, '../m1_profile_age.sql'), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('draft age migration preserves existing profiles, authorization and privacy', async t => {
  const db = new PGlite();
  const login = async n => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id(n)]);
    await db.query("select set_config('request.jwt.claim.role', 'authenticated', false)");
    await db.exec('set role authenticated');
  };
  const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create function auth.role() returns text language sql stable as
        $$ select current_setting('request.jwt.claim.role', true) $$;
      grant usage on schema auth, public, storage to authenticated, anon;
      create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
      create table public.profiles(id uuid primary key, full_name text not null default '',
        role text, status text default 'active', created_at timestamptz default now());
      create table storage.objects(id int primary key);
    `);
    await db.exec(readFileSync(join(__dirname, '../m1_onboarding_security_migration.sql'), 'utf8'));
    for (let n = 1; n <= 4; n++) {
      await db.query('insert into auth.users values($1, now())', [id(n)]);
    }
    await db.query("update profiles set role='student',nickname='Existing Reader' where id=$1", [id(1)]);
    await db.exec(readFileSync(join(__dirname, '../m1_teacher_verification.sql'), 'utf8'));
    // Model another module allowing profile-name reads without exposing age.
    await db.exec('create policy shared_names on public.profiles for select to authenticated using(true)');
    const before = (await db.query('select * from profiles order by id')).rows;
    await db.exec(migration);

    await t.test('existing values are untouched and age remains nullable', async () => {
      const after = (await db.query('select * from profiles order by id')).rows;
      assert.deepEqual(after.map(({ age, ...row }) => row), before);
      assert.ok(after.every(row => row.age === null));
    });
    await t.test('learners retain role selection and can save and read their own age', async () => {
      for (const [n, role, age] of [[2, 'student', 1], [3, 'general_user', 120]]) {
        await login(n);
        assert.equal(await scalar('select assign_own_role($1)', [role]), role);
        await db.query('update profiles set nickname=$1,age=$2 where id=auth.uid()', ['Reader', age]);
        assert.equal(await scalar('select get_own_profile_age($1)', [id(n)]), age);
      }
    });
    await t.test('Teacher invitation and pending approval remain enforced', async () => {
      await db.exec('reset role');
      const code = 'age-test-only-invite-code';
      await db.query("insert into teacher_invite_codes(code_hash,max_uses) values(encode(sha256(convert_to($1,'UTF8')),'hex'),1)", [code]);
      await login(4);
      assert.equal(await scalar('select register_teacher_with_invite($1)', ['invalid-invite-code']), false);
      assert.equal(await scalar('select register_teacher_with_invite($1)', [code]), true);
      await db.query("update profiles set full_name='Teacher Name',age=35 where id=auth.uid()");
      assert.equal(await scalar('select get_own_profile_age($1)', [id(4)]), 35);
      assert.equal(await scalar('select teacher_status from profiles where id=auth.uid()'), 'pending');
      await assert.rejects(db.query("update profiles set teacher_status='approved' where id=auth.uid()"));
      await assert.rejects(db.query("select review_teacher_registration($1,'approved')", [id(4)]));
    });
    await t.test('invalid ages reject the entire name-and-age update', async () => {
      await login(2);
      for (const age of [0, -1, 121]) {
        await assert.rejects(db.query("update profiles set nickname='Changed',age=$1 where id=auth.uid()", [age]), /profiles_age_check/);
      }
      await assert.rejects(db.query("update profiles set age=$1 where id=auth.uid()", ['12.5']), /integer/);
      assert.equal(await scalar('select nickname from profiles where id=auth.uid()'), 'Reader');
      assert.equal(await scalar('select get_own_profile_age($1)', [id(2)]), 1);
    });
    await t.test('age cannot be read or updated across users even with shared name reads', async () => {
      await login(2);
      assert.equal(await scalar('select count(*)::int from profiles'), 4);
      await assert.rejects(db.query('select age from profiles'), /permission denied/);
      assert.equal(await scalar('select get_own_profile_age($1)', [id(3)]), null);
      await db.query('update profiles set age=20 where id=$1', [id(3)]);
      await login(3);
      assert.equal(await scalar('select get_own_profile_age($1)', [id(3)]), 120);
      await db.exec('reset role; set role anon');
      await assert.rejects(db.query('select get_own_profile_age($1)', [id(3)]), /permission denied/);
    });
    await t.test('draft stops safely if an existing broad SELECT grant would expose age', async () => {
      await db.exec('reset role; alter table profiles drop column age; drop function get_own_profile_age(uuid); grant select on profiles to authenticated');
      await assert.rejects(db.exec(migration), /Review broad profile SELECT grants/);
      await db.exec('rollback');
      assert.equal(await scalar("select count(*)::int from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='age'"), 0);
    });
  } finally { await db.close(); }
});
