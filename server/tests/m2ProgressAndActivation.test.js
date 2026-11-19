// M2 F5 (reading progress) and F6 (controlled initial diagnostic activation). F6 runs the REAL proposed SQL
// (packages + activation) on the live diagnostic_results fixture (incl. the live M8 trigger) through the real official
// result service and real receipt signing. Synthetic content only; the official 3.0 question bank is not changed.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const express = require("express");
const { PGlite } = require("@electric-sql/pglite");
const { LIVE_FIXTURE } = require("../../supabase/tests/fixtures/liveDiagnosticFixture.cjs");
const { createPgliteSupabase } = require("./helpers/pgliteSupabase");
const { buildReadingProgress } = require("../services/readingProgressService");
const { createDiagnosticHistoryRouter } = require("../routes/diagnosticHistory");
const { listSchoolStudentResults } = require("../services/diagnosticHistoryService");
const { createInitialDiagnosticService } = require("../services/initialDiagnosticService");
const { createDiagnosticResultService } = require("../services/diagnosticResultService");
const { createDiagnosticBindingResolver } = require("../services/diagnosticBindingResolver");
const { createTranscriptReceiptService } = require("../services/diagnosticTranscriptReceipts");
const { createInitialDiagnosticRouter } = require("../routes/initialDiagnostic");
const { DIAGNOSTIC_ASSESSMENTS, getDiagnosticPassageText } = require("../services/diagnosticAssessments");
const { getPlacement } = require("../services/currentReadingLevelService");
const { isOfficialInitialResult } = require("../services/initialDiagnosticCompletion");

// ---------------- F5: calculations ----------------
const entry = (extra) => ({ id: extra.id ?? "x", assessmentType: "initial", language: "en", completedAt: "2026-10-01T00:00:00Z", wordRecognitionScore: 92,
  comprehensionScore: 66.7, readingLevel: "Instructional", assessmentId: "grade5-en-passage-v3", assessmentVersion: "3.0", assessmentTitle: "Garden", verified: true, ...extra });

test("F5: initial only -> current = initial; no change claimed", () => {
  const p = buildReadingProgress([entry({ id: "i" })]);
  assert.deepEqual([p.en.current.readingLevel, p.en.current.rule, p.en.change.status], ["Instructional", "initial", "insufficient"]);
  assert.deepEqual([p.fil.current, p.fil.change.status], [null, "none"], "Filipino has no official assessment");
});

test("F5: initial + reassessments; switch OFF keeps the initial as current and explains it; switch ON follows the latest", () => {
  const entries = [entry({ id: "i", readingLevel: "Frustration" }),
    entry({ id: "r1", assessmentType: "reassessment", assessmentId: "pkg", assessmentVersion: "1.0", readingLevel: "Instructional", completedAt: "2026-11-01T00:00:00Z" }),
    entry({ id: "r2", assessmentType: "reassessment", assessmentId: "pkg2", assessmentVersion: "1.0", readingLevel: "Independent", completedAt: "2026-11-15T00:00:00Z" })];
  const off = buildReadingProgress(entries);
  assert.deepEqual([off.en.current.readingLevel, off.en.current.source], ["Frustration", "initial"]);
  assert.match(off.en.placementNote, /placement still uses the initial diagnostic/);
  assert.deepEqual([off.en.change.status, off.en.change.direction, off.en.change.basedOn], ["compared", "higher", 3]);
  assert.doesNotMatch(off.en.change.message, /trend|improving/i, "a change between results, never a trend");
  assert.deepEqual(off.en.reassessments.map((r) => r.id), ["r1", "r2"]);
  const on = buildReadingProgress(entries, { followsReassessment: true });
  assert.deepEqual([on.en.current.readingLevel, on.en.current.source, on.en.placementNote], ["Independent", "reassessment", null]);
});

test("F5: only official results count (unverified, v2.0, other versions, practice never)", () => {
  const p = buildReadingProgress([
    entry({ id: "u", verified: false, readingLevel: "Independent" }),
    entry({ id: "v2", assessmentId: "grade5-en-sentences-v2", assessmentVersion: "2.0", readingLevel: "Independent" }),
    entry({ id: "lower", assessmentVersion: "0.9", readingLevel: "Independent" }),
    entry({ id: "ok", readingLevel: "Frustration" }),
    entry({ id: "fil", language: "fil", assessmentId: "grade5-fil-passage-v3", readingLevel: "Independent" }),
  ]);
  assert.deepEqual([p.en.current.readingLevel, p.en.initial.id, p.en.change.status], ["Frustration", "ok", "insufficient"]);
  assert.equal(p.fil.current.readingLevel, "Independent", "English and Filipino are separate");
  assert.equal(p.en.reassessments.length, 0);
});

