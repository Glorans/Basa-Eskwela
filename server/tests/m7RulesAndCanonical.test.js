// M7: Basa Eskwela risk rules, M6's one assessment per activity, both assignment types and repeated
// readings. In-memory rows and fakes only; no network, no Staging.
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyRisk } = require('../services/m7Risk');
const { splitCanonicalCompleted, activityKey, chooseActivityAttempt } = require('../services/comprehensionActivity');
const attemptService = require('../services/comprehensionAttemptService');
const analytics = require('../services/m7Analytics');
const { buildAdminStudents, buildAdminStudentDetail, buildAdminAnalytics, loadAdminData, parseFilters } = require('../services/adminSystemAnalytics');
const { getTeacherQuizzes } = require('../services/m7TeacherQuizzes');
const { activeMaterialAssignments, activeRoomModules, withAssessmentRequirement, deriveActivityProgress, expandModuleAssignments } = require('../services/assignedReadingProgress');
const { getTeacherCompletionAnalytics } = require('../services/teacherCompletionAnalytics');
const { matchComprehensionAttempts } = require('../services/teacherComprehensionReview');
const { buildAdminWeeklyReport } = require('../services/weeklyReportGenerator');
const { loadWeeklyComprehensions, loadWeeklyRiskSummary } = require('../services/weeklyReportComprehension');
const { recipientRows } = require('../services/weeklyReportRows');

const quizzes = (scores) => scores.map((score, i) => ({ id: String(i).padStart(3, '0'), score, status: 'completed', completedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString() }));
const classify = (...scores) => classifyRisk(quizzes(scores)).classification;

test('A-H: the requested risk scenarios', () => {
  assert.equal(classify(74), 'At Risk', 'A: first score 74');
  assert.equal(classify(59), 'Needs Support', 'B: first score 59');
  assert.equal(classify(77), 'Early Warning', 'C: 77 without unresolved risk');
  assert.equal(classify(85), 'On Track', 'D: 85 without unresolved risk');
  assert.equal(classify(70, 74), 'Needs Support', 'E: two consecutive scores below 75');
  assert.equal(classify(74, 80), 'At Risk', 'F: one 80 does not clear At Risk');
  assert.equal(classifyRisk(quizzes([74, 80])).recoveryCount, 1, 'F: recovery progress is reported');
  assert.equal(classify(74, 80, 76), 'Early Warning', 'G: second score of at least 75 completes recovery; 76 is Early Warning');
  assert.equal(classify(74, 80, 90), 'On Track', 'G: second score of at least 75 completes recovery; 90 is On Track');
  assert.equal(classifyRisk([]).classification, 'No assessment data', 'H: no completed assessment');
});

// ---- Canonical selection ----
const USER = 'student-1';
const attempt = (id, completed_at, extra = {}) => ({ id, user_id: USER, status: completed_at ? 'completed' : 'in_progress', completed_at, created_at: '2026-10-01T00:00:00Z',
  module_id: null, passage_id: null, room_id: 'room', assignment_id: null, material_id: 'material', activity_assignment_id: 'activity', question_snapshot: [], ...extra });

test('canonical selection agrees with M6: first completed attempt, in every order', () => {
  const rows = [attempt('later', '2026-10-05T00:00:00Z'), attempt('open', null), attempt('first', '2026-10-02T00:00:00Z')];
  for (const order of [rows, [...rows].reverse()]) {
    const { canonical, extra } = splitCanonicalCompleted(order);
    assert.deepEqual(canonical.map((r) => r.id), ['first']);
    assert.deepEqual(extra.map((r) => r.id), ['later']);
    assert.equal(chooseActivityAttempt(order).id, 'first', 'the same rule M6 uses');
  }
  assert.equal(attemptService.activityKey, activityKey, 'M6 uses the shared rule');
  assert.deepEqual(splitCanonicalCompleted([attempt('open', null)]).canonical, [], 'an unfinished attempt never counts as completed');
});

