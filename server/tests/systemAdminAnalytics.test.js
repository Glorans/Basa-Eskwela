// M7 for the System Admin: F2 platform overview and F4 Independent Learner performance. Fixtures only, no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const { platformOverview, independentLearners, independentLearnerDetail } = require('../services/systemAdminAnalytics');
const { authorizeSystemAdminRequest, authorizeAdminRequest } = require('../services/adminUserService');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SA = id(1), SCHOOL = id(2), TEACHER = id(3), STUDENT = id(4), IL = id(5), IL2 = id(6);
const profiles = [
  { id: SA, role: 'system_admin', full_name: 'Sys Admin' }, { id: SCHOOL, role: 'admin', full_name: 'School Admin Person' },
  { id: TEACHER, role: 'teacher', teacher_status: 'approved', full_name: 'Teacher Tess' },
  { id: id(7), role: 'teacher', teacher_status: 'pending', full_name: 'Pending Pat' },
  { id: STUDENT, role: 'student', full_name: 'Student Sam' }, { id: IL, role: 'general_user', full_name: 'Learner Lia' },
  { id: IL2, role: 'general_user', nickname: 'Nico' }, { id: id(8), role: null },
];
const MODULE = id(30), PRIVATE_MATERIAL = id(40);
const modules = [{ id: MODULE, title: 'The Garden', status: 'published', deleted_at: null }, { id: id(31), title: 'Draft', status: 'draft', deleted_at: null },
  { id: id(32), title: 'Old', status: 'archived', deleted_at: null }, { id: id(33), title: 'Gone', status: 'draft', deleted_at: '2026-11-01T00:00:00Z' }];
const NOW = Date.parse('2026-11-18T12:00:00Z');
const readings = [
  { id: id(50), user_id: IL, module_id: MODULE, material_id: null, completed_at: '2026-11-17T02:00:00Z', pronunciation_accuracy: 90, reading_speed_wpm: 100, detected_error_count: 2, transcript: 'SECRET TRANSCRIPT' },
  { id: id(51), user_id: IL, module_id: null, material_id: PRIVATE_MATERIAL, completed_at: '2026-10-01T02:00:00Z', pronunciation_accuracy: 70, reading_speed_wpm: 80, detected_error_count: 5 },
  { id: id(52), user_id: STUDENT, module_id: MODULE, completed_at: '2026-11-16T02:00:00Z', pronunciation_accuracy: 50, reading_speed_wpm: 60 },
  { id: id(53), user_id: TEACHER, module_id: MODULE, completed_at: '2026-11-16T02:00:00Z', pronunciation_accuracy: 10, reading_speed_wpm: 10 },
];
const quizzes = [
  { id: id(60), userId: IL, title: 'My Secret Diary Material', completedAt: '2026-11-17T03:00:00Z', score: 80, firstCorrect: 4, totalQuestions: 5,
    byType: { literal: { total: 5, firstCorrect: 4 } }, answers: ['SECRET ANSWER'] },
  { id: id(61), userId: STUDENT, title: 'The Garden', completedAt: '2026-11-16T03:00:00Z', score: 40, byType: {} },
];
const attempts = [{ id: id(60), user_id: IL, module_id: null, material_id: PRIVATE_MATERIAL }];

function fakeRows(table, columns, filters = {}) {
  const pick = list => list.filter(row => Object.entries(filters).every(([k, v]) => Array.isArray(v) ? v.includes(row[k]) : row[k] === v));
  if (table === 'profiles') return Promise.resolve(pick(profiles));
  if (table === 'modules') return Promise.resolve(pick(modules));
  if (table === 'oral_reading_attempts') return Promise.resolve(pick(readings));
  if (table === 'm6_comprehension_attempts') return Promise.resolve(pick(attempts));
  throw new Error(`unexpected table ${table}`);
}
const deps = {
  rows: fakeRows, now: () => NOW,
  quizzes: async (_filters, options = {}) => quizzes.filter(q => !options.include || options.include({ user_id: q.userId })),
  personal: async userId => ({ summary: { readingAttempts: 2 }, readings: readings.filter(r => r.user_id === userId),
    quizzes: quizzes.filter(q => q.userId === userId), historicalQuizzes: [] }),
};

test('F2 platform overview: correct totals, learner-only activity, and no names or account ids', async () => {
  const o = await platformOverview(deps);
  assert.deepEqual(o.users, { total: 8, systemAdmins: 1, schoolAdmins: 1, teachers: 2, approvedTeachers: 1, students: 1, independentLearners: 2, withoutRole: 1 });
  assert.deepEqual(o.modules, { published: 1, draft: 1, archived: 1, inTrash: 1 });
  assert.equal(o.activity.readingAttempts, 3, 'Teacher self-practice is not learner activity');
  assert.equal(o.activity.completedQuizzes, 2);
  assert.equal(o.activity.activeLearners7Days, 2);
  assert.equal(o.independentLearners.readingAttempts, 2);
  assert.equal(o.students.readingAttempts, 1);
  const text = JSON.stringify(o);
  for (const p of profiles) {
    assert.ok(!text.includes(p.id), 'no account id');
    if (p.full_name) assert.ok(!text.includes(p.full_name), 'no name');
  }
  assert.ok(!text.includes('Secret') && !text.includes('The Garden'), 'no titles');
});

