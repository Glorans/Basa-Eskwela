// M2 F8 for Independent Learners: availability, self-start, delivery, receipts, official result and isolation, against
// the REAL proposed SQL (packages + reassessment foundation + Independent Learner eligibility) on a copy of the live
// diagnostic_results shape (incl. the live M8 trigger), in disposable in-memory PostgreSQL, with the real receipt signer.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const express = require("express");
const { PGlite } = require("@electric-sql/pglite");
const { LIVE_FIXTURE } = require("../../supabase/tests/fixtures/liveDiagnosticFixture.cjs");
const { createTranscriptReceiptService } = require("../services/diagnosticTranscriptReceipts");
const { createReassessmentDeliveryService, passageHash } = require("../services/reassessmentDeliveryService");
const { parseIndependentPilot, describeIndependentPilot } = require("../services/independentPilot");
const { createReassessmentsRouter } = require("../routes/reassessments");
const { DIAGNOSTIC_ASSESSMENTS, getDiagnosticAssessmentBinding } = require("../services/diagnosticAssessments");

const sql = (f) => readFileSync(resolve(__dirname, "../../supabase/proposed", f), "utf8");
const MIGRATIONS = ["m2_assessment_packages_PROPOSED.sql", "m2_reassessment_foundation_PROPOSED.sql", "m2_independent_reassessment_eligibility_PROPOSED.sql", "m2_f10_direct_publish_PROPOSED.sql"].map(sql);
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rid = (n) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const P = {
  sa: [uid(1), "system_admin", null], admin: [uid(2), "admin", null], teacher: [uid(3), "teacher", "approved"], student: [uid(6), "student", null],
  il: [uid(8), "general_user", null], il2: [uid(9), "general_user", null], il3: [uid(10), "general_user", null],
};
const ROOM = uid(50);
const as = (key) => ({ user: { id: P[key][0] }, profile: { id: P[key][0], role: P[key][1], teacher_status: P[key][2] } });
const SECRET = "test-receipt-secret-that-is-long-enough-123456";
const NOW = "2026-11-19T04:00:00.000Z";
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
    getSettings: () => first("select * from m2_reassessment_settings"),
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

/** gates: "off" (the default) or { days } to switch both gates on with that interval. */
async function setup({ gates = { days: 30 }, pilot } = {}) {
  const d = new PGlite();
  await d.exec(LIVE_FIXTURE);
  for (const [id, role, status] of Object.values(P)) {
    await d.query("insert into auth.users values ($1)", [id]);
    await d.query("insert into profiles(id, role, teacher_status, full_name, nickname) values ($1, $2, $3, $4, $4)", [id, role, status, `Person ${role}`]);
  }
  await d.query("insert into rooms(id, teacher_id, room_name, room_code) values ($1, $2, 'Room A', 'A')", [ROOM, P.teacher[0]]);
  await d.query("insert into enrollments(room_id, student_id) values ($1, $2)", [ROOM, P.student[0]]);
  // il: English initial 40 days ago (Frustration). il2: English initial 2 days ago. il3: none. student: English initial.
  for (const [n, who, days] of [[1, "il", 40], [2, "il2", 2], [3, "student", 40]]) {
    await d.query(`insert into diagnostic_results(user_id, language, assessment_id, assessment_version, orv_score, comprehension_score, reading_level, difficulty_tier,
      verification_status, verification_method, verification_recording_id, verified_at) values ($1, 'en', 'grade5-en-passage-v3', '3.0', 80, 50, 'Frustration', 'Easy',
      'server_verified', 'server_stt_receipt_v1', $2, $3::timestamptz - make_interval(days => $4))`, [P[who][0], rid(900 + n), NOW, days]);
  }
  for (const m of MIGRATIONS) await d.exec(m);
  if (gates !== "off") await d.query("update m2_reassessment_settings set official_reassessment_enabled = true, independent_learner_enabled = true, independent_min_days_between = $1", [gates.days]);
  await d.exec("set role service_role");
  const receipts = createTranscriptReceiptService({ getSecret: () => SECRET });
  const service = createReassessmentDeliveryService({ repository: repo(d), receipts, now: () => new Date().toISOString(),
    ...(pilot === undefined ? {} : { independentPilot: parseIndependentPilot(pilot) }) });
  return { d, service, receipts };
}
const su = async (d, work) => { await d.exec("reset role"); try { return await work(); } finally { await d.exec("set role service_role"); } };

