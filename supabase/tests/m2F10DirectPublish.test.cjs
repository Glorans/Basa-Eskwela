// Disposable in-memory PostgreSQL only. Rehearses m2_f10_direct_publish_PROPOSED.sql (on top of the packages and
// reassessment foundation proposals), its VERIFY and its ROLLBACK. Synthetic content only.
const { PGlite } = require('../../server/node_modules/@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { LIVE_FIXTURE } = require('./fixtures/liveDiagnosticFixture.cjs');

const read = (f) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const PACKAGES = read('proposed/m2_assessment_packages_PROPOSED.sql');
const FOUNDATION = read('proposed/m2_reassessment_foundation_PROPOSED.sql');
const CHANGE = read('proposed/m2_f10_direct_publish_PROPOSED.sql');
const ROLLBACK = read('proposed/m2_f10_direct_publish_ROLLBACK_PROPOSED.sql');
const VERIFY = read('proposed/m2_f10_direct_publish_VERIFY_READONLY.sql');
const ORIGINAL = { 'm2_guard_assessment_version()': '08cc2107fb3e37fbf2fe48e4af0d992d', 'm2_publish_assessment_version(uuid,uuid)': '94a15859e110ab4cd13686fadf8b2428',
  'm2_guard_reassessment_assignment()': '63d5b2129f2432f9e3da6f3b570703d8', 'm2_record_reassessment_result(uuid,uuid,jsonb)': 'e055f14f89b18c4d8301b4e3f8904601' };
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SA = id(1), ADMIN = id(2), TEACHER = id(3), OTHER_TEACHER = id(4), STUDENT = id(6), LEARNER = id(8);
const ROOM = id(50), OTHER_ROOM = id(51);
const question = (n, type) => ({ id: `q${n}`, type, prompt: `Question ${n}?`, correctChoiceId: 'a', choices: ['a', 'b', 'c', 'd'].map((c) => ({ id: c, label: `Choice ${c}` })) });
const QUESTIONS = [question(1, 'literal'), question(2, 'literal'), question(3, 'inferential'), question(4, 'inferential'), question(5, 'inferential'), question(6, 'critical')];
const PARAGRAPHS = ['Ana walked to the river with her small brown dog early in the morning.', 'They watched the fish swim under the old bridge until the sun was high and warm.'];
const SHAPES = { teacher: ['reassessment', 'classroom', 'teacher'], school: ['reassessment', 'classroom', 'school'], independent: ['reassessment', 'independent_learners', 'platform'],
  initial: ['initial', 'all_learners', 'platform'] };

async function db({ change = true } = {}) {
  const d = new PGlite();
  await d.exec(LIVE_FIXTURE);
  for (const [uid, role, status] of [[SA, 'system_admin', null], [ADMIN, 'admin', null], [TEACHER, 'teacher', 'approved'], [OTHER_TEACHER, 'teacher', 'approved'],
    [STUDENT, 'student', null], [LEARNER, 'general_user', null]]) {
    await d.query('insert into auth.users values ($1)', [uid]);
    await d.query('insert into profiles(id, role, teacher_status) values ($1, $2, $3)', [uid, role, status]);
  }
  await d.query(`insert into rooms(id, teacher_id, room_name, room_code) values ($1, $2, 'Room A', 'A1'), ($3, $4, 'Room B', 'B1')`, [ROOM, TEACHER, OTHER_ROOM, OTHER_TEACHER]);
  await d.query('insert into enrollments(room_id, student_id) values ($1, $2)', [ROOM, STUDENT]);
  await d.query(`insert into diagnostic_results(id, user_id, language, assessment_id, assessment_version, orv_score, comprehension_score, reading_level, difficulty_tier,
    verification_status, verification_method, verification_recording_id, verified_at)
    values ($1, $2, 'en', 'grade5-en-passage-v3', '3.0', 80, 50, 'Frustration', 'Easy', 'server_verified', 'server_stt_receipt_v1', $3, now() - interval '30 days')`, [id(101), STUDENT, id(201)]);
  await d.exec(PACKAGES);
  await d.exec(FOUNDATION);
  if (change) await d.exec(CHANGE);
  return d;
}
async function draft(d, { category = 'teacher', owner = TEACHER, questions = QUESTIONS } = {}) {
  const { rows: [p] } = await d.query(`insert into m2_assessment_packages(kind, audience, scope, owner_id, language, title) values ($1,$2,$3,$4,'en','Pkg') returning id`, [...SHAPES[category], owner]);
  const { rows: [v] } = await d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by, passage_title, paragraphs, questions)
    values ($1, 1, '1.0', $2, 'Story', $3, $4) returning id`, [p.id, owner, JSON.stringify(PARAGRAPHS), JSON.stringify(questions)]);
  return { packageId: p.id, versionId: v.id };
}
const publish = (d, v, actor = TEACHER) => d.query('select m2_publish_assessment_version($1, $2)', [v, actor]);
const row = async (d, v) => (await d.query('select status, content_sha256, published_at, reviewed_at, submitted_at from m2_assessment_package_versions where id = $1', [v])).rows[0];
const gates = (d, official, independent = false) => d.query('update m2_reassessment_settings set official_reassessment_enabled = $1, independent_learner_enabled = $2', [official, independent]);
const assign = (d, v, { by = TEACHER, room = ROOM } = {}) => d.query(`insert into m2_reassessment_assignments(package_version_id, package_id, language, kind, room_id, student_id, assigned_by)
  select $1, package_id, 'en', 'classroom', $2, $3, $4 from m2_assessment_package_versions where id = $1 returning id`, [v, room, STUDENT, by]);
const payload = () => JSON.stringify({ language: 'en', orv_score: 97, comprehension_score: 83.3, reading_level: 'Independent', difficulty_tier: 'Hard', reading_speed_wpm: 110,
  transcript: 'synthetic', stt_confidence: 0.9, oral_reading_metrics: { comprehensionAnswers: { q1: 'a' } }, verification_method: 'server_stt_receipt_v1', verification_recording_id: id(777) });
const md5s = async (d) => Object.fromEntries((await d.query(`select p.oid::regprocedure::text sig, md5(prosrc) m from pg_proc p
  where p.oid in (${Object.keys(ORIGINAL).map((s) => `'public.${s}'::regprocedure`).join(',')})`)).rows.map((r) => [r.sig.replace('public.', '').replace(/ /g, ''), r.m]));
const verify = async (d) => (await d.exec(VERIFY)).find((r) => r.fields?.some((f) => f.name === 'result')).rows;
const initialResults = async (d) => (await d.query(`select md5(string_agg(id::text || reading_level || orv_score::text, ',' order by id)) h from diagnostic_results`)).rows[0].h;
const runFails = async (d, sql, pattern) => { await assert.rejects(d.exec(sql), pattern); await d.exec('rollback'); };

test('preflight matches the live bodies; apply passes VERIFY; switches untouched; a second run is refused', async () => {
  const before = await db({ change: false });
  assert.deepEqual(await md5s(before), ORIGINAL, 'the rehearsal starts from the live bodies');
  const d = await db();
  const rows = await verify(d);
  assert.ok(rows.length >= 18);
  assert.deepEqual(rows.filter((r) => r.result !== 'PASS'), []);
  assert.deepEqual((await d.query('select official_reassessment_enabled o, independent_learner_enabled i from m2_reassessment_settings')).rows[0], { o: false, i: false });
  await runFails(d, CHANGE, /STOP: m2_guard_assessment_version\(\) is not the reviewed original/);
});

test('Teacher, School Admin and System Admin packages publish straight from draft, validated and frozen, with no review or endorsement', async () => {
  const d = await db();
  for (const [category, owner] of [['teacher', TEACHER], ['school', ADMIN], ['independent', SA]]) {
    const { versionId } = await draft(d, { category, owner });
    await publish(d, versionId, owner);
    const r = await row(d, versionId);
    assert.equal(r.status, 'published', category);
    assert.match(r.content_sha256, /^[0-9a-f]{64}$/, 'content frozen');
    assert.ok(r.published_at);
    assert.equal(r.reviewed_at, null, 'no approval was invented');
    assert.equal(r.submitted_at, null, 'no submission was invented');
    await assert.rejects(d.query(`update m2_assessment_package_versions set paragraphs = '["changed"]' where id = $1`, [versionId]), /Only draft content can be edited/);
  }
  assert.equal((await d.query('select count(*)::int n from m2_assessment_educator_reviews')).rows[0].n, 0);
  assert.equal((await d.query('select count(*)::int n from m2_reassessment_assignments')).rows[0].n, 0, 'publishing never assigns');
});

test('incomplete drafts cannot be published; a new publish retires the previous version atomically; a submitted version can be published', async () => {
  const d = await db();
  const bad = await draft(d, { questions: QUESTIONS.slice(0, 2) });
  await assert.rejects(publish(d, bad.versionId), /not ready to publish/);
  assert.equal((await row(d, bad.versionId)).status, 'draft');
  const first = await draft(d);
  await publish(d, first.versionId);
  const { rows: [v2] } = await d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by, passage_title, paragraphs, questions)
    values ($1, 2, '2.0', $2, 'Story 2', $3, $4) returning id`, [first.packageId, TEACHER, JSON.stringify(PARAGRAPHS), JSON.stringify(QUESTIONS)]);
  await d.query(`update m2_assessment_package_versions set status = 'in_review', submitted_by = $2 where id = $1`, [v2.id, TEACHER]);
  await publish(d, v2.id);
  assert.deepEqual([(await row(d, first.versionId)).status, (await row(d, v2.id)).status], ['retired', 'published']);
  await d.query(`update m2_assessment_packages set archived_at = now() where id = $1`, [bad.packageId]);
  await assert.rejects(publish(d, bad.versionId), /cannot be published/, 'archived packages stay read-only');
});

