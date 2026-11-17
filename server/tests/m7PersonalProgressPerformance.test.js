// GET /api/analytics/personal performance (Student and Independent Learner Progress & Result): the learner's
// comprehension attempts are read once without the story text, classroom work runs alongside the comprehension
// reads, and Independent Learners skip classroom reads. Responses must stay exactly as before.
// In-memory data and mocked authorization only.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

delete process.env.M7_RISK_WORKER_ENABLED;
const oral = require('../services/oralReadingAttemptService');
const supabaseAdmin = require('../services/supabaseAdmin');
let requester = null;
let db = null;
// Mocked before the routes load, because routes and services keep the functions they import.
test.mock.method(oral, 'authorizeOralReadingRequest', async () => requester);
test.mock.method(supabaseAdmin, 'getSupabaseAdmin', () => db);
const analytics = require('../services/m7Analytics');
const router = require('../routes/m7Analytics');
const { datasets, makeDb, callPersonal } = require('./fixtures/m7PersonalProgress');

// SHA-256 of each full response computed by the implementation BEFORE this optimization (GitHub main d1ed12a)
// on the same datasets. Any change to a field, value, order, null or empty list changes the fingerprint.
const BEFORE = {
  'student: no readings or quizzes': '7fb4abc8d7be4a23f35d0af9a26b7375dffe3a4efebf69e3e6b432d011bbae43',
  'student: completed quizzes, English + Filipino': '38b4b1c8437a647c601bd54fbf7e91a759d0e83f3c685234c9e1151a027862c1',
  'student: incomplete assignments (materials + modules, removed, selected, unpublished, deleted)': 'b3202b22751283465dbd1940ac7716ab2ea8dba96ddbfb43e793ed8769a3a62e',
  'student: multiple learning rooms': '29d6c36cc91b502322aaa30dd468b69fcef852d82171aa4c253f47179588daf6',
  'student: several attempts for the same activity (historical, not counted)': 'b1f95f495eaad0fca3acfbbc4f131bc843b951fd2a0e70c575f94abec1b52052',
  'student: missing or incomplete optional data': '2afe4b29c048017f0895ad9c0e8c70d4fc6d826bd8cdad1b2b23b46bd945edb3',
  'student: large history (hundreds of records, many pages)': 'b4de92c27c0f37c79ce95d383d193d12d20effe4fdf16c3bda47184ba59b3fbe',
  'independent learner: no history': '7fb4abc8d7be4a23f35d0af9a26b7375dffe3a4efebf69e3e6b432d011bbae43',
  'independent learner: personal reading history (modules + own materials)': '17e175352e19105b6fe588e2069bcc2df4ff0ab378da380efaecc17a64ba363a',
  'independent learner: leftover classroom rows are ignored': 'a493dba714c7aa22ff807caaf70af56d2b2774e1c6a18d5a23c857f71638b9bb',
  'independent learner: large history': 'b20a3bac7d610247daed21c67cca02c3d9c08183871a3e3c1bcc679227e484dd',
  // Updated 2026-11-17 (Student personal reading and comprehension): a Student's reading or quiz without a
  // classroom is no longer attributed to a Teacher. Verified: the new output equals the old output computed with
  // this fixture's 15 classroom-less readings and 7 classroom-less quizzes removed. Staging had no Student reading
  // or quiz without a classroom. Previous value: f468dd3b300f8edd5ff5c6d9f3d3a69255d083b9199dedf29ba3db840fde7cf5
  'teacher analytics (regression guard)': '483d1505290a01925d694b38ace140b99bb10dc263ab0b74e875b5a477783609',
};
const fingerprint = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const all = datasets();
const named = (name) => all.find((ds) => ds.name === name);
async function run(ds, options) {
  db = makeDb(ds.tables, options);
  requester = { user: { id: ds.userId }, profile: { id: ds.userId, role: ds.role } };
  return ds.role === 'teacher' ? analytics.teacher(ds.userId) : callPersonal(router);
}
const CLASSROOM_TABLES = ['reading_activity_assignments', 'enrollments', 'uploaded_materials', 'room_modules', 'modules', 'room_module_recipients', 'module_passages', 'comprehension_questions'];

