// M1 F7 Deactivate/Reactivate: scope, fail-closed ordering, error mapping, route wiring and the deactivated-token check.
// Fakes only: no Supabase project, no real accounts.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const { setManagedUserStatus, AdminUserOperationError, AdminAuthorizationError } = require('../services/adminUserService');
const { describePermissions, canChangeAccountStatus } = require('../services/m1AccountScope');
const { createAdminUsersRouter } = require('../routes/adminUsers');
const { AccountDeactivatedError, SupabaseAuthenticationError } = require('../services/supabaseAdmin');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SA = id(1), SCHOOL = id(2), TEACHER = id(3), STUDENT = id(4), LEARNER = id(5), SA2 = id(6), UNKNOWN = id(99);
const OTHER_STUDENT = id(7), OTHER_ADMIN = id(8);
const ROLES = { [SA]: 'system_admin', [SCHOOL]: 'admin', [TEACHER]: 'teacher', [STUDENT]: 'student', [LEARNER]: 'general_user', [SA2]: 'system_admin',
  [OTHER_STUDENT]: 'student', [OTHER_ADMIN]: 'admin' };
// M1 multi-tenancy: School 1 (S1) and School 2 (S2). System Admins and Independent Learners have no school.
const S1 = id(50), S2 = id(51);
const SCHOOLS = { [SCHOOL]: S1, [TEACHER]: S1, [STUDENT]: S1, [OTHER_STUDENT]: S2, [OTHER_ADMIN]: S2 };

function fakeSupabase({ rpcError = null, banError = null, unbanError = null } = {}) {
  const calls = [];
  const client = {
    from: table => ({ select: () => ({ eq: (_c, value) => ({ maybeSingle: async () => {
      assert.equal(table, 'profiles');
      return { data: ROLES[value] ? { id: value, role: ROLES[value], status: 'active', school_id: SCHOOLS[value] ?? null } : null, error: null };
    } }) }) }),
    auth: { admin: { updateUserById: async (userId, attrs) => {
      calls.push(['ban', userId, attrs.ban_duration]);
      return { error: attrs.ban_duration === 'none' ? unbanError : banError };
    } } },
    rpc: async (name, args) => { calls.push(['rpc', name, args.p_actor, args.p_target, args.p_status]); return rpcError ? { data: null, error: rpcError } : { data: 'active', error: null }; },
  };
  return { calls, deps: { getSupabaseAdmin: () => client } };
}
const run = (manager, target, status, options) => {
  const f = fakeSupabase(options);
  return { f, result: setManagedUserStatus(manager, target, status, f.deps, ROLES[manager], SCHOOLS[manager] ?? null) };
};

test('scope: System Admin manages every non-System-Admin account in every school; School Admin manages Teachers and Students of their own school', () => {
  assert.deepEqual(describePermissions('system_admin').statusRoles, ['general_user', 'admin', 'teacher', 'student']);
  assert.deepEqual(describePermissions('admin').statusRoles, ['teacher', 'student']);
  for (const [manager, target, allowed] of [['system_admin', 'general_user', true], ['system_admin', 'admin', true], ['system_admin', 'teacher', true],
    ['system_admin', 'student', true], ['system_admin', 'system_admin', false], ['admin', 'teacher', true], ['admin', 'student', true],
    ['admin', 'admin', false], ['admin', 'system_admin', false], ['admin', 'general_user', false], ['teacher', 'student', false], [null, 'student', false]]) {
    assert.equal(canChangeAccountStatus({ managerRole: manager, managerId: 'a', targetRole: target, targetId: 'b', managerSchoolId: manager === 'admin' ? S1 : null, targetSchoolId: S1 }), allowed, `${manager} -> ${target}`);
  }
  // M1 multi-tenancy: a School Admin never manages another school's (or a school-less) account; the System Admin does.
  assert.equal(canChangeAccountStatus({ managerRole: 'admin', managerId: 'a', targetRole: 'student', targetId: 'b', managerSchoolId: S1, targetSchoolId: S2 }), false);
  assert.equal(canChangeAccountStatus({ managerRole: 'admin', managerId: 'a', targetRole: 'student', targetId: 'b', managerSchoolId: S1, targetSchoolId: null }), false);
  assert.equal(canChangeAccountStatus({ managerRole: 'admin', managerId: 'a', targetRole: 'student', targetId: 'b', managerSchoolId: null, targetSchoolId: null }), false);
  assert.equal(canChangeAccountStatus({ managerRole: 'system_admin', managerId: 'a', targetRole: 'student', targetId: 'b', targetSchoolId: S2 }), true);
  assert.equal(canChangeAccountStatus({ managerRole: 'system_admin', managerId: 'a', targetRole: 'admin', targetId: 'a' }), false, 'never self');
});