test('the initial diagnostic keeps draft -> in_review -> approved -> published (F6 unchanged)', async () => {
  const d = await db();
  const { versionId } = await draft(d, { category: 'initial', owner: SA });
  await assert.rejects(publish(d, versionId, SA), /cannot be published/);
  await assert.rejects(d.query(`update m2_assessment_package_versions set status = 'published', published_by = $2 where id = $1`, [versionId, SA]), /cannot move from draft to published/);
  await d.query(`update m2_assessment_package_versions set status = 'in_review', submitted_by = $2 where id = $1`, [versionId, SA]);
  await assert.rejects(publish(d, versionId, SA), /cannot be published/);
  await assert.rejects(d.query(`update m2_assessment_package_versions set status = 'approved', reviewed_by = $2 where id = $1`, [versionId, SA]), /attestation/);
  await d.query(`update m2_assessment_package_versions set status = 'approved', reviewed_by = $2, educator_review_attestation = 'ok' where id = $1`, [versionId, SA]);
  await publish(d, versionId, SA);
  assert.equal((await row(d, versionId)).status, 'published');
});

test('assignment and results: no endorsement needed, but the switch, room ownership and published status are still enforced', async () => {
  const d = await db();
  const before = await initialResults(d);
  const { versionId } = await draft(d);
  await publish(d, versionId);
  await assert.rejects(assign(d, versionId), /Reassessment is not enabled/, 'switch off: refused');
  await gates(d, true);
  await assert.rejects(assign(d, versionId, { by: OTHER_TEACHER, room: OTHER_ROOM }), /.+/, 'another Teacher\'s room is refused');
  const { rows: [a] } = await assign(d, versionId);
  const { rows: [r] } = await d.query('select m2_record_reassessment_result($1, $2, $3::jsonb) id', [a.id, STUDENT, payload()]);
  assert.ok(r.id, 'result recorded without an educator endorsement');
  assert.equal(await initialResults(d) === before, false, 'one reassessment result added');
  assert.equal((await d.query(`select count(*)::int n from diagnostic_results where assessment_type = 'initial'`)).rows[0].n, 1, 'initial results untouched');
  const second = await draft(d);
  await publish(d, second.versionId);
  await assign(d, second.versionId);
  await assert.rejects(assign(d, second.versionId), /.+/, 'one active assignment per Student and language is still enforced');
  const third = await draft(d);
  await assert.rejects(assign(d, third.versionId), /Only a published version/, 'an unpublished version cannot be assigned');
});