test('K: separate assignments, classrooms, passages, learners and materials stay separate', () => {
  const base = { material_id: null, activity_assignment_id: null, module_id: 'm', passage_id: 'p', room_id: 'r1', assignment_id: 'a1' };
  const rows = [
    attempt('a', '2026-10-01T00:00:00Z', base),
    attempt('b', '2026-10-02T00:00:00Z', { ...base, assignment_id: 'a2' }),
    attempt('c', '2026-10-03T00:00:00Z', { ...base, room_id: 'r2', assignment_id: 'a3' }),
    attempt('d', '2026-10-04T00:00:00Z', { ...base, room_id: null, assignment_id: null }),
    attempt('e', '2026-10-05T00:00:00Z', { ...base, passage_id: 'p2' }),
    attempt('f', '2026-10-06T00:00:00Z', { ...base, user_id: 'student-2' }),
    attempt('g', '2026-10-07T00:00:00Z'),
    attempt('h', '2026-10-08T00:00:00Z', { activity_assignment_id: 'activity-2' }),
  ];
  assert.equal(splitCanonicalCompleted(rows).canonical.length, 8);
  assert.deepEqual(splitCanonicalCompleted([...rows, attempt('dup', '2026-10-09T00:00:00Z', base)]).extra.map((r) => r.id), ['dup']);
});

test('rows that name no activity are never grouped together', () => {
  const rows = [attempt('x', '2026-10-01T00:00:00Z', { material_id: null, module_id: null }), attempt('y', '2026-10-02T00:00:00Z', { material_id: null, module_id: null })];
  assert.equal(splitCanonicalCompleted(rows).canonical.length, 2);
});

const SNAPSHOT = [0, 1, 2, 3].map((n) => ({ id: `q${n}`, type: ['literal', 'inferential', 'critical', 'literal'][n], questionText: 'Q?', options: ['a', 'b', 'c', 'd'], correctOptionIndex: 0 }));
function answers(attemptId, correct) {
  return SNAPSHOT.map((q, n) => ({ id: `${attemptId}-${n}`, attempt_id: attemptId, question_id: q.id, first_option_index: n < correct ? 0 : 1, first_answer_correct: n < correct, resolved: true, hint_used: false, answer_history: [] }));
}
const memoryRows = (tables) => async (table, _columns, filters = {}) => (tables[table] ?? []).filter((row) => Object.entries(filters).every(([k, v]) => (Array.isArray(v) ? v.includes(row[k]) : row[k] === v)));

test('I: quizzes() counts the canonical score once; the later duplicate stays viewable but not counted', async () => {
  const tables = {
    m6_comprehension_attempts: [attempt('first', '2026-10-01T00:00:00Z', { question_snapshot: SNAPSHOT }), attempt('later', '2026-10-05T00:00:00Z', { question_snapshot: SNAPSHOT })],
    m6_comprehension_responses: [...answers('first', 1), ...answers('later', 4)],
  };
  const load = memoryRows(tables);
  const counted = await analytics.quizzes({ user_id: USER }, { rows: load });
  assert.deepEqual(counted.map((q) => [q.id, q.score]), [['first', 25]]);
  const kept = await analytics.historicalQuizzes({ user_id: USER }, { rows: load });
  assert.deepEqual(kept.map((q) => [q.id, q.score, q.notCounted]), [['later', 100, true]]);
  assert.equal(classifyRisk(counted).classification, 'Needs Support', 'the 100 does not hide the canonical 25');
  // An invalid later duplicate is not counted, so it cannot make the learner unavailable.
  tables.m6_comprehension_attempts[1].question_snapshot = null;
  assert.equal((await analytics.quizzes({ user_id: USER }, { rows: load }))[0].dataQuality, undefined);
  // Invalid canonical evidence is never a low score.
  tables.m6_comprehension_attempts[0].question_snapshot = null;
  const invalid = await analytics.quizzes({ user_id: USER }, { rows: load });
  assert.equal(invalid[0].score, null);
  assert.equal(classifyRisk(invalid).classification, 'No assessment data');
});