/** A published package version (superuser), endorsed unless told otherwise. */
async function version(d, { audience = "independent_learners", scope = "platform", owner = P.sa[0], language = "en", title = "Garden check", endorse = true, upTo = "published" } = {}) {
  return su(d, async () => {
    const { rows: [p] } = await d.query(`insert into m2_assessment_packages(kind, audience, scope, owner_id, language, title) values ('reassessment',$1,$2,$3,$4,$5) returning id`, [audience, scope, owner, language, title]);
    const { rows: [v] } = await d.query(`insert into m2_assessment_package_versions(package_id, version_number, version_label, created_by, passage_title, paragraphs, questions)
      values ($1, 1, '1.0', $2, 'Story', $3, $4) returning id`, [p.id, owner, JSON.stringify(PARAGRAPHS[language]), JSON.stringify(QUESTIONS)]);
    if (upTo !== "draft") {
      await d.query(`update m2_assessment_package_versions set status = 'in_review', submitted_by = $2 where id = $1`, [v.id, owner]);
      await d.query(`update m2_assessment_package_versions set status = 'approved', reviewed_by = $2, educator_review_attestation = 'Library' where id = $1`, [v.id, P.sa[0]]);
      await d.query("select m2_publish_assessment_version($1, $2)", [v.id, owner]);
      if (endorse) {
        await d.query(`insert into m2_assessment_educator_reviews(version_id, reviewer_name, reviewer_qualification, reviewed_on, passage_suitable, questions_sound,
          answer_keys_correct, language_accurate, outcome, recorded_by) values ($1, 'R', 'Teacher (stated)', '2026-11-18', true, true, true, true, 'endorsed', $2)`, [v.id, P.sa[0]]);
      }
    }
    return { packageId: p.id, versionId: v.id };
  });
}
const binding = (versionId, assignmentId, language = "en") => ({ assessmentId: `m2-package-version:${versionId}`, assessmentVersion: `assignment:${assignmentId}`,
  passageHash: passageHash({ paragraphs: PARAGRAPHS[language] }) });
const receipt = (receipts, { user = P.il[0], language = "en", bind, recording = rid(1) }) => receipts.issue({
  userId: user, language, binding: bind, recordingId: recording, segmentIndex: 1, source: "stream", text: PARAGRAPHS[language].join(" "), confidence: 0.95, audioSeconds: 30 });
const refused = (promise, status, code) => assert.rejects(promise, (e) => {
  assert.equal(e.statusCode, status, `${e.code}: ${e.message}`);
  if (code) assert.equal(e.code, code, e.message);
  return true;
});
const count = async (d, where = "true") => (await d.query(`select count(*)::int n from m2_reassessment_assignments where ${where}`)).rows[0].n;

test("default (gate OFF, interval UNSET): nothing can start; the database refuses a direct insert too", async () => {
  const { d, service } = await setup({ gates: "off" });
  const v = await version(d);
  const mine = await service.listMine(as("il"));
  assert.equal(mine.enabled, false);
  assert.deepEqual(mine.languages.en, { canStart: false, reason: "Reassessments are not open yet. Please check again later.", nextAvailableAt: null });
  assert.equal(mine.available[0].canStart, false);
  await refused(service.startIndependent(as("il"), { packageVersionId: v.versionId }), 409, "REASSESSMENT_NOT_ENABLED");
  await assert.rejects(d.query(`insert into m2_reassessment_assignments(package_version_id, package_id, language, kind, student_id, assigned_by)
    values ($1, $2, 'en', 'independent', $3, $3)`, [v.versionId, v.packageId, P.il[0]]), /not enabled/);
  await assert.rejects(d.query("update m2_reassessment_settings set independent_min_days_between = 30"), /permission denied/, "the backend cannot set the interval");
});