test('deactivate bans the Auth user first, then records the status and audit row; reactivate records first, then lifts the ban', async () => {
  let { f, result } = run(SA, LEARNER, 'inactive');
  assert.deepEqual(await result, { id: LEARNER, status: 'inactive', previousStatus: 'active' });
  assert.deepEqual(f.calls, [['ban', LEARNER, '876000h'], ['rpc', 'm1_set_account_status', SA, LEARNER, 'inactive']]);
  ({ f, result } = run(SCHOOL, STUDENT, 'active'));
  assert.equal((await result).status, 'active');
  assert.deepEqual(f.calls, [['rpc', 'm1_set_account_status', SCHOOL, STUDENT, 'active'], ['ban', STUDENT, 'none']]);
  ({ f, result } = run(SCHOOL, TEACHER, 'inactive'));
  await result;
  ({ f, result } = run(SA, SCHOOL, 'inactive'));
  await result;
  assert.equal(f.calls.length, 2);
  // F7 for the System Admin: Teachers and Students of any school.
  for (const target of [TEACHER, STUDENT, OTHER_STUDENT]) {
    ({ f, result } = run(SA, target, 'inactive'));
    assert.equal((await result).status, 'inactive');
    assert.deepEqual(f.calls, [['ban', target, '876000h'], ['rpc', 'm1_set_account_status', SA, target, 'inactive']]);
  }
});

test('refused targets make no Auth or database change', async () => {
  const cases = [
    [SA, UNKNOWN, 403, /outside the accounts you can manage/], [SCHOOL, OTHER_STUDENT, 403, /outside/], [OTHER_ADMIN, STUDENT, 403, /outside/],
    [SA, SA2, 409, /System Admin accounts cannot be deactivated/], [SA, SA, 409, /your own account/],
    [SCHOOL, SA, 403, /outside/], [SCHOOL, SCHOOL, 409, /your own account/], [SCHOOL, LEARNER, 403, /outside/], [SCHOOL, UNKNOWN, 403, /outside/],
  ];
  for (const [manager, target, statusCode, message] of cases) {
    const { f, result } = run(manager, target, 'inactive');
    await assert.rejects(result, e => e instanceof AdminUserOperationError && e.statusCode === statusCode && message.test(e.message), `${manager}->${target}`);
    assert.deepEqual(f.calls, [], `${manager}->${target} made no change`);
  }
  for (const role of ['teacher', 'student', 'general_user', null, undefined]) {
    const f = fakeSupabase();
    await assert.rejects(setManagedUserStatus(TEACHER, STUDENT, 'inactive', f.deps, role), AdminAuthorizationError);
    assert.deepEqual(f.calls, []);
  }
  for (const status of ['deleted', '', null, 'ACTIVE']) {
    const { f, result } = run(SA, LEARNER, status);
    await assert.rejects(result, e => e.statusCode === 400);
    assert.deepEqual(f.calls, []);
  }
});

test('fails closed: a database failure undoes the deactivation ban; reactivation never lifts the ban before the status is saved', async () => {
  let { f, result } = run(SA, LEARNER, 'inactive', { rpcError: { code: 'XX000', message: 'boom' } });
  await assert.rejects(result, e => e.statusCode === 502 && /No change was made/.test(e.message));
  assert.deepEqual(f.calls.map(c => c[0] + ':' + (c[2] ?? '')), ['ban:876000h', 'rpc:' + SA, 'ban:none']);

  ({ f, result } = run(SA, LEARNER, 'inactive', { rpcError: { code: 'PGRST202', message: 'Could not find the function public.m1_set_account_status' } }));
  await assert.rejects(result, e => e.statusCode === 503 && /database update/.test(e.message));
  assert.equal(f.calls.at(-1)[2], 'none', 'ban removed again before the migration exists');

  ({ f, result } = run(SA, LEARNER, 'inactive', { rpcError: { code: 'XX000', message: 'boom' }, unbanError: { message: 'down' } }));
  await assert.rejects(result, e => e.statusCode === 502 && /still blocked/.test(e.message));

  ({ f, result } = run(SA, LEARNER, 'inactive', { banError: { message: 'auth down' } }));
  await assert.rejects(result, e => e.statusCode === 502 && /No change was made/.test(e.message));
  assert.deepEqual(f.calls.map(c => c[0]), ['ban'], 'no status change when the ban fails');

  ({ f, result } = run(SCHOOL, STUDENT, 'active', { rpcError: { code: 'XX000', message: 'boom' } }));
  await assert.rejects(result, e => e.statusCode === 502);
  assert.deepEqual(f.calls.map(c => c[0]), ['rpc'], 'still banned: reactivation stopped before lifting the ban');

  ({ f, result } = run(SCHOOL, STUDENT, 'active', { unbanError: { message: 'auth down' } }));
  await assert.rejects(result, e => e.statusCode === 502 && /Retry Reactivate/.test(e.message));

  ({ f, result } = run(SA, LEARNER, 'inactive', { rpcError: { code: '42501', message: 'permission denied for function m1_set_account_status' } }));
  await assert.rejects(result, e => e.statusCode === 502 && /No change was made/.test(e.message), 'a permission error is a failure, not "not installed"');
  assert.equal(f.calls.at(-1)[2], 'none', 'ban undone');

  ({ result } = run(SA, SCHOOL, 'inactive', { rpcError: { code: 'P0001', message: 'm1_last_system_admin' } }));
  await assert.rejects(result, e => e.statusCode === 409 && /last active System Admin/.test(e.message));
  ({ result } = run(SA, SCHOOL, 'inactive', { rpcError: { code: 'P0001', message: 'm1_target_missing' } }));
  await assert.rejects(result, e => e.statusCode === 403);
});

