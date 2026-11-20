// M2 F7 — Try Assessment for a SPECIFIC authored Initial Diagnostic version. Runs the REAL proposed SQL (packages,
// activation, no-endorsement rule) on the live diagnostic_results fixture in an in-memory database, with real receipt
// signing and the real server scorer. Synthetic content only. Nothing here is written by practice.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const { LIVE_FIXTURE } = require("../../supabase/tests/fixtures/liveDiagnosticFixture.cjs");
const { createPgliteSupabase } = require("./helpers/pgliteSupabase");
const { createPracticeVersionService, PRACTICE_VERSION_PREFIX } = require("../services/practiceVersionService");
const { createDiagnosticPracticeService } = require("../services/diagnosticPracticeService");
const { createDiagnosticBindingResolver } = require("../services/diagnosticBindingResolver");
const { DIAGNOSTIC_ASSESSMENTS, getDiagnosticAssessmentBinding } = require("../services/diagnosticAssessments");
const { scoreDiagnostic } = require("../services/diagnosticScoring");
const { testReceipts } = require("./fixtures/diagnosticTrust");

const sql = (f) => readFileSync(resolve(__dirname, "../../supabase/proposed", f), "utf8");
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SA = uid(1), ADMIN = uid(2), TEACHER = uid(3);
const TYPES = ["literal", "literal", "inferential", "inferential", "inferential", "critical"];
const content = (label, keys) => ({
  title: `The Mango Seed ${label}`,
  paragraphs: [`Lito planted a small mango seed beside the classroom window, story ${label}.`, "Every day he watered it and watched for the first green leaf to appear."],
  questions: TYPES.map((type, i) => ({ id: `q${i + 1}`, type, prompt: `Question ${i + 1} of ${label}?`, correctChoiceId: keys[i],
    choices: ["a", "b", "c", "d"].map((c) => ({ id: c, label: `${label} option ${c}` })) })),
});
const RID = "00000000-0000-4000-8000-0000000000f7";
const SA_REQ = { user: { id: SA }, profile: { id: SA, role: "system_admin" } };
const ADMIN_REQ = { user: { id: ADMIN }, profile: { id: ADMIN, role: "admin" } };
const TEACHER_REQ = { user: { id: TEACHER }, profile: { id: TEACHER, role: "teacher", teacher_status: "approved" } };

