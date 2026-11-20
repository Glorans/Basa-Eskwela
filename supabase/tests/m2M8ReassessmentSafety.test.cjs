// Disposable in-memory PostgreSQL only. Rehearses m2_m8_reassessment_safety_PROPOSED.sql on top of the packages,
// reassessment foundation and Independent Learner eligibility proposals, on a fixture carrying the LIVE (byte-identical)
// m8_sync_diagnostic and m8_badge_eligible. Covers Students (classroom) and Independent Learners (independent), English
// and Filipino, and every initial -> reassessment level transition the adviser asked about.
const { PGlite } = require('../../server/node_modules/@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { LIVE_FIXTURE } = require('./fixtures/liveDiagnosticFixture.cjs');

const read = (f) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const BASE = ['proposed/m2_assessment_packages_PROPOSED.sql', 'proposed/m2_reassessment_foundation_PROPOSED.sql',
  'proposed/m2_independent_reassessment_eligibility_PROPOSED.sql'].map(read);
const SAFETY = read('proposed/m2_m8_reassessment_safety_PROPOSED.sql');
const ROLLBACK = read('proposed/m2_m8_reassessment_safety_ROLLBACK_PROPOSED.sql');
const VERIFY = read('proposed/m2_m8_reassessment_safety_VERIFY_READONLY.sql');
const LIVE_MD5 = { m8_sync_diagnostic: '2ebfdd77f8a38176c66f396d56ec3146', m8_badge_eligible: '890ab04a84fdb83ce271ba6a7b9fd9dd' };
let seq = 0;
const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const SA = id(), TEACHER = id(), ROOM = id();
const TIER = { Frustration: 'Easy', Instructional: 'Medium', Independent: 'Hard' };
const QUESTIONS = ['literal', 'literal', 'inferential', 'inferential', 'inferential', 'critical'].map((type, i) => ({
  id: `q${i + 1}`, type, prompt: `Q${i + 1}?`, correctChoiceId: 'a', choices: ['a', 'b', 'c', 'd'].map((c) => ({ id: c, label: c })) }));
const PARAGRAPHS = ['Ana walked to the river with her small brown dog early in the morning.', 'They watched the fish swim under the old bridge until the sun was high and warm.'];
const SCENARIOS = [
  ['Frustration', 'Instructional', 'improved'], ['Instructional', 'Independent', 'improved'], ['Independent', 'Instructional', 'lower'],
  ['Instructional', 'Instructional', 'unchanged'], ['Frustration', 'Frustration', 'unchanged'],
];

async function db({ safety = true } = {}) {
  const d = new PGlite();
  await d.exec(LIVE_FIXTURE);
  for (const [uid, role, status] of [[SA, 'system_admin', null], [TEACHER, 'teacher', 'approved']]) {
    await d.query('insert into auth.users values ($1)', [uid]);
    await d.query('insert into profiles(id, role, teacher_status) values ($1, $2, $3)', [uid, role, status]);
  }
  await d.query(`insert into rooms(id, teacher_id, room_name, room_code) values ($1, $2, 'Room', 'R')`, [ROOM, TEACHER]);
  for (const m of BASE) await d.exec(m);
  if (safety) await d.exec(SAFETY);
  await d.query(`update m2_reassessment_settings set official_reassessment_enabled = true, independent_learner_enabled = true, independent_min_days_between = 30`);
  return d;
}
async function learner(d, role) {
  const uid = id();
  await d.query('insert into auth.users values ($1)', [uid]);
  await d.query('insert into profiles(id, role) values ($1, $2)', [uid, role]);
  if (role === 'student') await d.query('insert into enrollments(room_id, student_id) values ($1, $2)', [ROOM, uid]);
  return uid;
}
async function initial(d, uid, language, level, daysAgo = 60) {
  await d.query(`insert into diagnostic_results(user_id, language, assessment_id, assessment_version, orv_score, comprehension_score, reading_level, difficulty_tier,
    verification_status, verification_method, verification_recording_id, verified_at) values ($1, $2, $3, '3.0', 90, 60, $4, $5, 'server_verified', 'server_stt_receipt_v1', $6, now() - make_interval(days => $7))`,
  [uid, language, `grade5-${language}-passage-v3`, level, TIER[level], id(), daysAgo]);
}
async function publishedVersion(d, { audience, scope, owner, language }) {
  const { rows: [p] } = await d.query(`insert into m2_assessment_packages(kind, audience, scope, owner_id, language, title) values ('reassessment',$1,$2,$3,$4,'P') returning id`, [audience, scope, owner, language]);
  const { rows: [v] } = await d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by, passage_title, paragraphs, questions)
    values ($1, 1, '1.0', $2, 'Story', $3, $4) returning id`, [p.id, owner, JSON.stringify(PARAGRAPHS), JSON.stringify(QUESTIONS)]);
  await d.query(`update m2_assessment_package_versions set status = 'in_review', submitted_by = $2 where id = $1`, [v.id, owner]);
  await d.query(`update m2_assessment_package_versions set status = 'approved', reviewed_by = $2, educator_review_attestation = 'Library' where id = $1`, [v.id, SA]);
  await d.query('select m2_publish_assessment_version($1, $2)', [v.id, owner]);
  await d.query(`insert into m2_assessment_educator_reviews(version_id, reviewer_name, reviewer_qualification, reviewed_on, passage_suitable, questions_sound,
    answer_keys_correct, language_accurate, outcome, recorded_by) values ($1, 'R', 'Teacher (stated)', current_date, true, true, true, true, 'endorsed', $2)`, [v.id, SA]);
  return { packageId: p.id, versionId: v.id };
}
/** Records an official reassessment through the protected function, exactly as the backend does. */
async function reassess(d, uid, role, language, level) {
  const classroom = role === 'student';
  const v = await publishedVersion(d, classroom ? { audience: 'classroom', scope: 'teacher', owner: TEACHER, language }
    : { audience: 'independent_learners', scope: 'platform', owner: SA, language });
  const { rows: [a] } = await d.query(`insert into m2_reassessment_assignments(package_version_id, package_id, language, kind, room_id, student_id, assigned_by)
    values ($1, $2, $3, $4, $5, $6, $7) returning id`, [v.versionId, v.packageId, language, classroom ? 'classroom' : 'independent', classroom ? ROOM : null, uid, classroom ? TEACHER : uid]);
  const { rows: [r] } = await d.query('select m2_record_reassessment_result($1, $2, $3::jsonb) id', [a.id, uid, JSON.stringify({
    language, orv_score: 98, comprehension_score: 83.3, reading_level: level, difficulty_tier: TIER[level],
    verification_method: 'server_stt_receipt_v1', verification_recording_id: id() })]);
  return r.id;
}
const m8 = async (d, uid) => (await d.query(`select
    (select coalesce(string_agg(badge_id || '@' || earned_at, ',' order by badge_id), '') from m8_earned_badges where user_id = $1) badges,
    (select coalesce(string_agg(id::text || ':' || xp_earned, ',' order by id), '') from m8_xp_events where user_id = $1) xp,
    (select unlocked_difficulty || '@' || updated_at from m8_learner_progress where user_id = $1) progress,
    m8_badge_eligible($1, 'level_up') level_up_eligible, m2_trusted_reading_level($1, 'en') trusted_en, m2_trusted_reading_level($1, 'fil') trusted_fil`, [uid])).rows[0];
const current = async (d, uid, lang) => (await d.query('select * from m2_current_reading_level($1, $2)', [uid, lang])).rows[0];

for (const role of ['student', 'general_user']) {
  for (const language of ['en', 'fil']) {
    test(`${role} ${language}: every transition leaves XP, badges and unlocked difficulty exactly as they were; the change is classified`, async () => {
      const d = await db();
      const other = language === 'en' ? 'fil' : 'en';
      for (const [from, to, direction] of SCENARIOS) {
        const uid = await learner(d, role);
        await initial(d, uid, language, from);
        await initial(d, uid, other, 'Frustration');
        // Pre-existing reward records (earned earlier) must survive untouched.
        await d.query(`insert into m8_xp_events(user_id, source_type, xp_earned) values ($1, 'module', 50)`, [uid]);
        const before = await m8(d, uid);
        const otherBefore = await current(d, uid, other);
        const resultId = await reassess(d, uid, role, language, to);
        const after = await m8(d, uid);
        assert.deepEqual(after, before, `${from} -> ${to}: no XP, badge, unlock or eligibility change`);
        const change = (await d.query('select * from m2_reading_level_change($1)', [resultId])).rows[0];
        assert.deepEqual([change.language, change.previous_level, change.new_level, change.direction], [language, from, to, direction], `${from} -> ${to}`);
        const cur = await current(d, uid, language);
        assert.deepEqual([cur.assessment_type, cur.reading_level], ['reassessment', to], 'the latest official level is available to an approved placement policy');
        assert.deepEqual(await current(d, uid, other), otherBefore, `${other} unaffected`);
        assert.equal((await d.query('select m2_initial_diagnostic_completed($1, $2) ok', [uid, language])).rows[0].ok, true, 'initial completion kept');
        assert.equal((await d.query(`select count(*)::int n from diagnostic_results where user_id = $1 and assessment_type = 'initial'`, [uid])).rows[0].n, 2, 'initial history kept');
      }
    });
  }
}

test('contrast: WITHOUT the safety migration the live M8 code awards level_up and changes unlocks for a reassessment', async () => {
  const d = await db({ safety: false });
  const uid = await learner(d, 'student');
  await initial(d, uid, 'en', 'Frustration');
  const before = await m8(d, uid);
  assert.equal(before.level_up_eligible, false);
  await reassess(d, uid, 'student', 'en', 'Instructional');
  const after = await m8(d, uid);
  assert.match(after.badges, /level_up/, 'the live trigger awards level_up for the reassessment');
  assert.equal(after.level_up_eligible, true, 'the live eligibility counts the reassessment');
});

test('initial diagnostics keep the EXACT existing M8 behaviour (level_up and unlocked difficulty) with the safety migration', async () => {
  const outcome = async (safety) => {
    const d = await db({ safety });
    const rows = [];
    for (const [en, fil] of [['Frustration', 'Frustration'], ['Instructional', 'Frustration'], ['Frustration', 'Independent'], ['Independent', 'Instructional']]) {
      const uid = await learner(d, 'general_user');
      await initial(d, uid, 'en', en);
      await initial(d, uid, 'fil', fil);
      const s = await m8(d, uid);
      rows.push([s.badges.replace(/@[^,]*/g, ''), s.progress.replace(/@.*/, ''), s.level_up_eligible]);
    }
    return rows;
  };
  const live = await outcome(false);
  assert.deepEqual(await outcome(true), live, 'identical to the live behaviour for initial results');
  assert.deepEqual(live, [['', 'Easy', false], ['level_up', 'Medium', true], ['level_up', 'Hard', true], ['level_up', 'Hard', true]]);
});

test('preflight refuses unknown M8 code; second run refused; verify passes; backend cannot flip the placement switch', async () => {
  const d = new PGlite();
  await d.exec(LIVE_FIXTURE);
  for (const m of BASE) await d.exec(m);
  await d.exec(`create or replace function public.m8_sync_diagnostic() returns trigger language plpgsql security definer set search_path = '' as $f$ begin return new; end $f$`);
  await assert.rejects(d.exec(SAFETY), /m8_sync_diagnostic differs from the reviewed version/);
  await d.exec('rollback');
  const ok = await db();
  await assert.rejects(ok.exec(SAFETY), /already \(partly\) installed/);
  await ok.exec('rollback');
  const res = (await ok.exec(VERIFY)).find((r) => r.fields?.some((f) => f.name === 'result'));
  assert.deepEqual(res.rows.filter((r) => r.result !== 'PASS'), []);
  assert.equal(res.rows.length, 7);
  await ok.exec('set role service_role');
  await assert.rejects(ok.query('update m2_reassessment_settings set placement_follows_reassessment = true'), /permission denied/);
  await ok.query(`select * from m2_reading_level_change('${id()}')`); // the backend may call it (read-only)
  await ok.exec('reset role; set role authenticated');
  await assert.rejects(ok.query(`select * from m2_reading_level_change('${id()}')`), /permission denied/, 'browsers may not');
  await ok.exec('reset role');
});

test('rollback restores the reviewed M8 functions byte-for-byte; refused while reassessments exist or the switch is on', async () => {
  const d = await db();
  await d.query('update m2_reassessment_settings set placement_follows_reassessment = true');
  await assert.rejects(d.exec(ROLLBACK), /switch placement_follows_reassessment off/);
  await d.exec('rollback');
  await d.query('update m2_reassessment_settings set placement_follows_reassessment = false');
  const uid = await learner(d, 'student');
  await initial(d, uid, 'en', 'Frustration');
  await reassess(d, uid, 'student', 'en', 'Independent');
  await assert.rejects(d.exec(ROLLBACK), /reassessment results exist/);
  await d.exec('rollback');
  const clean = await db();
  await clean.exec(ROLLBACK);
  const md5 = Object.fromEntries((await clean.query(`select proname, md5(prosrc) m from pg_proc where proname in ('m8_sync_diagnostic', 'm8_badge_eligible')`)).rows.map((r) => [r.proname, r.m]));
  assert.deepEqual(md5, LIVE_MD5);
  assert.equal((await clean.query(`select to_regprocedure('public.m2_reading_level_change(uuid)') f`)).rows[0].f, null);
  await clean.exec(SAFETY);
});