function database(tables) {
  return { from(table) {
    const filters = [];
    const q = { select() { return q; }, order() { return q; }, limit() { return q; }, range(a, b) { q.window = [a, b + 1]; return q; },
      eq(k, v) { filters.push((r) => r[k] === v); return q; }, in(k, vs) { filters.push((r) => vs.includes(r[k])); return q; }, gt(k, v) { filters.push((r) => r[k] > v); return q; },
      then(resolve) { let data = (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).sort((x, y) => String(x.id ?? '').localeCompare(String(y.id ?? ''))); if (q.window) data = data.slice(...q.window); return Promise.resolve(resolve({ data, error: null })); } };
    return q;
  } };
}
const teacherTables = () => ({
  rooms: [{ id: 'room', teacher_id: 'teacher', room_name: 'Room' }],
  enrollments: [{ id: 'e1', room_id: 'room', student_id: USER }, { id: 'e2', room_id: 'room', student_id: 'quiet' }],
  profiles: [{ id: USER, role: 'student', full_name: 'Ana' }, { id: 'quiet', role: 'student', full_name: 'Quiet' }],
  m6_comprehension_attempts: [attempt('first', '2026-10-01T00:00:00Z', { question_snapshot: SNAPSHOT }), attempt('later', '2026-10-20T00:00:00Z', { question_snapshot: SNAPSHOT })],
  m6_comprehension_responses: [...answers('first', 1), ...answers('later', 4)],
});
const teacher = { user: { id: 'teacher' }, profile: { role: 'teacher', teacher_status: 'approved' } };

test('I: Teacher quizzes, weekly comprehension and weekly risk use only the canonical attempt', async () => {
  const deps = { getSupabaseAdmin: () => database(teacherTables()) };
  assert.deepEqual((await getTeacherQuizzes(teacher, deps)).map((q) => [q.attemptId, q.scorePercentage]), [['first', 25]]);
  const period = (start, end) => ({ start: Date.parse(start), endExclusive: Date.parse(end) });
  assert.equal((await loadWeeklyComprehensions(teacher, period('2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'), deps)).length, 1);
  assert.deepEqual(await loadWeeklyComprehensions(teacher, period('2026-10-19T00:00:00Z', '2026-10-21T00:00:00Z'), deps), [], 'the extra attempt is not reported in its own week');
  const risk = await loadWeeklyRiskSummary(teacher, deps);
  assert.deepEqual(risk.counts, { 'Needs Support': 1, 'No assessment data': 1 });
  assert.equal(risk.students.find((s) => s.studentId === 'quiet').classification, 'No assessment data', 'H: no evidence is not a low score or On Track');
});

// ---- Classroom module completion ----
const MODULE_ROWS = {
  roomModules: [{ id: 'rm', room_id: 'room', module_id: 'mod', assigned_at: '2026-10-01T00:00:00Z' }],
  passages: [{ id: 'p1', module_id: 'mod' }, { id: 'p2', module_id: 'mod' }, { id: 'other', module_id: 'mod2' }],
};
const moduleAttempt = (id, passage_id, completed_at, extra = {}) => attempt(id, completed_at, { material_id: null, activity_assignment_id: null, module_id: 'mod', passage_id, assignment_id: 'rm', ...extra });
const moduleStatus = (readings, attempts) => {
  const [row] = expandModuleAssignments(MODULE_ROWS.roomModules, [], MODULE_ROWS.passages, () => [USER]);
  return deriveActivityProgress(row, readings, attempts);
};

