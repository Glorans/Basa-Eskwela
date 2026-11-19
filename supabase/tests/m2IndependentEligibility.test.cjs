// Disposable in-memory PostgreSQL only. Rehearses m2_independent_reassessment_eligibility_PROPOSED.sql (on top of the
// packages + reassessment foundation proposals) on a copy of the live diagnostic_results shape, and its ROLLBACK.
const { PGlite } = require('../../server/node_modules/@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { LIVE_FIXTURE } = require('./fixtures/liveDiagnosticFixture.cjs');

const read = (f) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const PACKAGES = read('proposed/m2_assessment_packages_PROPOSED.sql');
const FOUNDATION = read('proposed/m2_reassessment_foundation_PROPOSED.sql');
const ELIGIBILITY = read('proposed/m2_independent_reassessment_eligibility_PROPOSED.sql');
const ROLLBACK = read('proposed/m2_independent_reassessment_eligibility_ROLLBACK_PROPOSED.sql');
const VERIFY = read('proposed/m2_independent_reassessment_eligibility_VERIFY_READONLY.sql');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SA = id(1), ADMIN = id(2), TEACHER = id(3), STUDENT = id(6), IL = id(8), IL2 = id(9), IL3 = id(10), ROOM = id(50);
const QUESTIONS = ['literal', 'literal', 'inferential', 'inferential', 'inferential', 'critical'].map((type, i) => ({
  id: `q${i + 1}`, type, prompt: `Q${i + 1}?`, correctChoiceId: 'a', choices: ['a', 'b', 'c', 'd'].map((c) => ({ id: c, label: c })) }));
const PARAGRAPHS = ['Ana walked to the river with her small brown dog early in the morning.', 'They watched the fish swim under the old bridge until the sun was high and warm.'];

async function db() {
  const d = new PGlite();
  await d.exec(LIVE_FIXTURE);
  for (const [uid, role, status] of [[SA, 'system_admin', null], [ADMIN, 'admin', null], [TEACHER, 'teacher', 'approved'], [STUDENT, 'student', null],
    [IL, 'general_user', null], [IL2, 'general_user', null], [IL3, 'general_user', null]]) {
    await d.query('insert into auth.users values ($1)', [uid]);
    await d.query('insert into profiles(id, role, teacher_status) values ($1, $2, $3)', [uid, role, status]);
  }
  await d.query(`insert into rooms(id, teacher_id, room_name, room_code) values ($1, $2, 'Room', 'R')`, [ROOM, TEACHER]);
  await d.query('insert into enrollments(room_id, student_id) values ($1, $2)', [ROOM, STUDENT]);
  // IL: initial English 40 days ago. IL2: initial English 2 days ago. IL3: no initial. STUDENT: initial English.
  for (const [n, uid, days] of [[1, IL, 40], [2, IL2, 2], [3, STUDENT, 40]]) {
    await d.query(`insert into diagnostic_results(user_id, language, assessment_id, assessment_version, orv_score, comprehension_score, reading_level, difficulty_tier,
      verification_status, verification_method, verification_recording_id, verified_at) values ($1, 'en', 'grade5-en-passage-v3', '3.0', 80, 50, 'Frustration', 'Easy',
      'server_verified', 'server_stt_receipt_v1', $2, now() - make_interval(days => $3))`, [uid, id(900 + n), days]);
  }
  await d.exec(PACKAGES);
  await d.exec(FOUNDATION);
  await d.exec(ELIGIBILITY);
  return d;
}
const fails = (p, pattern) => assert.rejects(p, pattern);
const failsScript = async (d, sql, pattern) => { await assert.rejects(d.exec(sql), pattern); await d.exec('rollback'); };

async function version(d, { audience = 'independent_learners', scope = 'platform', owner = SA, language = 'en' } = {}) {
  const { rows: [p] } = await d.query(`insert into m2_assessment_packages(kind, audience, scope, owner_id, language, title) values ('reassessment',$1,$2,$3,$4,'P') returning id`, [audience, scope, owner, language]);
  const { rows: [v] } = await d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by, passage_title, paragraphs, questions)
    values ($1, 1, '1.0', $2, 'Story', $3, $4) returning id`, [p.id, owner, JSON.stringify(PARAGRAPHS), JSON.stringify(QUESTIONS)]);
  await d.query(`update m2_assessment_package_versions set status = 'in_review', submitted_by = $2 where id = $1`, [v.id, owner]);
  await d.query(`update m2_assessment_package_versions set status = 'approved', reviewed_by = $2, educator_review_attestation = 'Library' where id = $1`, [v.id, SA]);
  await d.query('select m2_publish_assessment_version($1, $2)', [v.id, owner]);
  await d.query(`insert into m2_assessment_educator_reviews(version_id, reviewer_name, reviewer_qualification, reviewed_on, passage_suitable, questions_sound,
    answer_keys_correct, language_accurate, outcome, recorded_by) values ($1, 'R', 'Teacher (stated)', current_date, true, true, true, true, 'endorsed', $2)`, [v.id, SA]);
  return v.id;
}
const selfStart = (d, v, learner = IL, language = 'en') => d.query(`insert into m2_reassessment_assignments(package_version_id, package_id, language, kind, student_id, assigned_by)
  select $1, package_id, $3, 'independent', $2, $2 from m2_assessment_package_versions where id = $1 returning id`, [v, learner, language]);
const gates = (d, official, independent, days) => d.query(`update m2_reassessment_settings set official_reassessment_enabled = $1,
  independent_learner_enabled = $2, independent_min_days_between = $3`, [official, independent, days]);

test('install: refuses a second run; verify passes with Independent Learner reassessment OFF and the interval UNSET', async () => {
  const d = await db();
  await failsScript(d, ELIGIBILITY, /already installed/);
  const result = (await d.exec(VERIFY)).find((r) => r.fields?.some((f) => f.name === 'result'));
  assert.deepEqual(result.rows.filter((r) => r.result !== 'PASS'), []);
  assert.equal(result.rows.length, 4);
});

test('default state refuses every self-start (gates off, interval unset)', async () => {
  const d = await db();
  const v = await version(d);
  await fails(selfStart(d, v), /Reassessment is not enabled/);
  await gates(d, true, false, null);
  await fails(selfStart(d, v), /Independent Learner reassessment is not enabled/);
  await fails(gates(d, true, true, null), /m2_independent_needs_interval/, 'IL cannot be switched on without an interval');
});

test('eligibility: initial diagnostic in the language required; waiting interval since the latest official result', async () => {
  const d = await db();
  const v = await version(d);
  const fil = await version(d, { language: 'fil' });
  await gates(d, true, true, 30);
  await fails(selfStart(d, v, IL3), /Complete the initial diagnostic in this language first/);
  await fails(selfStart(d, fil, IL, 'fil'), /Complete the initial diagnostic in this language first/, 'English initial does not unlock Filipino');
  await fails(selfStart(d, v, IL2), /waiting interval/, 'initial result only 2 days old');
  await selfStart(d, v, IL);
  // A client-supplied language cannot sneak past the check: the package's language is used.
  await fails(selfStart(d, fil, IL, 'en'), /Complete the initial diagnostic in this language first/);
  // The interval is configurable: 1 day lets IL2 start.
  await gates(d, true, true, 1);
  await selfStart(d, v, IL2);
});

test('package and role boundaries stay enforced by the Phase 2 guard; classroom assignments are unaffected', async () => {
  const d = await db();
  await gates(d, true, true, 30);
  const classroom = await version(d, { audience: 'classroom', scope: 'teacher', owner: TEACHER });
  const ilPkg = await version(d);
  await fails(selfStart(d, classroom, IL), /for themselves|Independent Learners start only/, 'a Teacher package is never self-started');
  await fails(selfStart(d, ilPkg, STUDENT), /for themselves|Independent Learners start only/, 'a Student cannot self-start');
  await fails(d.query(`insert into m2_reassessment_assignments(package_version_id, package_id, language, kind, student_id, assigned_by)
    select $1, package_id, 'en', 'independent', $2, $3 from m2_assessment_package_versions where id = $1`, [ilPkg, IL, SA]), /for themselves/, 'a System Admin cannot start it for them');
  // Classroom assignment for a Student: not subject to the Independent Learner interval (initial only 40 days ago anyway, but the rule is not applied).
  await d.query(`insert into m2_reassessment_assignments(package_version_id, package_id, language, kind, room_id, student_id, assigned_by)
    select $1, package_id, 'en', 'classroom', $2, $3, $4 from m2_assessment_package_versions where id = $1`, [classroom, ROOM, STUDENT, TEACHER]);
});

test('duplicates: one active per language; the same version never twice; a recorded result restarts the interval', async () => {
  const d = await db();
  await gates(d, true, true, 30);
  const v1 = await version(d);
  const v2 = await version(d);
  const { rows: [a] } = await selfStart(d, v1);
  await fails(selfStart(d, v2), /m2_one_active_reassessment_per_language/);
  await fails(selfStart(d, v1), /m2_one_active_reassessment_per_language|m2_one_assignment_per_version/);
  // Record the result through the protected function: the assignment completes and a new official result exists now.
  await d.query(`select m2_record_reassessment_result($1, $2, $3::jsonb)`, [a.id, IL, JSON.stringify({ language: 'en', orv_score: 95, comprehension_score: 83.3,
    reading_level: 'Instructional', difficulty_tier: 'Medium', verification_method: 'server_stt_receipt_v1', verification_recording_id: id(990) })]);
  await fails(selfStart(d, v1), /m2_one_assignment_per_version|waiting interval/, 'a completed version is never taken again (refused by the interval first, then the unique index)');
  await fails(selfStart(d, v2), /waiting interval/, 'the new reassessment result restarts the waiting interval');
});

test('rollback removes only the trigger; data stays; re-apply works', async () => {
  const d = await db();
  await gates(d, true, true, 30);
  const v = await version(d);
  await selfStart(d, v);
  await d.exec(ROLLBACK);
  assert.equal((await d.query(`select to_regprocedure('public.m2_check_independent_eligibility()') f`)).rows[0].f, null);
  assert.equal((await d.query('select count(*)::int n from m2_reassessment_assignments')).rows[0].n, 1, 'no data removed');
  await failsScript(d, ROLLBACK, /not installed/);
  await d.exec(ELIGIBILITY);
});
