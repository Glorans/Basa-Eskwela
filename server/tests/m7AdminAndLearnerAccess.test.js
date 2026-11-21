// M7 Appendix N completion: Independent Learner progress, Admin student performance, competency,
// interventions and weekly reports. In-memory data and mocked authorization only; nothing is saved.
const test = require('node:test');
const assert = require('node:assert/strict');

const oral = require('../services/oralReadingAttemptService');
const adminUsers = require('../services/adminUserService');
const supabaseAdmin = require('../services/supabaseAdmin');
const { OralReadingAuthorizationError } = oral;
const { AdminAuthorizationError } = adminUsers;

// Authorization is mocked before the routes load, because routes keep the functions they import.
let signedIn = { user: { id: 'student-1' }, profile: { role: 'student' } };
test.mock.method(oral, 'authorizeOralReadingRequest', async () => {
  if (!['student', 'general_user'].includes(signedIn.profile.role)) throw new OralReadingAuthorizationError();
  return signedIn;
});
test.mock.method(oral, 'authorizeTeacherOralReadingRequest', async () => {
  if (signedIn.profile.role !== 'teacher') throw new OralReadingAuthorizationError('Approved Teacher access is required.');
  return signedIn;
});
test.mock.method(adminUsers, 'authorizeAdminRequest', async () => {
  if (signedIn.profile.role !== 'admin') throw new AdminAuthorizationError();
  return signedIn;
});
// m7Analytics keeps the database client it imports, so a switchable fake is installed first.
let currentDb = null;
test.mock.method(supabaseAdmin, 'getSupabaseAdmin', () => currentDb ?? assert.fail('no database in this test'));
const analytics = require('../services/m7Analytics');
const adminSystem = require('../services/adminSystemAnalytics');
const { buildAdminStudents, buildAdminStudentDetail, competencyOf, buildAdminAnalytics } = adminSystem;
const { buildAdminWeeklyReport, generateAdminWeeklyReport } = require('../services/weeklyReportGenerator');
const { saveWeeklyReport } = require('../services/weeklyReportStorage');
const { createAdminWeeklyReportsRouter, createWeeklyReportsRouter } = require('../routes/weeklyReports');
const m7Router = require('../routes/m7Analytics');

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = id(1), S2 = id(2), S3 = id(3), IL = id(4), T1 = id(10), ADMIN = id(20), ROOM = id(30), ROOM2 = id(31);
const quiz = (n, user, score, completedAt, extra = {}) => ({ id: id(100 + n), userId: user, roomId: ROOM, title: `Story ${n}`, status: 'completed', completedAt,
  score, firstCorrect: Math.round(score / 50), totalQuestions: 2, hintsUsed: 0,
  byType: { literal: { total: 1, firstCorrect: score >= 50 ? 1 : 0 }, inferential: { total: 1, firstCorrect: score === 100 ? 1 : 0 }, critical: { total: 0, firstCorrect: 0 } }, ...extra });