test('assigned modules complete only from saved evidence for every passage of that assignment', () => {
  const reading = { id: 'r', user_id: USER, module_id: 'mod', passage_id: 'p1', room_id: 'room', assignment_id: 'rm' };
  assert.equal(moduleStatus([], []).status, 'Not Started', 'merely assigned is not completed');
  assert.equal(moduleStatus([reading], []).status, 'In Progress', 'a reading alone does not complete a passage with questions');
  assert.equal(moduleStatus([reading], [moduleAttempt('a', 'p1', null)]).status, 'In Progress');
  const oneOfTwo = moduleStatus([reading], [moduleAttempt('a', 'p1', '2026-10-02T00:00:00Z')]);
  assert.equal(oneOfTwo.status, 'In Progress');
  assert.deepEqual([oneOfTwo.passagesCompleted, oneOfTwo.passagesTotal], [1, 2]);
  assert.equal(moduleStatus([reading], [moduleAttempt('a', 'p1', '2026-10-02T00:00:00Z'), moduleAttempt('b', 'p2', '2026-10-03T00:00:00Z')]).status, 'Completed');
  // A duplicate of one passage cannot stand in for the other, and is not counted twice.
  const dup = moduleStatus([reading], [moduleAttempt('a', 'p1', '2026-10-02T00:00:00Z'), moduleAttempt('dup', 'p1', '2026-10-03T00:00:00Z')]);
  assert.deepEqual([dup.status, dup.passagesCompleted], ['In Progress', 1]);
  // Unrelated attempts: self-practice, another assignment, another passage.
  const unrelated = [moduleAttempt('x', 'p1', '2026-10-02T00:00:00Z', { assignment_id: null, room_id: null }), moduleAttempt('y', 'p1', '2026-10-02T00:00:00Z', { assignment_id: 'other' }), moduleAttempt('z', 'other', '2026-10-02T00:00:00Z')];
  assert.equal(moduleStatus([], unrelated).status, 'Not Started');
});

// Approved rule: each passage needs its own evidence; reviewed questions decide which.
const PASSAGES = (...ids) => ids.map((id) => ({ id, module_id: 'mod' }));
const moduleRow = (passageIds, withQuestions) => expandModuleAssignments(MODULE_ROWS.roomModules, [],
  withAssessmentRequirement(PASSAGES(...passageIds), withQuestions.map((passage_id) => ({ passage_id }))), () => [USER])[0];
const passageReading = (id, passage_id, extra = {}) => ({ id, user_id: USER, module_id: 'mod', passage_id, room_id: 'room', assignment_id: 'rm', ...extra });
const summary = (progress) => [progress.status, progress.passagesCompleted, progress.passagesTotal];
const DONE = '2026-10-02T00:00:00Z';

test('single-passage module: with questions needs M6, read-aloud-only needs a reading', () => {
  const withQuestions = moduleRow(['p1'], ['p1']);
  assert.deepEqual(summary(deriveActivityProgress(withQuestions, [], [])), ['Not Started', 0, 1]);
  assert.deepEqual(summary(deriveActivityProgress(withQuestions, [passageReading('r', 'p1')], [])), ['In Progress', 0, 1]);
  assert.deepEqual(summary(deriveActivityProgress(withQuestions, [passageReading('r', 'p1')], [moduleAttempt('a', 'p1', null)])), ['In Progress', 0, 1]);
  assert.deepEqual(summary(deriveActivityProgress(withQuestions, [passageReading('r', 'p1')], [moduleAttempt('a', 'p1', DONE)])), ['Completed', 1, 1]);
  const readOnly = moduleRow(['p1'], []);
  assert.deepEqual(summary(deriveActivityProgress(readOnly, [], [])), ['Not Started', 0, 1]);
  assert.deepEqual(summary(deriveActivityProgress(readOnly, [passageReading('r', 'p1')], [])), ['Completed', 1, 1]);
});

test('multi-passage module: 4 of 6 stays In Progress until every passage is done', () => {
  const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
  const row = moduleRow(ids, ids);
  const attempts = ids.slice(0, 4).map((p) => moduleAttempt(`a-${p}`, p, DONE));
  assert.deepEqual(summary(deriveActivityProgress(row, [], attempts)), ['In Progress', 4, 6]);
  assert.deepEqual(summary(deriveActivityProgress(row, [], ids.map((p) => moduleAttempt(`a-${p}`, p, DONE)))), ['Completed', 6, 6]);
});

