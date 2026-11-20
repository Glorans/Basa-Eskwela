// Disposable in-memory PostgreSQL only. Rehearses m2_initial_activation_no_endorsement_PROPOSED.sql (on top of the
// packages and activation proposals), its VERIFY and its ROLLBACK. Synthetic content only.
const { PGlite } = require('../../server/node_modules/@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { LIVE_FIXTURE } = require('./fixtures/liveDiagnosticFixture.cjs');

const read = (f) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const PACKAGES = read('proposed/m2_assessment_packages_PROPOSED.sql');
const ACTIVATION = read('proposed/m2_initial_activation_PROPOSED.sql');
const NO_ENDORSEMENT = read('proposed/m2_initial_activation_no_endorsement_PROPOSED.sql');
const ROLLBACK = read('proposed/m2_initial_activation_no_endorsement_ROLLBACK_PROPOSED.sql');
const VERIFY = read('proposed/m2_initial_activation_no_endorsement_VERIFY_READONLY.sql');
const ORIGINAL_MD5 = '6dce9f9cfc71174033da44590cea9abd';
const NEW_MD5 = 'ed9266fe09773b403031f46c9ba8050b';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SA = id(1), ADMIN = id(3), TEACHER = id(4);
const QUESTIONS = ['literal', 'literal', 'inferential', 'inferential', 'inferential', 'critical'].map((type, i) => ({
  id: `q${i + 1}`, type, prompt: `Q${i + 1}?`, correctChoiceId: 'a', choices: ['a', 'b', 'c', 'd'].map((c) => ({ id: c, label: c })) }));
const PARAGRAPHS = ['Ana walked to the river with her small brown dog early in the morning.', 'They watched the fish swim under the old bridge until the sun was high and warm.'];

async function db({ change = true } = {}) {
  const d = new PGlite();
  await d.exec(LIVE_FIXTURE);
  for (const [uid, role, status] of [[SA, 'system_admin', null], [ADMIN, 'admin', null], [TEACHER, 'teacher', 'approved']]) {
    await d.query('insert into auth.users values ($1)', [uid]);
    await d.query('insert into profiles(id, role, teacher_status) values ($1, $2, $3)', [uid, role, status]);
  }
  await d.exec(PACKAGES);
  await d.exec(ACTIVATION);
  if (change) await d.exec(NO_ENDORSEMENT);
  return d;
}
/** An authored version of a language's initial lineage, taken to `upTo`, WITHOUT any educator review. */
async function version(d, language, { label = '4.0', upTo = 'published' } = {}) {
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
    await d.query(`update m2_assessment_package_versions set status = 'approved', reviewed_by = $2, educator_review_attestation = 'Checked by the System Admin' where id = $1`, [v.id, SA]);
    if (upTo === 'published') await d.query('select m2_publish_assessment_version($1, $2)', [v.id, SA]);
  }
  return { pkg, version: v.id };
}
const activate = (d, language, v, expected, actor = SA) => d.query('select m2_activate_initial_version($1, $2, $3, $4)', [language, v, expected, actor]);
const active = async (d, language) => (await d.query('select package_version_id v from m2_initial_activation where language = $1', [language])).rows[0].v;
const bodyMd5 = async (d) => (await d.query(`select md5(prosrc) m from pg_proc where oid = 'public.m2_activate_initial_version(text,uuid,uuid,uuid)'::regprocedure`)).rows[0].m;
const verify = async (d) => (await d.exec(VERIFY)).find((r) => r.fields?.some((f) => f.name === 'result')).rows;

