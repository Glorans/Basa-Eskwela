// Disposable in-memory PostgreSQL only. Rehearses m2_flexible_questions_PROPOSED.sql (5-8 comprehension questions),
// its VERIFY and its ROLLBACK on top of the packages proposal. The scripts were generated for the local M2 test
// database, whose validator body has CRLF line endings, so the packages proposal is installed with CRLF here too.
const { PGlite } = require('../../server/node_modules/@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { LIVE_FIXTURE } = require('./fixtures/liveDiagnosticFixture.cjs');

const read = (f) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const crlf = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
const PACKAGES = crlf(read('proposed/m2_assessment_packages_PROPOSED.sql'));
const PROPOSED = read('proposed/m2_flexible_questions_PROPOSED.sql');
const ROLLBACK = read('proposed/m2_flexible_questions_ROLLBACK_PROPOSED.sql');
const VERIFY = read('proposed/m2_flexible_questions_VERIFY_READONLY.sql');
const ORIGINAL_MD5 = 'cb51bb7e6cf0a501a0950203e0f88da7';
const NEW_MD5 = 'c349c8b5fbea59de2b3ca99658e0878a';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SA = id(1);
const TYPES = ['literal', 'inferential', 'critical'];
const questions = (n, types = TYPES) => Array.from({ length: n }, (_, i) => ({ id: `q${i + 1}`, type: types[i % types.length], prompt: `Q${i + 1}?`,
  correctChoiceId: 'a', choices: ['a', 'b', 'c', 'd'].map((c) => ({ id: c, label: c.toUpperCase() })) }));
const PARAGRAPHS = [Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ')];

async function db({ apply = true } = {}) {
  const d = new PGlite();
  await d.exec(LIVE_FIXTURE);
  await d.query('insert into auth.users values ($1)', [SA]);
  await d.query("insert into profiles(id, role) values ($1, 'system_admin')", [SA]);
  await d.exec(PACKAGES);
  const { rows: [p] } = await d.query(`insert into m2_assessment_packages(kind, audience, scope, owner_id, language, title)
    values ('reassessment','independent_learners','platform',$1,'en','Central') returning id`, [SA]);
  // An existing six-question version, published under the current rule.
  const six = await version(d, p.id, 1, 6);
  await d.query("update m2_assessment_package_versions set status = 'in_review', submitted_by = $2 where id = $1", [six, SA]);
  await d.query("update m2_assessment_package_versions set status = 'approved', reviewed_by = $2, educator_review_attestation = 'Checked' where id = $1", [six, SA]);
  await d.query('select m2_publish_assessment_version($1, $2)', [six, SA]);
  if (apply) await d.exec(PROPOSED);
  return { d, pkg: p.id, six };
}
async function version(d, pkg, n, count, types) {
  const { rows: [v] } = await d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by, passage_title, paragraphs, questions)
    values ($1, $2, $3, $4, 'Story', $5, $6) returning id`, [pkg, n, `${n}.0`, SA, JSON.stringify(PARAGRAPHS), JSON.stringify(questions(count, types))]);
  return v.id;
}
const submit = (d, v) => d.query("update m2_assessment_package_versions set status = 'in_review', submitted_by = $2 where id = $1", [v, SA]);
const bodyMd5 = async (d) => (await d.query("select md5(prosrc) m from pg_proc where oid = 'public.m2_assessment_content_issues(text,jsonb,jsonb)'::regprocedure")).rows[0].m;
const verify = async (d) => (await d.exec(VERIFY)).find((r) => r.fields?.some((f) => f.name === 'result')).rows;

test('before: the CRLF install reproduces the local database body; only six questions can be submitted', async () => {
  const { d, pkg } = await db({ apply: false });
  assert.equal(await bodyMd5(d), ORIGINAL_MD5, 'same body bytes as the local M2 test database');
  await assert.rejects(submit(d, await version(d, pkg, 2, 7)), /Add exactly 6 comprehension questions/);
});

test('apply: VERIFY passes; 5, 6, 7 and 8 questions submit; 4 and 9 are refused; a second run is refused', async () => {
  const { d, pkg } = await db();
  assert.equal(await bodyMd5(d), NEW_MD5);
  assert.deepEqual((await verify(d)).filter((r) => r.result !== 'PASS'), []);
  let n = 10;
  for (const count of [5, 6, 7, 8]) {
    const v = await version(d, pkg, n++, count);
    await submit(d, v);
    assert.equal((await d.query('select status from m2_assessment_package_versions where id = $1', [v])).rows[0].status, 'in_review', `${count} questions`);
    await d.query("update m2_assessment_package_versions set status = 'draft', review_note = 'back' where id = $1", [v]);
    await d.query('delete from m2_assessment_package_versions where id = $1', [v]);
  }
  for (const count of [4, 9]) await assert.rejects(submit(d, await version(d, pkg, n++, count)), /Add 5 to 8 comprehension questions/, `${count} questions`);
  await assert.rejects(d.exec(PROPOSED), /not the reviewed six-question original/);
  await d.exec('rollback');
});

test('every other rule still holds: all three question types, four choices a-d, one correct answer, unique ids', async () => {
  const { d, pkg } = await db();
  await assert.rejects(submit(d, await version(d, pkg, 20, 5, ['literal'])), /Include at least one literal, one inferential and one critical question/);
  const { rows: [v] } = await d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by, passage_title, paragraphs, questions)
    values ($1, 21, '21.0', $2, 'Story', $3, $4) returning id`, [pkg, SA, JSON.stringify(PARAGRAPHS),
    JSON.stringify(questions(5).map((q, i) => (i === 0 ? { ...q, choices: q.choices.slice(0, 3), correctChoiceId: null } : i === 1 ? { ...q, id: 'q1' } : q)))]);
  await assert.rejects(submit(d, v.id), (e) => /needs exactly 4 answer choices/.test(e.message) && /needs a unique id/.test(e.message));
  await assert.rejects(d.query("select public.m2_assessment_content_issues('T', $1, $2)", [JSON.stringify(PARAGRAPHS), JSON.stringify(questions(5))])
    .then(async () => { await d.exec('set role authenticated'); return d.query("select public.m2_assessment_content_issues('T', '[]', '[]')"); }), /permission denied/);
  await d.exec('reset role');
});