test('mixed module applies the right rule to each passage', () => {
  const row = moduleRow(['q', 'r'], ['q']);
  assert.deepEqual(row.readAloudOnlyPassageIds, ['r']);
  assert.deepEqual(summary(deriveActivityProgress(row, [passageReading('1', 'q')], [])), ['In Progress', 0, 2], 'a reading of the question passage is not enough');
  assert.deepEqual(summary(deriveActivityProgress(row, [passageReading('1', 'r')], [])), ['In Progress', 1, 2]);
  assert.deepEqual(summary(deriveActivityProgress(row, [passageReading('1', 'q'), passageReading('2', 'r')], [moduleAttempt('a', 'q', DONE)])), ['Completed', 2, 2]);
  assert.deepEqual(summary(deriveActivityProgress(row, [passageReading('1', 'q')], [moduleAttempt('a', 'q', DONE)])), ['In Progress', 1, 2], 'M6 on one passage cannot stand in for reading the other');
});

test('repeated readings and duplicate M6 attempts count once; an in-progress duplicate does not undo a completed one', () => {
  const row = moduleRow(['q', 'r'], ['q']);
  const readings = [passageReading('1', 'r'), passageReading('2', 'r'), passageReading('3', 'q'), passageReading('4', 'q')];
  assert.deepEqual(summary(deriveActivityProgress(row, readings, [])), ['In Progress', 1, 2]);
  const attempts = [moduleAttempt('a', 'q', DONE), moduleAttempt('b', 'q', '2026-10-03T00:00:00Z'), moduleAttempt('c', 'q', null)];
  assert.deepEqual(summary(deriveActivityProgress(row, readings, attempts)), ['Completed', 2, 2]);
});

test('evidence from elsewhere never completes a read-aloud-only passage', () => {
  const row = moduleRow(['r'], []);
  for (const foreign of [{ assignment_id: 'other' }, { room_id: 'other' }, { assignment_id: null, room_id: null }, { module_id: 'other' }, { passage_id: 'other' }]) {
    assert.equal(deriveActivityProgress(row, [passageReading('x', 'r', foreign)], []).passagesCompleted, 0, JSON.stringify(foreign));
  }
});

test('a module with no eligible passages is never completed', () => {
  const row = moduleRow([], []);
  assert.deepEqual(summary(deriveActivityProgress(row, [], [])), ['Not Started', 0, 0]);
  assert.deepEqual(summary(deriveActivityProgress(row, [passageReading('r', 'legacy')], [])), ['In Progress', 0, 0]);
});

test('unknown question data keeps the assessment required', () => {
  const [row] = expandModuleAssignments(MODULE_ROWS.roomModules, [], PASSAGES('p1'), () => [USER]);
  assert.deepEqual(row.readAloudOnlyPassageIds, []);
  assert.equal(deriveActivityProgress(row, [passageReading('r', 'p1')], []).status, 'In Progress');
});

test('deleted or unpublished modules leave active requirements, as they leave the Learning Room', () => {
  const rows = [{ id: 'a', module_id: 'live' }, { id: 'b', module_id: 'deleted' }, { id: 'c', module_id: 'archived' }, { id: 'd', module_id: 'missing' }];
  const modules = [{ id: 'live', status: 'published' }, { id: 'deleted', status: 'published', deleted_at: DONE }, { id: 'archived', status: 'archived' }];
  assert.deepEqual(activeRoomModules(rows, modules).map((row) => row.id), ['a']);
});