async function call(router, path) {
  const app = express();
  app.use("/api/diagnostic-history", router);
  const server = app.listen(0);
  try { const r = await fetch(`http://127.0.0.1:${server.address().port}/api/diagnostic-history${path}`); return { status: r.status, body: await r.json() }; }
  finally { server.close(); }
}
const who = (id, role, teacher_status = null) => async () => ({ user: { id }, profile: { role, teacher_status } });

test("F5 routes: own progress for learners; Teachers through the F3 active-room scope; School Admin only for the school list", async () => {
  const own = [];
  const base = { listOwn: async (u) => { own.push(u); return [entry({ id: "i" })]; }, placementSwitch: async () => false,
    listTeacher: async () => ({ students: [{ id: "s1", name: "Ana", rooms: [{ id: "r", name: "Room" }], results: [entry({ id: "i" })] }] }),
    listSchool: async () => [{ id: "s1", name: "Ana", results: [entry({ id: "i" })] }] };
  for (const role of ["student", "general_user"]) {
    const r = await call(createDiagnosticHistoryRouter({ ...base, authorizeLearner: who("L1", role) }), "/progress/me?userId=someone-else");
    assert.deepEqual([r.status, r.body.progress.en.current.readingLevel], [200, "Instructional"]);
  }
  assert.deepEqual(own, ["L1", "L1"], "the learner id comes from the session");
  assert.equal((await call(createDiagnosticHistoryRouter({ ...base, authorizeLearner: who("T", "teacher", "approved") }), "/progress/me")).status, 403);
  const t = await call(createDiagnosticHistoryRouter({ ...base, authorizeTeacher: who("T", "teacher", "approved") }), "/progress/teacher");
  assert.deepEqual([t.status, t.body.students[0].name, t.body.students[0].rooms.length, Object.keys(t.body.students[0])], [200, "Ana", 1, ["id", "name", "rooms", "progress"]]);
  assert.equal((await call(createDiagnosticHistoryRouter({ ...base, authorizeTeacher: who("T", "teacher", "pending") }), "/progress/teacher")).status, 403);
  const s = await call(createDiagnosticHistoryRouter({ ...base, authorizeSchoolAdmin: who("A", "admin") }), "/progress/school");
  assert.deepEqual([s.status, s.body.students.length], [200, 1]);
  for (const role of ["system_admin", "teacher", "student", "general_user"]) {
    assert.equal((await call(createDiagnosticHistoryRouter({ ...base, authorizeSchoolAdmin: who("X", role, "approved") }), "/progress/school")).status, 403, role);
  }
});

test("F5 school scope: Students only (Independent Learners excluded); results never include answers or transcripts", async () => {
  const d = new PGlite();
  await d.exec(LIVE_FIXTURE);
  const ids = { s: "00000000-0000-4000-8000-000000000001", il: "00000000-0000-4000-8000-000000000002" };
  for (const [key, role] of [["s", "student"], ["il", "general_user"]]) {
    await d.query("insert into auth.users values ($1)", [ids[key]]);
    await d.query("insert into profiles(id, role, full_name, nickname) values ($1, $2, $3, $3)", [ids[key], role, `N${key}`]);
    await d.query(`insert into diagnostic_results(user_id, language, assessment_id, assessment_version, orv_score, comprehension_score, reading_level, difficulty_tier,
      transcript, oral_reading_metrics, verification_status, verification_method, verification_recording_id, verified_at)
      values ($1, 'en', 'grade5-en-passage-v3', '3.0', 90, 60, 'Instructional', 'Medium', 'SECRET TRANSCRIPT', '{"comprehensionAnswers":{"q1":"a"}}', 'server_verified', 'm', $1, now())`, [ids[key]]);
  }
  const students = await listSchoolStudentResults({ getAdmin: () => createPgliteSupabase(d) });
  assert.deepEqual(students.map((s) => s.id), [ids.s]);
  assert.doesNotMatch(JSON.stringify(students), /SECRET|comprehensionAnswers/);
});