test('route: PATCH /:userId/status authorizes first, validates the id and passes the database role', async () => {
  const seen = [];
  let authorizeError = null;
  const router = createAdminUsersRouter({
    authorizeAccountManager: async () => { if (authorizeError) throw authorizeError; return { user: { id: SCHOOL }, profile: { role: 'admin', school_id: S1 } }; },
    setManagedUserStatus: async (...args) => { seen.push(args); if (args[1] === SA) throw new AdminUserOperationError('This account is outside the accounts you can manage.', 403); return { id: args[1], status: args[2] }; },
  });
  const app = express(); app.use(express.json()); app.use('/api/admin/users', router);
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/api/admin/users`;
  const patch = (userId, body) => fetch(`${base}/${userId}/status`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    let r = await patch(STUDENT, { status: 'inactive', role: 'system_admin' });
    assert.equal(r.status, 200); assert.equal((await r.json()).message, 'Account deactivated.');
    assert.deepEqual(seen[0], [SCHOOL, STUDENT, 'inactive', undefined, 'admin', S1], 'role and school from the database, never the body');
    r = await patch(STUDENT, { status: 'active' }); assert.equal((await r.json()).message, 'Account reactivated.');
    r = await patch('not-a-uuid', { status: 'inactive' }); assert.equal(r.status, 400);
    r = await patch(SA, { status: 'inactive' }); assert.equal(r.status, 403);
    assert.equal(seen.length, 3);
    authorizeError = new AccountDeactivatedError();
    r = await patch(STUDENT, { status: 'active' });
    assert.equal(r.status, 401); assert.match((await r.json()).message, /deactivated/);
    assert.equal(seen.length, 3, 'a deactivated administrator reaches nothing');
  } finally { server.close(); }
});

test('existing sessions: every backend endpoint refuses a banned (deactivated) account; active and lifted bans pass', async () => {
  const sdkPath = require.resolve('@supabase/supabase-js');
  const adminPath = path.resolve(__dirname, '../services/supabaseAdmin.js');
  const saved = { sdk: require.cache[sdkPath], admin: require.cache[adminPath], url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  let user = null, authError = null;
  require.cache[sdkPath] = { ...saved.sdk, exports: { createClient: () => ({ auth: { getUser: async () => ({ data: { user: authError ? null : user }, error: authError }) } }) } };
  delete require.cache[adminPath];
  process.env.SUPABASE_URL = 'http://fake.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';
  try {
    const fresh = require(adminPath);
    const req = { get: () => 'Bearer token' };
    user = { id: LEARNER, banned_until: '2126-11-18T00:00:00Z' };
    await assert.rejects(fresh.getAuthenticatedSupabaseUser(req), e => e instanceof fresh.SupabaseAuthenticationError && e.name === 'AccountDeactivatedError');
    // Supabase Auth itself refuses a banned user's existing token (verified on the rehearsal stack: 403 user_banned).
    authError = { status: 403, code: 'user_banned', message: 'User is banned' };
    await assert.rejects(fresh.getAuthenticatedSupabaseUser(req), e => e.name === 'AccountDeactivatedError' && /deactivated/.test(e.message));
    authError = { status: 403, code: 'bad_jwt', message: 'invalid JWT' };
    await assert.rejects(fresh.getAuthenticatedSupabaseUser(req), e => e instanceof fresh.SupabaseAuthenticationError && e.name !== 'AccountDeactivatedError');
    authError = null;
    for (const banned_until of [null, undefined, '2020-01-01T00:00:00Z', 'none']) {
      user = { id: LEARNER, banned_until };
      assert.equal((await fresh.getAuthenticatedSupabaseUser(req)).id, LEARNER, String(banned_until));
    }
  } finally {
    require.cache[sdkPath] = saved.sdk; require.cache[adminPath] = saved.admin;
    if (saved.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
  }
  assert.ok(new AccountDeactivatedError() instanceof SupabaseAuthenticationError);
});

test('permanent deletion: the DELETE route answers 410 to every caller before any lookup, and never deletes', async () => {
  let authorized = 0;
  const router = createAdminUsersRouter({ authorizeAccountManager: async () => { authorized++; return { user: { id: SA }, profile: { role: 'system_admin' } }; } });
  const app = express(); app.use(express.json()); app.use('/api/admin/users', router);
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/api/admin/users`;
  try {
    for (const target of [LEARNER, SCHOOL, STUDENT, 'not-a-uuid']) {
      const r = await fetch(`${base}/${target}`, { method: 'DELETE', headers: { authorization: 'Bearer x' } });
      assert.equal(r.status, 410, target);
      assert.match((await r.json()).message, /Permanent account deletion is disabled/);
    }
    assert.equal(authorized, 0, 'no lookup or authorization work for a disabled action');
  } finally { server.close(); }
});