test('Teacher, Admin and report totals agree on a mixed module and on progress', async () => {
  const tables = {
    rooms: [{ id: 'room', room_name: 'Room', teacher_id: 'teacher' }], enrollments: [{ id: 'e', room_id: 'room', student_id: USER }],
    profiles: [{ id: USER, role: 'student', full_name: 'Ana' }, { id: 'teacher', role: 'teacher', teacher_status: 'approved', full_name: 'T' }],
    reading_activity_assignments: [], room_module_recipients: [],
    room_modules: [{ id: 'rm', room_id: 'room', module_id: 'mod', assigned_at: '2026-10-01T00:00:00Z' }, { id: 'rm-old', room_id: 'room', module_id: 'gone', assigned_at: '2026-10-01T00:00:00Z' }],
    modules: [{ id: 'mod', title: 'Mixed', status: 'published' }, { id: 'gone', title: 'Gone', status: 'published', deleted_at: DONE }],
    module_passages: PASSAGES('q', 'r'), comprehension_questions: [{ id: 'cq', passage_id: 'q', module_id: 'mod', review_status: 'reviewed' }, { id: 'draft', passage_id: 'r', module_id: 'mod', review_status: 'generated' }],
    oral_reading_attempts: [passageReading('r1', 'r', { completed_at: DONE })], m6_comprehension_attempts: [moduleAttempt('a', 'q', null)], uploaded_materials: [],
  };
  const teacher = await getTeacherCompletionAnalytics({ user: { id: 'teacher' }, profile: { role: 'teacher', teacher_status: 'approved' } }, { getSupabaseAdmin: () => database(tables) });
  assert.deepEqual([teacher.totalAssignments, teacher.inProgressAssignments, teacher.completedAssignments], [1, 1, 0]);
  const admin = await loadAdminData({ rows: memoryRows(tables), quizzes: async () => [] }, new Set(tables.profiles.map((p) => p.id)));
  const detail = buildAdminStudentDetail(admin, USER, 'admin');
  assert.deepEqual(detail.activities.map((a) => [a.kind, a.title, a.status, a.passagesCompleted, a.passagesTotal]), [['module', 'Mixed', 'In Progress', 1, 2]]);
  tables.m6_comprehension_attempts[0] = moduleAttempt('a', 'q', DONE);
  const done = await getTeacherCompletionAnalytics({ user: { id: 'teacher' }, profile: { role: 'teacher', teacher_status: 'approved' } }, { getSupabaseAdmin: () => database(tables) });
  assert.deepEqual([done.completedAssignments, done.completionRate], [1, 100]);
  assert.equal(buildAdminStudents(await loadAdminData({ rows: memoryRows(tables), quizzes: async () => [] }, new Set(tables.profiles.map((p) => p.id))))[0].completion.completed, 1);
});

test('module assignments: removed ones are not counted, and selected recipients only', () => {
  const enrolled = () => ['a', 'b'];
  assert.deepEqual(expandModuleAssignments([{ id: 'x', room_id: 'r', module_id: 'm', removed_at: '2026-10-01T00:00:00Z' }], [], [], enrolled), []);
  assert.deepEqual(expandModuleAssignments([{ id: 'x', room_id: 'r', module_id: 'm' }], [], [], enrolled).map((row) => row.student_id), ['a', 'b']);
  assert.deepEqual(expandModuleAssignments([{ id: 'x', room_id: 'r', module_id: 'm', targeting_mode: 'selected_students' }],
    [{ room_module_id: 'x', student_id: 'b' }, { room_module_id: 'other', student_id: 'a' }], [], enrolled).map((row) => row.student_id), ['b']);
});

test('recipients page by key because the table has no id column', async () => {
  const rows = Array.from({ length: 230 }, (_, n) => ({ room_module_id: 'x', student_id: `s${String(n).padStart(3, '0')}` }));
  assert.equal((await recipientRows(database({ room_module_recipients: rows }), ['x'])).length, 230);
  assert.equal((await recipientRows(database({ room_module_recipients: rows }))).length, 230);
  assert.deepEqual(await recipientRows(database({ room_module_recipients: rows }), []), []);
});

