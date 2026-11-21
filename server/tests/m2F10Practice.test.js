// M2 F10 — Try Assessment for a reassessment package version (System Admin, School Admin, Teacher). Runs the REAL
// proposed SQL (packages, reassessment foundation, F10 direct publishing) on the live diagnostic_results fixture in an
// in-memory database, with real receipt signing and the real server scorer. Synthetic content only. Practice reads only.
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
const { testReceipts } = require("./fixtures/diagnosticTrust");

const sql = (f) => readFileSync(resolve(__dirname, "../../supabase/proposed", f), "utf8");
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = { sa: [uid(1), "system_admin", null], admin: [uid(2), "admin", null], teacher: [uid(3), "teacher", "approved"],
  other: [uid(4), "teacher", "approved"], pending: [uid(5), "teacher", "pending"], student: [uid(6), "student", null], learner: [uid(7), "general_user", null] };
const REQ = Object.fromEntries(Object.entries(P).map(([k, [id, role, status]]) => [k, { user: { id }, profile: { id, role, teacher_status: status } }]));
const TYPES = ["literal", "literal", "inferential", "inferential", "inferential", "critical"];
const SHAPES = { teacher: ["reassessment", "classroom", "teacher"], school: ["reassessment", "classroom", "school"], independent: ["reassessment", "independent_learners", "platform"] };
const RID = "00000000-0000-4000-8000-0000000000f1";
const content = (label, keys) => ({
  title: `Ang Saranggola ${label}`,
  paragraphs: [`Si Lito ay gumawa ng saranggola para sa pista, kuwento ${label}.`, "Tuwing hapon, pinalipad niya ito sa bukid kasama ang kanyang kapatid."],
  questions: TYPES.map((type, i) => ({ id: `q${i + 1}`, type, prompt: `Tanong ${i + 1} ${label}?`, correctChoiceId: keys[i],
    choices: ["a", "b", "c", "d"].map((c) => ({ id: c, label: `${label} pili ${c}` })) })),
});