function data(overrides = {}) {
  return {
    profiles: [
      { id: S1, role: 'student', full_name: 'Ana' }, { id: S2, role: 'student', full_name: 'Ben' }, { id: S3, role: 'student', nickname: 'Cy' },
      { id: IL, role: 'general_user', full_name: 'Ivy' }, { id: T1, role: 'teacher', teacher_status: 'approved', full_name: 'Teacher T' },
      { id: ADMIN, role: 'admin', full_name: 'Admin' },
    ],
    rooms: [{ id: ROOM, room_name: 'Grade 5', teacher_id: T1 }, { id: ROOM2, room_name: 'Empty room', teacher_id: T1 }],
    enrollments: [{ id: id(40), student_id: S1, room_id: ROOM }, { id: id(41), student_id: S2, room_id: ROOM }],
    readings: [
      { id: id(50), user_id: S1, room_id: ROOM, material_id: id(60), activity_assignment_id: id(70), completed_at: '2026-11-03T02:00:00Z', pronunciation_accuracy: 86.486486, reading_speed_wpm: 100.4, passage_title_snapshot: 'Seeds' },
      { id: id(51), user_id: IL, room_id: null, completed_at: '2026-11-03T02:00:00Z', pronunciation_accuracy: 10, reading_speed_wpm: 10 },
    ],
    quizzes: [quiz(1, S1, 50, '2026-11-03T03:00:00Z'), quiz(2, S1, 50, '2026-11-04T03:00:00Z'), quiz(3, IL, 0, '2026-11-04T03:00:00Z', { roomId: null })],
    assignments: [{ id: id(70), student_id: S1, room_id: ROOM, material_id: id(60), status: 'assigned', read_aloud_only: false },
      { id: id(71), student_id: S2, room_id: ROOM, material_id: id(61), status: 'assigned', read_aloud_only: false }],
    attempts: [{ id: id(101), user_id: S1, room_id: ROOM, material_id: id(60), activity_assignment_id: id(70), oral_reading_attempt_id: id(50), status: 'completed' }],
    interventions: [{ id: id(80), teacher_id: T1, student_id: S1, status: 'planned' }, { id: id(81), teacher_id: ADMIN, student_id: S1, status: 'completed' }],
    ...overrides,
  };
}
function call(router, method, path, req) {
  const layer = router.stack.find((l) => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { resolve({ status: this.statusCode, body }); return this; } };
    Promise.resolve(layer.route.stack[0].handle({ params: {}, query: {}, body: {}, headers: {}, ...req }, res)).catch(reject);
  });
}

// --- Function 1: personal progress -----------------------------------------------------------
test('personal progress: Students and Independent Learners see only their own records; other roles are refused', async (t) => {
  const asked = [];
  t.mock.method(analytics, 'personal', async (userId) => { asked.push(userId); return { summary: {}, readings: [], quizzes: [], activities: [{ id: 'a' }] }; });
  signedIn = { user: { id: IL }, profile: { role: 'general_user' } };
  const mine = await call(m7Router, 'get', '/personal', {});
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.data.activities, [], 'Independent Learners have no classroom assignments');
  signedIn = { user: { id: S1 }, profile: { role: 'student' } };
  assert.equal((await call(m7Router, 'get', '/personal', { query: { userId: S2 } })).body.data.activities.length, 1);
  assert.deepEqual(asked, [IL, S1], 'always the signed-in learner; a userId query is ignored');
  for (const role of ['teacher', 'admin']) {
    signedIn = { user: { id: T1 }, profile: { role } };
    assert.equal((await call(m7Router, 'get', '/personal', {})).status, 403, role);
  }
});

// --- Functions 4, 8, 9: Admin student performance --------------------------------------------
test('Admin student list: every Student account, including those with no data; Independent Learners excluded', () => {
  const list = buildAdminStudents(data());
  assert.deepEqual(list.map((s) => s.name), ['Ana', 'Ben', 'Cy']);
  const [ana, ben, cy] = list;
  assert.equal(ana.readingAttempts, 1);
  assert.equal(ana.completedQuizzes, 2);
  assert.equal(ana.comprehensionScore, 50);
  assert.equal(ana.classification, 'Needs Support', 'two consecutive scores below 75%');
  assert.deepEqual(ana.completion, { assigned: 1, completed: 1, completionRate: 100 });
  assert.deepEqual([ben.classification, ben.readingAttempts, ben.pronunciationAccuracy, ben.comprehensionScore], ['No assessment data', 0, null, null]);
  assert.deepEqual(ben.completion, { assigned: 1, completed: 0, completionRate: 0 });
  assert.deepEqual([cy.classification, cy.classrooms, cy.completion.completionRate], ['No assessment data', [], null]);
  // The list's classification matches the existing Admin risk section for the same data.
  const dashboard = buildAdminAnalytics(data(), { roomId: null, startDate: null, endDate: null });
  assert.equal(dashboard.details.riskCounts['Early Warning'], list.filter((s) => s.classification === 'Early Warning').length);
  assert.ok(!JSON.stringify(list).includes('Ivy'));
});