test('apply: replaces only the activation body; VERIFY passes; privileges kept; a second run is refused', async () => {
  const before = await db({ change: false });
  assert.equal(await bodyMd5(before), ORIGINAL_MD5, 'the committed activation proposal is the reviewed original');
  const acl = async (d) => (await d.query(`select proacl::text a, prosecdef s from pg_proc where oid = 'public.m2_activate_initial_version(text,uuid,uuid,uuid)'::regprocedure`)).rows[0];
  const aclBefore = await acl(before);
  await before.exec(NO_ENDORSEMENT);
  assert.equal(await bodyMd5(before), NEW_MD5);
  assert.deepEqual(await acl(before), aclBefore, 'owner privileges and SECURITY DEFINER unchanged');
  assert.deepEqual((await verify(before)).filter((r) => r.result !== 'PASS'), []);
  await assert.rejects(before.exec(NO_ENDORSEMENT), /not the reviewed original/);
  await before.exec('rollback');
  const funcs = (await before.query(`select count(*)::int n from pg_proc where proname = 'm2_version_educator_endorsed'`)).rows[0].n;
  assert.equal(funcs, 1, 'the shared endorsement function is kept for reassessment');
});

test('a published version activates without an educator endorsement, and no review is fabricated', async () => {
  const d = await db();
  const v = await version(d, 'en');
  const reviews = async () => (await d.query('select count(*)::int n from m2_assessment_educator_reviews')).rows[0].n;
  assert.equal(await reviews(), 0);
  assert.equal(await active(d, 'en'), null, 'publishing never activates');
  await activate(d, 'en', v.version, null);
  assert.equal(await active(d, 'en'), v.version);
  assert.equal(await reviews(), 0, 'no endorsement or review record is created');
  assert.equal((await d.query('select m2_version_educator_endorsed($1) e', [v.version])).rows[0].e, false, 'it is still not "endorsed"');
  const events = (await d.query('select language, to_label, actor from m2_initial_activation_events')).rows;
  assert.deepEqual(events, [{ language: 'en', to_label: '4.0', actor: SA }], 'the change is recorded in the history');
  assert.equal(await active(d, 'fil'), null, 'Filipino is unaffected');
});

test('every other activation rule still holds', async () => {
  const d = await db();
  const ok = await version(d, 'en');
  for (const actor of [ADMIN, TEACHER, id(99)]) await assert.rejects(activate(d, 'en', ok.version, null, actor), /Only a System Admin/);
  await assert.rejects(activate(d, 'fil', ok.version, null), /this language's initial diagnostic/, 'English content cannot become the Filipino diagnostic');
  const draft = await version(d, 'en', { label: '5.0', upTo: 'draft' });
  await assert.rejects(activate(d, 'en', draft.version, null), /published in the library/, 'a draft can never be activated');
  const approved = await version(d, 'fil', { upTo: 'approved' });
  await assert.rejects(activate(d, 'fil', approved.version, null), /published in the library/);
  const imported = (await d.query(`select id from m2_assessment_package_versions where source = 'code_import' and package_id = $1`, [ok.pkg])).rows[0].id;
  await assert.rejects(activate(d, 'en', imported, null), /built-in version/);
  await assert.rejects(activate(d, 'en', ok.version, id(77)), (e) => e.code === '40001', 'the caller must name the version it replaces');
  await activate(d, 'en', ok.version, null);
  await assert.rejects(activate(d, 'en', ok.version, ok.version), /already active/);
  await activate(d, 'en', null, ok.version);
  assert.equal(await active(d, 'en'), null, 'returning to the built-in 3.0 still works');
});

test('rollback restores the original body byte-for-byte and the endorsement rule; re-apply works', async () => {
  const d = await db();
  const v = await version(d, 'en');
  await d.exec(ROLLBACK);
  assert.equal(await bodyMd5(d), ORIGINAL_MD5);
  await assert.rejects(activate(d, 'en', v.version, null), /no documented educator endorsement/);
  await assert.rejects(d.exec(ROLLBACK), /nothing to roll back/);
  await d.exec('rollback');
  await d.exec(NO_ENDORSEMENT);
  assert.equal(await bodyMd5(d), NEW_MD5);
  await activate(d, 'en', v.version, null);
  assert.equal(await active(d, 'en'), v.version);
});