const adminData = () => ({
  profiles: [{ id: USER, role: 'student', full_name: 'Ana' }, { id: 'admin', role: 'admin', full_name: 'Admin' }, { id: 'teacher', role: 'teacher', teacher_status: 'approved', full_name: 'T' }],
  rooms: [{ id: 'room', room_name: 'Room', teacher_id: 'teacher' }], enrollments: [{ id: 'e', room_id: 'room', student_id: USER }],
  readings: [], quizzes: [{ id: 'first', userId: USER, roomId: 'room', status: 'completed', score: 25, firstCorrect: 1, totalQuestions: 4, completedAt: '2026-10-01T00:00:00Z', byType: {} }],
  attempts: [moduleAttempt('a', 'p1', '2026-10-02T00:00:00Z'), moduleAttempt('b', 'p2', '2026-10-03T00:00:00Z')],
  assignments: expandModuleAssignments(MODULE_ROWS.roomModules, [], MODULE_ROWS.passages, () => [USER]),
  interventions: [],
});

test('module completion is consistent in Admin Student Performance, System Performance and Admin weekly reports', () => {
  const data = adminData();
  const [row] = buildAdminStudents(data);
  assert.deepEqual(row.completion, { assigned: 1, completed: 1, completionRate: 100 });
  assert.equal(row.classification, 'Needs Support');
  assert.equal(buildAdminAnalytics(data, parseFilters({})).details.completion.completed, 1);
  const report = buildAdminWeeklyReport(data, { startDate: '2026-10-01', endDate: '2026-10-07' });
  assert.equal(report.currentCompletionSnapshot.completedAssignments, 1);
  assert.deepEqual(report.riskClassifications.counts, { 'Needs Support': 1 });
  assert.equal(report.riskClassifications.students[0].classification, 'Needs Support');
  assert.equal(buildAdminStudentDetail(data, USER, 'admin').activities[0].kind, 'module');
});

test('J: Admin practice never reaches learner analytics, even through loadAdminData', async () => {
  const tables = {
    profiles: adminData().profiles, rooms: adminData().rooms, enrollments: adminData().enrollments,
    oral_reading_attempts: [{ id: 'ar', user_id: 'admin', room_id: null, completed_at: '2026-10-01T00:00:00Z', pronunciation_accuracy: 1, reading_speed_wpm: 1 }],
    m6_comprehension_attempts: [{ id: 'aq', user_id: 'admin', status: 'completed' }],
  };
  const data = await loadAdminData({ rows: memoryRows(tables), quizzes: async () => [{ id: 'aq', userId: 'admin', status: 'completed', score: 0, completedAt: '2026-10-01T00:00:00Z' }] }, new Set(tables.profiles.map((p) => p.id)));
  assert.deepEqual([data.readings, data.quizzes, data.attempts], [[], [], []]);
  assert.ok(!buildAdminStudents(data).some((s) => s.id === 'admin'));
  assert.deepEqual(buildAdminAnalytics(data, parseFilters({})).details.riskCounts['No assessment data'], 1);
});

// ---- What each assigned activity requires (M4 assignment mode) ----
const activity = (extra = {}) => ({ id: 'act', student_id: USER, room_id: 'room', material_id: 'mat', status: 'assigned', read_aloud_only: false, question_set_id: 'set', ...extra });
const activityReading = (id = 'r1') => ({ id, user_id: USER, room_id: 'room', material_id: 'mat', activity_assignment_id: 'act' });
const activityAttempt = (id, completedAt, oral = 'r1') => attempt(id, completedAt, { room_id: 'room', material_id: 'mat', activity_assignment_id: 'act', oral_reading_attempt_id: oral });

test('a read-aloud-only activity completes from its reading and never needs an M6 assessment', () => {
  const only = activity({ read_aloud_only: true, question_set_id: null });
  assert.equal(deriveActivityProgress(only, [], []).status, 'Not Started');
  assert.equal(deriveActivityProgress({ ...only, status: 'completed' }, [], []).status, 'Not Started', 'a status with no saved reading is not completion');
  assert.equal(deriveActivityProgress(only, [activityReading()], []).status, 'Oral Reading Saved', 'saved, but M4 has not recorded completion yet');
  const done = deriveActivityProgress({ ...only, status: 'completed' }, [activityReading()], []);
  assert.equal(done.status, 'Completed');
  assert.equal(done.comprehensionAttemptId, null);
});