// ---------------- F6: controlled activation (real SQL) ----------------
const sql = (f) => readFileSync(resolve(__dirname, "../../supabase/proposed", f), "utf8");
const SECRET = "test-receipt-secret-that-is-long-enough-123456";
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SA = uid(1), ADMIN = uid(2);
const NEW_PARAGRAPHS = ["Lito planted a small mango seed beside the classroom window one rainy morning.", "Every day he watered it and watched for the first green leaf to appear."];
const NEW_KEYS = ["c", "d", "b", "a", "c", "d"];
const NEW_QUESTIONS = ["literal", "literal", "inferential", "inferential", "inferential", "critical"].map((type, i) => ({
  id: `new-q${i + 1}`, type, prompt: `New question ${i + 1}?`, correctChoiceId: NEW_KEYS[i], choices: ["a", "b", "c", "d"].map((c) => ({ id: c, label: `Option ${c}` })) }));

async function f6Setup() {
  const d = new PGlite();
  await d.exec(LIVE_FIXTURE);
  for (const [id, role] of [[SA, "system_admin"], [ADMIN, "admin"]]) {
    await d.query("insert into auth.users values ($1)", [id]);
    await d.query("insert into profiles(id, role) values ($1, $2)", [id, role]);
  }
  await d.exec(sql("m2_assessment_packages_PROPOSED.sql"));
  await d.exec(sql("m2_initial_activation_PROPOSED.sql"));
  // The English lineage: the imported 3.0 plus a synthetic, published, endorsed 4.0.
  const code = DIAGNOSTIC_ASSESSMENTS.en;
  const { rows: [p] } = await d.query(`insert into m2_assessment_packages(kind, audience, scope, owner_id, language, title, legacy_assessment_id) values ('initial','all_learners','platform',$1,'en','Initial',$2) returning id`, [SA, code.id]);
  await d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, status, source, created_by, published_by, passage_title, paragraphs, questions)
    values ($1, 1, '3.0', 'published', 'code_import', $2, $2, $3, $4, $5)`, [p.id, SA, code.title, JSON.stringify(code.paragraphs),
    JSON.stringify(code.questions.map((q, i) => ({ id: q.id, type: ["literal", "literal", "inferential", "inferential", "inferential", "critical"][i], prompt: "P", correctChoiceId: q.correctChoiceId, choices: ["a", "b", "c", "d"].map((c) => ({ id: c, label: c })) })))]);
  const { rows: [v] } = await d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by, passage_title, paragraphs, questions)
    values ($1, 2, '4.0', $2, 'The Mango Seed', $3, $4) returning id`, [p.id, SA, JSON.stringify(NEW_PARAGRAPHS), JSON.stringify(NEW_QUESTIONS)]);
  await d.query(`update m2_assessment_package_versions set status = 'in_review', submitted_by = $2 where id = $1`, [v.id, SA]);
  await d.query(`update m2_assessment_package_versions set status = 'approved', reviewed_by = $2, educator_review_attestation = 'Library' where id = $1`, [v.id, SA]);
  await d.query(`insert into m2_assessment_educator_reviews(version_id, reviewer_name, reviewer_qualification, reviewed_on, passage_suitable, questions_sound,
    answer_keys_correct, language_accurate, outcome, recorded_by) values ($1, 'R', 'Grade 5 English teacher (stated)', current_date, true, true, true, true, 'endorsed', $2)`, [v.id, SA]);
  await d.query("select m2_publish_assessment_version($1, $2)", [v.id, SA]);
  await d.exec("set role service_role");
  const supa = createPgliteSupabase(d);
  let clock = Date.now();
  const receipts = createTranscriptReceiptService({ getSecret: () => SECRET, now: () => clock });
  const initial = createInitialDiagnosticService({ getAdmin: () => supa, now: () => clock });
  const results = createDiagnosticResultService({ receipts, getAdmin: () => supa, initialAssessments: initial });
  const resolveBinding = createDiagnosticBindingResolver({ initialAssessments: initial, getReassessments: () => ({ resolveBinding: async () => null }) });
  return { d, supa, receipts, initial, results, resolveBinding, versionId: v.id, packageId: p.id, advance: (ms) => { clock += ms; } };
}
let learners = 100;
async function learner(d, role = "student") {
  const id = uid(++learners);
  await d.exec("reset role");
  await d.query("insert into auth.users values ($1)", [id]);
  await d.query("insert into profiles(id, role) values ($1, $2)", [id, role]);
  await d.exec("set role service_role");
  return { user: { id }, profile: { role } };
}
const activate = (d, version, expected) => d.query("select m2_activate_initial_version('en', $1, $2, $3)", [version, expected, SA]);
async function take(ctx, requester, { version = "3.0", answers, recording = uid(5000 + learners), advance = 0 } = {}) {
  const binding = await ctx.resolveBinding({ requester, language: "en", assessmentId: DIAGNOSTIC_ASSESSMENTS.en.id, assessmentVersion: version });
  if (!binding) return { refused: "binding" };
  const text = version === "3.0" ? getDiagnosticPassageText(DIAGNOSTIC_ASSESSMENTS.en) : NEW_PARAGRAPHS.join(" ");
  const token = ctx.receipts.issue({ userId: requester.user.id, language: "en", binding, recordingId: recording, segmentIndex: 1, source: "stream", text, confidence: 0.9, audioSeconds: 30 });
  if (advance) ctx.advance(advance);
  return ctx.results.submitInitialDiagnostic(requester, { language: "en", assessmentId: DIAGNOSTIC_ASSESSMENTS.en.id, assessmentVersion: version,
    answers: answers ?? (version === "3.0" ? Object.fromEntries(DIAGNOSTIC_ASSESSMENTS.en.questions.map((q) => [q.id, q.correctChoiceId]))
      : Object.fromEntries(NEW_QUESTIONS.map((q) => [q.id, q.correctChoiceId]))), transcriptReceipts: [token], recordingDurationSeconds: 30 });
}

