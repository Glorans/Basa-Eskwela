const test = require('node:test');
const assert = require('node:assert/strict');
const { getAdminSystemAnalytics } = require('../services/adminSystemAnalytics');

// Admin System Performance describes learners. Admin self-practice (M5 readings, M6
// comprehension) keeps its own results but never enters these totals. In-memory rows only.
const ADMIN = { user: { id: 'admin' }, profile: { id: 'admin', role: 'admin' } };
const reading = (id, userId, roomId = null) => ({ id, user_id: userId, room_id: roomId, completed_at: '2026-10-02T00:00:00Z',
  pronunciation_accuracy: userId === 'admin' ? 10 : 90, reading_speed_wpm: userId === 'admin' ? 5 : 100 });
const quiz = (id, userId, score) => ({ id, userId, roomId: null, status: 'completed', score, completedAt: '2026-10-02T00:00:00Z' });

function data({ withPractice }) {
  const tables = {
    profiles: [{ id: 'admin', role: 'admin', full_name: 'Admin' }, { id: 's', role: 'student', full_name: 'Student' },
      { id: 'g', role: 'general_user', full_name: 'Learner' }, { id: 't', role: 'teacher', teacher_status: 'approved', full_name: 'Teacher' }],
    rooms: [], enrollments: [], reading_activity_assignments: [], m7_interventions: [],
    oral_reading_attempts: [reading('r1', 's'), reading('r2', 'g'),
      ...(withPractice ? [reading('ra1', 'admin'), reading('ra2', 'admin'), reading('rt', 't')] : [])],
    m6_comprehension_attempts: [{ id: 'q1', user_id: 's', status: 'completed' }, { id: 'q2', user_id: 'g', status: 'completed' },
      ...(withPractice ? [{ id: 'qa', user_id: 'admin', status: 'completed' }] : [])],
  };
  const quizzes = [quiz('q1', 's', 80), quiz('q2', 'g', 60), ...(withPractice ? [quiz('qa', 'admin', 0)] : [])];
  return { rows: async (table) => tables[table] ?? [], quizzes: async () => quizzes, requesterSchoolMembers: async () => ({ members: new Set(tables.profiles.map((p) => p.id)) }) };
}

test('Admin practice readings and comprehension never change Admin System Performance', async () => {
  const learnersOnly = await getAdminSystemAnalytics(ADMIN, {}, data({ withPractice: false }));
  const withPractice = await getAdminSystemAnalytics(ADMIN, {}, data({ withPractice: true }));
  // Students only: the Independent Learner's reading (r2) and quiz (q2, score 60) are outside the School Admin's scope.
  assert.equal(withPractice.readingAttempts, 1, 'only Student readings are counted');
  assert.equal(withPractice.completedQuizzes, 1, 'only Student comprehension is counted');
  assert.equal(withPractice.pronunciationAccuracy, 90);
  assert.equal(withPractice.comprehensionScore, 80);
  // Every figure, trend and the independent (no classroom) totals are identical to learners only.
  assert.deepEqual(withPractice.details.performance, learnersOnly.details.performance);
  assert.deepEqual(withPractice.details.trends, learnersOnly.details.trends);
  assert.deepEqual(withPractice.details.independentPerformance, learnersOnly.details.independentPerformance);
  assert.deepEqual(withPractice.details.participation, learnersOnly.details.participation);
  assert.ok(!JSON.stringify(withPractice).includes('"admin"'), 'no Admin row appears anywhere');
  assert.equal(withPractice.details.independentPerformance.readingAttempts, 1, 'unassigned practice is the Student practice only');
  assert.equal(withPractice.details.independentPerformance.completedQuizzes, 1);
  assert.ok(!JSON.stringify(withPractice).includes('"g"'), 'no Independent Learner row appears anywhere');
});