test('existing versions and results are untouched: the published six-question version and diagnostic results stay as they were', async () => {
  const { d, six } = await db({ apply: false });
  const snapshot = async () => (await d.query(`select (select md5(string_agg(v::text, ',' order by v.id)) from m2_assessment_package_versions v) versions,
    (select md5(coalesce(string_agg(r::text, ',' order by r.id), '')) from diagnostic_results r) results`)).rows[0];
  const before = await snapshot();
  await d.exec(PROPOSED);
  assert.deepEqual(await snapshot(), before, 'applying changes no row');
  assert.equal((await d.query('select status from m2_assessment_package_versions where id = $1', [six])).rows[0].status, 'published');
});

test('rollback restores the original body byte-for-byte (CRLF kept), reports non-six versions, and re-apply works', async () => {
  const { d, pkg } = await db();
  const seven = await version(d, pkg, 30, 7);
  await submit(d, seven); // frozen with 7 questions while the 5-8 rule was on
  await d.exec(ROLLBACK);
  assert.equal(await bodyMd5(d), ORIGINAL_MD5);
  const crlfCount = (await d.query("select length(prosrc) - length(replace(prosrc, chr(13), '')) n from pg_proc where oid = 'public.m2_assessment_content_issues(text,jsonb,jsonb)'::regprocedure")).rows[0].n;
  assert.equal(crlfCount, 52, 'the CRLF line endings are restored exactly');
  assert.equal((await d.query('select status from m2_assessment_package_versions where id = $1', [seven])).rows[0].status, 'in_review', 'a frozen version is kept');
  await assert.rejects(submit(d, await version(d, pkg, 31, 7)), /Add exactly 6 comprehension questions/, 'six questions again for new submissions');
  await assert.rejects(d.exec(ROLLBACK), /nothing to roll back/);
  await d.exec('rollback');
  await d.exec(PROPOSED);
  assert.equal(await bodyMd5(d), NEW_MD5);
});