test("F6 default: the built-in 3.0 stays active; learners take and complete it exactly as before", async () => {
  const ctx = await f6Setup();
  const delivery = await ctx.initial.delivery("en");
  assert.deepEqual([delivery.active.source, delivery.active.version, delivery.delivered.source], ["code", "3.0", "code"]);
  const s = await learner(ctx.d);
  const { row } = await take(ctx, s);
  assert.deepEqual([row.assessment_id, row.assessment_version, row.reading_level], [DIAGNOSTIC_ASSESSMENTS.en.id, "3.0", "Independent"]);
  assert.equal(isOfficialInitialResult(row), true);
});

test("F6 activation of 4.0: new learners get 4.0 (no keys delivered), scored with 4.0's keys; 3.0 completers never retake", async () => {
  const ctx = await f6Setup();
  const done3 = await learner(ctx.d);
  await take(ctx, done3); // completed 3.0 before activation
  await activate(ctx.d, ctx.versionId, null);
  const delivery = await ctx.initial.delivery("en");
  assert.deepEqual([delivery.active.source, delivery.active.version, delivery.delivered.version], ["package", "4.0", "4.0"]);
  assert.deepEqual(delivery.accepted.map((a) => a.version), ["4.0", "3.0"], "3.0 still accepted for in-progress sessions (grace)");
  assert.deepEqual(delivery.delivered.assessment.passage.paragraphs, NEW_PARAGRAPHS);
  assert.doesNotMatch(JSON.stringify(delivery), /correctChoiceId|"type"|literal|inferential/);
  const fresh = await learner(ctx.d);
  const { row } = await take(ctx, fresh, { version: "4.0" });
  assert.deepEqual([row.assessment_id, row.assessment_version, row.reading_level, Number(row.comprehension_score)], [DIAGNOSTIC_ASSESSMENTS.en.id, "4.0", "Independent", 100]);
  // Wrong (3.0-keyed) answers on 4.0 score 0: the server uses the delivered version's own keys.
  const wrongKeys = await learner(ctx.d);
  const wrong = await take(ctx, wrongKeys, { version: "4.0", answers: Object.fromEntries(NEW_QUESTIONS.map((q) => [q.id, "a"])) });
  assert.ok(Math.abs(Number(wrong.row.comprehension_score) - (100 * NEW_KEYS.filter((k) => k === "a").length) / 6) < 0.01, "scored with 4.0 keys");
  assert.equal(isOfficialInitialResult(row), true, "4.0 counts as initial completion");
  const placement = await getPlacement(fresh.user.id, "en", { getAdmin: () => ctx.supa });
  assert.deepEqual([placement.status, placement.assessmentVersion, placement.source], ["ready", "4.0", "initial"]);
  await assert.rejects(take(ctx, done3, { version: "4.0" }), (e) => e.code === "DIAGNOSTIC_ALREADY_COMPLETED" && e.statusCode === 409, "a 3.0 completer cannot take 4.0");
  assert.equal((await getPlacement(done3.user.id, "en", { getAdmin: () => ctx.supa })).assessmentVersion, "3.0", "3.0 completion and placement kept");
});