test("eligibility per language: initial diagnostic required; the waiting interval counts from the latest official result", async () => {
  const { d, service } = await setup();
  await version(d);
  await version(d, { language: "fil", title: "Kuwento" });
  const il = await service.listMine(as("il"));
  assert.deepEqual([il.languages.en.canStart, il.languages.fil.canStart], [true, false]);
  assert.equal(il.languages.fil.reason, "Finish your first Filipino reading check before taking a reassessment.");
  const il2 = await service.listMine(as("il2"));
  assert.equal(il2.languages.en.canStart, false);
  assert.match(il2.languages.en.reason, /^Your next English reassessment opens on .+ 2026\.$/);
  assert.ok(il2.languages.en.nextAvailableAt);
  const il3 = await service.listMine(as("il3"));
  assert.equal(il3.languages.en.reason, "Finish your first English reading check before taking a reassessment.");
  assert.doesNotMatch(JSON.stringify({ il, il2, il3 }), /roomName|teacher|Learning Room/i, "no classroom information for Independent Learners");
});

test("visibility: only published Independent Learner packages (F10: no endorsement needed); classroom and other packages never appear or start", async () => {
  const { d, service } = await setup();
  const ok = await version(d, { title: "IL ready" });
  await version(d, { title: "IL unendorsed", endorse: false });
  await version(d, { title: "IL draft", upTo: "draft" });
  const teacherPkg = await version(d, { audience: "classroom", scope: "teacher", owner: P.teacher[0], title: "Teacher private" });
  const schoolPkg = await version(d, { audience: "classroom", scope: "school", owner: P.admin[0], title: "School package" });
  const mine = await service.listMine(as("il"));
  assert.deepEqual(mine.available.map((a) => a.title), ["IL ready", "IL unendorsed"]);
  assert.equal(mine.available[0].packageVersionId, ok.versionId);
  assert.doesNotMatch(JSON.stringify(mine), /Teacher private|School package|correctChoiceId|paragraphs/);
  await refused(service.startIndependent(as("il"), { packageVersionId: teacherPkg.versionId }), 404, "PACKAGE_NOT_FOUND");
  await refused(service.startIndependent(as("il"), { packageVersionId: schoolPkg.versionId }), 404, "PACKAGE_NOT_FOUND");
  await refused(service.startIndependent(as("il"), { packageVersionId: "nope" }), 400, "PACKAGE_REQUIRED");
  assert.equal(await count(d), 0);
});

test("self-start: only Independent Learners; repeated and concurrent starts return the one assignment; other ineligible starts refused", async () => {
  const { d, service } = await setup();
  const v = await version(d);
  const v2 = await version(d, { title: "Second" });
  for (const key of ["student", "teacher", "admin", "sa"]) await refused(service.startIndependent(as(key), { packageVersionId: v.versionId }), 403, "REASSESSMENT_FORBIDDEN");
  await refused(service.startIndependent(as("il2"), { packageVersionId: v.versionId }), 409, "NOT_ELIGIBLE");
  await refused(service.startIndependent(as("il3"), { packageVersionId: v.versionId }), 409, "NOT_ELIGIBLE");
  const starts = await Promise.all([1, 2, 3].map(() => service.startIndependent(as("il"), { packageVersionId: v.versionId })));
  assert.equal(new Set(starts.map((s) => s.assignment.id)).size, 1, "three concurrent clicks, one assignment");
  assert.equal(await count(d, `student_id = '${P.il[0]}'`), 1);
  const again = await service.startIndependent(as("il"), { packageVersionId: v.versionId });
  assert.deepEqual([again.assignment.id, again.resumed], [starts[0].assignment.id, true]);
  await refused(service.startIndependent(as("il"), { packageVersionId: v2.versionId }), 409, "NOT_ELIGIBLE");
  const row = (await d.query("select kind, room_id, assigned_by, student_id, language from m2_reassessment_assignments")).rows[0];
  assert.deepEqual([row.kind, row.room_id, row.assigned_by, row.student_id, row.language], ["independent", null, P.il[0], P.il[0], "en"]);
});