test('deleteManagedUser refuses without a separately approved deletion request; deactivation never deletes', async () => {
  const { deleteManagedUser } = require('../services/adminUserService');
  const deleted = [];
  const client = { from: () => { throw new Error('no lookup expected'); }, auth: { admin: { deleteUser: async id => { deleted.push(id); return { error: null }; } } } };
  for (const approvedDeletionRequestId of [undefined, '', '   ', true, 1]) {
    await assert.rejects(deleteManagedUser(SA, LEARNER, { getSupabaseAdmin: () => client, approvedDeletionRequestId }, 'system_admin'),
      e => e.statusCode === 410 && /approved data-deletion request/.test(e.message));
  }
  assert.deepEqual(deleted, []);

  // Every deactivate/reactivate path, including failures, uses ban/unban only.
  for (const [manager, target, status, options] of [[SA, LEARNER, 'inactive', {}], [SA, LEARNER, 'active', {}], [SCHOOL, STUDENT, 'inactive', { rpcError: { message: 'boom' } }],
    [SCHOOL, STUDENT, 'active', { unbanError: { message: 'down' } }], [SCHOOL, TEACHER, 'inactive', { banError: { message: 'down' } }]]) {
    const f = fakeSupabase(options);
    const admin = f.deps.getSupabaseAdmin();
    admin.auth.admin.deleteUser = async id => { deleted.push(id); return { error: null }; };
    await setManagedUserStatus(manager, target, status, { getSupabaseAdmin: () => admin }, ROLES[manager]).catch(() => {});
  }
  assert.deepEqual(deleted, [], 'auth.admin.deleteUser is never called');
  const source = require('node:fs').readFileSync(require.resolve('../services/adminUserService'), 'utf8');
  const statusFn = source.slice(source.indexOf('async function setManagedUserStatus'), source.indexOf('const EMAIL_PATTERN'));
  assert.doesNotMatch(statusFn, /deleteUser|deleteManagedUser/);
});

test('account list reports whether Supabase Auth currently blocks sign-in, so a stopped change can be retried', async () => {
  const { listManagedUsers } = require('../services/adminUserService');
  const auth = [{ id: STUDENT, email: 's@x.invalid', banned_until: '2126-01-01T00:00:00Z', created_at: '2026-01-01' },
    { id: TEACHER, email: 't@x.invalid', banned_until: null, created_at: '2026-01-02' }];
  const profiles = [{ id: STUDENT, role: 'student', status: 'active', created_at: '2026-01-01', school_id: S1 }, { id: TEACHER, role: 'teacher', status: 'inactive', created_at: '2026-01-02', school_id: S1 },
    { id: OTHER_STUDENT, role: 'student', status: 'active', created_at: '2026-01-03', school_id: S2 }];
  const client = { auth: { admin: { listUsers: async () => ({ data: { users: auth }, error: null }) } },
    from: () => ({ select: () => ({ order: async () => ({ data: profiles, error: null }) }) }) };
  const list = await listManagedUsers({ getSupabaseAdmin: () => client }, 'admin', S1);
  // Another school's Student (profile only, no Auth row here) is never listed for this School Admin.
  assert.deepEqual(list.map(u => [u.id, u.status, u.signInBlocked]).sort(), [[STUDENT, 'active', true], [TEACHER, 'inactive', false]].sort());
  await assert.rejects(listManagedUsers({ getSupabaseAdmin: () => client }, 'admin', null), AdminAuthorizationError);
});
