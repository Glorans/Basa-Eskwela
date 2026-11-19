// Disposable in-memory PostgreSQL only. Rehearses m2_initial_activation_PROPOSED.sql (on top of the packages proposal)
// and its ROLLBACK, on the live diagnostic_results fixture. Synthetic content only.
const { PGlite } = require('../../server/node_modules/@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { LIVE_FIXTURE } = require('./fixtures/liveDiagnosticFixture.cjs');

const read = (f) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const PACKAGES = read('proposed/m2_assessment_packages_PROPOSED.sql');
const ACTIVATION = read('proposed/m2_initial_activation_PROPOSED.sql');
const ROLLBACK = read('proposed/m2_initial_activation_ROLLBACK_PROPOSED.sql');
const VERIFY = read('proposed/m2_initial_activation_VERIFY_READONLY.sql');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SA = id(1), SA2 = id(2), ADMIN = id(3), TEACHER = id(4);
const QUESTIONS = ['literal', 'literal', 'inferential', 'inferential', 'inferential', 'critical'].map((type, i) => ({
  id: `q${i + 1}`, type, prompt: `Q${i + 1}?`, correctChoiceId: 'a', choices: ['a', 'b', 'c', 'd'].map((c) => ({ id: c, label: c })) }));
const PARAGRAPHS = ['Ana walked to the river with her small brown dog early in the morning.', 'They watched the fish swim under the old bridge until the sun was high and warm.'];

async function db() {
  const d = new PGlite();
  await d.exec(LIVE_FIXTURE);
  for (const [uid, role, status] of [[SA, 'system_admin', null], [SA2, 'system_admin', null], [ADMIN, 'admin', null], [TEACHER, 'teacher', 'approved']]) {
    await d.query('insert into auth.users values ($1)', [uid]);
    await d.query('insert into profiles(id, role, teacher_status) values ($1, $2, $3)', [uid, role, status]);
  }
  await d.exec(PACKAGES);
  await d.exec(ACTIVATION);
  return d;
}
const fails = (p, pattern) => assert.rejects(p, pattern);
/** The initial lineage for a language (imported 3.0) plus an authored version taken to `upTo`. */
async function lineage(d, language, { label = '4.0', upTo = 'published', endorse = true } = {}) {
  const legacy = `grade5-${language}-passage-v3`;
  let pkg = (await d.query('select id from m2_assessment_packages where legacy_assessment_id = $1', [legacy])).rows[0]?.id;
  if (!pkg) {
    pkg = (await d.query(`insert into m2_assessment_packages(kind, audience, scope, owner_id, language, title, legacy_assessment_id) values ('initial','all_learners','platform',$1,$2,'Initial',$3) returning id`, [SA, language, legacy])).rows[0].id;
    await d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, status, source, created_by, published_by, passage_title, paragraphs, questions)
      values ($1, 1, '3.0', 'published', 'code_import', $2, $2, 'Story', $3, $4)`, [pkg, SA, JSON.stringify(PARAGRAPHS), JSON.stringify(QUESTIONS)]);
  }
  const n = (await d.query('select coalesce(max(version_number), 0) + 1 n from m2_assessment_package_versions where package_id = $1', [pkg])).rows[0].n;
  const { rows: [v] } = await d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by, passage_title, paragraphs, questions)
    values ($1, $2, $3, $4, 'Story', $5, $6) returning id`, [pkg, n, label, SA, JSON.stringify(PARAGRAPHS), JSON.stringify(QUESTIONS)]);
  if (upTo !== 'draft') {
    await d.query(`update m2_assessment_package_versions set status = 'in_review', submitted_by = $2 where id = $1`, [v.id, SA]);
    await d.query(`update m2_assessment_package_versions set status = 'approved', reviewed_by = $2, educator_review_attestation = 'Library' where id = $1`, [v.id, SA]);
    if (endorse) {
      await d.query(`insert into m2_assessment_educator_reviews(version_id, reviewer_name, reviewer_qualification, reviewed_on, passage_suitable, questions_sound,
        answer_keys_correct, language_accurate, outcome, recorded_by) values ($1, 'R', 'Teacher (stated)', current_date, true, true, true, true, 'endorsed', $2)`, [v.id, SA]);
    }
    if (upTo === 'published') await d.query('select m2_publish_assessment_version($1, $2)', [v.id, SA]);
  }
  return { pkg, version: v.id };
}
const activate = (d, language, version, expected, actor = SA) => d.query('select m2_activate_initial_version($1, $2, $3, $4)', [language, version, expected, actor]);
const active = async (d, language) => (await d.query('select package_version_id v from m2_initial_activation where language = $1', [language])).rows[0].v;

test('install: both languages start on the built-in 3.0; verify passes; second run refused; publishing activates nothing', async () => {
  const d = await db();
  assert.deepEqual([await active(d, 'en'), await active(d, 'fil')], [null, null]);
  await lineage(d, 'en');
  assert.equal(await active(d, 'en'), null, 'publishing in the library never activates');
  const res = (await d.exec(VERIFY)).find((r) => r.fields?.some((f) => f.name === 'result'));
  assert.deepEqual(res.rows.filter((r) => r.result !== 'PASS'), []);
  await assert.rejects(d.exec(ACTIVATION), /already \(partly\) installed/);
  await d.exec('rollback');
});

