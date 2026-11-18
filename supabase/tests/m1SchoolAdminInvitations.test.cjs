// Disposable in-memory PostgreSQL only. Never connects to a Supabase project.
// Rehearses m1_school_admin_invitations_PROPOSED.sql and its ROLLBACK. Stubs carry only the columns used here.
const { PGlite } = require('../../server/node_modules/@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const read = f => readFileSync(resolve(__dirname, '..', f), 'utf8');
const PROPOSAL = read('proposed/m1_school_admin_invitations_PROPOSED.sql');
const ROLLBACK = read('proposed/m1_school_admin_invitations_ROLLBACK_PROPOSED.sql');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SA = id(1), SA_INACTIVE = id(2), SCHOOL = id(3), TEACHER = id(4), NEW = id(5), OTHER = id(6), LEARNER = id(7);

async function db() {
  const d = new PGlite();
  await d.exec(`
    create role authenticated; create role anon; create role service_role bypassrls; -- as on Supabase
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, encrypted_password text, banned_until timestamptz);
    create table profiles(id uuid primary key, role text, status text not null default 'active', full_name text, teacher_status text);
    grant usage on schema public, auth to authenticated, anon, service_role;
    -- Supabase's default privileges: new public tables/functions are granted to every API role. The migration must undo this.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    create table m1_account_status_events(id int);
    create function m1_set_account_status(uuid, uuid, text) returns text language sql as $$ select 'stub' $$;
    insert into auth.users values
      ('${SA}','sa@x.test',now(),'h',null), ('${SA_INACTIVE}','sa2@x.test',now(),'h',null), ('${SCHOOL}','school@x.test',now(),'h',null),
      ('${TEACHER}','t@x.test',now(),'h',null), ('${NEW}','new.admin@x.test',null,'',null), ('${OTHER}','other@x.test',null,'',null),
      ('${LEARNER}','learner@x.test',now(),'h',null);
    insert into profiles(id, role, status, full_name, teacher_status) values
      ('${SA}','system_admin','active','SA',null), ('${SA_INACTIVE}','system_admin','inactive','SA2',null),
      ('${SCHOOL}','admin','active','Original School Admin',null), ('${TEACHER}','teacher','active','T','approved'),
      ('${NEW}',null,'active','',null), ('${OTHER}',null,'active','',null), ('${LEARNER}',null,'active','',null);
  `);
  return d;
}
const run = async (d, sql) => { try { await d.exec(sql); } catch (e) { await d.exec('rollback'); throw e; } };
const create = (d, actor = SA, user = NEW, email = 'New.Admin@x.test') => d.query(
  `select public.m1_create_school_admin_invitation($1, $2, $3, $4, $5, $6, $7, $8, 7) as id`,
  [actor, user, email, '  Ana   Reyes ', 'Letter from the principal dated 2026-11-18', 'official_school_email', 'School Principal', null]).then(r => r.rows[0].id);
const send = (d, inv, outcome = 'sent', actor = SA) => d.query('select public.m1_record_school_admin_invitation_email($1, $2, $3, 7) as e', [actor, inv, outcome]);
const accept = (d, user = NEW, at = 'now()') => d.query(`select public.m1_accept_school_admin_invitation($1, ${at}) as r`, [user]).then(r => r.rows[0].r);
const role = async (d, who) => (await d.query('select role, status from profiles where id = $1', [who])).rows[0];
const events = async d => (await d.query('select action from public.m1_school_admin_invitation_events order by id')).rows.map(r => r.action);
const linkSession = d => d.exec(`update auth.users set email_confirmed_at = now(), encrypted_password = 'hash' where id = '${NEW}'`);

test('install requires M1 deactivation, refuses to run twice, and changes no existing account', async () => {
  const d = await db();
  const before = (await d.query('select * from profiles order by id')).rows;
  await run(d, PROPOSAL);
  assert.deepEqual((await d.query('select * from profiles order by id')).rows, before);
  await assert.rejects(run(d, PROPOSAL), /already \(partly\) installed/);
  const bare = await db(); await bare.exec('drop function m1_set_account_status(uuid,uuid,text)');
  await assert.rejects(run(bare, PROPOSAL), /m1_account_deactivation must be installed first/);
});

test('only an active System Admin can authorize; the account stays role-less (no access) while pending', async () => {
  const d = await db(); await run(d, PROPOSAL);
  for (const actor of [SA_INACTIVE, SCHOOL, TEACHER, NEW, id(99)]) await assert.rejects(create(d, actor), /m1_invite_actor_not_system_admin/, actor);
  await assert.rejects(create(d, SA, SCHOOL, 'school@x.test'), /m1_invite_target_not_unassigned/, 'an existing School Admin is not re-invited');
  await assert.rejects(create(d, SA, OTHER, 'someone-else@x.test'), /m1_invite_email_mismatch/);
  const inv = await create(d);
  assert.deepEqual(await role(d, NEW), { role: null, status: 'active' });
  assert.equal((await d.query('select full_name from profiles where id = $1', [NEW])).rows[0].full_name, 'Ana Reyes');
  const row = (await d.query('select email, authorized_by, status, confirmation_method, last_sent_at from public.m1_school_admin_invitations where id = $1', [inv])).rows[0];
  assert.deepEqual(row, { email: 'new.admin@x.test', authorized_by: SA, status: 'pending', confirmation_method: 'official_school_email', last_sent_at: null });
  await assert.rejects(create(d), /m1_invite_duplicate|m1_invite_target_not_unassigned/);
  await assert.rejects(d.query(`select public.m1_create_school_admin_invitation($1,$2,$3,$4,$5,$6,$7,null,7)`, [SA, OTHER, 'other@x.test', 'O', 'abc', 'official_school_email', 'Principal']), /check constraint|violates/);
  await assert.rejects(d.query(`select public.m1_create_school_admin_invitation($1,$2,$3,$4,$5,$6,$7,null,7)`, [SA, OTHER, 'other@x.test', 'O', 'A real reference', 'a_checkbox', 'Principal']), /check constraint|violates/);
  assert.deepEqual(await events(d), ['authorized']);
});

test('database guard: no path except acceptance can grant School Admin or change an invited account role', async () => {
  const d = await db(); await run(d, PROPOSAL);
  await create(d);
  await assert.rejects(d.query(`update profiles set role = 'admin' where id = $1`, [NEW]), /granted only by accepting/);
  await assert.rejects(d.query(`update profiles set role = 'student' where id = $1`, [NEW]), /granted only by accepting/, 'no self-selected role while invited');
  await assert.rejects(d.query(`update profiles set role = 'admin' where id = $1`, [LEARNER]), /granted only by accepting/, 'no direct promotion of any account');
  await assert.rejects(d.query(`insert into profiles(id, role) values ($1, 'admin')`, [id(50)]), /granted only by accepting/);
  await d.query(`update profiles set role = 'student' where id = $1`, [LEARNER]); // ordinary onboarding still works
  await d.query(`update profiles set full_name = 'Renamed', status = 'inactive' where id = $1`, [SCHOOL]); // existing admin unaffected
  await d.query(`update profiles set status = 'active' where id = $1`, [SCHOOL]);
  assert.equal((await role(d, SCHOOL)).role, 'admin');
});

test('acceptance: only after a current link session, password and confirmed email; activates only that account', async () => {
  const d = await db(); await run(d, PROPOSAL);
  const inv = await create(d);
  await assert.rejects(accept(d), /m1_invite_link_not_current/, 'nothing sent yet');
  await send(d, inv);
  await assert.rejects(accept(d), /m1_invite_email_unconfirmed/, 'link not opened');
  await d.exec(`update auth.users set email_confirmed_at = now() where id = '${NEW}'`);
  await assert.rejects(accept(d), /m1_invite_password_not_set/);
  await linkSession(d);
  await assert.rejects(accept(d, NEW, `now() - interval '1 hour'`), /m1_invite_link_not_current/, 'a session older than the latest send');
  await assert.rejects(accept(d, OTHER), /m1_invite_none/, 'another account cannot accept it');
  assert.equal(await accept(d), 'admin');
  assert.deepEqual(await role(d, NEW), { role: 'admin', status: 'active' });
  assert.equal((await role(d, OTHER)).role, null);
  await assert.rejects(accept(d), /m1_invite_already_accepted/);
  await assert.rejects(d.query('select public.m1_cancel_school_admin_invitation($1, $2, null)', [SA, inv]), /m1_invite_not_pending/, 'accepted admins are deactivated, not cancelled');
  assert.deepEqual(await events(d), ['authorized', 'invitation_sent', 'accepted', 'role_activated']);
});

test('expiry and resend: an expired invitation cannot be accepted until a System Admin resends it', async () => {
  const d = await db(); await run(d, PROPOSAL);
  const inv = await create(d); await send(d, inv); await linkSession(d);
  await d.exec(`update public.m1_school_admin_invitations set expires_at = now() - interval '1 minute'`);
  await assert.rejects(accept(d), /m1_invite_expired/, 'Forgot Password cannot revive an expired invitation');
  await assert.rejects(send(d, inv, 'resent', SCHOOL), /m1_invite_actor_not_system_admin/);
  await send(d, inv, 'resent');
  await assert.rejects(accept(d, NEW, `now() - interval '1 hour'`), /m1_invite_link_not_current/, 'old links stop working after a resend');
  assert.equal(await accept(d), 'admin');
  assert.deepEqual(await events(d), ['authorized', 'invitation_sent', 'invitation_resent', 'accepted', 'role_activated']);
});

test('cancel: terminal; the account becomes inactive and can never be accepted or re-invited', async () => {
  const d = await db(); await run(d, PROPOSAL);
  const inv = await create(d); await send(d, inv); await send(d, inv, 'failed');
  await assert.rejects(d.query('select public.m1_cancel_school_admin_invitation($1, $2, $3)', [SCHOOL, inv, 'x']), /m1_invite_actor_not_system_admin/);
  await d.query('select public.m1_cancel_school_admin_invitation($1, $2, $3)', [SA, inv, 'Sent to the wrong address']);
  assert.deepEqual(await role(d, NEW), { role: null, status: 'inactive' });
  await linkSession(d);
  await assert.rejects(accept(d), /m1_invite_cancelled/);
  await assert.rejects(send(d, inv, 'resent'), /m1_invite_not_pending/);
  await assert.rejects(create(d), /m1_invite_target_not_unassigned|m1_invite_duplicate/);
  await assert.rejects(d.query(`update profiles set role = 'student' where id = $1`, [NEW]), /granted only by accepting/);
  assert.deepEqual(await events(d), ['authorized', 'invitation_sent', 'invitation_send_failed', 'cancelled']);
});

test('browser roles cannot read the records or call the functions', async () => {
  const d = await db(); await run(d, PROPOSAL);
  await d.exec(`set role authenticated`);
  for (const sql of ['select * from public.m1_school_admin_invitations', 'select * from public.m1_school_admin_invitation_events',
    `select public.m1_accept_school_admin_invitation('${NEW}', now())`,
    `select public.m1_create_school_admin_invitation('${SA}','${NEW}','new.admin@x.test','A','Reference text','in_person','Principal',null,7)`]) {
    await assert.rejects(d.query(sql), /permission denied/, sql);
  }
  await d.exec('reset role');
});

test('backend service role: read-only tables, every operation through the functions; history cannot be altered', async () => {
  const d = await db(); await run(d, PROPOSAL);
  await d.exec('set role service_role');
  const inv = (await d.query(`select public.m1_create_school_admin_invitation($1,$2,$3,$4,$5,$6,$7,null,7) as id`,
    [SA, NEW, 'new.admin@x.test', 'Ana', 'Letter dated 2026-11-18', 'signed_letter', 'Principal'])).rows[0].id;
  await d.query("select public.m1_record_school_admin_invitation_email($1, $2, 'sent', 7)", [SA, inv]);
  assert.equal((await d.query('select count(*)::int n from public.m1_school_admin_invitation_events')).rows[0].n, 2, 'service role can read');
  for (const sql of [
    `insert into public.m1_school_admin_invitations(user_id, email, authorized_by, authorization_reference, confirmation_method, authorizing_position, expires_at) values ('${OTHER}','other@x.test','${SA}','Forged reference','in_person','Principal', now() + interval '7 days')`,
    `update public.m1_school_admin_invitations set authorized_by = '${SCHOOL}'`,
    'delete from public.m1_school_admin_invitations',
    `insert into public.m1_school_admin_invitation_events(invitation_id, target_id, actor_id, action) values ('${inv}', '${NEW}', '${SA}', 'accepted')`,
    'update public.m1_school_admin_invitation_events set actor_id = null', 'delete from public.m1_school_admin_invitation_events',
    `select public.m1_is_active_system_admin('${SA}')`,
  ]) await assert.rejects(d.query(sql), /permission denied/, sql);
  await d.exec('reset role');
  await d.exec(`update auth.users set email_confirmed_at = now(), encrypted_password = 'hash' where id = '${NEW}'`);
  await d.exec('set role service_role');
  assert.equal((await d.query('select public.m1_accept_school_admin_invitation($1, now()) as r', [NEW])).rows[0].r, 'admin', 'acceptance still works');
  await d.exec('reset role');
  // Even the owner cannot rewrite or remove the history (only by dropping the triggers, an explicit owner action).
  await assert.rejects(d.query('update public.m1_school_admin_invitation_events set actor_id = null'), /history cannot be changed/);
  await assert.rejects(d.query('delete from public.m1_school_admin_invitation_events'), /history cannot be changed/);
  await assert.rejects(d.query('truncate public.m1_school_admin_invitation_events'), /history cannot be changed/);
  await assert.rejects(d.query('delete from public.m1_school_admin_invitations'), /history cannot be changed/);
});

test('rollback refuses while an invitation is pending (even past its window), and proceeds once it is resolved', async () => {
  const d = await db(); await run(d, PROPOSAL);
  const inv = await create(d); await send(d, inv);
  await d.exec(`update public.m1_school_admin_invitations set expires_at = now() - interval '1 day'`);
  await assert.rejects(run(d, ROLLBACK), /1 pending School Admin invitation\(s\)/);
  assert.equal((await d.query(`select to_regprocedure('public.m1_accept_school_admin_invitation(uuid,timestamptz)') is not null ok`)).rows[0].ok, true, 'nothing removed');
  await assert.rejects(d.query(`update profiles set role = 'student' where id = $1`, [NEW]), /granted only by accepting/, 'guard still active');
  await d.query('select public.m1_cancel_school_admin_invitation($1, $2, $3)', [SA, inv, 'Resolve before rollback']);
  await run(d, ROLLBACK);
  assert.equal((await d.query(`select count(*)::int n from pg_trigger where tgname = 'm1_guard_school_admin_role'`)).rows[0].n, 0);
  assert.equal((await role(d, NEW)).status, 'inactive', 'the cancelled account stays inactive');
  await assert.rejects(d.query('delete from public.m1_school_admin_invitations'), /history cannot be changed/, 'kept records stay protected');
});

test('rollback removes the guard and functions and keeps the records; accepted admins keep their role', async () => {
  const d = await db(); await run(d, PROPOSAL);
  const inv = await create(d); await send(d, inv); await linkSession(d); await accept(d);
  await run(d, ROLLBACK);
  const left = (await d.query(`select to_regprocedure('public.m1_accept_school_admin_invitation(uuid,timestamptz)') is null a,
    not exists (select 1 from pg_trigger where tgname = 'm1_guard_school_admin_role') g,
    to_regclass('public.m1_school_admin_invitations') is not null kept`)).rows[0];
  assert.deepEqual(left, { a: true, g: true, kept: true });
  assert.equal((await role(d, NEW)).role, 'admin');
});
