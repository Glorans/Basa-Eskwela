// Disposable in-memory PostgreSQL only. Never connects to a Supabase project.
// Rehearses m2_assessment_packages_PROPOSED.sql and its ROLLBACK.
const { PGlite } = require('../../server/node_modules/@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const read = (f) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const PROPOSAL = read('proposed/m2_assessment_packages_PROPOSED.sql');
const ROLLBACK = read('proposed/m2_assessment_packages_ROLLBACK_PROPOSED.sql');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SA = id(1), ADMIN = id(2), TEACHER = id(3), OTHER_TEACHER = id(4);

async function db({ install = true } = {}) {
  const d = new PGlite();
  await d.exec(`
    create role authenticated; create role anon; create role service_role bypassrls;
    create table profiles(id uuid primary key, role text);
    create table diagnostic_results(id uuid primary key);
    grant usage on schema public to authenticated, anon, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    insert into profiles values ('${SA}','system_admin'), ('${ADMIN}','admin'), ('${TEACHER}','teacher'), ('${OTHER_TEACHER}','teacher');
  `);
  if (install) await d.exec(PROPOSAL);
  return d;
}
const fails = async (promise, pattern) => assert.rejects(promise, pattern);
// A refused script leaves its BEGIN open and aborted: roll it back, as the M1 harness does.
const failsScript = async (d, sql, pattern) => { await assert.rejects(d.exec(sql), pattern); await d.exec('rollback'); };
const question = (n, type, extra = {}) => ({ id: `q${n}`, type, prompt: `Question ${n}?`, correctChoiceId: 'a',
  choices: ['a', 'b', 'c', 'd'].map((c) => ({ id: c, label: `Choice ${c}` })), ...extra });
const QUESTIONS = [question(1, 'literal'), question(2, 'literal'), question(3, 'inferential'), question(4, 'inferential'), question(5, 'inferential'), question(6, 'critical')];
const PARAGRAPHS = ['Ana walked to the river with her small brown dog early in the morning.', 'They watched the fish swim under the old bridge until the sun was high and warm.'];
async function pkg(d, { kind = 'reassessment', audience = 'classroom', scope = 'teacher', owner = TEACHER, language = 'en', legacy = null } = {}) {
  return (await d.query(`insert into m2_assessment_packages(kind, audience, scope, owner_id, language, title, legacy_assessment_id)
    values ($1,$2,$3,$4,$5,'A title',$6) returning id`, [kind, audience, scope, owner, language, legacy])).rows[0].id;
}
async function draft(d, packageId, n = 1, by = TEACHER) {
  return (await d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by, passage_title, paragraphs, questions)
    values ($1,$2,$3,$4,'Story',$5,$6) returning id`, [packageId, n, `${n}.0`, by, JSON.stringify(PARAGRAPHS), JSON.stringify(QUESTIONS)])).rows[0].id;
}
const status = (d, v, s, extra = '') => d.query(`update m2_assessment_package_versions set status = '${s}' ${extra} where id = $1`, [v]);
const row = async (d, v) => (await d.query('select * from m2_assessment_package_versions where id = $1', [v])).rows[0];
const toPublished = async (d, v) => {
  await status(d, v, 'in_review', `, submitted_by = '${TEACHER}'`);
  await status(d, v, 'approved', `, reviewed_by = '${ADMIN}', educator_review_attestation = 'Reviewed by the Grade 5 English teacher'`);
  await status(d, v, 'published', `, published_by = '${TEACHER}'`);
};

test('install: refuses to run twice; browser roles have no access; service role reads and writes; RLS on', async () => {
  const d = await db();
  await failsScript(d, PROPOSAL, /already \(partly\) installed/);
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['m2_assessment_packages', 'm2_assessment_package_versions']) {
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        assert.equal((await d.query(`select has_table_privilege('${role}','public.${table}','${priv}') ok`)).rows[0].ok, false, `${role} ${priv} ${table}`);
      }
    }
    assert.equal((await d.query(`select has_function_privilege('${role}','public.m2_assessment_content_issues(text,jsonb,jsonb)','EXECUTE') ok`)).rows[0].ok, false);
  }
  assert.equal((await d.query(`select has_table_privilege('service_role','public.m2_assessment_package_versions','INSERT') ok`)).rows[0].ok, true);
  assert.equal((await d.query(`select bool_and(relrowsecurity) ok from pg_class where relname in ('m2_assessment_packages','m2_assessment_package_versions')`)).rows[0].ok, true);
  assert.equal((await d.query(`select count(*)::int n from pg_policies where tablename like 'm2_assessment%'`)).rows[0].n, 0);
});

test('packages: only the four kind/audience/scope combinations; one active initial package per language; identity fixed; never deleted', async () => {
  const d = await db();
  await pkg(d, { kind: 'initial', audience: 'all_learners', scope: 'platform', owner: SA });
  await fails(pkg(d, { kind: 'initial', audience: 'all_learners', scope: 'platform', owner: SA }), /m2_one_active_initial_package_per_language/);
  await pkg(d, { kind: 'initial', audience: 'all_learners', scope: 'platform', owner: SA, language: 'fil' });
  await pkg(d, { kind: 'reassessment', audience: 'independent_learners', scope: 'platform', owner: SA });
  await pkg(d, { scope: 'school', owner: ADMIN });
  const teacherPkg = await pkg(d);
  for (const bad of [{ kind: 'initial', audience: 'classroom', scope: 'teacher' }, { kind: 'reassessment', audience: 'independent_learners', scope: 'teacher' },
    { kind: 'reassessment', audience: 'classroom', scope: 'platform' }, { kind: 'reassessment', audience: 'all_learners', scope: 'platform' }]) {
    await fails(pkg(d, bad), /m2_package_kind_audience_scope/);
  }
  await d.query(`update m2_assessment_packages set title = 'Renamed', archived_at = now() where id = $1`, [teacherPkg]);
  await fails(d.query(`update m2_assessment_packages set owner_id = $2 where id = $1`, [teacherPkg, OTHER_TEACHER]), /cannot change/);
  await fails(d.query(`update m2_assessment_packages set language = 'fil' where id = $1`, [teacherPkg]), /cannot change/);
  await fails(d.query(`delete from m2_assessment_packages where id = $1`, [teacherPkg]), /never deleted/);
});

test('versions: new versions start as drafts; drafts are editable; invalid content cannot be submitted', async () => {
  const d = await db();
  const p = await pkg(d);
  await fails(d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by, status) values ($1,1,'1.0',$2,'published')`, [p, TEACHER]), /start as drafts/);
  const v = (await d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by) values ($1,1,'1.0',$2) returning id`, [p, TEACHER])).rows[0].id;
  await fails(status(d, v, 'in_review', `, submitted_by = '${TEACHER}'`), /not ready for review: Add a passage title\. The passage needs 1 to 10 paragraphs\. Add exactly 6 comprehension questions\./);
  const bad = QUESTIONS.map((q, i) => (i === 0 ? { ...q, correctChoiceId: 'e' } : i === 1 ? { ...q, choices: q.choices.slice(0, 3) } : q));
  await d.query(`update m2_assessment_package_versions set passage_title = 'Story', paragraphs = $2, questions = $3 where id = $1`, [v, JSON.stringify(PARAGRAPHS), JSON.stringify(bad)]);
  await fails(status(d, v, 'in_review', `, submitted_by = '${TEACHER}'`), /Question 1 needs one correct answer\. Question 2 needs exactly 4 answer choices\./);
  const noCritical = QUESTIONS.map((q) => ({ ...q, type: q.type === 'critical' ? 'literal' : q.type }));
  await d.query(`update m2_assessment_package_versions set questions = $2 where id = $1`, [v, JSON.stringify(noCritical)]);
  await fails(status(d, v, 'in_review', `, submitted_by = '${TEACHER}'`), /at least one literal, one inferential and one critical/);
  const issues = (await d.query(`select m2_assessment_content_issues('Story', $1, $2) i`, [JSON.stringify(PARAGRAPHS), JSON.stringify(QUESTIONS)])).rows[0].i;
  assert.deepEqual(issues, []);
});

test('lifecycle: submit freezes content with a SHA-256; return to draft unfreezes; approval needs a reviewer and an attestation', async () => {
  const d = await db();
  const v = await draft(d, await pkg(d));
  await fails(status(d, v, 'in_review'), /who submitted/);
  await status(d, v, 'in_review', `, submitted_by = '${TEACHER}'`);
  const frozen = await row(d, v);
  assert.match(frozen.content_sha256, /^[0-9a-f]{64}$/);
  assert.ok(frozen.submitted_at);
  await fails(d.query(`update m2_assessment_package_versions set passage_title = 'Changed' where id = $1`, [v]), /Only draft content can be edited/);
  await fails(d.query(`update m2_assessment_package_versions set questions = '[]' where id = $1`, [v]), /Only draft content can be edited/);
  await status(d, v, 'draft', `, review_note = 'Please simplify question 4'`);
  const returned = await row(d, v);
  assert.equal(returned.content_sha256, null);
  assert.equal(returned.review_note, 'Please simplify question 4');
  await d.query(`update m2_assessment_package_versions set passage_title = 'Story, revised' where id = $1`, [v]);
  await status(d, v, 'in_review', `, submitted_by = '${TEACHER}'`);
  await fails(status(d, v, 'approved', `, reviewed_by = '${ADMIN}'`), /educator-review attestation/);
  await fails(status(d, v, 'approved', `, reviewed_by = '${ADMIN}', educator_review_attestation = '   '`), /educator-review attestation/);
  await status(d, v, 'approved', `, reviewed_by = '${ADMIN}', educator_review_attestation = 'Reviewed by the Grade 5 English teacher'`);
  assert.ok((await row(d, v)).reviewed_at);
});

test('lifecycle: only forward moves; publication is recorded; one published version per package; history cannot be rewritten', async () => {
  const d = await db();
  const p = await pkg(d);
  const v1 = await draft(d, p, 1);
  await fails(status(d, v1, 'approved'), /cannot move from draft to approved/);
  await fails(status(d, v1, 'published'), /cannot move from draft to published/);
  await toPublished(d, v1);
  const published = await row(d, v1);
  assert.ok(published.published_at);
  await fails(status(d, v1, 'draft'), /cannot move from published to draft/);
  await fails(status(d, v1, 'approved'), /cannot move from published to approved/);
  await fails(d.query(`update m2_assessment_package_versions set educator_review_attestation = 'rewritten' where id = $1`, [v1]), /cannot be rewritten/);
  await fails(d.query(`update m2_assessment_package_versions set version_number = 9 where id = $1`, [v1]), /identity cannot change/);
  await fails(d.query(`delete from m2_assessment_package_versions where id = $1`, [v1]), /Only draft versions can be deleted/);
  // A change to published content is a NEW version; the old one stays published until the new one replaces it.
  const v2 = (await d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by, based_on_version_id, passage_title, paragraphs, questions)
    select package_id, 2, '2.0', $2, id, passage_title || ' (revised)', paragraphs, questions from m2_assessment_package_versions where id = $1 returning id`, [v1, TEACHER])).rows[0].id;
  await status(d, v2, 'in_review', `, submitted_by = '${TEACHER}'`);
  await status(d, v2, 'approved', `, reviewed_by = '${ADMIN}', educator_review_attestation = 'Reviewed'`);
  await fails(status(d, v2, 'published', `, published_by = '${TEACHER}'`), /m2_one_published_version_per_package/);
  await status(d, v1, 'retired', `, retired_by = '${TEACHER}'`);
  await status(d, v2, 'published', `, published_by = '${TEACHER}'`);
  assert.equal((await row(d, v1)).status, 'retired');
  assert.deepEqual((await row(d, v1)).questions, QUESTIONS, 'the retired version keeps its original content');
  await fails(status(d, v1, 'published', `, published_by = '${TEACHER}'`), /cannot move from retired to published/);
  await fails(d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by) values ($1, 2, '3.0', $2)`, [p, TEACHER]), /unique/);
  const d3 = await draft(d, p, 3);
  await d.query(`delete from m2_assessment_package_versions where id = $1`, [d3]);
});

test('code import: only for the package mirroring a code-defined diagnostic, only as published, content validated and hashed', async () => {
  const d = await db();
  const plain = await pkg(d, { kind: 'initial', audience: 'all_learners', scope: 'platform', owner: SA });
  const insertImport = (p, extra = {}) => d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by, source, status, passage_title, paragraphs, questions)
    values ($1, 3, '3.0', $2, 'code_import', $3, 'Story', $4, $5) returning id`, [p, SA, extra.status ?? 'published', JSON.stringify(PARAGRAPHS), JSON.stringify(extra.questions ?? QUESTIONS)]);
  await fails(insertImport(plain), /Only the code-defined diagnostic can be imported/);
  const legacy = await pkg(d, { kind: 'initial', audience: 'all_learners', scope: 'platform', owner: SA, language: 'fil', legacy: 'grade5-fil-passage-v3' });
  await fails(insertImport(legacy, { status: 'draft' }), /Only the code-defined diagnostic can be imported/);
  await fails(insertImport(legacy, { questions: QUESTIONS.slice(0, 5) }), /Imported content is invalid/);
  const v = (await insertImport(legacy)).rows[0].id;
  const r = await row(d, v);
  assert.equal(r.status, 'published');
  assert.match(r.content_sha256, /^[0-9a-f]{64}$/);
  assert.ok(r.published_at);
});