test('every response is identical to the implementation before this optimization', async () => {
  assert.equal(all.length, Object.keys(BEFORE).length);
  for (const ds of all) assert.equal(fingerprint(await run(ds)), BEFORE[ds.name], ds.name);
});

test('the identical responses carry real results (counts, scores, statuses, not-counted and invalid evidence)', async () => {
  const several = (await run(named('student: several attempts for the same activity (historical, not counted)'))).body.data;
  assert.deepEqual([several.quizzes.length, several.historicalQuizzes.length, several.activities.length], [6, 5, 6]);
  assert.ok(several.historicalQuizzes.every((q) => q.notCounted === true));
  const missing = (await run(named('student: missing or incomplete optional data'))).body.data;
  assert.equal(missing.summary.invalidCompletedQuizzes, 1);
  assert.equal(missing.summary.comprehensionScore, null, 'no average over invalid evidence');
  const rooms = (await run(named('student: multiple learning rooms'))).body.data;
  assert.deepEqual([...new Set(rooms.activities.map((a) => a.status))].sort(),
    ['Completed', 'Comprehension In Progress', 'In Progress', 'Not Started', 'Oral Reading Saved']);
  assert.equal(rooms.summary.comprehensionScore, 83.31);
  const large = (await run(named('student: large history (hundreds of records, many pages)'))).body.data;
  assert.deepEqual([large.readings.length, large.quizzes.length + large.historicalQuizzes.length], [420, 245]);
});

test('a learner\'s comprehension attempts are read once, with the columns used and without the story text', async () => {
  for (const ds of all.filter((d) => d.role !== 'teacher')) {
    await run(ds);
    const reads = db.log.filter((e) => e.table === 'm6_comprehension_attempts');
    const attempts = ds.tables.m6_comprehension_attempts.length;
    // One keyset read: its pages (100 rows each) plus the final empty page. Before: three reads, two with '*'.
    assert.equal(reads.length, attempts === 0 ? 1 : Math.ceil(attempts / 100) + 1, ds.name);
    for (const read of reads) {
      assert.equal(read.columns, 'id,module_id,passage_id,assignment_id,room_id,material_id,activity_assignment_id,oral_reading_attempt_id,status,created_at,completed_at,user_id,passage_title,question_snapshot', ds.name);
    }
    assert.ok(!db.log.some((e) => e.columns === '*' && e.table === 'm6_comprehension_attempts'));
  }
});

test('classroom work starts while the comprehension reads are still running', async () => {
  await run(named('student: multiple learning rooms'), { delays: { m6_comprehension_responses: 25 } });
  const responses = db.log.filter((e) => e.table === 'm6_comprehension_responses');
  const firstModuleRead = db.log.find((e) => e.table === 'room_modules');
  // Before, room_modules was read only after every comprehension read had finished.
  assert.ok(firstModuleRead.started < Math.max(...responses.map((e) => e.ended)));
});

test('Independent Learners read no classroom tables; Students still get their activities', async () => {
  for (const ds of all.filter((d) => d.role === 'general_user')) {
    const response = await run(ds);
    assert.deepEqual(response.body.data.activities, [], ds.name);
    assert.deepEqual(db.log.filter((e) => CLASSROOM_TABLES.includes(e.table)), [], ds.name);
  }
  // The skip follows the verified server-side profile, never the request: the same records as a Student.
  const leftover = named('independent learner: leftover classroom rows are ignored');
  const asStudent = await run({ ...leftover, role: 'student' });
  assert.equal(asStudent.body.data.activities.length > 0, true);
  assert.ok(db.log.some((e) => e.table === 'enrollments'));
});

test('a failed read still fails the whole request, with no unhandled rejection', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    for (const table of ['enrollments', 'room_modules', 'uploaded_materials', 'm6_comprehension_attempts', 'm6_comprehension_responses', 'oral_reading_attempts']) {
      const response = await run(named('student: multiple learning rooms'), { failures: { [table]: true }, delays: { m6_comprehension_responses: 5 } });
      assert.equal(response.status, 500, table);
      assert.equal(response.body.success, false, table);
      assert.match(response.body.message, /Unable to load or save analytics/, table);
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