test("delivery and official result: no keys; receipts bound to this learner + version + assignment; server scoring; recorded once", async () => {
  const { d, service, receipts } = await setup();
  const v = await version(d);
  const { assignment } = await service.startIndependent(as("il"), { packageVersionId: v.versionId });
  const { assessment } = await service.getContent(as("il"), assignment.id);
  assert.deepEqual([assessment.id, assessment.version, assessment.language], [`m2-package-version:${v.versionId}`, `assignment:${assignment.id}`, "en"]);
  assert.doesNotMatch(JSON.stringify(assessment), /correctChoiceId|"type"|sha256|reviewer|attestation/);
  const bind = binding(v.versionId, assignment.id);
  assert.deepEqual(await service.resolveBinding({ requester: as("il"), language: "en", ...bind }), bind);
  assert.equal(await service.resolveBinding({ requester: as("il2"), language: "en", ...bind }), null, "another Independent Learner");
  assert.equal(await service.resolveBinding({ requester: as("student"), language: "en", ...bind }), null, "a Student");
  assert.equal(await service.resolveBinding({ requester: as("sa"), language: "en", ...bind }), null, "staff");
  await refused(service.getContent(as("il2"), assignment.id), 404);
  await refused(service.getContent(as("student"), assignment.id), 404, "ASSIGNMENT_NOT_FOUND");
  const submit = (tokens, answers = ALL_RIGHT, extra = {}) => service.submitResult(as("il"), assignment.id, { transcriptReceipts: tokens, answers, ...extra });
  const code = DIAGNOSTIC_ASSESSMENTS.en;
  await refused(submit([receipt(receipts, { bind: getDiagnosticAssessmentBinding("en", code.id, code.version) })]), 422, "READING_NOT_VERIFIED");
  await refused(submit([receipt(receipts, { user: P.il2[0], bind })]), 422, "READING_NOT_VERIFIED");
  await refused(submit([receipt(receipts, { language: "fil", bind })]), 422, "READING_NOT_VERIFIED");
  await refused(submit([receipt(createTranscriptReceiptService({ getSecret: () => SECRET, now: () => Date.now() - 25 * 3600 * 1000 }), { bind })]), 422, "READING_NOT_VERIFIED");
  const result = await submit([receipt(receipts, { bind, recording: rid(5) })], { ...ALL_RIGHT, q2: "a" }, { orvScore: 0, readingLevel: "Frustration" });
  assert.deepEqual([result.wordRecognitionScore, result.comprehension], [100, { correct: 5, total: 6 }]);
  const row = (await d.query("select * from diagnostic_results where assessment_type = 'reassessment'")).rows[0];
  const ver = (await d.query("select content_sha256 from m2_assessment_package_versions where id = $1", [v.versionId])).rows[0];
  assert.deepEqual([row.user_id, row.package_version_id, row.content_sha256, row.reassessment_assignment_id, row.oral_reading_metrics.scoringRule],
    [P.il[0], v.versionId, ver.content_sha256, assignment.id, "title-optional-v1"]);
  assert.equal((await submit([receipt(receipts, { bind, recording: rid(5) })])).replayed, true);
  await refused(submit([receipt(receipts, { bind, recording: rid(6) })]), 409, "ASSIGNMENT_COMPLETED");
  assert.equal((await d.query("select count(*)::int n from diagnostic_results where assessment_type = 'reassessment'")).rows[0].n, 1);
});