test('rollback: refuses while authored versions exist; removes only this feature when just code imports remain', async () => {
  const d = await db();
  const p = await pkg(d);
  await draft(d, p);
  await failsScript(d, ROLLBACK, /STOP: 1 authored assessment version\(s\) exist/);
  assert.notEqual((await d.query(`select to_regclass('public.m2_assessment_packages') t`)).rows[0].t, null, 'nothing removed');
  const clean = await db();
  const legacy = await pkg(clean, { kind: 'initial', audience: 'all_learners', scope: 'platform', owner: SA, legacy: 'grade5-en-passage-v3' });
  await clean.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by, source, status, passage_title, paragraphs, questions)
    values ($1, 3, '3.0', $2, 'code_import', 'published', 'Story', $3, $4)`, [legacy, SA, JSON.stringify(PARAGRAPHS), JSON.stringify(QUESTIONS)]);
  await clean.exec(ROLLBACK);
  for (const object of ['public.m2_assessment_packages', 'public.m2_assessment_package_versions']) {
    assert.equal((await clean.query(`select to_regclass($1) t`, [object])).rows[0].t, null);
  }
  assert.notEqual((await clean.query(`select to_regclass('public.diagnostic_results') t`)).rows[0].t, null, 'diagnostic_results untouched');
  await clean.exec(PROPOSAL); // installable again after rollback
});

test('atomic publish: retires the previous published version and publishes the approved one together; refuses drafts and archived packages', async () => {
  const d = await db();
  const p = await pkg(d);
  const v1 = await draft(d, p, 1);
  await toPublished(d, v1);
  const v2 = await draft(d, p, 2);
  await fails(d.query('select m2_publish_assessment_version($1, $2)', [v2, TEACHER]), /Only an approved version/);
  await status(d, v2, 'in_review', `, submitted_by = '${TEACHER}'`);
  await status(d, v2, 'approved', `, reviewed_by = '${ADMIN}', educator_review_attestation = 'Reviewed'`);
  await d.query('select m2_publish_assessment_version($1, $2)', [v2, TEACHER]);
  assert.deepEqual([(await row(d, v1)).status, (await row(d, v2)).status], ['retired', 'published']);
  assert.equal((await row(d, v1)).retired_by, TEACHER);
  assert.equal((await d.query(`select has_function_privilege('authenticated','public.m2_publish_assessment_version(uuid,uuid)','EXECUTE') ok`)).rows[0].ok, false);
  const v3 = await draft(d, p, 3);
  await status(d, v3, 'in_review', `, submitted_by = '${TEACHER}'`);
  await status(d, v3, 'approved', `, reviewed_by = '${ADMIN}', educator_review_attestation = 'Reviewed'`);
  await d.query(`update m2_assessment_packages set archived_at = now() where id = $1`, [p]);
  await fails(d.query('select m2_publish_assessment_version($1, $2)', [v3, TEACHER]), /active package/);
  assert.equal((await row(d, v2)).status, 'published', 'a refused publish changes nothing');
});

test('the backend role (service_role, no default privileges) can run the whole lifecycle; authenticated cannot read', async () => {
  const d = await db();
  // Remove the default-privilege grants so only the migration's explicit grants count.
  await d.exec(`revoke all on function m2_assessment_content_sha256(text, jsonb, jsonb) from service_role;
    grant execute on function m2_assessment_content_sha256(text, jsonb, jsonb) to service_role;`);
  await d.exec('set role service_role');
  const p = await pkg(d);
  const v = await draft(d, p, 1);
  await status(d, v, 'in_review', `, submitted_by = '${TEACHER}'`);
  await status(d, v, 'approved', `, reviewed_by = '${ADMIN}', educator_review_attestation = 'Reviewed'`);
  await d.query('select m2_publish_assessment_version($1, $2)', [v, TEACHER]);
  assert.equal((await row(d, v)).status, 'published');
  assert.match((await row(d, v)).content_sha256, /^[0-9a-f]{64}$/);
  await d.exec('reset role; set role authenticated');
  await fails(d.query('select * from m2_assessment_package_versions'), /permission denied/);
  await fails(d.query('select m2_publish_assessment_version($1, $2)', [v, TEACHER]), /permission denied/);
  await d.exec('reset role');
});

// A1: educator review evidence is append-only, only for frozen content, and library approval is not endorsement.
const review = (d, v, extra = {}) => {
  const r = { reviewer_name: 'Ms. Reviewer', reviewer_qualification: 'Grade 5 English teacher (stated)', reviewed_on: '2026-11-18',
    passage_suitable: true, questions_sound: true, answer_keys_correct: true, language_accurate: true,
    outcome: 'endorsed', notes: null, recorded_by: ADMIN, ...extra };
  const keys = Object.keys(r);
  return d.query(`insert into m2_assessment_educator_reviews(version_id, ${keys.join(', ')}) values ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) returning id`,
    [v, ...keys.map((k) => r[k])]);
};
const endorsed = async (d, v) => (await d.query('select m2_version_educator_endorsed($1) ok', [v])).rows[0].ok;

test('educator reviews: only frozen versions; endorsement needs all four checks; no future dates; permanent records', async () => {
  const d = await db();
  const p = await pkg(d);
  const v = await draft(d, p, 1);
  await fails(review(d, v), /Only submitted, approved, published or retired versions/);
  await status(d, v, 'in_review', `, submitted_by = '${TEACHER}'`);
  await fails(review(d, v, { answer_keys_correct: false }), /m2_review_endorsement_needs_all_checks/);
  await fails(review(d, v, { reviewed_on: '2999-01-01' }), /future/);
  await fails(review(d, v, { reviewer_qualification: '  ' }), /check constraint/);
  assert.equal(await endorsed(d, v), false, 'no review yet');
  // Library approval alone is never endorsement.
  await status(d, v, 'approved', `, reviewed_by = '${ADMIN}', educator_review_attestation = 'Admin approval'`);
  assert.equal(await endorsed(d, v), false, 'approved for library is not educator-endorsed');
  const { rows: [first] } = await review(d, v, { answer_keys_correct: false, outcome: 'changes_requested' });
  assert.equal(await endorsed(d, v), false);
  await review(d, v, { reviewed_on: '2026-11-19' });
  assert.equal(await endorsed(d, v), true, 'latest review endorses');
  await review(d, v, { reviewed_on: '2026-11-19', outcome: 'changes_requested', language_accurate: false });
  assert.equal(await endorsed(d, v), false, 'a later changes_requested review withdraws the endorsement');
  await fails(d.query(`update m2_assessment_educator_reviews set outcome = 'endorsed' where id = $1`, [first.id]), /permanent records/);
  await fails(d.query('delete from m2_assessment_educator_reviews where id = $1', [first.id]), /permanent records/);
  for (const priv of ['UPDATE', 'DELETE']) {
    assert.equal((await d.query(`select has_table_privilege('service_role','public.m2_assessment_educator_reviews','${priv}') ok`)).rows[0].ok, false, priv);
  }
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await d.query(`select has_table_privilege('${role}','public.m2_assessment_educator_reviews','SELECT') ok`)).rows[0].ok, false, role);
  }
});

test('educator reviews block the rollback until exported', async () => {
  const d = await db();
  const p = await pkg(d, { kind: 'initial', audience: 'all_learners', scope: 'platform', owner: SA, legacy: 'grade5-en-passage-v3' });
  const { rows: [v] } = await d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, status, source, created_by, published_by, passage_title, paragraphs, questions)
    values ($1, 1, '3.0', 'published', 'code_import', $2, $2, 'Story', $3, $4) returning id`, [p, SA, JSON.stringify(PARAGRAPHS), JSON.stringify(QUESTIONS)]);
  await review(d, v.id);
  await failsScript(d, ROLLBACK, /educator review records exist/);
});