async function setup() {
  const d = new PGlite();
  await d.exec(LIVE_FIXTURE);
  for (const [id, role, status] of [[SA, "system_admin", null], [ADMIN, "admin", null], [TEACHER, "teacher", "approved"]]) {
    await d.query("insert into auth.users values ($1)", [id]);
    await d.query("insert into profiles(id, role, teacher_status) values ($1, $2, $3)", [id, role, status]);
  }
  await d.exec(sql("m2_assessment_packages_PROPOSED.sql"));
  await d.exec(sql("m2_initial_activation_PROPOSED.sql"));
  await d.exec(sql("m2_initial_activation_no_endorsement_PROPOSED.sql"));
  const ids = {};
  for (const language of ["en", "fil"]) {
    const code = DIAGNOSTIC_ASSESSMENTS[language];
    const { rows: [p] } = await d.query(`insert into m2_assessment_packages(kind, audience, scope, owner_id, language, title, legacy_assessment_id)
      values ('initial','all_learners','platform',$1,$2,'Initial',$3) returning id`, [SA, language, code.id]);
    await d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, status, source, created_by, published_by, passage_title, paragraphs, questions)
      values ($1, 1, '3.0', 'published', 'code_import', $2, $2, $3, $4, $5)`, [p.id, SA, code.title, JSON.stringify(code.paragraphs),
      JSON.stringify(code.questions.map((q, i) => ({ id: q.id, type: TYPES[i], prompt: "P", correctChoiceId: q.correctChoiceId, choices: ["a", "b", "c", "d"].map((c) => ({ id: c, label: c })) })))]);
    ids[language] = { pkg: p.id };
  }
  const version = async (language, label, upTo, keys = ["c", "d", "b", "a", "c", "d"]) => {
    const c = content(`${language}-${label}`, keys);
    const n = (await d.query("select coalesce(max(version_number), 0) + 1 n from m2_assessment_package_versions where package_id = $1", [ids[language].pkg])).rows[0].n;
    const { rows: [v] } = await d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by, passage_title, paragraphs, questions)
      values ($1, $2, $3, $4, $5, $6, $7) returning id`, [ids[language].pkg, n, label, SA, c.title, JSON.stringify(c.paragraphs), JSON.stringify(c.questions)]);
    if (upTo !== "draft") {
      await d.query("update m2_assessment_package_versions set status = 'in_review', submitted_by = $2 where id = $1", [v.id, SA]);
      if (upTo !== "in_review") await d.query("update m2_assessment_package_versions set status = 'approved', reviewed_by = $2, educator_review_attestation = 'Checked' where id = $1", [v.id, SA]);
      if (upTo === "published") await d.query("select m2_publish_assessment_version($1, $2)", [v.id, SA]);
    }
    return { id: v.id, content: c };
  };
  ids.en.v4 = await version("en", "4.0", "published");
  ids.en.v5 = await version("en", "5.0", "draft");
  ids.fil.v4 = await version("fil", "4.0", "published", ["a", "b", "c", "d", "a", "b"]);
  // A Teacher's private reassessment package (F10), still a draft: preview-only.
  const { rows: [tp] } = await d.query(`insert into m2_assessment_packages(kind, audience, scope, owner_id, language, title)
    values ('reassessment','classroom','teacher',$1,'en','Tess') returning id`, [TEACHER]);
  const tc = content("teacher", ["a", "a", "a", "a", "a", "a"]);
  const { rows: [tv] } = await d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by, passage_title, paragraphs, questions)
    values ($1, 1, '1.0', $2, $3, $4, $5) returning id`, [tp.id, TEACHER, tc.title, JSON.stringify(tc.paragraphs), JSON.stringify(tc.questions)]);
  ids.teacherVersion = tv.id;
  const counts = async () => (await d.query(`select (select count(*) from diagnostic_results)::int r, (select count(*) from m2_initial_activation_events)::int e,
    (select count(*) from m2_assessment_educator_reviews)::int v`)).rows[0];
  await d.exec("set role service_role");
  const supa = createPgliteSupabase(d);
  const practiceVersions = createPracticeVersionService({ getAdmin: () => supa });
  const receipts = testReceipts();
  return { d, ids, practiceVersions, receipts, counts,
    service: createDiagnosticPracticeService({ receipts, practiceVersions }),
    resolveBinding: createDiagnosticBindingResolver({ getReassessments: () => ({ resolveBinding: async () => null }), getPracticeVersions: () => practiceVersions }) };
}
const readingWith = (receipts, userId, language, binding, text) =>
  [receipts.issue({ userId, language, binding, recordingId: RID, segmentIndex: 1, source: "upload", text, confidence: 0.9 })];
const answersFor = (c, correct) => Object.fromEntries(c.questions.map((q, i) => [q.id, i < correct ? q.correctChoiceId : ["a", "b", "c", "d"].find((x) => x !== q.correctChoiceId)]));

test("content: the System Admin gets the EXACT selected version (language, version, title, passage, questions) without answer keys", async () => {
  const ctx = await setup();
  const en = await ctx.practiceVersions.getContent(SA_REQ, ctx.ids.en.v4.id);
  assert.equal(en.assessment.id, `${PRACTICE_VERSION_PREFIX}${ctx.ids.en.v4.id}`);
  assert.deepEqual([en.assessment.language, en.assessment.version, en.assessment.title], ["en", "4.0", "The Mango Seed en-4.0"]);
  assert.deepEqual(en.assessment.passage.paragraphs, ctx.ids.en.v4.content.paragraphs);
  assert.deepEqual(en.assessment.questions.map((q) => q.prompt), ctx.ids.en.v4.content.questions.map((q) => q.prompt));
  assert.equal(JSON.stringify(en).includes("correctChoiceId"), false, "answer keys never leave the server");
  assert.notEqual(en.assessment.title, DIAGNOSTIC_ASSESSMENTS.en.title, "never the built-in 3.0");
  const fil = await ctx.practiceVersions.getContent(SA_REQ, ctx.ids.fil.v4.id);
  assert.deepEqual([fil.assessment.language, fil.assessment.title], ["fil", "The Mango Seed fil-4.0"], "English and Filipino stay separate");
});

test("access: School Admin and Teacher cannot see Initial Diagnostic versions; drafts, reviews, other packages and the built-in are refused", async () => {
  const ctx = await setup();
  for (const requester of [ADMIN_REQ, TEACHER_REQ, { user: { id: uid(9) }, profile: { role: "student" } }]) {
    await assert.rejects(ctx.practiceVersions.getContent(requester, ctx.ids.en.v4.id), (e) => e.statusCode === 404, requester.profile.role);
  }
  await assert.rejects(ctx.practiceVersions.getContent(SA_REQ, ctx.ids.en.v5.id), (e) => e.statusCode === 409 && /Drafts can be previewed only/.test(e.message));
  await assert.rejects(ctx.practiceVersions.getContent(SA_REQ, ctx.ids.teacherVersion), (e) => e.statusCode === 404, "a Teacher's private package is not visible to the System Admin");
  await assert.rejects(ctx.practiceVersions.getContent(TEACHER_REQ, ctx.ids.teacherVersion), (e) => e.statusCode === 409, "a draft Teacher reassessment is preview-only (F10 practice: m2F10Practice.test.js)");
  const builtIn = (await ctx.d.query(`select id from m2_assessment_package_versions where source = 'code_import' and package_id = $1`, [ctx.ids.en.pkg])).rows[0].id;
  await assert.rejects(ctx.practiceVersions.getContent(SA_REQ, builtIn), (e) => e.code === "USE_BUILT_IN_PRACTICE");
  await assert.rejects(ctx.practiceVersions.getContent(SA_REQ, "not-a-uuid"), (e) => e.statusCode === 404);
  const inReview = await (async () => {
    await ctx.d.exec("reset role");
    const n = (await ctx.d.query("select max(version_number) + 1 n from m2_assessment_package_versions where package_id = $1", [ctx.ids.fil.pkg])).rows[0].n;
    const c = content("fil-review", ["a", "a", "a", "a", "a", "a"]);
    const { rows: [v] } = await ctx.d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by, passage_title, paragraphs, questions)
      values ($1, $2, '5.0', $3, $4, $5, $6) returning id`, [ctx.ids.fil.pkg, n, SA, c.title, JSON.stringify(c.paragraphs), JSON.stringify(c.questions)]);
    await ctx.d.query("update m2_assessment_package_versions set status = 'in_review', submitted_by = $2 where id = $1", [v.id, SA]);
    await ctx.d.exec("set role service_role");
    return v.id;
  })();
  await assert.rejects(ctx.practiceVersions.getContent(SA_REQ, inReview), (e) => e.statusCode === 409);
});