test('rollback: refused while a version published without review exists; otherwise restores the original bodies byte-for-byte', async () => {
  const d = await db();
  const { versionId } = await draft(d);
  await publish(d, versionId);
  await runFails(d, ROLLBACK, /published without review evidence/);
  assert.equal((await row(d, versionId)).status, 'published', 'nothing was changed');
  assert.deepEqual((await verify(d)).filter((r) => r.result !== 'PASS'), []);

  const clean = await db();
  await clean.exec(ROLLBACK);
  assert.deepEqual(await md5s(clean), ORIGINAL);
  const again = await draft(clean);
  await assert.rejects(publish(clean, again.versionId), /Only an approved version/, 'review stage required again');
  await assert.rejects(clean.exec(ROLLBACK), /nothing to roll back/);
});

test('assignment roles: a School Admin assigns school packages only; a Teacher only their own package, in their own rooms', async () => {
  const d = await db();
  await gates(d, true);
  const teacherPkg = await draft(d);
  await publish(d, teacherPkg.versionId);
  await assert.rejects(assign(d, teacherPkg.versionId, { by: ADMIN }), /School Admin for school packages/, 'School Admin cannot assign a Teacher package');
  const otherPkg = await draft(d, { owner: OTHER_TEACHER });
  await publish(d, otherPkg.versionId, OTHER_TEACHER);
  await assert.rejects(assign(d, otherPkg.versionId, { by: TEACHER }), /only be assigned in that Teacher's Learning Rooms/, 'another Teacher\'s package is refused');
  await assert.rejects(assign(d, otherPkg.versionId, { by: OTHER_TEACHER }), /that Teacher's Learning Rooms|Only the room's approved Teacher/, 'a Teacher cannot assign in another Teacher\'s room');
  const schoolPkg = await draft(d, { category: 'school', owner: ADMIN });
  await publish(d, schoolPkg.versionId, ADMIN);
  const { rows: [a] } = await assign(d, schoolPkg.versionId, { by: ADMIN });
  assert.ok(a.id, 'School Admin assigns a school package');
  await d.query(`update m2_reassessment_assignments set status = 'cancelled', cancelled_by = $2, cancel_reason = 'rehearsal' where id = $1`, [a.id, ADMIN]);
  const { rows: [b] } = await assign(d, teacherPkg.versionId, { by: TEACHER });
  assert.ok(b.id, 'the Teacher assigns their own package in their own room');
});