test('account deletion keeps working: owner/actor references become NULL, content and history stay unchanged', async () => {
  const d = await db();
  const p = await pkg(d);
  const v = await draft(d, p, 1);
  await toPublished(d, v);
  const before = await row(d, v);
  await d.query(`insert into m2_assessment_educator_reviews(version_id, reviewer_name, reviewer_qualification, reviewed_on, passage_suitable,
    questions_sound, answer_keys_correct, language_accurate, outcome, recorded_by) values ($1, 'R', 'Q', current_date, true, true, true, true, 'endorsed', $2)`, [v, ADMIN]);
  await d.query('delete from profiles where id = $1', [TEACHER]);
  await d.query('delete from profiles where id = $1', [ADMIN]);
  const after = await row(d, v);
  assert.deepEqual([after.created_by, after.submitted_by, after.published_by, after.reviewed_by], [null, null, null, null]);
  assert.deepEqual([after.status, after.content_sha256, after.paragraphs, after.reviewed_at, after.educator_review_attestation],
    [before.status, before.content_sha256, before.paragraphs, before.reviewed_at, before.educator_review_attestation]);
  assert.equal((await d.query('select owner_id from m2_assessment_packages where id = $1', [p])).rows[0].owner_id, null);
  assert.equal((await d.query('select recorded_by from m2_assessment_educator_reviews')).rows[0].recorded_by, null);
  assert.equal((await d.query('select m2_version_educator_endorsed($1) ok', [v])).rows[0].ok, true, 'evidence survives the account');
  // Direct edits are still refused: only the referential null-out is allowed.
  await fails(d.query('update m2_assessment_packages set owner_id = $2 where id = $1', [p, SA]), /cannot change/);
  await fails(d.query('update m2_assessment_package_versions set published_by = $2 where id = $1', [v, SA]), /cannot be rewritten/);
  await fails(d.query(`insert into m2_assessment_packages(kind, audience, scope, owner_id, language, title) values ('reassessment','classroom','teacher',null,'en','x')`), /owns the package/);
});