test("pilot allow-list: parsing is default-off, exact, case-insensitive and fails closed; the log never shows ids", () => {
  for (const raw of [undefined, null, "", "   "]) assert.equal(parseIndependentPilot(raw).enabled, false);
  assert.equal(parseIndependentPilot(undefined).allows("anyone"), true, "off = previous behaviour");
  const one = parseIndependentPilot(` ${P.il[0].toUpperCase()} , `);
  assert.deepEqual([one.enabled, one.malformed, one.size, one.allows(P.il[0]), one.allows(P.il2[0]), one.allows(undefined)], [true, false, 1, true, false, false]);
  for (const raw of [`${P.il[0]},not-an-id`, ",", "x"]) {
    const bad = parseIndependentPilot(raw);
    assert.deepEqual([bad.enabled, bad.malformed, bad.allows(P.il[0])], [true, true, false], `fails closed for ${JSON.stringify(raw)}`);
  }
  assert.equal(describeIndependentPilot(parseIndependentPilot(undefined)), "M2 Independent Learner pilot allow-list: off");
  assert.equal(describeIndependentPilot(one), "M2 Independent Learner pilot allow-list: on (1 account)");
  assert.doesNotMatch(describeIndependentPilot(one) + describeIndependentPilot(parseIndependentPilot("x")), /0000/);
});

test("pilot ON: only the listed Independent Learner can start; everyone else is refused by the server, not just hidden", async () => {
  const { d, service } = await setup({ pilot: P.il2[0] }); // il2 is listed (but still inside its waiting interval)
  const v = await version(d);
  // il: eligible in every other way, but not in the pilot -> "not open yet", no Start, and the server refuses a direct call.
  const outside = await service.listMine(as("il"));
  assert.deepEqual([outside.languages.en.canStart, outside.languages.en.reason], [false, "Reassessments are not open yet. Please check again later."]);
  assert.equal(outside.available[0].canStart, false);
  await refused(service.startIndependent(as("il"), { packageVersionId: v.versionId }), 409, "REASSESSMENT_NOT_ENABLED");
  await refused(service.startIndependent(as("il3"), { packageVersionId: v.versionId }), 409, "REASSESSMENT_NOT_ENABLED");
  // Listed il2: the existing rules still apply (waiting interval since its initial diagnostic 2 days ago, 30-day interval).
  const listed = await service.listMine(as("il2"));
  assert.match(listed.languages.en.reason, /^Your next English reassessment opens on/);
  await refused(service.startIndependent(as("il2"), { packageVersionId: v.versionId }), 409, "NOT_ELIGIBLE");
  assert.equal(await count(d), 0, "nothing was created");
  // Students never self-start, pilot or not.
  await refused(service.startIndependent(as("student"), { packageVersionId: v.versionId }), 403, "REASSESSMENT_FORBIDDEN");
  // The switch OFF still closes everything, pilot or not.
  await su(d, () => d.query("update m2_reassessment_settings set independent_learner_enabled = false"));
  await refused(service.startIndependent(as("il2"), { packageVersionId: v.versionId }), 409, "REASSESSMENT_NOT_ENABLED");
});

test("pilot ON for an eligible learner: start, content and official result as without the pilot; interval and initial rules kept", async () => {
  const { d, service, receipts } = await setup({ pilot: P.il[0] });
  const v = await version(d);
  const second = await version(d, { title: "Second" });
  const mine = await service.listMine(as("il"));
  assert.deepEqual([mine.languages.en.canStart, mine.languages.fil.canStart], [true, false], "Filipino still needs its initial diagnostic");
  const { assignment } = await service.startIndependent(as("il"), { packageVersionId: v.versionId });
  await service.getContent(as("il"), assignment.id);
  const result = await service.submitResult(as("il"), assignment.id, { transcriptReceipts: [receipt(receipts, { bind: binding(v.versionId, assignment.id) })], answers: ALL_RIGHT });
  assert.equal(result.readingLevel, "Independent");
  const row = (await d.query("select user_id, package_version_id, verification_status, reading_level from diagnostic_results where assessment_type = 'reassessment'")).rows[0];
  assert.deepEqual([row.user_id, row.package_version_id, row.verification_status, row.reading_level], [P.il[0], v.versionId, "server_verified", "Independent"]);
  const after = await service.listMine(as("il"));
  assert.match(after.languages.en.reason, /^Your next English reassessment opens on/, "the waiting interval restarts as usual");
  await refused(service.startIndependent(as("il"), { packageVersionId: second.versionId }), 409, "NOT_ELIGIBLE");
});