test('only a System Admin; only a published, endorsed, authored version of that language\'s initial lineage', async () => {
  const d = await db();
  const ok = await lineage(d, 'en');
  for (const actor of [ADMIN, TEACHER, id(99)]) await fails(activate(d, 'en', ok.version, null, actor), /Only a System Admin/);
  await fails(activate(d, 'fil', ok.version, null), /this language's initial diagnostic/, 'English content cannot become the Filipino diagnostic');
  const draft = await lineage(d, 'fil', { upTo: 'draft' });
  await fails(activate(d, 'fil', draft.version, null), /published in the library/);
  const unendorsed = await lineage(d, 'fil', { label: '5.0', endorse: false });
  await fails(activate(d, 'fil', unendorsed.version, null), /no documented educator endorsement/);
  const imported = (await d.query(`select id from m2_assessment_package_versions where source = 'code_import' and package_id = $1`, [ok.pkg])).rows[0].id;
  await fails(activate(d, 'en', imported, null), /built-in version/);
  const { rows: [p] } = await d.query(`insert into m2_assessment_packages(kind, audience, scope, owner_id, language, title) values ('reassessment','independent_learners','platform',$1,'en','IL') returning id`, [SA]);
  const { rows: [rv] } = await d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by, passage_title, paragraphs, questions) values ($1, 1, '1.0', $2, 'S', $3, $4) returning id`, [p.id, SA, JSON.stringify(PARAGRAPHS), JSON.stringify(QUESTIONS)]);
  await fails(activate(d, 'en', rv.id, null), /this language's initial diagnostic/, 'a reassessment package can never be activated');
  await activate(d, 'en', ok.version, null);
  assert.equal(await active(d, 'en'), ok.version);
  assert.equal(await active(d, 'fil'), null, 'English and Filipino are independent');
});

test('concurrency: the caller must name the version it replaces; a stale or repeated activation is refused', async () => {
  const d = await db();
  const v4 = await lineage(d, 'en');
  await activate(d, 'en', v4.version, null);
  await fails(activate(d, 'en', null, null, SA2), /changed since you loaded it/, 'a second System Admin with a stale view');
  await fails(activate(d, 'en', v4.version, v4.version), /already active/);
  const results = await Promise.allSettled([activate(d, 'en', null, v4.version), activate(d, 'en', null, v4.version, SA2)]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(await active(d, 'en'), null);
});

test('history is append-only; the backend cannot write the pointer directly; browsers see nothing', async () => {
  const d = await db();
  const v4 = await lineage(d, 'en');
  await activate(d, 'en', v4.version, null);
  await activate(d, 'en', null, v4.version);
  const events = (await d.query('select from_label, to_label, actor from m2_initial_activation_events order by changed_at, id')).rows;
  assert.deepEqual(events.map((e) => [e.from_label, e.to_label, e.actor]), [['3.0 (built-in)', '4.0', SA], ['4.0', '3.0 (built-in)', SA]]);
  await fails(d.query('delete from m2_initial_activation_events'), /permanent/);
  await fails(d.query(`update m2_initial_activation_events set to_label = 'x'`), /permanent/);
  await d.exec('set role service_role');
  await fails(d.query(`update m2_initial_activation set package_version_id = $1 where language = 'en'`, [v4.version]), /permission denied/);
  await activate(d, 'en', v4.version, null); // the function is the backend's only write path
  await d.exec('reset role; set role authenticated');
  await fails(d.query('select * from m2_initial_activation'), /permission denied/);
  await fails(activate(d, 'en', null, v4.version), /permission denied/);
  await d.exec('reset role');
});

test('an active version stays active (and immutable) even if a newer version is later published in the library', async () => {
  const d = await db();
  const v4 = await lineage(d, 'en');
  await activate(d, 'en', v4.version, null);
  await lineage(d, 'en', { label: '5.0' }); // publishing 5.0 retires 4.0 in the library
  assert.equal((await d.query('select status from m2_assessment_package_versions where id = $1', [v4.version])).rows[0].status, 'retired');
  assert.equal(await active(d, 'en'), v4.version, 'library status never changes what learners take');
  await fails(d.query(`update m2_assessment_package_versions set paragraphs = '[]' where id = $1`, [v4.version]), /Only draft content/);
});

test('rollback: refused while a language has an activated version; clean otherwise; re-apply works', async () => {
  const d = await db();
  const v4 = await lineage(d, 'en');
  await activate(d, 'en', v4.version, null);
  await assert.rejects(d.exec(ROLLBACK), /still has an activated version/);
  await d.exec('rollback');
  await activate(d, 'en', null, v4.version);
  await d.exec(ROLLBACK);
  assert.equal((await d.query(`select to_regclass('public.m2_initial_activation') t`)).rows[0].t, null);
  await d.exec(ACTIVATION);
});

test('account deletion: removing the System Admin who activated keeps the active version and the history (actor cleared)', async () => {
  const d = await db();
  const v4 = await lineage(d, 'en');
  await activate(d, 'en', v4.version, null, SA2);
  await d.query('delete from auth.users where id = $1', [SA2]);
  assert.equal(await active(d, 'en'), v4.version, 'learners keep taking the activated version');
  const row = (await d.query(`select (select activated_by from m2_initial_activation where language = 'en') by_pointer,
    (select count(*)::int from m2_initial_activation_events) n, (select count(*)::int from m2_initial_activation_events where actor is null) cleared`)).rows[0];
  assert.deepEqual([row.by_pointer, row.n, row.cleared], [null, 1, 1]);
});