test("F6 in-progress sessions: a learner who started 3.0 finishes 3.0 within 24 hours; after that only 4.0 is accepted", async () => {
  const ctx = await f6Setup();
  const reader = await learner(ctx.d);
  const binding3 = await ctx.resolveBinding({ requester: reader, language: "en", assessmentId: DIAGNOSTIC_ASSESSMENTS.en.id, assessmentVersion: "3.0" });
  assert.ok(binding3, "reading 3.0 before activation");
  await activate(ctx.d, ctx.versionId, null);
  const { row } = await take(ctx, reader, { version: "3.0" });
  assert.equal(row.assessment_version, "3.0", "the content did not change midway");
  ctx.advance(25 * 3600 * 1000);
  const late = await learner(ctx.d);
  assert.deepEqual(await take(ctx, late, { version: "3.0" }), { refused: "binding" }, "no new 3.0 readings after the grace window");
  assert.deepEqual((await ctx.initial.delivery("en")).accepted.map((a) => a.version), ["4.0"]);
  // F7 Practice Mode (staff) keeps using the built-in version.
  const staff = { user: { id: SA }, profile: { role: "system_admin" } };
  assert.ok(await ctx.resolveBinding({ requester: staff, language: "en", assessmentId: DIAGNOSTIC_ASSESSMENTS.en.id, assessmentVersion: "3.0" }));
});

test("F6 receipts are bound to the exact version: a 3.0 reading cannot be submitted as 4.0", async () => {
  const ctx = await f6Setup();
  await activate(ctx.d, ctx.versionId, null);
  const s = await learner(ctx.d);
  const binding3 = await ctx.resolveBinding({ requester: s, language: "en", assessmentId: DIAGNOSTIC_ASSESSMENTS.en.id, assessmentVersion: "3.0" });
  const token = ctx.receipts.issue({ userId: s.user.id, language: "en", binding: binding3, recordingId: uid(9001), segmentIndex: 1, source: "stream",
    text: getDiagnosticPassageText(DIAGNOSTIC_ASSESSMENTS.en), confidence: 0.9, audioSeconds: 30 });
  await assert.rejects(ctx.results.submitInitialDiagnostic(s, { language: "en", assessmentId: DIAGNOSTIC_ASSESSMENTS.en.id, assessmentVersion: "4.0",
    answers: Object.fromEntries(NEW_QUESTIONS.map((q) => [q.id, q.correctChoiceId])), transcriptReceipts: [token] }), (e) => e.code === "READING_NOT_VERIFIED");
  await assert.rejects(ctx.results.submitInitialDiagnostic(s, { language: "en", assessmentId: DIAGNOSTIC_ASSESSMENTS.en.id, assessmentVersion: "9.9",
    answers: {}, transcriptReceipts: [token] }), (e) => e.code === "ASSESSMENT_CHANGED");
});

test("F6 database: one official initial per learner per language; M8 treats a 4.0 initial like 3.0", async () => {
  const ctx = await f6Setup();
  await activate(ctx.d, ctx.versionId, null);
  const s = await learner(ctx.d);
  await take(ctx, s, { version: "4.0", answers: Object.fromEntries(NEW_QUESTIONS.map((q, i) => [q.id, i < 4 ? q.correctChoiceId : "a"])) });
  await ctx.d.exec("reset role");
  const m8 = (await ctx.d.query(`select (select unlocked_difficulty from m8_learner_progress where user_id = $1) u,
    (select count(*)::int from m8_earned_badges where user_id = $1 and badge_id = 'level_up') b, m8_badge_eligible($1, 'level_up') e, m2_trusted_reading_level($1, 'en') t`, [s.user.id])).rows[0];
  const level = (await ctx.d.query(`select reading_level from diagnostic_results where user_id = $1`, [s.user.id])).rows[0].reading_level;
  assert.equal(m8.t, level, "M8 reads the 4.0 initial as the trusted level");
  assert.equal(m8.u, { Frustration: "Easy", Instructional: "Medium", Independent: "Hard" }[level]);
  assert.equal(m8.b, level === "Frustration" ? 0 : 1);
  await assert.rejects(ctx.d.query(`insert into diagnostic_results(user_id, language, assessment_id, assessment_version, orv_score, comprehension_score, reading_level, difficulty_tier,
    verification_status, verification_method, verification_recording_id, verified_at) values ($1, 'en', $2, '3.0', 90, 60, 'Instructional', 'Medium', 'server_verified', 'm', $3, now())`,
  [s.user.id, DIAGNOSTIC_ASSESSMENTS.en.id, uid(9999)]), /diagnostic_results_one_verified_initial_per_language/);
});

