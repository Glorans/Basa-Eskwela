const test = require('node:test');
const assert = require('node:assert/strict');
const { authorizeMaterialRequest } = require('../services/materialPersistenceService');
const { authorizeTeacherOralReadingRequest } = require('../services/oralReadingAttemptService');
const { listManagedUsers, authorizeAdminRequest } = require('../services/adminUserService');

function dependencies(role, teacher_status) {
  return {
    getAuthenticatedSupabaseUser: async () => ({ id: 'account' }),
    getSupabaseAdmin: () => ({ from: () => ({
      select() { return this; }, eq() { return this; },
      single: async () => ({ data: { id: 'account', role, teacher_status }, error: null }),
    }) }),
  };
}

test('Teacher material and review APIs reject pending/rejected/missing approval from database', async () => {
  for (const status of ['pending', 'rejected', null, undefined]) {
    for (const authorize of [authorizeMaterialRequest, authorizeTeacherOralReadingRequest]) {
      await assert.rejects(authorize({}, dependencies('teacher', status)), (error) => error.statusCode === 403);
    }
  }
});

test('approved Teachers retain both APIs; Independent Learner material API is unchanged', async () => {
  for (const authorize of [authorizeMaterialRequest, authorizeTeacherOralReadingRequest]) {
    const result = await authorize({}, dependencies('teacher', 'approved'));
    assert.equal(result.profile.teacher_status, 'approved');
  }
  assert.equal((await authorizeMaterialRequest({}, dependencies('general_user', null))).profile.role, 'general_user');
});

test('pending Teachers cannot use the Admin API', async () => {
  await assert.rejects(authorizeAdminRequest({}, dependencies('teacher', 'pending')), (error) => error.statusCode === 403);
});

const SCHOOL = '5c000000-0000-4000-8000-000000000001';
test('Admin listing includes real Teacher status, full name, email and registration date', async () => {
  const profile = { id: 'teacher', role: 'teacher', teacher_status: 'pending', full_name: 'Maria Santos',
    nickname: null, status: 'active', created_at: '2026-10-08T00:00:00Z', school_id: SCHOOL };
  const users = await listManagedUsers({ getSupabaseAdmin: () => ({
    auth: { admin: { listUsers: async () => ({ data: { users: [{ id: 'teacher', email: 'teacher@example.test' }] } }) } },
    from: () => ({ select() { return this; }, order: async () => ({ data: [profile] }) }),
  }) }, 'admin', SCHOOL);
  assert.equal(users[0].teacherStatus, 'pending');
  assert.equal(users[0].fullName, 'Maria Santos');
  assert.equal(users[0].email, 'teacher@example.test');
  assert.equal(users[0].createdAt, profile.created_at);
});
