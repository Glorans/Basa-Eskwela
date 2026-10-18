// Local PostgreSQL/WASM only. Never connects to Supabase.
// Install @electric-sql/pglite into a temporary prefix; override PGLITE_TEST_MODULE if needed.
const { PGlite } = require(process.env.PGLITE_TEST_MODULE || require('node:path').join(
  require('node:os').tmpdir(), 'readflow-teacher-verification-check/node_modules/@electric-sql/pglite'));
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');

test('Teacher verification migration and database authorization', async (t) => {
  const db = new PGlite();
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const tables = ['rooms','enrollments','room_modules','reading_activity_assignments','modules',
    'module_passages','learning_paths','uploaded_materials','material_question_sets',
    'comprehension_questions','comprehension_question_answers','oral_reading_attempts','progress','diagnostic_results'];
  const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
  const login = async (n) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id(n)]);
    await db.query("select set_config('request.jwt.claim.role', 'authenticated', false)");
    await db.exec('set role authenticated');
  };
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role', true) $$;
      grant usage on schema auth, public, storage to authenticated;
      create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
      create table public.profiles(id uuid primary key, full_name text not null default '',
        role text, status text default 'active', created_at timestamptz default now());
      create table storage.objects(id int primary key);
      alter table storage.objects enable row level security;
      grant all on storage.objects to authenticated;
      create policy existing_storage on storage.objects for all to authenticated using(true) with check(true);
      insert into storage.objects values(1);
    `);
    await db.exec(readFileSync(join(__dirname, '../m1_onboarding_security_migration.sql'), 'utf8'));
    for (const name of tables) {
      await db.exec(`create table public.${name}(id int primary key);
        alter table public.${name} enable row level security;
        grant all on public.${name} to authenticated;
        create policy existing_access on public.${name} for all to authenticated using(true) with check(true);
        insert into public.${name} values(1);`);
    }
    await db.exec(`create policy existing_teacher_profile_reads on public.profiles for select to authenticated using(true);`);
    for (let n = 1; n <= 9; n++) {
      await db.query('insert into auth.users values($1, $2)', [id(n), n === 9 ? null : '2026-10-08']);
    }
    await db.query("update public.profiles set role='teacher', full_name='Existing Teacher' where id=$1", [id(1)]);
    await db.query("update public.profiles set role='admin', full_name='School Admin' where id=$1", [id(2)]);
    await db.exec(readFileSync(join(__dirname, '../m1_teacher_verification.sql'), 'utf8'));
    const code = 'local-test-only-invite-123456';
    await db.query("insert into public.teacher_invite_codes(code_hash, max_uses) values(encode(sha256(convert_to($1, 'UTF8')), 'hex'), 2)", [code]);

    await t.test('existing Teachers are approved and retain data access', async () => {
      await login(1);
      assert.equal(await scalar('select teacher_status from profiles where id=auth.uid()'), 'approved');
      assert.equal(await scalar('select count(*)::int from rooms'), 1);
    });
    await t.test('Student and Independent Learner role selection remains unchanged', async () => {
      for (const [n, role] of [[3, 'student'], [4, 'general_user']]) {
        await login(n);
        assert.equal(await scalar('select assign_own_role($1)', [role]), role);
        assert.equal(await scalar('select teacher_status from profiles where id=auth.uid()'), null);
        assert.equal(await scalar('select count(*)::int from modules'), 1);
      }
    });
    await t.test('invalid invite, legacy Teacher role assignment, and unverified email are rejected', async () => {
      await login(5);
      assert.equal(await scalar('select register_teacher_with_invite($1)', ['wrong-invite-code-000']), false);
      assert.equal(await scalar('select role from profiles where id=auth.uid()'), null);
      await assert.rejects(db.query("select assign_own_role('teacher')"));
      await assert.rejects(db.query("select assign_own_role('admin')"));
      await login(9);
      await assert.rejects(db.query('select register_teacher_with_invite($1)', [code]), /Verify your email/);
    });
    await t.test('valid invite atomically creates pending Teacher and can only be consumed once per account', async () => {
      await login(5);
      assert.equal(await scalar('select register_teacher_with_invite($1)', [code]), true);
      assert.equal(await scalar('select teacher_status from profiles where id=auth.uid()'), 'pending');
      await assert.rejects(db.query('select register_teacher_with_invite($1)', [code]), /already been assigned/);
      await db.query("update profiles set full_name='New Teacher' where id=auth.uid()");
    });
    await t.test('pending Teacher cannot read codes, self-approve, approve others, or access module data/storage directly', async () => {
      await login(5);
      await assert.rejects(db.query('select * from teacher_invite_codes'));
      await assert.rejects(db.query("update profiles set teacher_status='approved' where id=auth.uid()"));
      await assert.rejects(db.query("select review_teacher_registration($1,'approved')", [id(5)]), /Admin access/);
      assert.equal(await scalar('select count(*)::int from profiles'), 1);
      for (const table of [...tables, 'storage.objects']) {
        assert.equal(await scalar(`select count(*)::int from ${table}`), 0, table);
        await assert.rejects(db.query(`insert into ${table} values(2)`), /row-level security/, table);
        assert.equal((await db.query(`update ${table} set id=3 where id=1 returning id`)).rows.length, 0);
        assert.equal((await db.query(`delete from ${table} where id=1 returning id`)).rows.length, 0);
      }
    });
    await t.test('Admin sees pending Teachers, approves, and status immediately grants Teacher access', async () => {
      await login(2);
      const pending = (await db.query("select full_name, teacher_status from profiles where teacher_status='pending'")).rows;
      assert.deepEqual(pending, [{ full_name: 'New Teacher', teacher_status: 'pending' }]);
      assert.equal(await scalar("select review_teacher_registration($1,'approved')", [id(5)]), 'approved');
      await assert.rejects(db.query("select review_teacher_registration($1,'rejected')", [id(5)]), /no longer pending/);
      await login(5);
      assert.equal(await scalar('select m3_current_role()'), 'teacher');
      assert.equal(await scalar('select count(*)::int from rooms'), 1);
      await db.query('insert into rooms values(2)');
      await assert.rejects(db.query("select review_teacher_registration($1,'approved')", [id(6)]), /Admin access/);
    });
    await t.test('Admin rejection blocks access; code capacity cannot be exceeded', async () => {
      await login(6);
      assert.equal(await scalar('select register_teacher_with_invite($1)', [code]), true);
      await db.query("update profiles set full_name='Another Teacher' where id=auth.uid()");
      await login(2);
      assert.equal(await scalar("select review_teacher_registration($1,'rejected')", [id(6)]), 'rejected');
      await login(6);
      assert.equal(await scalar('select count(*)::int from rooms'), 0);
      await login(7);
      assert.equal(await scalar('select register_teacher_with_invite($1)', [code]), false);
      await db.exec('reset role');
      assert.equal(await scalar('select use_count from teacher_invite_codes'), 2);
    });
    await t.test('expired/inactive codes and repeated guessing fail without exposing codes', async () => {
      await db.exec('reset role');
      const insert = "insert into teacher_invite_codes(code_hash,active,expires_at) values(encode(sha256(convert_to($1,'UTF8')),'hex'),$2,$3)";
      await db.query(insert, ['inactive-test-code-1234', false, null]);
      await db.query(insert, ['expired-test-code-12345', true, '2000-01-01']);
      await db.query(insert, ['active-test-code-123456', true, null]);
      await login(8);
      for (const candidate of ['inactive-test-code-1234', 'expired-test-code-12345', 'wrong-code-12345678', 'wrong-code-12345678', 'wrong-code-12345678']) {
        assert.equal(await scalar('select register_teacher_with_invite($1)', [candidate]), false);
      }
      assert.equal(await scalar('select register_teacher_with_invite($1)', ['active-test-code-123456']), false);
      await db.exec('reset role');
      assert.equal(await scalar('select attempts from teacher_invite_attempts where user_id=$1', [id(8)]), 5);
    });
    await t.test('backend-generated hashes work with unchanged registration SQL and pending approval', async () => {
      await db.exec('reset role');
      const { createTeacherInvitation } = require('../../server/services/teacherInvitationService');
      // Bridge only the service insert into the isolated real SQL schema; no Supabase connection.
      const deps = { getSupabaseAdmin: () => ({ from: table => {
        assert.equal(table, 'teacher_invite_codes');
        return { insert(row) { this.row = row; return this; }, select() { return this; }, async single() {
          const row = this.row;
          const result = await db.query('insert into teacher_invite_codes(code_hash,active,expires_at,max_uses) values($1,$2,$3,$4) returning id,active,created_at,expires_at,max_uses,use_count',
            [row.code_hash, row.active, row.expires_at, row.max_uses]);
          return { data: result.rows[0], error: null };
        } };
      } }) };
      const generated = await createTeacherInvitation({ expiresAt: new Date(Date.now() + 86400000).toISOString() }, deps);
      await db.query('insert into auth.users values($1,now()),($2,now())', [id(10), id(11)]);
      await login(10);
      assert.equal(await scalar('select register_teacher_with_invite($1)', [generated.code]), true);
      assert.equal(await scalar('select teacher_status from profiles where id=auth.uid()'), 'pending');
      assert.equal(await scalar('select count(*)::int from rooms'), 0);
      await login(11);
      assert.equal(await scalar('select register_teacher_with_invite($1)', [generated.code]), false);
      await db.exec('reset role');
      assert.equal(await scalar('select use_count from teacher_invite_codes where id=$1', [generated.invitation.id]), 1);
      const limited = await createTeacherInvitation({ expiresAt: new Date(Date.now() + 86400000).toISOString(), maxUses: 2 }, deps);
      for (let n = 12; n <= 16; n++) await db.query('insert into auth.users values($1,now())', [id(n)]);
      // Concurrent submissions are queued by PGlite's single connection. This exercises
      // atomic consumption, not a multi-connection PostgreSQL lock-contention test.
      const results = await Promise.all([12,13,14,15,16].map(n => db.transaction(async tx => {
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [id(n)]);
        await tx.exec('set local role authenticated');
        return (await tx.query('select register_teacher_with_invite($1) as accepted', [limited.code])).rows[0].accepted;
      })));
      assert.equal(results.filter(Boolean).length, 2);
      assert.equal(await scalar('select use_count from teacher_invite_codes where id=$1', [limited.invitation.id]), 2);
      const revoked = await createTeacherInvitation({ expiresAt: new Date(Date.now() + 86400000).toISOString() }, deps);
      await db.query('update teacher_invite_codes set active=false where id=$1', [revoked.invitation.id]);
      await login(11);
      assert.equal(await scalar('select register_teacher_with_invite($1)', [revoked.code]), false);
    });
  } finally { await db.close(); }
});