test("F6 delivery route: learners only; never answer keys; the server chooses the version", async () => {
  const ctx = await f6Setup();
  await activate(ctx.d, ctx.versionId, null);
  const app = express();
  const mount = (role) => createInitialDiagnosticRouter({ initialAssessments: ctx.initial, authorize: async () => ({ user: { id: uid(77) }, profile: { role } }) });
  const get = async (role, path) => {
    const a = express(); a.use(mount(role)); const server = a.listen(0);
    try { const r = await fetch(`http://127.0.0.1:${server.address().port}${path}`); return { status: r.status, body: await r.json() }; } finally { server.close(); }
  };
  void app;
  const r = await get("student", "/api/diagnostic/initial/en");
  assert.deepEqual([r.status, r.body.delivered.version], [200, "4.0"]);
  assert.doesNotMatch(JSON.stringify(r.body), /correctChoiceId/);
  assert.equal((await get("general_user", "/api/diagnostic/initial/en?version=3.0")).body.delivered.version, "3.0", "an in-progress 3.0 session can reopen 3.0");
  assert.equal((await get("student", "/api/diagnostic/initial/en?version=7.0")).status, 409);
  for (const role of ["teacher", "admin", "system_admin"]) assert.equal((await get(role, "/api/diagnostic/initial/en")).status, 403, role);
  assert.equal((await get("student", "/api/diagnostic/initial/es")).status, 400);
});

test("F6 package service: System Admin only; shows the active version; stale expected version refused; return to built-in", async () => {
  const { createAssessmentPackageService } = require("../services/assessmentPackageService");
  const { createSupabaseAssessmentPackageRepository } = require("../services/assessmentPackageRepository");
  const ctx = await f6Setup();
  const service = createAssessmentPackageService({ repository: createSupabaseAssessmentPackageRepository({ getAdmin: () => ctx.supa }) });
  const sa = { user: { id: SA }, profile: { role: "system_admin" } };
  const admin = { user: { id: ADMIN }, profile: { role: "admin" } };
  const before = await service.getPackage(sa, ctx.packageId);
  assert.deepEqual([before.package.activation.activeVersionId, before.package.activation.canManage], [null, true]);
  assert.deepEqual(before.versions.map((v) => [v.versionLabel, v.canActivate]), [["4.0", true], ["3.0", false]], "only the endorsed 4.0 is eligible");
  await assert.rejects(service.setActiveInitialVersion(admin, ctx.packageId, ctx.versionId, {}), (e) => e.statusCode === 404, "platform packages are not visible to School Admins");
  await assert.rejects(service.setActiveInitialVersion({ user: { id: uid(3) }, profile: { role: "student" } }, ctx.packageId, ctx.versionId, {}), (e) => e.statusCode === 403);
  const after = await service.setActiveInitialVersion(sa, ctx.packageId, ctx.versionId, { expectedActiveVersionId: null });
  assert.equal(after.package.activation.activeVersionId, ctx.versionId);
  assert.deepEqual(after.versions.map((v) => [v.versionLabel, v.activeForLearners, v.canActivate]), [["4.0", true, false], ["3.0", false, false]]);
  // A second System Admin acting on a stale page (expects the built-in) is refused.
  await assert.rejects(service.setActiveInitialVersion(sa, ctx.packageId, null, { expectedActiveVersionId: null }), (e) => e.statusCode === 409);
  const back = await service.setActiveInitialVersion(sa, ctx.packageId, null, { expectedActiveVersionId: ctx.versionId });
  assert.equal(back.package.activation.activeVersionId, null);
  await ctx.d.exec("reset role");
  const events = (await ctx.d.query("select count(*)::int n from m2_initial_activation_events")).rows[0].n;
  assert.equal(events, 2, "every change is recorded");
});