test('an activity with questions completes only from its completed M6 assessment', () => {
  const withQuestions = activity();
  assert.equal(deriveActivityProgress({ ...withQuestions, status: 'completed' }, [activityReading()], []).status, 'Oral Reading Saved', 'a reading alone, or a stale status, is not enough');
  assert.equal(deriveActivityProgress(withQuestions, [activityReading()], [activityAttempt('a', null)]).status, 'Comprehension In Progress');
  assert.equal(deriveActivityProgress(withQuestions, [activityReading()], [activityAttempt('a', '2026-10-02T00:00:00Z')]).status, 'Completed');
  // Repeated readings and an extra saved attempt still make one completed activity.
  const repeated = deriveActivityProgress(withQuestions, [activityReading(), activityReading('r2')], [activityAttempt('a', '2026-10-02T00:00:00Z'), activityAttempt('b', '2026-10-03T00:00:00Z', 'r2')]);
  assert.equal(repeated.status, 'Completed');
});

test('activities a Teacher removed are not owed work in M7; Teacher, Admin and personal views agree', async () => {
  const kept = activity({ id: 'kept' });
  const removed = activity({ id: 'gone', removed_at: '2026-10-05T00:00:00Z' });
  assert.deepEqual(activeMaterialAssignments([kept, removed]), [kept]);
  const before = { profiles: adminData().profiles, rooms: adminData().rooms, enrollments: adminData().enrollments, reading_activity_assignments: [kept, removed] };
  const data = await loadAdminData({ rows: memoryRows(before), quizzes: async () => [] }, new Set(before.profiles.map((p) => p.id)));
  assert.deepEqual(data.assignments.map((row) => row.id), ['kept']);
  assert.equal(buildAdminStudents(data)[0].completion.assigned, 1);
  assert.equal(before.reading_activity_assignments.length, 2, 'nothing is changed');
  const source = (name) => require('node:fs').readFileSync(require.resolve(`../services/${name}`), 'utf8');
  assert.match(source('m7Analytics'), /activeMaterialAssignments\(assignments\)/);
  assert.match(source('teacherCompletionAnalytics'), /activeMaterialAssignments\(assignments\)/);
});

// ---- Repeated M5 readings in the Teacher review ----
test('a repeated reading finds the canonical assessment; every reading stays its own record', () => {
  const key = { module_id: 'mod', passage_id: 'p1', room_id: 'room', assignment_id: 'rm', material_id: null, activity_assignment_id: null, user_id: USER };
  const oral = [{ id: 'r1', ...key, completed_at: '2026-10-01T00:00:00Z' }, { id: 'r2', ...key, completed_at: '2026-10-09T00:00:00Z' }, { id: 'r3', ...key, passage_id: 'p2', completed_at: '2026-10-09T00:00:00Z' }];
  const rows = [moduleAttempt('canon', 'p1', '2026-10-02T00:00:00Z', { oral_reading_attempt_id: 'r1' }), moduleAttempt('extra', 'p1', null, { oral_reading_attempt_id: 'r2', created_at: '2026-10-09T00:00:00Z' })];
  const matches = matchComprehensionAttempts(oral, rows);
  assert.equal(matches.get('r1').id, 'canon');
  assert.equal(matches.get('r2').id, 'canon', 'not its own unfinished extra attempt');
  assert.equal(matches.has('r3'), false, 'another passage is another activity');
});

// ---- Interventions ----
test('a malformed intervention ID is not found, not a server error, and reaches no database write', async () => {
  let authorized = 0;
  for (const bad of ['not-a-uuid', "1' or 1=1", '12345']) {
    await assert.rejects(analytics.saveIntervention('author', 'student', bad, {}, { authorize: async () => { authorized++; } }), { statusCode: 404, message: 'Intervention not found.' });
  }
  assert.equal(authorized, 3, 'authorization still runs first');
});
