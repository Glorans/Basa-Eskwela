// M2 F8 Complete Reassessment: delivery + speech binding + official result, against the REAL proposed SQL (packages
// + reassessment foundation) on a copy of the live diagnostic_results shape (incl. the live M8 sync trigger), in
// disposable in-memory PostgreSQL (PGlite), with the REAL receipt signer. Never connects to Supabase or Azure.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const express = require("express");
const { PGlite } = require("@electric-sql/pglite");
const { LIVE_FIXTURE } = require("../../supabase/tests/fixtures/liveDiagnosticFixture.cjs");
const { createTranscriptReceiptService } = require("../services/diagnosticTranscriptReceipts");
const { createReassessmentDeliveryService, passageHash } = require("../services/reassessmentDeliveryService");
const { createDiagnosticBindingResolver } = require("../services/diagnosticBindingResolver");
const { createReassessmentsRouter } = require("../routes/reassessments");
const { DIAGNOSTIC_ASSESSMENTS, getDiagnosticAssessmentBinding } = require("../services/diagnosticAssessments");

const sql = (f) => readFileSync(resolve(__dirname, "../../supabase/proposed", f), "utf8");
const PACKAGES = sql("m2_assessment_packages_PROPOSED.sql");
const FOUNDATION = sql("m2_reassessment_foundation_PROPOSED.sql");
const F10 = sql("m2_f10_direct_publish_PROPOSED.sql");
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rid = (n) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const P = {
  sa: [uid(1), "system_admin", null], admin: [uid(2), "admin", null], teacher: [uid(3), "teacher", "approved"],
  s1: [uid(6), "student", null], s2: [uid(7), "student", null], other: [uid(9), "student", null], learner: [uid(10), "general_user", null],
};
const ROOM_A = uid(50), ROOM_B = uid(51);
const as = (key) => ({ user: { id: P[key][0] }, profile: { id: P[key][0], role: P[key][1], teacher_status: P[key][2] } });
const SECRET = "test-receipt-secret-that-is-long-enough-123456";
const PARAGRAPHS = { en: ["Ana walked to the river with her small brown dog early in the morning.", "They watched the fish swim under the old bridge until the sun was high and warm."],
  fil: ["Maagang naglakad si Ana papunta sa ilog kasama ang kanyang maliit na aso.", "Pinanood nila ang mga isda sa ilalim ng lumang tulay hanggang tumaas ang araw."] };
const KEYS = ["b", "c", "a", "d", "b", "c"];
const QUESTIONS = ["literal", "literal", "inferential", "inferential", "inferential", "critical"].map((type, i) => ({
  id: `q${i + 1}`, type, prompt: `Question ${i + 1}?`, correctChoiceId: KEYS[i], choices: ["a", "b", "c", "d"].map((c) => ({ id: c, label: `Choice ${c}` })) }));
const ALL_RIGHT = Object.fromEntries(KEYS.map((k, i) => [`q${i + 1}`, k]));