async function setup() {
  const d = new PGlite();
  await d.exec(LIVE_FIXTURE);
  for (const [id, role, status] of Object.values(P)) {
    await d.query("insert into auth.users values ($1)", [id]);
    await d.query("insert into profiles(id, role, teacher_status) values ($1, $2, $3)", [id, role, status]);
  }
  for (const f of ["m2_assessment_packages_PROPOSED.sql", "m2_reassessment_foundation_PROPOSED.sql", "m2_f10_direct_publish_PROPOSED.sql"]) await d.exec(sql(f));
  const packageOf = async (category, owner, language) => (await d.query(`insert into m2_assessment_packages(kind, audience, scope, owner_id, language, title)
    values ($1,$2,$3,$4,$5,$6) returning id`, [...SHAPES[category], owner, language, `${category} ${language}`])).rows[0].id;
  const versionOf = async (pkg, owner, tag, publish, keys = ["b", "c", "d", "a", "b", "c"]) => {
    const c = content(tag, keys);
    const n = (await d.query("select coalesce(max(version_number), 0) + 1 n from m2_assessment_package_versions where package_id = $1", [pkg])).rows[0].n;
    const label = `${n}.0`;
    const { rows: [v] } = await d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by, passage_title, paragraphs, questions)
      values ($1, $2, $3, $4, $5, $6, $7) returning id`, [pkg, n, label, owner, c.title, JSON.stringify(c.paragraphs), JSON.stringify(c.questions)]);
    if (publish) await d.query("select m2_publish_assessment_version($1, $2)", [v.id, owner]); // F10 direct publish
    return { id: v.id, label, content: c };
  };
  const ids = {};
  for (const [key, category, owner, language] of [["teacherEn", "teacher", P.teacher[0], "en"], ["teacherFil", "teacher", P.teacher[0], "fil"],
    ["other", "teacher", P.other[0], "en"], ["school", "school", P.admin[0], "fil"], ["central", "independent", P.sa[0], "en"]]) {
    const pkg = await packageOf(category, owner, language);
    ids[key] = { pkg, v1: await versionOf(pkg, owner, `${key} 1.0`, true) };
  }
  // The central package also has 2.0 published (1.0 retired) and a 3.0 draft.
  ids.central.v2 = await versionOf(ids.central.pkg, P.sa[0], "central 2.0", true, ["a", "a", "b", "b", "c", "c"]);
  ids.central.v3 = await versionOf(ids.central.pkg, P.sa[0], "central 3.0", false);
  const fingerprint = async () => (await d.query(`select
    (select md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), '')) from diagnostic_results x) r,
    (select md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), '')) from m2_assessment_package_versions x) v,
    (select md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), '')) from m2_reassessment_assignments x) a,
    (select md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), '')) from m2_assessment_educator_reviews x) e,
    (select to_jsonb(s)::text from m2_reassessment_settings s) s`)).rows[0];
  await d.exec("set role service_role");
  const supa = createPgliteSupabase(d);
  const practiceVersions = createPracticeVersionService({ getAdmin: () => supa, schoolFilter: async (_requester, ids) => new Set(ids.filter(Boolean)) });
  const receipts = testReceipts();
  return { d, ids, practiceVersions, receipts, fingerprint,
    service: createDiagnosticPracticeService({ receipts, practiceVersions }),
    resolveBinding: createDiagnosticBindingResolver({ getReassessments: () => ({ resolveBinding: async () => null }), getPracticeVersions: () => practiceVersions }) };
}
const refused = (promise, status) => assert.rejects(promise, (e) => { assert.equal(e.statusCode, status, e.message); return true; });

test("each manager tries the EXACT selected published version of their own package, without answer keys and with switches OFF", async () => {
  const ctx = await setup();
  await ctx.d.exec("reset role");
  assert.deepEqual((await ctx.d.query("select official_reassessment_enabled o, independent_learner_enabled i from m2_reassessment_settings")).rows[0], { o: false, i: false });
  await ctx.d.exec("set role service_role");
  for (const [who, key, version, category, language] of [["teacher", "teacherEn", "v1", "teacher", "en"], ["teacher", "teacherFil", "v1", "teacher", "fil"],
    ["admin", "school", "v1", "school", "fil"], ["sa", "central", "v2", "independent", "en"]]) {
    const v = ctx.ids[key][version];
    const got = await ctx.practiceVersions.getContent(REQ[who], v.id);
    assert.deepEqual([got.versionId, got.packageId, got.packageCategory, got.activeForLearners], [v.id, ctx.ids[key].pkg, category, false], `${who} ${key}`);
    assert.deepEqual([got.assessment.id, got.assessment.language, got.assessment.title], [`${PRACTICE_VERSION_PREFIX}${v.id}`, language, v.content.title]);
    assert.deepEqual(got.assessment.passage.paragraphs, v.content.paragraphs);
    assert.deepEqual(got.assessment.questions.map((q) => q.prompt), v.content.questions.map((q) => q.prompt), "questions in order");
    assert.equal(JSON.stringify(got).includes("correctChoiceId"), false, "answer keys never leave the server");
  }
});

test("server-side access: nobody tries another role's or another Teacher's package; drafts and retired versions are preview-only", async () => {
  const ctx = await setup();
  const { ids } = ctx;
  const cases = [
    ["other", ids.teacherEn.v1], ["admin", ids.teacherEn.v1], ["sa", ids.teacherEn.v1], // another Teacher's private package
    ["teacher", ids.school.v1], ["sa", ids.school.v1], // school package
    ["teacher", ids.central.v2], ["admin", ids.central.v2], // central Independent Learner package
    ["pending", ids.teacherEn.v1], ["student", ids.teacherEn.v1], ["learner", ids.central.v2],
  ];
  for (const [who, v] of cases) await refused(ctx.practiceVersions.getContent(REQ[who], v.id), 404); // invisible and missing look the same
  await refused(ctx.practiceVersions.getContent(REQ.sa, ids.central.v3.id), 409); // draft
  await refused(ctx.practiceVersions.getContent(REQ.sa, ids.central.v1.id), 409); // retired by 2.0
  await refused(ctx.practiceVersions.getContent(REQ.sa, "not-a-uuid"), 404);
  // Receipts are issued only to the package's manager, for that version, language and label.
  const id = `${PRACTICE_VERSION_PREFIX}${ids.teacherFil.v1.id}`;
  const binding = await ctx.resolveBinding({ requester: REQ.teacher, language: "fil", assessmentId: id, assessmentVersion: "1.0" });
  assert.equal(binding.assessmentId, id);
  assert.doesNotMatch(binding.assessmentId, /^m2-package-version:/, "never the official reassessment binding");
  for (const [who, language, label] of [["other", "fil", "1.0"], ["admin", "fil", "1.0"], ["teacher", "en", "1.0"], ["teacher", "fil", "2.0"]]) {
    assert.equal(await ctx.resolveBinding({ requester: REQ[who], language, assessmentId: id, assessmentVersion: label }), null, `${who} ${language} ${label}`);
  }
});

test("scoring a Teacher's practice: own passage and keys; practice only; nothing official is written", async () => {
  const ctx = await setup();
  await ctx.d.exec("reset role");
  const before = await ctx.fingerprint();
  await ctx.d.exec("set role service_role");
  const v = ctx.ids.teacherFil.v1;
  const id = `${PRACTICE_VERSION_PREFIX}${v.id}`;
  const binding = await ctx.resolveBinding({ requester: REQ.teacher, language: "fil", assessmentId: id, assessmentVersion: "1.0" });
  const transcript = v.content.paragraphs.join(" ");
  const receipts = [ctx.receipts.issue({ userId: P.teacher[0], language: "fil", binding, recordingId: RID, segmentIndex: 1, source: "upload", text: transcript, confidence: 0.9 })];
  const answers = Object.fromEntries(v.content.questions.map((q, i) => [q.id, i < 5 ? q.correctChoiceId : "a"]));
  const body = { language: "fil", assessmentId: id, assessmentVersion: "1.0", transcriptReceipts: receipts, recordingDurationSeconds: 30, answers };
  const result = await ctx.service.scorePractice(REQ.teacher, body);
  assert.deepEqual([result.practice, result.saved, result.assessmentId, result.passageTitle], [true, false, id, v.content.title]);
  assert.deepEqual([result.comprehension.correct, result.comprehension.total], [5, 6], "scored with this version's own answer keys");
  await assert.rejects(ctx.service.scorePractice(REQ.other, body), (e) => e.statusCode === 404, "another Teacher cannot score it");
  await assert.rejects(ctx.service.scorePractice(REQ.admin, body), (e) => e.statusCode === 404, "the School Admin cannot score it");
  await ctx.d.exec("reset role");
  assert.deepEqual(await ctx.fingerprint(), before, "no result, assignment, version, review or setting changed");
});