test("pilot value malformed: fails closed — nobody can start", async () => {
  const { d, service } = await setup({ pilot: `${P.il[0]},oops` });
  const v = await version(d);
  assert.equal((await service.listMine(as("il"))).languages.en.canStart, false);
  await refused(service.startIndependent(as("il"), { packageVersionId: v.versionId }), 409, "REASSESSMENT_NOT_ENABLED");
  assert.equal(await count(d), 0);
});

test("after completing: the same version is never offered again, and the new result restarts the waiting interval", async () => {
  const { d, service, receipts } = await setup();
  const v = await version(d);
  await version(d, { title: "Second" });
  const { assignment } = await service.startIndependent(as("il"), { packageVersionId: v.versionId });
  await service.submitResult(as("il"), assignment.id, { transcriptReceipts: [receipt(receipts, { bind: binding(v.versionId, assignment.id) })], answers: ALL_RIGHT });
  const mine = await service.listMine(as("il"));
  const byTitle = Object.fromEntries(mine.available.map((a) => [a.title, a]));
  assert.deepEqual([byTitle["Garden check"].canStart, byTitle["Garden check"].reason], [false, "You already took this one."]);
  assert.equal(byTitle.Second.canStart, false);
  assert.match(byTitle.Second.reason, /Your next English reassessment opens on/);
  await refused(service.startIndependent(as("il"), { packageVersionId: v.versionId }), 409, "ALREADY_TAKEN");
  assert.deepEqual([mine.reassessments[0].status, mine.reassessments[0].result.readingLevel], ["completed", "Independent"]);
});

test("Filipino is independent of English; English and Filipino classifications stay separate", async () => {
  const { d, service, receipts } = await setup();
  await su(d, () => d.query(`insert into diagnostic_results(user_id, language, assessment_id, assessment_version, orv_score, comprehension_score, reading_level, difficulty_tier,
    verification_status, verification_method, verification_recording_id, verified_at) values ($1, 'fil', 'grade5-fil-passage-v3', '3.0', 70, 33, 'Frustration', 'Easy',
    'server_verified', 'server_stt_receipt_v1', $2, now() - interval '60 days')`, [P.il[0], rid(950)]));
  const en = await version(d);
  const fil = await version(d, { language: "fil", title: "Kuwento" });
  const a = await service.startIndependent(as("il"), { packageVersionId: en.versionId });
  const b = await service.startIndependent(as("il"), { packageVersionId: fil.versionId });
  assert.notEqual(a.assignment.id, b.assignment.id, "one active per language, both languages at once");
  await service.submitResult(as("il"), b.assignment.id, { transcriptReceipts: [receipt(receipts, { language: "fil", bind: binding(fil.versionId, b.assignment.id, "fil") })], answers: ALL_RIGHT });
  const cur = async (lang) => (await d.query("select assessment_type from m2_current_reading_level($1, $2)", [P.il[0], lang])).rows[0].assessment_type;
  assert.deepEqual([await cur("fil"), await cur("en")], ["reassessment", "initial"]);
});