function repo(d) {
  const all = async (q, params) => (await d.query(q, params)).rows;
  const first = async (q, params) => (await all(q, params))[0] ?? null;
  return {
    getSettings: () => first("select official_reassessment_enabled from m2_reassessment_settings"),
    getAssignment: (id) => first("select * from m2_reassessment_assignments where id = $1", [id]),
    listMyAssignments: (sid, kind = "classroom") => all("select * from m2_reassessment_assignments where student_id = $1 and kind = $2", [sid, kind]),
    listIndependentPackages: () => all("select * from m2_assessment_packages where kind = 'reassessment' and audience = 'independent_learners' and scope = 'platform' and archived_at is null"),
    listPublishedVersions: (ids) => all("select id, package_id, version_label, status from m2_assessment_package_versions where package_id = any($1) and status = 'published'", [ids]),
    hasInitialDiagnostic: async (u, l) => (await first("select m2_initial_diagnostic_completed($1, $2) ok", [u, l])).ok === true,
    latestOfficialResultAt: async (u, l) => (await first(`select max(verified_at) t from diagnostic_results where user_id = $1 and language = $2
      and verification_status = 'server_verified' and assessment_type in ('initial', 'reassessment')`, [u, l])).t,
    insertIndependentAssignment: (row) => first(`insert into m2_reassessment_assignments(package_version_id, package_id, language, kind, student_id, assigned_by)
      values ($1, $2, $3, $4, $5, $6) returning *`, [row.package_version_id, row.package_id, row.language, row.kind, row.student_id, row.assigned_by]),
    closeWithdrawn: (id, u) => all(`update m2_reassessment_assignments set status = 'cancelled', cancelled_by = $2, cancel_reason = 'The reassessment version was withdrawn.'
      where id = $1 and student_id = $2 and kind = 'independent' and status = 'active' returning id`, [id, u]),
    getRoom: (id) => first("select id, room_name, archived_at from rooms where id = $1", [id]),
    isEnrolled: async (room, sid) => Boolean(await first("select 1 from enrollments where room_id = $1 and student_id = $2", [room, sid])),
    getVersion: (id) => first("select * from m2_assessment_package_versions where id = $1", [id]),
    getPackage: (id) => first("select * from m2_assessment_packages where id = $1", [id]),
    isEndorsed: async (id) => (await first("select m2_version_educator_endorsed($1) ok", [id])).ok === true,
    loadPackages: (ids) => all("select * from m2_assessment_packages where id = any($1)", [ids]),
    loadVersions: (ids) => all("select id, package_id, version_label, status from m2_assessment_package_versions where id = any($1)", [ids]),
    loadRooms: (ids) => all("select id, room_name, archived_at from rooms where id = any($1)", [ids]),
    loadResults: (ids, user) => all("select * from diagnostic_results where id = any($1) and user_id = $2", [ids, user]),
    recordResult: async (a, user, payload) => (await first("select m2_record_reassessment_result($1, $2, $3::jsonb) id", [a, user, JSON.stringify(payload)])).id,
  };
}

async function setup({ gate = true } = {}) {
  const d = new PGlite();
  await d.exec(LIVE_FIXTURE);
  for (const [id, role, status] of Object.values(P)) {
    await d.query("insert into auth.users values ($1)", [id]);
    await d.query("insert into profiles(id, role, teacher_status, full_name, nickname) values ($1, $2, $3, $4, $4)", [id, role, status, `Person ${role}`]);
  }
  await d.query("insert into rooms(id, teacher_id, room_name, room_code) values ($1, $2, 'Room A', 'A'), ($3, $2, 'Room B', 'B')", [ROOM_A, P.teacher[0], ROOM_B]);
  for (const [room, s] of [[ROOM_A, "s1"], [ROOM_A, "s2"], [ROOM_B, "other"]]) await d.query("insert into enrollments(room_id, student_id) values ($1, $2)", [room, P[s][0]]);
  // Existing initial results (server-verified) for s1, both languages.
  for (const [n, lang, level, tier] of [[1, "en", "Frustration", "Easy"], [2, "fil", "Instructional", "Medium"]]) {
    await d.query(`insert into diagnostic_results(user_id, language, assessment_id, assessment_version, orv_score, comprehension_score, reading_level, difficulty_tier,
      verification_status, verification_method, verification_recording_id, verified_at) values ($1, $2, $3, '3.0', 80, 50, $4, $5, 'server_verified', 'server_stt_receipt_v1', $6, now() - interval '30 days')`,
    [P.s1[0], lang, `grade5-${lang}-passage-v3`, level, tier, rid(900 + n)]);
  }
  await d.exec(PACKAGES);
  await d.exec(FOUNDATION);
  await d.exec(F10);
  if (gate) await d.exec("update m2_reassessment_settings set official_reassessment_enabled = true");
  await d.exec("set role service_role");
  const receipts = createTranscriptReceiptService({ getSecret: () => SECRET });
  const service = createReassessmentDeliveryService({ repository: repo(d), receipts });
  return { d, service, receipts };
}
const su = async (d, work) => { await d.exec("reset role"); try { return await work(); } finally { await d.exec("set role service_role"); } };