test('F4 list: Independent Learners only (no School Students, Teachers or administrators)', async () => {
  const list = await independentLearners(deps);
  assert.deepEqual(list.map(l => l.id).sort(), [IL, IL2].sort());
  const lia = list.find(l => l.id === IL);
  assert.equal(lia.readingAttempts, 2); assert.equal(lia.completedQuizzes, 1); assert.equal(lia.comprehensionScore, 80);
  assert.equal(list.find(l => l.id === IL2).name, 'Nico');
  assert.ok(!JSON.stringify(list).includes('Student Sam'));
});

test('F4 detail: only an Independent Learner; every other account is answered like an unknown id', async () => {
  for (const other of [STUDENT, TEACHER, SCHOOL, SA, id(999), 'not-a-uuid', '']) {
    await assert.rejects(independentLearnerDetail(other, deps), e => e.statusCode === 404 && e.message === 'Independent Learner not found.', other);
  }
});

test('F4 detail: performance fields only; no private material titles, transcripts, answers or recordings', async () => {
  const d = await independentLearnerDetail(IL, deps);
  assert.equal(d.name, 'Learner Lia');
  assert.deepEqual(d.readings.map(r => r.source), [{ kind: 'module', title: 'The Garden' }, { kind: 'own_material', title: 'Own reading material' }]);
  assert.deepEqual(d.quizzes.map(q => q.source), [{ kind: 'own_material', title: 'Own reading material' }]);
  assert.equal(d.competency.literal.score, 80);
  const text = JSON.stringify(d);
  for (const secret of ['SECRET TRANSCRIPT', 'SECRET ANSWER', 'My Secret Diary Material', PRIVATE_MATERIAL, 'recording', 'transcript', 'answers', 'material_id']) {
    assert.ok(!text.includes(secret), secret);
  }
});

test('authorization: only system_admin passes the System Admin gate; the School Admin gate still refuses it', async () => {
  const fake = role => ({ getAuthenticatedSupabaseUser: async () => ({ id: SA }),
    getSupabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: SA, role }, error: null }) }) }) }) }) });
  assert.equal((await authorizeSystemAdminRequest({}, fake('system_admin'))).profile.role, 'system_admin');
  for (const role of ['admin', 'teacher', 'student', 'general_user', null]) {
    await assert.rejects(authorizeSystemAdminRequest({}, fake(role)), e => e.statusCode === 403, String(role));
  }
  await assert.rejects(authorizeAdminRequest({}, fake('system_admin')), e => e.statusCode === 403, 'School Admin analytics stay School Admin only');
});

test('routes: the three System Admin endpoints call the System Admin gate before any data is loaded', async () => {
  const servicePath = path.resolve(__dirname, '../services/adminUserService.js');
  const dataPath = path.resolve(__dirname, '../services/systemAdminAnalytics.js');
  const routerPath = path.resolve(__dirname, '../routes/m7Analytics.js');
  const saved = { service: require.cache[servicePath], data: require.cache[dataPath], router: require.cache[routerPath] };
  let role = 'admin'; const loaded = [];
  const real = require(servicePath);
  require.cache[servicePath] = { ...saved.service, exports: { ...real,
    authorizeSystemAdminRequest: async () => { if (role !== 'system_admin') throw Object.assign(new Error('System Admin access is required.'), { statusCode: 403 }); return {}; } } };
  require.cache[dataPath] = { ...saved.data, exports: {
    platformOverview: async () => { loaded.push('overview'); return { ok: 1 }; },
    independentLearners: async () => { loaded.push('list'); return []; },
    independentLearnerDetail: async learnerId => { loaded.push(learnerId); return { id: learnerId }; } } };
  delete require.cache[routerPath];
  const app = express(); app.use('/api/analytics', require(routerPath));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/api/analytics/system-admin`;
  try {
    for (const url of ['/overview', '/independent-learners', `/independent-learners/${IL}`]) {
      const refused = await fetch(base + url);
      assert.equal(refused.status, 403, url);
    }
    assert.deepEqual(loaded, [], 'nothing loaded for a non-System Admin');
    role = 'system_admin';
    for (const url of ['/overview', '/independent-learners', `/independent-learners/${IL}`]) assert.equal((await fetch(base + url)).status, 200, url);
    assert.deepEqual(loaded, ['overview', 'list', IL]);
  } finally {
    server.close();
    require.cache[servicePath] = saved.service; require.cache[dataPath] = saved.data;
    if (saved.router) require.cache[routerPath] = saved.router; else delete require.cache[routerPath];
  }
});