test("a withdrawn version does not block the language forever: self-start closes it and starts the new one", async () => {
  const { d, service } = await setup();
  const v = await version(d);
  const v2 = await version(d, { title: "Second" });
  const first = await service.startIndependent(as("il"), { packageVersionId: v.versionId });
  await su(d, () => d.query(`update m2_assessment_package_versions set status = 'retired', retired_by = $2 where id = $1`, [v.versionId, P.sa[0]]));
  await refused(service.getContent(as("il"), first.assignment.id), 409, "VERSION_WITHDRAWN");
  const mine = await service.listMine(as("il"));
  assert.equal(mine.languages.en.canStart, true);
  assert.equal(mine.reassessments[0].unavailableReason, "This reassessment is no longer available. You can choose another one when it opens.");
  const second = await service.startIndependent(as("il"), { packageVersionId: v2.versionId });
  assert.notEqual(second.assignment.id, first.assignment.id);
  const old = (await d.query("select status, cancel_reason, cancelled_by from m2_reassessment_assignments where id = $1", [first.assignment.id])).rows[0];
  assert.deepEqual([old.status, old.cancelled_by], ["cancelled", P.il[0]]);
});

test("gate OFF after starting: content and submission refused; nothing recorded", async () => {
  const { d, service, receipts } = await setup();
  const v = await version(d);
  const { assignment } = await service.startIndependent(as("il"), { packageVersionId: v.versionId });
  await su(d, () => d.exec("update m2_reassessment_settings set independent_learner_enabled = false"));
  await refused(service.getContent(as("il"), assignment.id), 409, "REASSESSMENT_NOT_ENABLED");
  await refused(service.submitResult(as("il"), assignment.id, { transcriptReceipts: [receipt(receipts, { bind: binding(v.versionId, assignment.id) })], answers: ALL_RIGHT }), 409, "REASSESSMENT_NOT_ENABLED");
  assert.equal((await d.query("select count(*)::int n from diagnostic_results where assessment_type = 'reassessment'")).rows[0].n, 0);
});

test("M8 unchanged (trusted level still initial); the known level_up side effect applies to Independent Learners too", async () => {
  const { d, service, receipts } = await setup();
  const v = await version(d);
  const { assignment } = await service.startIndependent(as("il"), { packageVersionId: v.versionId });
  await service.submitResult(as("il"), assignment.id, { transcriptReceipts: [receipt(receipts, { bind: binding(v.versionId, assignment.id) })], answers: ALL_RIGHT });
  assert.equal((await d.query("select m2_trusted_reading_level($1, 'en') l", [P.il[0]])).rows[0].l, "Frustration");
  assert.equal((await d.query("select unlocked_difficulty from m8_learner_progress where user_id = $1", [P.il[0]])).rows[0].unlocked_difficulty, "Easy");
  assert.deepEqual((await d.query("select badge_id from m8_earned_badges where user_id = $1", [P.il[0]])).rows.map((r) => r.badge_id), ["level_up"]);
});

async function call(router, method, path, body) {
  const app = express();
  app.use(express.json());
  app.use("/api/reassessments", router);
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/reassessments${path}`, {
      method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
  }
}

test("routes: self-start for Independent Learners only; the learner id always comes from the session", async () => {
  const { d, service } = await setup();
  const v = await version(d);
  const il = createReassessmentsRouter({ authorizeLearner: async () => as("il"), delivery: service });
  const started = await call(il, "POST", "/me/independent/start", { packageVersionId: v.versionId, studentId: P.il2[0] });
  assert.equal(started.status, 200);
  assert.equal((await d.query("select student_id from m2_reassessment_assignments")).rows[0].student_id, P.il[0]);
  const list = await call(il, "GET", "/me");
  assert.deepEqual([list.status, list.body.reassessments.length, list.body.available.length], [200, 1, 1]);
  const student = createReassessmentsRouter({ authorizeLearner: async () => as("student"), delivery: service });
  assert.deepEqual([(await call(student, "POST", "/me/independent/start", { packageVersionId: v.versionId })).status], [403]);
  const studentList = await call(student, "GET", "/me");
  assert.equal(studentList.body.available, undefined, "Students never see Independent Learner packages");
});
