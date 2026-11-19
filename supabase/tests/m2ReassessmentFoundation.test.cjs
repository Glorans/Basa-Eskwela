// Disposable in-memory PostgreSQL only. Never connects to a Supabase project.
// Rehearses m2_reassessment_foundation_PROPOSED.sql (on top of m2_assessment_packages_PROPOSED.sql) and its ROLLBACK
// against a fixture that copies the LIVE definitions of diagnostic_results (columns, constraints, indexes, the DT1
// protection trigger and the M8 sync trigger with its helper functions), rooms and enrollments.
const { PGlite } = require('../../server/node_modules/@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const read = (f) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const PACKAGES = read('proposed/m2_assessment_packages_PROPOSED.sql');
const FOUNDATION = read('proposed/m2_reassessment_foundation_PROPOSED.sql');
const ROLLBACK = read('proposed/m2_reassessment_foundation_ROLLBACK_PROPOSED.sql');
const VERIFY = read('proposed/m2_reassessment_foundation_VERIFY_READONLY.sql');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SA = id(1), ADMIN = id(2), TEACHER = id(3), OTHER_TEACHER = id(4), PENDING_TEACHER = id(5);
const STUDENT = id(6), STUDENT2 = id(7), LEARNER = id(8), OUTSIDER = id(9);
const ROOM = id(50), OTHER_ROOM = id(51), ARCHIVED_ROOM = id(52);

const { LIVE_FIXTURE } = require('./fixtures/liveDiagnosticFixture.cjs');

const PEOPLE = [[SA, 'system_admin', null], [ADMIN, 'admin', null], [TEACHER, 'teacher', 'approved'], [OTHER_TEACHER, 'teacher', 'approved'],
  [PENDING_TEACHER, 'teacher', 'pending'], [STUDENT, 'student', null], [STUDENT2, 'student', null], [LEARNER, 'general_user', null], [OUTSIDER, 'student', null]];

async function db() {
  const d = new PGlite();
  await d.exec(LIVE_FIXTURE);
  for (const [uid, role, status] of PEOPLE) {
    await d.query('insert into auth.users values ($1)', [uid]);
    await d.query('insert into profiles(id, role, teacher_status) values ($1, $2, $3)', [uid, role, status]);
  }
  await d.query(`insert into rooms(id, teacher_id, room_name, room_code) values ($1, $2, 'Room A', 'A1'), ($3, $4, 'Room B', 'B1')`, [ROOM, TEACHER, OTHER_ROOM, OTHER_TEACHER]);
  await d.query(`insert into rooms(id, teacher_id, room_name, room_code, archived_at, archived_by) values ($1, $2, 'Old', 'C1', now(), $2)`, [ARCHIVED_ROOM, TEACHER]);
  await d.query('insert into enrollments(room_id, student_id) values ($1, $2), ($1, $3), ($4, $5), ($6, $2)', [ROOM, STUDENT, STUDENT2, OTHER_ROOM, OUTSIDER, ARCHIVED_ROOM]);
  // Existing initial results (server-verified, as on Staging) for both languages.
  for (const [n, uid, lang, level, tier] of [[1, STUDENT, 'en', 'Frustration', 'Easy'], [2, STUDENT, 'fil', 'Instructional', 'Medium'], [3, LEARNER, 'en', 'Frustration', 'Easy'], [4, STUDENT2, 'en', 'Independent', 'Hard']]) {
    await d.query(`insert into diagnostic_results(id, user_id, language, assessment_id, assessment_version, orv_score, comprehension_score, reading_level, difficulty_tier,
      verification_status, verification_method, verification_recording_id, verified_at)
      values ($1, $2, $3, $4, '3.0', 80, 50, $5, $6, 'server_verified', 'server_stt_receipt_v1', $7, now() - interval '30 days')`,
      [id(100 + n), uid, lang, `grade5-${lang}-passage-v3`, level, tier, id(200 + n)]);
  }
  return d;
}
const install = async (d) => { await d.exec(PACKAGES); await d.exec(FOUNDATION); };
const fails = (promise, pattern) => assert.rejects(promise, pattern);
const failsScript = async (d, sql, pattern) => { await assert.rejects(d.exec(sql), pattern); await d.exec('rollback'); };
const fingerprint = async (d) => (await d.query(`select md5(string_agg(id::text || reading_level || difficulty_tier || orv_score::text || comprehension_score::text
  || assessment_type || coalesce(assessment_id,'') || coalesce(assessment_version,'') || verification_status || coalesce(verified_at::text,''), ',' order by id)) h,
  count(*)::int n from diagnostic_results where assessment_type = 'initial'`)).rows[0];
const gates = (d, official = true, independent = false, days = null) =>
  d.query('update m2_reassessment_settings set official_reassessment_enabled = $1, independent_learner_enabled = $2, independent_min_days_between = $3', [official, independent, days]);

const question = (n, type) => ({ id: `q${n}`, type, prompt: `Question ${n}?`, correctChoiceId: 'a', choices: ['a', 'b', 'c', 'd'].map((c) => ({ id: c, label: `Choice ${c}` })) });
const QUESTIONS = [question(1, 'literal'), question(2, 'literal'), question(3, 'inferential'), question(4, 'inferential'), question(5, 'inferential'), question(6, 'critical')];
const PARAGRAPHS = ['Ana walked to the river with her small brown dog early in the morning.', 'They watched the fish swim under the old bridge until the sun was high and warm.'];

/** A package with one version taken to `upTo` ('draft' | 'in_review' | 'approved' | 'published'), optionally endorsed. */
async function version(d, { category = 'teacher', owner = TEACHER, language = 'en', upTo = 'published', endorse = true } = {}) {
  const shape = { teacher: ['reassessment', 'classroom', 'teacher'], school: ['reassessment', 'classroom', 'school'], independent: ['reassessment', 'independent_learners', 'platform'] }[category];
  const { rows: [p] } = await d.query(`insert into m2_assessment_packages(kind, audience, scope, owner_id, language, title) values ($1,$2,$3,$4,$5,'Pkg') returning id`, [...shape, owner, language]);
  const { rows: [v] } = await d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by, passage_title, paragraphs, questions)
    values ($1, 1, '1.0', $2, 'Story', $3, $4) returning id`, [p.id, owner, JSON.stringify(PARAGRAPHS), JSON.stringify(QUESTIONS)]);
  const steps = ['in_review', 'approved', 'published'];
  for (const step of steps.slice(0, steps.indexOf(upTo) + 1)) {
    if (step === 'in_review') await d.query(`update m2_assessment_package_versions set status = 'in_review', submitted_by = $2 where id = $1`, [v.id, owner]);
    if (step === 'approved') await d.query(`update m2_assessment_package_versions set status = 'approved', reviewed_by = $2, educator_review_attestation = 'Library approval' where id = $1`, [v.id, ADMIN]);
    if (step === 'published') await d.query('select m2_publish_assessment_version($1, $2)', [v.id, owner]);
    if (step === 'in_review' && endorse) {
      await d.query(`insert into m2_assessment_educator_reviews(version_id, reviewer_name, reviewer_qualification, reviewed_on, passage_suitable, questions_sound,
        answer_keys_correct, language_accurate, outcome, recorded_by) values ($1, 'Reviewer', 'Grade 5 reading teacher (stated)', current_date, true, true, true, true, 'endorsed', $2)`, [v.id, ADMIN]);
    }
  }
  return { packageId: p.id, versionId: v.id };
}
const assign = (d, versionId, { student = STUDENT, room = ROOM, by = TEACHER, kind = 'classroom' } = {}) =>
  d.query(`insert into m2_reassessment_assignments(package_version_id, package_id, language, kind, room_id, student_id, assigned_by)
    select $1, package_id, 'en', $2, $3, $4, $5 from m2_assessment_package_versions where id = $1 returning id`, [versionId, kind, room, student, by]);
const resultPayload = (overrides = {}) => JSON.stringify({ language: 'en', orv_score: 97, comprehension_score: 83.3, reading_level: 'Independent',
  difficulty_tier: 'Hard', reading_speed_wpm: 110, transcript: 'synthetic', stt_confidence: 0.9, oral_reading_metrics: { comprehensionAnswers: { q1: 'a' } },
  verification_method: 'server_stt_receipt_v1', verification_recording_id: id(Math.floor(Math.random() * 1e9)), ...overrides });
const record = (d, assignment, user = STUDENT, payload = resultPayload()) =>
  d.query('select m2_record_reassessment_result($1, $2, $3::jsonb) id', [assignment, user, payload]);

test('install on the live shape: initial results unchanged, gates off, second run refused, verify passes', async () => {
  const d = await db();
  const before = await fingerprint(d);
  await install(d);
  assert.deepEqual(await fingerprint(d), before, 'no existing initial result is rewritten');
  assert.deepEqual((await d.query('select official_reassessment_enabled o, independent_learner_enabled i from m2_reassessment_settings')).rows[0], { o: false, i: false });
  await failsScript(d, FOUNDATION, /already \(partly\) installed/);
  const results = (await d.exec(VERIFY)).find((r) => r.fields?.some((f) => f.name === 'result'));
  assert.ok(results.rows.length >= 14);
  assert.deepEqual(results.rows.filter((r) => r.result !== 'PASS'), [], 'every verify check passes');
});

test('gates off: no assignment and no result can be created, even with an endorsed published version', async () => {
  const d = await db(); await install(d);
  const { versionId } = await version(d);
  await fails(assign(d, versionId), /Reassessment is not enabled/);
  await fails(d.query('update m2_reassessment_settings set independent_learner_enabled = true, independent_min_days_between = 30'), /m2_independent_needs_official/);
  await fails(d.query('update m2_reassessment_settings set official_reassessment_enabled = true, independent_learner_enabled = true'), /m2_independent_needs_interval/);
  await d.exec('set role service_role');
  await fails(gates(d), /permission denied/, 'the backend cannot switch the gate on');
  await d.exec('reset role');
});

test('assignment boundaries: approval, endorsement, ownership, room, enrollment, roles, Independent Learners', async () => {
  const d = await db(); await install(d); await gates(d);
  for (const upTo of ['draft', 'in_review', 'approved']) {
    const { versionId } = await version(d, { upTo });
    await fails(assign(d, versionId), /Only a published version/, upTo);
  }
  const unendorsed = await version(d, { endorse: false });
  await fails(assign(d, unendorsed.versionId), /no documented educator endorsement/);
  const own = await version(d);
  await fails(assign(d, own.versionId, { room: OTHER_ROOM, student: OUTSIDER, by: OTHER_TEACHER }), /only be assigned in that Teacher's Learning Rooms/);
  await fails(assign(d, own.versionId, { room: OTHER_ROOM, student: OUTSIDER, by: ADMIN }), /only be assigned in that Teacher's Learning Rooms/, 'School Admin cannot move a private package to another room');
  await fails(assign(d, own.versionId, { student: OUTSIDER }), /not enrolled/);
  await fails(assign(d, own.versionId, { room: ARCHIVED_ROOM }), /active Learning Room/);
  await fails(assign(d, own.versionId, { by: OTHER_TEACHER }), /Only the room's approved Teacher or a School Admin/);
  await fails(assign(d, own.versionId, { by: PENDING_TEACHER }), /Only the room's approved Teacher or a School Admin/);
  await fails(assign(d, own.versionId, { by: STUDENT }), /Only the room's approved Teacher or a School Admin/);
  const school = await version(d, { category: 'school', owner: ADMIN });
  await assign(d, school.versionId, { room: OTHER_ROOM, student: OUTSIDER, by: OTHER_TEACHER });
  await assign(d, own.versionId, { by: ADMIN });
  const il = await version(d, { category: 'independent', owner: SA });
  await fails(assign(d, il.versionId, { student: STUDENT2 }), /Independent Learner packages cannot be assigned in a classroom/);
  await fails(assign(d, il.versionId, { kind: 'independent', room: null, student: LEARNER, by: LEARNER }), /Independent Learner reassessment is not enabled/);
  await gates(d, true, true, 30);
  await fails(assign(d, il.versionId, { kind: 'independent', room: null, student: LEARNER, by: SA }), /for themselves/);
  await fails(assign(d, own.versionId, { kind: 'independent', room: null, student: LEARNER, by: LEARNER }), /for themselves/, 'IL cannot take classroom packages');
  await assign(d, il.versionId, { kind: 'independent', room: null, student: LEARNER, by: LEARNER });
});

test('duplicates: one active reassessment per learner per language; never the same version twice; English and Filipino separate', async () => {
  const d = await db(); await install(d); await gates(d);
  const a = await version(d); const b = await version(d);
  const fil = await version(d, { language: 'fil' });
  const { rows: [first] } = await assign(d, a.versionId);
  await fails(assign(d, b.versionId), /m2_one_active_reassessment_per_language/);
  await d.query(`insert into m2_reassessment_assignments(package_version_id, package_id, language, kind, room_id, student_id, assigned_by)
    select id, package_id, 'fil', 'classroom', $2, $3, $4 from m2_assessment_package_versions where id = $1`, [fil.versionId, ROOM, STUDENT, TEACHER]);
  const langs = (await d.query('select language from m2_reassessment_assignments where student_id = $1 order by language', [STUDENT])).rows.map((r) => r.language);
  assert.deepEqual(langs, ['en', 'fil'], 'language comes from the package, not the caller');
  await d.query(`update m2_reassessment_assignments set status = 'cancelled', cancelled_by = $2, cancel_reason = 'Wrong room' where id = $1`, [first.id, TEACHER]);
  await assign(d, b.versionId);
  await fails(d.query(`update m2_reassessment_assignments set status = 'active', cancelled_at = null, cancel_reason = null where id = $1`, [first.id]), /permanent records/);
});

test('recording: only through the function, exact version + fingerprint, assignment completed, no second result', async () => {
  const d = await db(); await install(d); await gates(d);
  const v = await version(d);
  const { rows: [a] } = await assign(d, v.versionId);
  await d.exec('set role service_role');
  await fails(d.query(`insert into diagnostic_results(user_id, assessment_type, language, assessment_id, assessment_version, orv_score, comprehension_score, reading_level, difficulty_tier,
    verification_status, verification_method, verification_recording_id, verified_at, package_version_id, content_sha256, reassessment_assignment_id)
    values ($1, 'reassessment', 'en', 'x', '1.0', 1, 1, 'Independent', 'Hard', 'server_verified', 'm', $2, now(), $3, $4, $5)`,
    [STUDENT, id(999), v.versionId, 'a'.repeat(64), a.id]), /recorded only by m2_record_reassessment_result/);
  await fails(d.query(`update m2_reassessment_assignments set status = 'completed', result_id = $2, completed_at = now() where id = $1`, [a.id, id(101)]), /completed only by recording/);
  await fails(d.query('delete from m2_reassessment_assignments where id = $1', [a.id]), /permission denied/);
  await fails(record(d, a.id, STUDENT2), /Assignment not found/, 'another learner cannot use the assignment');
  await fails(record(d, a.id, STUDENT, resultPayload({ language: 'fil' })), /language does not match/);
  const { rows: [r] } = await record(d, a.id);
  await d.exec('reset role');
  const row = (await d.query('select * from diagnostic_results where id = $1', [r.id])).rows[0];
  const ver = (await d.query('select * from m2_assessment_package_versions where id = $1', [v.versionId])).rows[0];
  assert.deepEqual([row.assessment_type, row.assessment_id, row.assessment_version, row.package_version_id, row.content_sha256, row.reassessment_assignment_id, row.verification_status],
    ['reassessment', v.packageId, '1.0', v.versionId, ver.content_sha256, a.id, 'server_verified']);
  const done = (await d.query('select status, result_id from m2_reassessment_assignments where id = $1', [a.id])).rows[0];
  assert.deepEqual([done.status, done.result_id], ['completed', r.id]);
  await d.exec('set role service_role');
  await fails(record(d, a.id), /already been completed/);
  await fails(d.query(`update diagnostic_results set content_sha256 = $2 where id = $1`, [r.id, 'b'.repeat(64)]), /cannot change/);
  await fails(d.query('update diagnostic_results set reading_level = $2 where id = $1', [r.id, 'Frustration']), /cannot be modified/);
  await fails(d.query('delete from diagnostic_results where id = $1', [r.id]), /kept as history/);
  await fails(d.query(`update m2_assessment_package_versions set paragraphs = '[]' where id = $1`, [v.versionId]), /Only draft content/);
  await d.exec('reset role');
});

test('recording is refused for cancelled, unenrolled, archived-room, retired, withdrawn-endorsement and gate-off cases', async () => {
  const d = await db(); await install(d); await gates(d);
  const make = async (student = STUDENT) => { const v = await version(d); const { rows: [a] } = await assign(d, v.versionId, { student }); return { ...v, a: a.id }; };
  let c = await make();
  await d.query(`update m2_reassessment_assignments set status = 'cancelled', cancelled_by = $2, cancel_reason = 'x' where id = $1`, [c.a, TEACHER]);
  await fails(record(d, c.a), /already been completed or cancelled/);
  c = await make(STUDENT2);
  await d.query('delete from enrollments where room_id = $1 and student_id = $2', [ROOM, STUDENT2]);
  await fails(record(d, c.a, STUDENT2), /no longer active for this Student/);
  c = await make();
  await d.query(`update m2_assessment_package_versions set status = 'retired', retired_by = $2 where id = $1`, [c.versionId, TEACHER]);
  await fails(record(d, c.a), /no longer approved for official use/);
  await d.query(`update m2_reassessment_assignments set status = 'cancelled', cancelled_by = $2, cancel_reason = 'x' where id = $1`, [c.a, TEACHER]);
  c = await make();
  await d.query(`insert into m2_assessment_educator_reviews(version_id, reviewer_name, reviewer_qualification, reviewed_on, passage_suitable, questions_sound,
    answer_keys_correct, language_accurate, outcome, recorded_by) values ($1, 'Reviewer', 'Teacher', current_date, true, true, false, true, 'changes_requested', $2)`, [c.versionId, ADMIN]);
  await fails(record(d, c.a), /no longer approved for official use/);
  await d.query(`update m2_reassessment_assignments set status = 'cancelled', cancelled_by = $2, cancel_reason = 'x' where id = $1`, [c.a, TEACHER]);
  c = await make();
  await d.query('update rooms set archived_at = now(), archived_by = $2 where id = $1', [ROOM, TEACHER]);
  await fails(record(d, c.a), /no longer active for this Student/);
  await d.query('update rooms set archived_at = null, archived_by = null where id = $1', [ROOM]);
  await gates(d, false);
  await fails(record(d, c.a), /Reassessment is not enabled/);
});

test('current reading level: equals the initial result today; a recorded reassessment becomes current; M8 input stays initial-only', async () => {
  const d = await db(); await install(d);
  const level = async (u, l) => (await d.query('select * from m2_current_reading_level($1, $2)', [u, l])).rows[0];
  // Parity with today's M3 lookup (exact v3.0 initial row) for every learner and language with a result.
  const pairs = (await d.query(`select user_id, language, reading_level, difficulty_tier, id from diagnostic_results`)).rows;
  for (const p of pairs) {
    const cur = await level(p.user_id, p.language);
    assert.deepEqual([cur.result_id, cur.reading_level, cur.difficulty_tier, cur.assessment_type], [p.id, p.reading_level, p.difficulty_tier, 'initial']);
  }
  assert.equal(await level(STUDENT2, 'fil'), undefined, 'no result in a language means no level (languages are separate)');
  assert.equal((await d.query('select m2_initial_diagnostic_completed($1, $2) ok', [STUDENT, 'en'])).rows[0].ok, true);
  assert.equal((await d.query('select m2_initial_diagnostic_completed($1, $2) ok', [STUDENT2, 'fil'])).rows[0].ok, false);
  // Completion does not depend on the active version (a future initial 4.0 must not force a retake).
  await d.query(`update diagnostic_results set assessment_version = assessment_version where false`);

  await gates(d);
  const v = await version(d);
  const { rows: [a] } = await assign(d, v.versionId);
  const progressBefore = (await d.query('select unlocked_difficulty from m8_learner_progress where user_id = $1', [STUDENT])).rows[0];
  const { rows: [r] } = await record(d, a.id);
  const cur = await level(STUDENT, 'en');
  assert.deepEqual([cur.result_id, cur.assessment_type, cur.reading_level, cur.package_version_id], [r.id, 'reassessment', 'Independent', v.versionId]);
  assert.equal((await level(STUDENT, 'fil')).assessment_type, 'initial', 'Filipino is unaffected by an English reassessment');
  assert.equal((await d.query(`select m2_trusted_reading_level($1, 'en') l`, [STUDENT])).rows[0].l, 'Frustration', 'M8 still reads the initial result');
  assert.equal((await d.query('select m2_initial_diagnostic_completed($1, $2) ok', [STUDENT, 'en'])).rows[0].ok, true);
  // KNOWN M8 DEPENDENCY (documented, not changed): the live trigger awards level_up for any verified Instructional/Independent row.
  const badges = (await d.query(`select badge_id from m8_earned_badges where user_id = $1`, [STUDENT])).rows.map((x) => x.badge_id);
  assert.deepEqual(badges, ['level_up'], 'this is why the gate must stay off until the adviser decides M8 behaviour');
  const progressAfter = (await d.query('select unlocked_difficulty from m8_learner_progress where user_id = $1', [STUDENT])).rows[0];
  assert.equal(progressAfter.unlocked_difficulty, progressBefore?.unlocked_difficulty ?? 'Medium', 'unlocked difficulty still follows initial results only');
});

test('unverified rows never count; browser roles cannot reach assignments, settings or the functions', async () => {
  const d = await db(); await install(d);
  await d.exec(`alter table diagnostic_results disable trigger diagnostic_results_protect_verification;
    insert into diagnostic_results(user_id, language, assessment_id, assessment_version, orv_score, comprehension_score, reading_level, difficulty_tier, verified_at, completed_at)
    values ('${STUDENT2}', 'fil', 'grade5-fil-passage-v3', '3.0', 1, 1, 'Independent', 'Hard', null, now());
    alter table diagnostic_results enable trigger diagnostic_results_protect_verification;`);
  assert.equal((await d.query('select * from m2_current_reading_level($1, $2)', [STUDENT2, 'fil'])).rows.length, 0);
  assert.equal((await d.query('select m2_initial_diagnostic_completed($1, $2) ok', [STUDENT2, 'fil'])).rows[0].ok, false);
  await d.exec('set role authenticated');
  for (const sql of ['select * from m2_reassessment_assignments', 'select * from m2_reassessment_settings',
    `select m2_current_reading_level('${STUDENT}', 'en')`, `select m2_record_reassessment_result('${id(1)}', '${STUDENT}', '{}'::jsonb)`]) {
    await fails(d.query(sql), /permission denied/, sql);
  }
  await d.exec('reset role');
});

test('account and room deletion keep working: assignments follow the learner; a deleted room leaves history', async () => {
  const d = await db(); await install(d); await gates(d);
  const v = await version(d);
  const v2 = await version(d);
  const { rows: [a] } = await assign(d, v.versionId);
  await record(d, a.id);
  await assign(d, v2.versionId, { student: STUDENT2 });
  // Deleting the Teacher's account cascades to the room (as today); assignments keep their history with room NULL.
  await d.query('delete from auth.users where id = $1', [TEACHER]);
  const rows = (await d.query('select student_id, room_id, assigned_by, status from m2_reassessment_assignments order by student_id')).rows;
  assert.deepEqual(rows.map((r) => [r.room_id, r.assigned_by, r.status]), [[null, null, 'completed'], [null, null, 'active']]);
  // Deleting a learner removes their assignment and reassessment result together, as initial results today.
  await d.query('delete from auth.users where id = $1', [STUDENT]);
  assert.equal((await d.query('select count(*)::int n from m2_reassessment_assignments where student_id = $1', [STUDENT])).rows[0].n, 0);
  assert.equal((await d.query('select count(*)::int n from diagnostic_results where user_id = $1', [STUDENT])).rows[0].n, 0);
});

test('rollback: refused while assignments or results exist; otherwise restores the initial-only shape exactly', async () => {
  const d = await db();
  const before = await fingerprint(d);
  const shape = async () => (await d.query(`select string_agg(column_name, ',' order by ordinal_position) c from information_schema.columns where table_name = 'diagnostic_results'`)).rows[0].c;
  const constraint = async () => (await d.query(`select pg_get_constraintdef(oid) c from pg_constraint where conname = 'diagnostic_results_assessment_type_check'`)).rows[0].c;
  const [columns, check] = [await shape(), await constraint()];
  await install(d);
  await gates(d);
  const v = await version(d);
  await assign(d, v.versionId);
  await failsScript(d, ROLLBACK, /reassessment assignments exist/);
  const clean = await db();
  const cleanBefore = await fingerprint(clean);
  await install(clean);
  await clean.exec(ROLLBACK);
  assert.equal(await (async () => (await clean.query(`select string_agg(column_name, ',' order by ordinal_position) c from information_schema.columns where table_name = 'diagnostic_results'`)).rows[0].c)(), columns);
  assert.equal((await clean.query(`select pg_get_constraintdef(oid) c from pg_constraint where conname = 'diagnostic_results_assessment_type_check'`)).rows[0].c, check);
  assert.deepEqual(await fingerprint(clean), cleanBefore);
  assert.deepEqual(await fingerprint(d), before, 'the refused rollback changed nothing');
  assert.equal((await clean.query(`select to_regclass('public.m2_reassessment_assignments') t`)).rows[0].t, null);
  await clean.exec(FOUNDATION);
});