test('Admin student detail: competency with correct counts, own interventions only, others counted without notes', () => {
  const own = [{ id: id(81), teacher_id: ADMIN, student_id: S1, status: 'completed', notes: 'Admin note', intervention_date: '2026-11-04' },
    { id: id(80), teacher_id: T1, student_id: S1, status: 'planned', notes: 'Teacher private note' }];
  const detail = buildAdminStudentDetail(data(), S1, ADMIN, own);
  assert.deepEqual(detail.competency, {
    literal: { total: 2, correct: 2, score: 100 }, inferential: { total: 2, correct: 0, score: 0 }, critical: { total: 0, correct: 0, score: null },
  });
  assert.deepEqual(detail.interventions.own.map((i) => i.notes), ['Admin note'], 'a Teacher note passed in by mistake is still filtered out');
  assert.deepEqual(detail.interventions.others, { total: 1, planned: 1, inProgress: 0, completed: 0 });
  assert.ok(!JSON.stringify(detail).includes('Teacher private note'));
  assert.equal(detail.readings[0].readingAccuracy, 86.486486, 'saved values are returned unchanged');
  assert.equal(detail.contexts[0].teacherName, 'Teacher T');
  for (const other of [IL, T1, ADMIN, id(999)]) assert.throws(() => buildAdminStudentDetail(data(), other, ADMIN), { statusCode: 404 });
});

test('competency: invalid evidence is unavailable, never counted as wrong; missing types have no score', () => {
  const invalid = competencyOf([quiz(1, S1, 50, '2026-11-03T03:00:00Z'), { id: 'bad', dataQuality: 'Invalid completed assessment evidence', byType: {} }]);
  assert.deepEqual(invalid.literal, { total: 1, correct: null, score: null });
  assert.deepEqual(competencyOf([]), { literal: { total: 0, correct: 0, score: null }, inferential: { total: 0, correct: 0, score: null }, critical: { total: 0, correct: 0, score: null } });
});

test('Admin analytics routes refuse every non-Admin before reading data', async (t) => {
  t.mock.method(adminSystem, 'loadAdminData', async () => assert.fail('data must not be read'));
  for (const role of ['student', 'general_user', 'teacher']) {
    signedIn = { user: { id: S1 }, profile: { role } };
    assert.equal((await call(m7Router, 'get', '/admin/students', {})).status, 403, role);
    assert.equal((await call(m7Router, 'get', '/admin/students/:studentId', { params: { studentId: S1 } })).status, 403, role);
    assert.equal((await call(m7Router, 'post', '/admin/students/:studentId/interventions', { params: { studentId: S1 }, body: {} })).status, 403, role);
  }
});