test("speech receipts: issued only for the authorised version, its language and label; staff ids never resolve for learners", async () => {
  const ctx = await setup();
  const id = `${PRACTICE_VERSION_PREFIX}${ctx.ids.en.v4.id}`;
  const binding = await ctx.resolveBinding({ requester: SA_REQ, language: "en", assessmentId: id, assessmentVersion: "4.0" });
  assert.equal(binding.assessmentId, id);
  assert.equal(binding.assessmentVersion, "4.0");
  assert.notEqual(binding.passageHash, getDiagnosticAssessmentBinding("en", DIAGNOSTIC_ASSESSMENTS.en.id, DIAGNOSTIC_ASSESSMENTS.en.version).passageHash, "bound to 4.0's passage, not 3.0's");
  assert.equal(await ctx.resolveBinding({ requester: SA_REQ, language: "fil", assessmentId: id, assessmentVersion: "4.0" }), null, "wrong language");
  assert.equal(await ctx.resolveBinding({ requester: SA_REQ, language: "en", assessmentId: id, assessmentVersion: "3.0" }), null, "wrong version label");
  assert.equal(await ctx.resolveBinding({ requester: ADMIN_REQ, language: "en", assessmentId: id, assessmentVersion: "4.0" }), null, "School Admin");
  assert.equal(await ctx.resolveBinding({ requester: { user: { id: uid(9) }, profile: { role: "student" } }, language: "en", assessmentId: id, assessmentVersion: "4.0" }), null, "learners");
  const draftId = `${PRACTICE_VERSION_PREFIX}${ctx.ids.en.v5.id}`;
  assert.equal(await ctx.resolveBinding({ requester: SA_REQ, language: "en", assessmentId: draftId, assessmentVersion: "5.0" }), null, "drafts never get receipts");
  // School Admins and Teachers keep the built-in practice exactly as before.
  const code = DIAGNOSTIC_ASSESSMENTS.en;
  assert.ok(await ctx.resolveBinding({ requester: TEACHER_REQ, language: "en", assessmentId: code.id, assessmentVersion: code.version }));
});