/** A published, endorsed Teacher package version (as the superuser), and an assignment of it. */
async function assigned(d, { student = "s1", language = "en", room = ROOM_A, endorse = true } = {}) {
  return su(d, async () => {
    const gateWas = (await d.query("select official_reassessment_enabled g from m2_reassessment_settings")).rows[0].g;
    await d.query("update m2_reassessment_settings set official_reassessment_enabled = true");
    const { rows: [p] } = await d.query(`insert into m2_assessment_packages(kind, audience, scope, owner_id, language, title) values ('reassessment','classroom','teacher',$1,$2,'River check') returning id`, [P.teacher[0], language]);
    const { rows: [v] } = await d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by, passage_title, paragraphs, questions)
      values ($1, 1, '1.0', $2, 'Story', $3, $4) returning id`, [p.id, P.teacher[0], JSON.stringify(PARAGRAPHS[language]), JSON.stringify(QUESTIONS)]);
    await d.query(`update m2_assessment_package_versions set status = 'in_review', submitted_by = $2 where id = $1`, [v.id, P.teacher[0]]);
    await d.query(`update m2_assessment_package_versions set status = 'approved', reviewed_by = $2, educator_review_attestation = 'Library' where id = $1`, [v.id, P.admin[0]]);
    await d.query("select m2_publish_assessment_version($1, $2)", [v.id, P.teacher[0]]);
    await d.query(`insert into m2_assessment_educator_reviews(version_id, reviewer_name, reviewer_qualification, reviewed_on, passage_suitable, questions_sound,
      answer_keys_correct, language_accurate, outcome, recorded_by) values ($1, 'R', 'Teacher (stated)', '2026-11-18', true, true, true, true, 'endorsed', $2)`, [v.id, P.admin[0]]);
    const { rows: [a] } = await d.query(`insert into m2_reassessment_assignments(package_version_id, package_id, language, kind, room_id, student_id, assigned_by)
      values ($1, $2, $3, 'classroom', $4, $5, $6) returning id`, [v.id, p.id, language, room, P[student][0], P.teacher[0]]);
    if (!endorse) {
      await d.query(`insert into m2_assessment_educator_reviews(version_id, reviewer_name, reviewer_qualification, reviewed_on, passage_suitable, questions_sound,
        answer_keys_correct, language_accurate, outcome, recorded_by) values ($1, 'R', 'Teacher', '2026-11-19', true, true, false, true, 'changes_requested', $2)`, [v.id, P.admin[0]]);
    }
    await d.query("update m2_reassessment_settings set official_reassessment_enabled = $1", [gateWas]);
    return { packageId: p.id, versionId: v.id, assignmentId: a.id };
  });
}
const binding = (x, language = "en") => ({ assessmentId: `m2-package-version:${x.versionId}`, assessmentVersion: `assignment:${x.assignmentId}`,
  passageHash: passageHash({ paragraphs: PARAGRAPHS[language] }) });
const receipt = (receipts, { user = P.s1[0], language = "en", bind, recording = rid(1), text } = {}) => receipts.issue({
  userId: user, language, binding: bind, recordingId: recording, segmentIndex: 1, source: "stream",
  text: text ?? PARAGRAPHS[language].join(" "), confidence: 0.95, audioSeconds: 30 });
const refused = (promise, status, code) => assert.rejects(promise, (e) => {
  assert.equal(e.statusCode, status, `${e.code}: ${e.message}`);
  if (code) assert.equal(e.code, code, e.message);
  return true;
});

test("staff are refused every F8 call; an Independent Learner cannot open or submit a Student's classroom assignment", async () => {
  const { d, service, receipts } = await setup();
  const x = await assigned(d);
  await refused(service.getContent(as("learner"), x.assignmentId), 404, "ASSIGNMENT_NOT_FOUND");
  await refused(service.submitResult(as("learner"), x.assignmentId, { transcriptReceipts: [receipt(receipts, { user: P.learner[0], bind: binding(x) })], answers: ALL_RIGHT }), 404, "ASSIGNMENT_NOT_FOUND");
  assert.equal(await service.resolveBinding({ requester: as("learner"), language: "en", ...binding(x) }), null);
  await refused(service.startIndependent(as("s1"), { packageVersionId: x.versionId }), 403, "REASSESSMENT_FORBIDDEN");
  for (const key of ["teacher", "admin", "sa"]) {
    await refused(service.listMine(as(key)), 403, "REASSESSMENT_FORBIDDEN");
    await refused(service.getContent(as(key), x.assignmentId), 403, "REASSESSMENT_FORBIDDEN");
    await refused(service.submitResult(as(key), x.assignmentId, {}), 403, "REASSESSMENT_FORBIDDEN");
    assert.equal(await service.resolveBinding({ requester: as(key), language: "en", ...binding(x) }), null, `${key} gets no receipt binding`);
  }
});

test("content: only the assigned Student; passage, title, questions and choices; never keys, types, fingerprints or reviews", async () => {
  const { d, service } = await setup();
  const x = await assigned(d);
  const { assessment, assignment } = await service.getContent(as("s1"), x.assignmentId);
  assert.equal(assessment.id, `m2-package-version:${x.versionId}`);
  assert.equal(assessment.version, `assignment:${x.assignmentId}`);
  assert.deepEqual([assessment.language, assessment.assessmentType, assessment.title, assignment.title], ["en", "reassessment", "Story", "River check"]);
  assert.deepEqual(assessment.passage.paragraphs, PARAGRAPHS.en);
  assert.equal(assessment.questions.length, 6);
  assert.deepEqual(Object.keys(assessment.questions[0]).sort(), ["choices", "id", "prompt"]);
  assert.doesNotMatch(JSON.stringify({ assessment, assignment }), /correctChoiceId|"type"|sha256|content_sha|attestation|reviewer|educator|literal|inferential/);
  await refused(service.getContent(as("s2"), x.assignmentId), 404, "ASSIGNMENT_NOT_FOUND"); // a classmate
  await refused(service.getContent(as("other"), x.assignmentId), 404, "ASSIGNMENT_NOT_FOUND");
  await refused(service.getContent(as("s1"), "nope"), 404);
  await refused(service.getContent(as("s1"), uid(999)), 404);
});

test("delivery is refused when the gate is off, the room is archived, the Student left, or the version was withdrawn", async () => {
  const { d, service } = await setup({ gate: false });
  const x = await assigned(d);
  await refused(service.getContent(as("s1"), x.assignmentId), 409, "REASSESSMENT_NOT_ENABLED");
  const listed = await service.listMine(as("s1"));
  assert.deepEqual([listed.enabled, listed.reassessments[0].available, listed.reassessments[0].unavailableReason],
    [false, false, "Reassessments are not open yet. Please check again later."]);
  await su(d, () => d.exec("update m2_reassessment_settings set official_reassessment_enabled = true"));
  assert.ok((await service.getContent(as("s1"), x.assignmentId)).assessment);
  await su(d, () => d.query("update rooms set archived_at = now(), archived_by = $2 where id = $1", [ROOM_A, P.teacher[0]]));
  await refused(service.getContent(as("s1"), x.assignmentId), 409, "ROOM_NOT_ACTIVE");
  await su(d, () => d.query("update rooms set archived_at = null, archived_by = null where id = $1", [ROOM_A]));
  await su(d, () => d.query("delete from enrollments where room_id = $1 and student_id = $2", [ROOM_A, P.s1[0]]));
  await refused(service.getContent(as("s1"), x.assignmentId), 409, "ROOM_NOT_ACTIVE");
  await su(d, () => d.query("insert into enrollments(room_id, student_id) values ($1, $2)", [ROOM_A, P.s1[0]]));
  // F10: a later "changes requested" review no longer withdraws a published version; only retiring it does.
  const notEndorsed = await assigned(d, { student: "s2", endorse: false });
  assert.ok((await service.getContent(as("s2"), notEndorsed.assignmentId)).assessment);
  await su(d, () => d.query(`update m2_assessment_package_versions set status = 'retired', retired_by = $2 where id = $1`, [x.versionId, P.teacher[0]]));
  await refused(service.getContent(as("s1"), x.assignmentId), 409, "VERSION_WITHDRAWN");
});

test("cancelled and completed assignments cannot be opened or submitted", async () => {
  const { d, service, receipts } = await setup();
  const x = await assigned(d);
  await su(d, () => d.query(`update m2_reassessment_assignments set status = 'cancelled', cancelled_by = $2, cancel_reason = 'x' where id = $1`, [x.assignmentId, P.teacher[0]]));
  await refused(service.getContent(as("s1"), x.assignmentId), 409, "ASSIGNMENT_CANCELLED");
  await refused(service.submitResult(as("s1"), x.assignmentId, { transcriptReceipts: [receipt(receipts, { bind: binding(x) })], answers: ALL_RIGHT }), 409, "ASSIGNMENT_CANCELLED");
  assert.equal((await d.query("select count(*)::int n from diagnostic_results where assessment_type = 'reassessment'")).rows[0].n, 0);
});

test("speech binding: the code diagnostic keeps its binding; a reassessment binds to the exact version, assignment and passage", async () => {
  const { d, service } = await setup();
  const x = await assigned(d);
  const y = await assigned(d, { language: "fil" });
  const resolveBinding = createDiagnosticBindingResolver({ getReassessments: () => service });
  const code = DIAGNOSTIC_ASSESSMENTS.en;
  assert.deepEqual(await resolveBinding({ requester: as("teacher"), language: "en", assessmentId: code.id, assessmentVersion: code.version }),
    getDiagnosticAssessmentBinding("en", code.id, code.version), "initial diagnostic binding unchanged (staff F7 included)");
  assert.deepEqual(await resolveBinding({ requester: as("s1"), language: "en", ...binding(x) }), binding(x));
  assert.equal(await resolveBinding({ requester: as("s1"), language: "fil", ...binding(x) }), null, "wrong language");
  assert.equal(await resolveBinding({ requester: as("s2"), language: "en", ...binding(x) }), null, "another Student");
  assert.equal(await resolveBinding({ requester: as("s1"), language: "en", assessmentId: `m2-package-version:${y.versionId}`, assessmentVersion: `assignment:${x.assignmentId}` }), null, "version not of this assignment");
  assert.equal(await resolveBinding({ requester: as("s1"), language: "en", assessmentId: `m2-package-version:${x.versionId}`, assessmentVersion: "3.0" }), null);
  assert.deepEqual(await resolveBinding({ requester: as("s1"), language: "fil", ...binding(y, "fil") }), binding(y, "fil"), "Filipino separately");
});

test("official result (English): server scoring with the stored keys, recorded transactionally, linked and fingerprinted", async () => {
  const { d, service, receipts } = await setup();
  const x = await assigned(d);
  const answers = { ...ALL_RIGHT, q6: "a" }; // 5 of 6 right
  const result = await service.submitResult(as("s1"), x.assignmentId, {
    transcriptReceipts: [receipt(receipts, { bind: binding(x) })], answers,
    // Client values are ignored entirely:
    orvScore: 1, comprehensionScore: 100, readingLevel: "Independent", difficultyTier: "Hard", transcript: "fake",
  });
  assert.equal(result.wordRecognitionScore, 100);
  assert.equal(Math.round(result.comprehensionScore * 10) / 10, 83.3);
  assert.deepEqual(result.comprehension, { correct: 5, total: 6 });
  assert.equal(result.replayed, false);
  assert.doesNotMatch(JSON.stringify(result), /correctChoiceId|"q\d"|choiceId/, "no answer key and no per-question correctness");
  const row = (await d.query("select * from diagnostic_results where assessment_type = 'reassessment'")).rows[0];
  const version = (await d.query("select content_sha256, version_label from m2_assessment_package_versions where id = $1", [x.versionId])).rows[0];
  assert.deepEqual([row.user_id, row.language, row.package_version_id, row.content_sha256, row.reassessment_assignment_id, row.assessment_id, row.assessment_version, row.verification_status],
    [P.s1[0], "en", x.versionId, version.content_sha256, x.assignmentId, x.packageId, "1.0", "server_verified"]);
  assert.equal(row.reading_level, result.readingLevel);
  assert.equal(row.oral_reading_metrics.scoringRule, "title-optional-v1");
  assert.deepEqual(row.oral_reading_metrics.comprehensionAnswers, answers, "the learner's own choices are kept, as for the initial diagnostic");
  const a = (await d.query("select status, result_id from m2_reassessment_assignments where id = $1", [x.assignmentId])).rows[0];
  assert.deepEqual([a.status, a.result_id], ["completed", row.id]);
  const list = await service.listMine(as("s1"));
  assert.deepEqual([list.reassessments[0].status, list.reassessments[0].result.readingLevel], ["completed", row.reading_level]);
});

test("official result (Filipino) is scored with Filipino text rules and kept separate from English", async () => {
  const { d, service, receipts } = await setup();
  const y = await assigned(d, { language: "fil" });
  const r = await service.submitResult(as("s1"), y.assignmentId, { transcriptReceipts: [receipt(receipts, { language: "fil", bind: binding(y, "fil") })], answers: ALL_RIGHT });
  assert.deepEqual([r.language, r.wordRecognitionScore, r.comprehension.correct], ["fil", 100, 6]);
  const cur = async (lang) => (await d.query("select * from m2_current_reading_level($1, $2)", [P.s1[0], lang])).rows[0];
  assert.equal((await cur("fil")).assessment_type, "reassessment");
  assert.equal((await cur("en")).assessment_type, "initial", "English unchanged");
});

test("receipts must be for THIS Student, language, version, assignment and passage; invalid ones are refused", async () => {
  const { d, service, receipts } = await setup();
  const x = await assigned(d);
  const z = await assigned(d, { student: "s2" });
  const code = DIAGNOSTIC_ASSESSMENTS.en;
  const submit = (tokens) => service.submitResult(as("s1"), x.assignmentId, { transcriptReceipts: tokens, answers: ALL_RIGHT });
  await refused(submit([receipt(receipts, { bind: getDiagnosticAssessmentBinding("en", code.id, code.version) })]), 422, "READING_NOT_VERIFIED"); // initial diagnostic receipt
  await refused(submit([receipt(receipts, { user: P.s2[0], bind: binding(x) })]), 422, "READING_NOT_VERIFIED"); // another learner's
  await refused(submit([receipt(receipts, { bind: binding(z) })]), 422, "READING_NOT_VERIFIED"); // another assignment's
  await refused(submit([receipt(receipts, { language: "fil", bind: binding(x) })]), 422, "READING_NOT_VERIFIED"); // another language
  await refused(submit([receipt(receipts, { bind: { ...binding(x), passageHash: "0".repeat(64) } })]), 422, "READING_NOT_VERIFIED"); // another passage
  // Flip the FIRST signature character: the last base64url character also holds unused padding bits, so changing it
  // can leave the decoded signature identical (the receipt would then still be genuine, about 1 run in 16).
  const genuine = receipt(receipts, { bind: binding(x) });
  const tampered = genuine.replace(/\.(.)/, (_m, c) => `.${c === "A" ? "B" : "A"}`);
  assert.equal(tampered.split(".")[0], genuine.split(".")[0], "only the signature is changed");
  await refused(submit([tampered]), 422, "READING_NOT_VERIFIED");
  const old = createTranscriptReceiptService({ getSecret: () => SECRET, now: () => Date.now() - 25 * 60 * 60 * 1000 });
  await refused(submit([receipt(old, { bind: binding(x) })]), 422, "READING_NOT_VERIFIED"); // expired
  const otherSecret = createTranscriptReceiptService({ getSecret: () => "a-completely-different-secret-1234567890" });
  await refused(submit([receipt(otherSecret, { bind: binding(x) })]), 422, "READING_NOT_VERIFIED");
  await refused(submit([]), 422, "READING_NOT_VERIFIED");
  await refused(service.submitResult(as("s1"), x.assignmentId, { transcriptReceipts: [receipt(receipts, { bind: binding(x) })], answers: { q1: "a" } }), 400, "INVALID_ANSWERS");
  await refused(service.submitResult(as("s1"), x.assignmentId, { transcriptReceipts: [receipt(receipts, { bind: binding(x) })], answers: { ...ALL_RIGHT, q1: "e" } }), 400, "INVALID_ANSWERS");
  assert.equal((await d.query("select count(*)::int n from diagnostic_results where assessment_type = 'reassessment'")).rows[0].n, 0);
});

test("duplicates and replays: same recording returns the stored result; another recording is refused; concurrent submits record once", async () => {
  const { d, service, receipts } = await setup();
  const x = await assigned(d);
  const body = (recording) => ({ transcriptReceipts: [receipt(receipts, { bind: binding(x), recording })], answers: ALL_RIGHT });
  const results = await Promise.allSettled([service.submitResult(as("s1"), x.assignmentId, body(rid(1))), service.submitResult(as("s1"), x.assignmentId, body(rid(2)))]);
  const ok = results.filter((r) => r.status === "fulfilled");
  assert.equal(ok.length, 1, "exactly one of two concurrent submissions is recorded");
  assert.equal(results.find((r) => r.status === "rejected").reason.statusCode, 409);
  const winner = (await d.query("select verification_recording_id r from diagnostic_results where assessment_type = 'reassessment'")).rows;
  assert.equal(winner.length, 1);
  const again = await service.submitResult(as("s1"), x.assignmentId, body(winner[0].r));
  assert.equal(again.replayed, true, "a retry of the recorded reading returns the stored result");
  await refused(service.submitResult(as("s1"), x.assignmentId, body(rid(3))), 409, "ASSIGNMENT_COMPLETED");
  await refused(service.getContent(as("s1"), x.assignmentId), 409, "ASSIGNMENT_COMPLETED");
  assert.equal((await d.query("select count(*)::int n from diagnostic_results where assessment_type = 'reassessment'")).rows[0].n, 1);
});

test("gate OFF refuses official submission even with valid receipts; nothing is recorded", async () => {
  const { d, service, receipts } = await setup();
  const x = await assigned(d);
  const token = receipt(receipts, { bind: binding(x) });
  await su(d, () => d.exec("update m2_reassessment_settings set official_reassessment_enabled = false"));
  await refused(service.submitResult(as("s1"), x.assignmentId, { transcriptReceipts: [token], answers: ALL_RIGHT }), 409, "REASSESSMENT_NOT_ENABLED");
  assert.equal((await d.query("select count(*)::int n from diagnostic_results where assessment_type = 'reassessment'")).rows[0].n, 0);
});

test("current level, initial completion and M8 after a reassessment (M8 unchanged; level_up side effect documented)", async () => {
  const { d, service, receipts } = await setup();
  const x = await assigned(d);
  const before = (await d.query("select count(*)::int n from diagnostic_results where assessment_type = 'initial'")).rows[0].n;
  await service.submitResult(as("s1"), x.assignmentId, { transcriptReceipts: [receipt(receipts, { bind: binding(x) })], answers: ALL_RIGHT });
  const cur = (await d.query("select * from m2_current_reading_level($1, 'en')", [P.s1[0]])).rows[0];
  assert.deepEqual([cur.assessment_type, cur.package_version_id], ["reassessment", x.versionId]);
  assert.equal((await d.query("select m2_initial_diagnostic_completed($1, 'en') ok", [P.s1[0]])).rows[0].ok, true, "initial completion preserved");
  assert.equal((await d.query("select count(*)::int n from diagnostic_results where assessment_type = 'initial'")).rows[0].n, before, "initial history preserved");
  assert.equal((await d.query("select m2_trusted_reading_level($1, 'en') l", [P.s1[0]])).rows[0].l, "Frustration", "M8 still reads the initial result");
  const progress = (await d.query("select unlocked_difficulty from m8_learner_progress where user_id = $1", [P.s1[0]])).rows[0];
  assert.equal(progress.unlocked_difficulty, "Medium", "unlocked difficulty still follows initial results only (Filipino Instructional)");
  // KNOWN M8 DEPENDENCY (not changed here): the live trigger awards level_up for any verified Instructional/Independent row.
  const badges = (await d.query("select badge_id from m8_earned_badges where user_id = $1", [P.s1[0]])).rows.map((b) => b.badge_id);
  assert.deepEqual(badges, ["level_up"]);
});

async function call(router, method, path, body) {
  const app = express();
  app.use(express.json());
  app.use("/api/reassessments", router);
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/reassessments${path}`, {
      method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
  } finally {
    server.close();
  }
}

test("routes: /me uses the learner check, ignores any student id in the request, and never returns keys", async () => {
  const { d, service, receipts } = await setup();
  const x = await assigned(d);
  const router = createReassessmentsRouter({ authorizeLearner: async () => as("s1"), authorize: async () => as("teacher"), delivery: service,
    service: { overview: async () => ({ ok: true }) } });
  const mine = await call(router, "GET", `/me?studentId=${P.s2[0]}`);
  assert.deepEqual([mine.status, mine.body.reassessments.length, mine.cache], [200, 1, "no-store"]);
  const content = await call(router, "GET", `/me/${x.assignmentId}/content`);
  assert.equal(content.status, 200);
  assert.doesNotMatch(JSON.stringify(content.body), /correctChoiceId/);
  const bad = await call(router, "POST", `/me/${x.assignmentId}/result`, { transcriptReceipts: ["x.y"], answers: ALL_RIGHT, studentId: P.s2[0] });
  assert.deepEqual([bad.status, bad.body.code], [422, "READING_NOT_VERIFIED"]);
  const ok = await call(router, "POST", `/me/${x.assignmentId}/result`, { transcriptReceipts: [receipt(receipts, { bind: binding(x) })], answers: ALL_RIGHT });
  assert.deepEqual([ok.status, ok.body.result.assessmentType, ok.body.result.comprehension.total], [200, "reassessment", 6]);
  const { OralReadingAuthorizationError } = require("../services/oralReadingAttemptService");
  const staff = createReassessmentsRouter({ authorizeLearner: async () => { throw new OralReadingAuthorizationError(); }, delivery: service });
  const denied = await call(staff, "GET", "/me");
  assert.deepEqual([denied.status, denied.body.code], [403, "REASSESSMENT_FORBIDDEN"]);
  const il = createReassessmentsRouter({ authorizeLearner: async () => as("learner"), delivery: service });
  const ilList = await call(il, "GET", "/me");
  assert.deepEqual([ilList.status, ilList.body.reassessments], [200, []], "an Independent Learner never sees classroom assignments");
  assert.equal((await call(createReassessmentsRouter({ authorizeLearner: async () => as("s1") }), "GET", "/me")).status, 503, "no delivery service = not installed");
  assert.deepEqual((await call(router, "GET", "/overview")).body, { success: true, ok: true }, "F9 staff routes unaffected");
});

test("F8 -> F3/F5: the recorded reassessment joins the learner's official history; the current level follows the placement rule", async () => {
  const { toHistoryEntry } = require("../services/diagnosticHistoryService");
  const { buildReadingProgress } = require("../services/readingProgressService");
  const { d, service, receipts } = await setup();
  const before = (await d.query("select id, reading_level, orv_score, comprehension_score from diagnostic_results where user_id = $1 order by id", [P.s1[0]])).rows;
  const x = await assigned(d);
  await service.submitResult(as("s1"), x.assignmentId, { transcriptReceipts: [receipt(receipts, { bind: binding(x) })], answers: ALL_RIGHT });
  const rows = (await d.query("select * from diagnostic_results where user_id = $1", [P.s1[0]])).rows;
  // Supabase returns ISO timestamps; PGlite returns Date objects (second-resolution strings), so normalise as the API does.
  const entries = rows.map((r) => toHistoryEntry({ ...r, completed_at: new Date(r.completed_at).toISOString() }));
  const re = entries.find((e) => e.assessmentType === "reassessment");
  assert.ok(re && re.verified && re.language === "en", "F3: the reassessment is in the learner's history, verified, English");
  assert.equal(typeof re.wordRecognitionScore, "number");
  assert.equal(typeof re.comprehensionScore, "number");
  const off = buildReadingProgress(entries, { followsReassessment: false });
  assert.deepEqual([off.en.current.source, off.en.reassessments.length, off.en.reassessments[0].id], ["initial", 1, re.id],
    "switch OFF: the current level stays the initial diagnostic; the reassessment is history");
  assert.match(off.en.placementNote, /placement still uses the initial diagnostic/);
  assert.equal(off.fil.reassessments.length, 0, "Filipino is untouched by an English reassessment");
  const on = buildReadingProgress(entries, { followsReassessment: true });
  assert.deepEqual([on.en.current.source, on.en.current.readingLevel], ["reassessment", re.readingLevel], "switch ON (only after approval): the latest official result");
  const after = (await d.query("select id, reading_level, orv_score, comprehension_score from diagnostic_results where user_id = $1 and assessment_type = 'initial' order by id", [P.s1[0]])).rows;
  assert.deepEqual(after, before, "earlier results are unchanged");
});