// --- Function 10: interventions --------------------------------------------------------------
function interventionDb(log) {
  return { from(table) {
    const q = { table, action: 'select', filters: {},
      select() { return this; }, insert(row) { this.action = 'insert'; this.row = row; return this; }, update(row) { this.action = 'update'; this.row = row; return this; },
      eq(k, v) { this.filters[k] = v; return this; }, in() { return this; }, order() { return this; }, limit() { return this; }, gt() { return this; },
      async maybeSingle() { log.push({ table, action: this.action, row: this.row, filters: this.filters }); return { data: { id: 'saved', ...this.row }, error: null }; },
      then(resolve) { return Promise.resolve(resolve({ data: table === 'profiles' && this.filters.id === S1 && this.filters.role === 'student' ? [{ id: S1, role: 'student' }] : [], error: null })); },
    };
    return q;
  } };
}
test('Admin interventions are authored by the Admin, limited to Student accounts, and update only their own rows', async (t) => {
  const log = [];
  currentDb = interventionDb(log);
  const body = { notes: ' Meet weekly ', intervention_date: '2026-11-05', status: 'planned', follow_up_date: null, follow_up_notes: '' };
  // M1 multi-tenancy: the Student must also belong to the School Admin's school (SCHOOL); another school answers 404.
  const SCHOOL = id(900), OTHER = id(901);
  const students = async (table, cols, filters) => (table === 'profiles' && filters.id === S1 && filters.role === 'student' && filters.school_id === SCHOOL ? [{ id: S1, role: 'student' }] : []);
  const authorize = () => analytics.requireAdminStudent(S1, students, SCHOOL);
  await assert.rejects(analytics.saveIntervention(ADMIN, S1, null, { notes: 'x', intervention_date: '2026-11-05', status: 'planned' }, { authorize: () => analytics.requireAdminStudent(S1, students, OTHER) }), { statusCode: 404 });
  await assert.rejects(analytics.requireAdminStudent(S1, students, null), { statusCode: 403 });
  await analytics.saveIntervention(ADMIN, S1, null, body, { authorize });
  assert.deepEqual([log[0].action, log[0].row.teacher_id, log[0].row.student_id, log[0].row.notes], ['insert', ADMIN, S1, 'Meet weekly']);
  await analytics.saveIntervention(ADMIN, S1, id(80), body, { authorize });
  assert.deepEqual(log[1].filters, { id: id(80), teacher_id: ADMIN, student_id: S1 }, 'an Admin update can only match its own record');
  // Independent Learners, unknown IDs and malformed IDs are refused before any write.
  for (const studentId of [IL, id(999), 'not-a-uuid']) {
    await assert.rejects(analytics.saveIntervention(ADMIN, studentId, null, body, { authorize: () => analytics.requireAdminStudent(studentId, async () => [], SCHOOL) }), { statusCode: 404 });
  }
  assert.equal(log.filter((entry) => entry.table === 'm7_interventions').length, 2);
  // Validation is unchanged.
  await assert.rejects(analytics.saveIntervention(ADMIN, S1, null, { ...body, status: 'done' }, { authorize: async () => {} }), { statusCode: 400 });
});

test('Teacher interventions keep the classroom check when no Admin authorizer is passed', async (t) => {
  const log = [];
  currentDb = interventionDb(log);
  // requireStudent runs (no classrooms in this database), so the Teacher is refused for a student outside their rooms.
  await assert.rejects(analytics.saveIntervention(T1, S1, null, { notes: 'x', intervention_date: '2026-11-05', status: 'planned' }), { statusCode: 403 });
  assert.equal(log.filter((entry) => entry.table === 'm7_interventions').length, 0, 'nothing is written');
});

// --- Functions 6 and 7: Admin weekly reports ---------------------------------------------------
test('Admin weekly report: Students only, PHT period, comparisons, summaries and competency; Teacher shape kept', () => {
  const report = buildAdminWeeklyReport(data(), { startDate: '2026-11-02', endDate: '2026-11-08' });
  assert.equal(report.scope, 'admin');
  assert.match(report.learnerScope, /Independent Learner practice is not included/);
  assert.deepEqual([report.reading.totalAttempts, report.reading.studentsWithAttempts], [1, 1], 'the Independent Learner reading is excluded');
  assert.deepEqual(report.comprehension.assessments.map((a) => [a.studentName, a.correctAnswers, a.totalQuestions, a.scorePercentage]), [['Ana', 1, 2, 50], ['Ana', 1, 2, 50]]);
  assert.deepEqual(report.currentCompletionSnapshot.classrooms.map((c) => [c.roomName, c.totalAssignments, c.completedAssignments]), [['Grade 5', 2, 1], ['Empty room', 0, 0]]);
  assert.equal(report.classroomComparisons[0].roomName, 'Grade 5');
  assert.deepEqual(report.studentSummaries.map((s) => [s.studentName, s.readingAttempts, s.completedAssessments, s.averageScore]), [['Ana', 1, 2, 50]]);
  assert.deepEqual(report.competency.literal, { total: 2, correct: 2, score: 100 });
  // PHT boundaries: a quiz at 2026-11-01T16:00Z is Monday 00:00 PHT, inside; one minute earlier is outside.
  const edges = data({ quizzes: [quiz(1, S1, 100, '2026-11-01T16:00:00Z'), quiz(2, S1, 100, '2026-11-01T15:59:00Z')] });
  assert.equal(buildAdminWeeklyReport(edges, { startDate: '2026-11-02', endDate: '2026-11-08' }).comprehension.completedAssessments, 1);
  // Invalid evidence stops the report instead of being scored.
  const invalid = data({ quizzes: [{ id: 'bad', userId: S1, completedAt: '2026-11-03T03:00:00Z', score: null, dataQuality: 'Invalid completed assessment evidence', byType: {} }] });
  assert.throws(() => buildAdminWeeklyReport(invalid, { startDate: '2026-11-02', endDate: '2026-11-08' }), /evidence is incomplete/);
  assert.throws(() => buildAdminWeeklyReport(data(), { startDate: '2026-11-08', endDate: '2026-11-02' }), /end date cannot be before/);
});