test("scoring: the selected version's own passage and keys; never 3.0; refuses mismatched receipts; writes nothing", async () => {
  const ctx = await setup();
  const v4 = ctx.ids.en.v4;
  const id = `${PRACTICE_VERSION_PREFIX}${v4.id}`;
  const binding = await ctx.resolveBinding({ requester: SA_REQ, language: "en", assessmentId: id, assessmentVersion: "4.0" });
  const transcript = v4.content.paragraphs.join(" ");
  const own = readingWith(ctx.receipts, SA, "en", binding, transcript);
  await ctx.d.exec("reset role");
  const before = await ctx.counts();
  await ctx.d.exec("set role service_role");
  const body = { language: "en", assessmentId: id, assessmentVersion: "4.0", transcriptReceipts: own, recordingDurationSeconds: 30, answers: answersFor(v4.content, 4) };
  const result = await ctx.service.scorePractice(SA_REQ, body);
  const expected = scoreDiagnostic({ assessment: { language: "en", title: v4.content.title, questions: v4.content.questions.map((q) => ({ id: q.id, choiceIds: ["a", "b", "c", "d"], correctChoiceId: q.correctChoiceId })) },
    passageText: transcript, transcript, recordingDurationSeconds: 30, answers: body.answers });
  assert.deepEqual([result.practice, result.saved, result.assessmentId, result.assessmentVersion, result.passageTitle], [true, false, id, "4.0", v4.content.title]);
  assert.deepEqual([result.wordRecognitionScore, result.comprehensionScore, result.readingLevel], [expected.orvScore, expected.comprehensionScore, expected.readingLevel]);
  assert.deepEqual([result.comprehension.correct, result.comprehension.total], [4, 6], "scored with 4.0's answer keys");
  assert.equal(JSON.stringify(result).includes("correctChoiceId"), false);

  // Receipts for the built-in 3.0, for another version or another account are refused for 4.0 (and vice versa).
  const code = DIAGNOSTIC_ASSESSMENTS.en;
  const codeReceipts = readingWith(ctx.receipts, SA, "en", getDiagnosticAssessmentBinding("en", code.id, code.version), transcript);
  await assert.rejects(ctx.service.scorePractice(SA_REQ, { ...body, transcriptReceipts: codeReceipts }), (e) => e.code === "READING_NOT_VERIFIED");
  await assert.rejects(ctx.service.scorePractice(SA_REQ, { ...body, transcriptReceipts: readingWith(ctx.receipts, ADMIN, "en", binding, transcript) }), (e) => e.code === "READING_NOT_VERIFIED");
  await assert.rejects(ctx.service.scorePractice(SA_REQ, { language: "en", assessmentId: code.id, assessmentVersion: code.version, transcriptReceipts: own,
    recordingDurationSeconds: 30, answers: Object.fromEntries(code.questions.map((q) => [q.id, q.correctChoiceId])) }), (e) => e.code === "READING_NOT_VERIFIED", "a 4.0 receipt never scores 3.0");
  await assert.rejects(ctx.service.scorePractice(SA_REQ, { ...body, assessmentVersion: "3.0" }), (e) => e.code === "ASSESSMENT_CHANGED");
  await assert.rejects(ctx.service.scorePractice(SA_REQ, { ...body, language: "fil" }), (e) => e.code === "ASSESSMENT_CHANGED");
  await assert.rejects(ctx.service.scorePractice(ADMIN_REQ, body), (e) => e.statusCode === 404, "School Admins cannot score this version");
  await assert.rejects(ctx.service.scorePractice(SA_REQ, { ...body, assessmentId: `${PRACTICE_VERSION_PREFIX}${ctx.ids.en.v5.id}`, assessmentVersion: "5.0" }), (e) => e.statusCode === 409, "drafts are never scored");

  await ctx.d.exec("reset role");
  assert.deepEqual(await ctx.counts(), before, "no result, activation, review, XP or other record is written");
});

test("the authored version learners take stays practisable after a newer version replaces it in the library", async () => {
  const ctx = await setup();
  await ctx.d.exec("reset role");
  await ctx.d.query("select m2_activate_initial_version('en', $1, null, $2)", [ctx.ids.en.v4.id, SA]);
  await ctx.d.exec("update m2_assessment_package_versions set status = 'in_review', submitted_by = created_by where version_label = '5.0' and status = 'draft'");
  await ctx.d.exec("update m2_assessment_package_versions set status = 'approved', reviewed_by = created_by, educator_review_attestation = 'Checked' where version_label = '5.0' and status = 'in_review'");
  const v5 = (await ctx.d.query("select id from m2_assessment_package_versions where version_label = '5.0' and package_id = $1", [ctx.ids.en.pkg])).rows[0].id;
  await ctx.d.query("select m2_publish_assessment_version($1, $2)", [v5, SA]);
  assert.equal((await ctx.d.query("select status from m2_assessment_package_versions where id = $1", [ctx.ids.en.v4.id])).rows[0].status, "retired");
  await ctx.d.exec("set role service_role");
  const content4 = await ctx.practiceVersions.getContent(SA_REQ, ctx.ids.en.v4.id);
  assert.equal(content4.activeForLearners, true, "the active (retired-in-library) 4.0 can still be tried");
  const content5 = await ctx.practiceVersions.getContent(SA_REQ, v5);
  assert.equal(content5.assessment.version, "5.0");
});