test('Admin report generation requires an Admin and reads no data otherwise', async () => {
  for (const role of ['teacher', 'student', 'general_user']) {
    await assert.rejects(generateAdminWeeklyReport({ user: { id: T1 }, profile: { role } }, { startDate: '2026-11-02', endDate: '2026-11-08' },
      { loadAdminData: async () => assert.fail('no data for non-Admins') }), AdminAuthorizationError, role);
  }
  const scoped = [];
  const report = await generateAdminWeeklyReport({ user: { id: ADMIN }, profile: { role: 'admin' } }, { startDate: '2026-11-02', endDate: '2026-11-08' },
    { loadAdminData: async (_deps, members) => { scoped.push(members); return data(); }, requesterSchoolMembers: async () => ({ members: new Set(['school-member']) }) });
  assert.deepEqual([...scoped[0]], ['school-member'], 'the report reads only the School Admin school');
  assert.equal(report.scope, 'admin');
});

test('Admin report routes: Admin only, saved under the Admin as owner, and kept apart from Teacher reports', async () => {
  const saved = [];
  const deps = {
    generateAdminWeeklyReport: async (requester, period) => buildAdminWeeklyReport(data(), period),
    // A mocked database: the real save function builds the row, nothing is written anywhere.
    getSupabaseAdmin: () => ({ from: () => ({ insert(row) { saved.push(row); return this; }, select() { return this; },
      async single() { return { data: { id: 'r1', period_start: saved.at(-1).period_start, period_end: saved.at(-1).period_end, report_data: saved.at(-1).report_data, created_at: '2026-11-05T00:00:00Z' }, error: null }; } }) }),
    listWeeklyReports: async (requester) => ({ reports: [{ owner: requester.user.id }], nextCursor: null }),
    getSavedWeeklyReport: async (requester, reportId) => ({ id: reportId, owner: requester.user.id }),
  };
  const adminRouter = createAdminWeeklyReportsRouter({ ...deps, authorizeAdminRequest: adminUsers.authorizeAdminRequest });
  for (const role of ['teacher', 'student', 'general_user']) {
    signedIn = { user: { id: T1 }, profile: { role } };
    assert.equal((await call(adminRouter, 'post', '/', { body: { period: { startDate: '2026-11-02', endDate: '2026-11-08' } } })).status, 403, role);
    assert.equal((await call(adminRouter, 'get', '/', {})).status, 403, role);
  }
  assert.equal(saved.length, 0);
  signedIn = { user: { id: ADMIN }, profile: { role: 'admin' } };
  const created = await call(adminRouter, 'post', '/', { body: { period: { startDate: '2026-11-02', endDate: '2026-11-08' } } });
  assert.equal(created.status, 201);
  assert.equal(saved[0].teacher_id, ADMIN, 'the Admin owns the report');
  assert.equal(saved[0].report_data.scope, 'admin');
  assert.equal((await call(adminRouter, 'get', '/', {})).body.reports[0].owner, ADMIN);
  assert.equal((await call(adminRouter, 'get', '/:reportId', { params: { reportId: 'r1' } })).body.report.owner, ADMIN);
  // An Admin cannot use the Teacher report routes.
  const teacherRouter = createWeeklyReportsRouter({ ...deps, authorizeTeacherOralReadingRequest: oral.authorizeTeacherOralReadingRequest });
  assert.equal((await call(teacherRouter, 'get', '/', {})).status, 403);
  assert.ok(typeof saveWeeklyReport === 'function');
});
