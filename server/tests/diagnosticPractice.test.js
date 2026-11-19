// M2 F7 Preview / Try Assessment (staff Practice Mode). Synthetic receipts and transcripts only; no Azure, no database.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { readFileSync } = require("node:fs");
const { createServer } = require("node:http");
const { once } = require("node:events");
const { WebSocket } = require("ws");

const { createDiagnosticPracticeRouter } = require("../routes/diagnosticPractice");
const { createDiagnosticPracticeService } = require("../services/diagnosticPracticeService");
const { createDiagnosticAudioHandler } = require("../routes/diagnosticAudio");
const { attachDiagnosticSpeechSocket } = require("../routes/diagnosticSpeechSocket");
const {
  authorizeDiagnosticPracticeRequest, authorizeDiagnosticSpeechRequest, authorizeOralReadingPracticeRequest, authorizeOralReadingRequest,
} = require("../services/oralReadingAttemptService");
const { DIAGNOSTIC_ASSESSMENTS, getDiagnosticAssessmentBinding, getDiagnosticPassageText } = require("../services/diagnosticAssessments");
const { DIAGNOSTIC_SCORING_RULE, getReadingWords, scoreDiagnostic } = require("../services/diagnosticScoring");
const { SupabaseAuthenticationError } = require("../services/supabaseAdmin");
const { testReceipts } = require("./fixtures/diagnosticTrust");

const PROFILES = {
  sysadmin: { id: "sa-1", role: "system_admin" },
  admin: { id: "admin-1", role: "admin" },
  teacher: { id: "teacher-1", role: "teacher", teacher_status: "approved" },
  pending: { id: "teacher-2", role: "teacher", teacher_status: "pending" },
  student: { id: "student-1", role: "student" },
  general: { id: "general-1", role: "general_user" },
  none: { id: "none-1", role: null },
};
const deps = {
  prefetchProfile: false,
  async getAuthenticatedSupabaseUser(req) {
    const token = /^Bearer\s+(.+)$/i.exec(req.get("authorization") ?? "")?.[1]?.trim();
    if (!token || !PROFILES[token]) throw new SupabaseAuthenticationError();
    return { id: PROFILES[token].id };
  },
  getSupabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: (_c, id) => ({ single: async () => {
    const p = Object.values(PROFILES).find((x) => x.id === id);
    return { data: { id, full_name: "", nickname: null, role: p.role, teacher_status: p.teacher_status ?? null }, error: null };
  } }) }) }) }),
};
const req = (token) => ({ get: (h) => (h.toLowerCase() === "authorization" && token ? `Bearer ${token}` : undefined) });
const allowed = async (fn, token) => { try { await fn(req(token), deps); return true; } catch { return false; } };

const RID = "00000000-0000-4000-8000-0000000000f7";
function readingFor(receipts, userId, language, transcript, recordingId = RID) {
  const a = DIAGNOSTIC_ASSESSMENTS[language];
  const binding = getDiagnosticAssessmentBinding(language, a.id, a.version);
  return [receipts.issue({ userId, language, binding, recordingId, segmentIndex: 1, source: "upload", text: transcript, confidence: 0.9 })];
}
function body(language, transcriptReceipts, correct = 6) {
  const a = DIAGNOSTIC_ASSESSMENTS[language];
  return { language, assessmentId: a.id, assessmentVersion: a.version, transcriptReceipts, recordingDurationSeconds: 40,
    answers: Object.fromEntries(a.questions.map((q, i) => [q.id, i < correct ? q.correctChoiceId : q.choiceIds.find((c) => c !== q.correctChoiceId)])) };
}

// ---------- Authorization ----------
test("practice scoring: System Admin, School Admin and APPROVED Teachers only; learners, pending Teachers and role-less accounts refused", async () => {
  for (const token of ["sysadmin", "admin", "teacher"]) assert.equal(await allowed(authorizeDiagnosticPracticeRequest, token), true, token);
  for (const token of ["student", "general", "pending", "none"]) assert.equal(await allowed(authorizeDiagnosticPracticeRequest, token), false, token);
  assert.equal(await allowed(authorizeDiagnosticPracticeRequest, undefined), false);
});

test("diagnostic speech: learners (official) and staff (practice); pending Teachers and role-less refused", async () => {
  for (const token of ["student", "general", "sysadmin", "admin", "teacher"]) assert.equal(await allowed(authorizeDiagnosticSpeechRequest, token), true, token);
  for (const token of ["pending", "none"]) assert.equal(await allowed(authorizeDiagnosticSpeechRequest, token), false, token);
});

test("unchanged: M5 self-practice speech roles and the OFFICIAL diagnostic (learners only) still refuse new staff roles", async () => {
  for (const token of ["sysadmin", "teacher"]) assert.equal(await allowed(authorizeOralReadingPracticeRequest, token), false, `M5 ${token}`);
  assert.equal(await allowed(authorizeOralReadingPracticeRequest, "admin"), true, "School Admin keeps M5 self-practice");
  for (const token of ["sysadmin", "admin", "teacher", "pending"]) assert.equal(await allowed(authorizeOralReadingRequest, token), false, `official ${token}`);
  for (const token of ["student", "general"]) assert.equal(await allowed(authorizeOralReadingRequest, token), true, `official ${token}`);
});

// ---------- Scoring: same server rubric, nothing stored ----------
for (const language of ["en", "fil"]) {
  test(`${language}: practice uses the official server scorer and classification, and is labelled practice and unsaved`, () => {
    const receipts = testReceipts();
    const service = createDiagnosticPracticeService({ receipts });
    const a = DIAGNOSTIC_ASSESSMENTS[language];
    const passage = getDiagnosticPassageText(a);
    const words = getReadingWords(passage, language);
    const transcript = `${a.title}. ${words.map((w, i) => (i === 5 || i === 30 ? `zz${w}` : w)).join(" ")}`;
    const result = service.scorePractice({ user: { id: "teacher-1" } }, body(language, readingFor(receipts, "teacher-1", language, transcript), 5));
    const official = scoreDiagnostic({ assessment: a, passageText: passage, transcript, recordingDurationSeconds: 40, answers: body(language, [], 5).answers });
    assert.equal(result.practice, true);
    assert.equal(result.saved, false);
    assert.equal(result.scoringRule, DIAGNOSTIC_SCORING_RULE);
    assert.equal(result.wordRecognitionScore, official.orvScore);
    assert.equal(result.comprehensionScore, official.comprehensionScore);
    assert.equal(result.readingLevel, official.readingLevel);
    assert.equal(result.reading.titleWordsExcluded, getReadingWords(a.title, language).length, "the title rule applies to practice too");
    assert.deepEqual([result.reading.substitutions, result.reading.omissions, result.reading.insertions], [2, 0, 0]);
    assert.deepEqual([result.comprehension.correct, result.comprehension.total], [5, 6]);
    assert.equal(JSON.stringify(result).includes("correctChoiceId"), false, "the answer key is not returned");
    assert.equal("transcript" in result, false);
  });
}

test("practice cannot be scored with another account's reading receipts, or for a stale assessment, or with missing answers", () => {
  const receipts = testReceipts();
  const service = createDiagnosticPracticeService({ receipts });
  const transcript = getDiagnosticPassageText(DIAGNOSTIC_ASSESSMENTS.en);
  const others = readingFor(receipts, "student-1", "en", transcript);
  assert.throws(() => service.scorePractice({ user: { id: "teacher-1" } }, body("en", others)), (e) => e.code === "READING_NOT_VERIFIED");
  const own = readingFor(receipts, "teacher-1", "en", transcript);
  assert.throws(() => service.scorePractice({ user: { id: "teacher-1" } }, { ...body("en", own), assessmentVersion: "2.0" }), (e) => e.code === "ASSESSMENT_CHANGED");
  assert.throws(() => service.scorePractice({ user: { id: "teacher-1" } }, { ...body("en", own), answers: {} }), (e) => e.code === "INVALID_ANSWERS");
  assert.throws(() => service.scorePractice({ user: { id: "teacher-1" } }, body("en", readingFor(receipts, "teacher-1", "fil", transcript))), (e) => e.code === "READING_NOT_VERIFIED", "receipts are bound to the language/assessment");
});

test("the practice service and route have no database access: no Supabase client, no insert/update/upsert", () => {
  for (const file of ["../services/diagnosticPracticeService.js", "../routes/diagnosticPractice.js"]) {
    const source = readFileSync(require.resolve(file), "utf8");
    assert.doesNotMatch(source, /getSupabaseAdmin|\.from\(|\.insert\(|\.update\(|\.upsert\(|\.rpc\(/, file);
  }
});

// ---------- Route ----------
async function startRouter(t, { rateLimit } = {}) {
  const receipts = testReceipts();
  const app = express();
  app.use(express.json());
  app.use(createDiagnosticPracticeRouter({ receipts, authorize: (r) => authorizeDiagnosticPracticeRequest(r, deps), log: () => {}, ...(rateLimit ? { rateLimit } : {}) }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const post = async (token, payload) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/diagnostic/practice`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) });
    return { status: r.status, body: await r.json(), cache: r.headers.get("cache-control") };
  };
  return { post, receipts };
}

test("POST /api/diagnostic/practice: staff get a practice result; learners, pending Teachers and signed-out requests are refused", async (t) => {
  const { post, receipts } = await startRouter(t);
  const transcript = getDiagnosticPassageText(DIAGNOSTIC_ASSESSMENTS.fil);
  for (const token of ["sysadmin", "admin", "teacher"]) {
    const r = await post(token, body("fil", readingFor(receipts, PROFILES[token].id, "fil", transcript)));
    assert.equal(r.status, 200, token);
    assert.equal(r.cache, "no-store");
    assert.deepEqual([r.body.result.practice, r.body.result.saved, r.body.result.readingLevel, r.body.result.wordRecognitionScore], [true, false, "Independent", 100], token);
  }
  for (const token of ["student", "general", "pending", "none"]) {
    const r = await post(token, body("fil", readingFor(receipts, PROFILES[token].id, "fil", transcript)));
    assert.equal(r.status, 403, token);
    assert.equal(r.body.code, "PRACTICE_FORBIDDEN");
  }
  assert.equal((await post(undefined, body("fil", []))).status, 401);
});

test("practice can be repeated with the same or a new reading; a burst is rate limited", async (t) => {
  const { post, receipts } = await startRouter(t, { rateLimit: { limit: 3, windowMs: 60000 } });
  const transcript = getDiagnosticPassageText(DIAGNOSTIC_ASSESSMENTS.en);
  const first = readingFor(receipts, "admin-1", "en", transcript);
  assert.equal((await post("admin", body("en", first))).status, 200);
  assert.equal((await post("admin", body("en", first))).status, 200, "same reading again");
  assert.equal((await post("admin", body("en", readingFor(receipts, "admin-1", "en", transcript, "00000000-0000-4000-8000-0000000000f8"), 3))).body.result.comprehensionScore, 50);
  assert.equal((await post("admin", body("en", first))).status, 429);
});

// ---------- Upload fallback: new staff roles may send diagnostic parts only ----------
test("upload fallback: System Admin and Teachers cannot use plain (non-diagnostic) transcription; diagnostic parts work; original roles unchanged", async () => {
  const run = async (role, withDiagnostic) => {
    let called = false;
    const handler = createDiagnosticAudioHandler({ receipts: testReceipts(), log() {}, remove: async () => {}, transcribe: async () => { called = true; return { text: "synthetic reading" }; } });
    const a = DIAGNOSTIC_ASSESSMENTS.en;
    const res = { code: 200, body: null, locals: { speechRequester: { user: { id: `${role}-x` }, profile: { role } } }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    const fields = withDiagnostic ? { recordingId: RID, segmentIndex: "1", assessmentId: a.id, assessmentVersion: a.version } : {};
    await handler({ file: { path: "part.wav", mimetype: "audio/wav" }, body: { language: "en", ...fields } }, res);
    return { code: res.code, called, receipt: Boolean(res.body?.transcription?.receipt), error: res.body?.code };
  };
  for (const role of ["system_admin", "teacher"]) {
    assert.deepEqual(await run(role, false), { code: 403, called: false, receipt: false, error: "DIAGNOSTIC_ONLY" }, `${role} plain`);
    assert.deepEqual(await run(role, true), { code: 200, called: true, receipt: true, error: undefined }, `${role} diagnostic`);
  }
  for (const role of ["student", "general_user", "admin"]) assert.equal((await run(role, false)).code, 200, `${role} plain unchanged`);
});

// ---------- Live stream: diagnostic streams admit staff; M5 streams keep their roles ----------
test("live stream: diagnostic streams admit staff (and refuse pending Teachers); M5 streams still refuse System Admin and Teachers", async (t) => {
  const server = createServer();
  const sessions = [];
  attachDiagnosticSpeechSocket(server, {
    receipts: testReceipts(),
    authorize: (token) => authorizeOralReadingPracticeRequest(req(token), deps),
    authorizeDiagnostic: (token) => authorizeDiagnosticSpeechRequest(req(token), deps),
    allowedOrigins: ["http://localhost:5173"],
    createSession: (options) => { sessions.push(options); return { acceptAudio() {}, stop() {}, dispose() {} }; },
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const a = DIAGNOSTIC_ASSESSMENTS.en;
  const open = async (token, diagnostic) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws/diagnostic/speech`, { origin: "http://localhost:5173" });
    await once(ws, "open");
    const before = sessions.length;
    let rejected = false;
    ws.on("message", (m) => { if (JSON.parse(m.toString()).type === "error") rejected = true; });
    ws.send(JSON.stringify({ type: "configure", encoding: "LINEAR16", sampleRate: 16000, channels: 1, accessToken: token, language: "en",
      ...(diagnostic ? { diagnostic: { assessmentId: a.id, assessmentVersion: a.version } } : {}) }));
    await new Promise((r) => setTimeout(r, 150));
    const accepted = sessions.length > before && !rejected;
    const issuesReceipts = accepted && typeof sessions.at(-1).issueReceipt === "function";
    ws.terminate();
    return { accepted, issuesReceipts };
  };
  for (const token of ["sysadmin", "admin", "teacher", "student", "general"]) assert.deepEqual(await open(token, true), { accepted: true, issuesReceipts: true }, `diagnostic ${token}`);
  assert.deepEqual(await open("pending", true), { accepted: false, issuesReceipts: false }, "pending Teacher, diagnostic");
  for (const token of ["sysadmin", "teacher", "pending"]) assert.equal((await open(token, false)).accepted, false, `M5 ${token}`);
  for (const token of ["admin", "student"]) assert.deepEqual(await open(token, false), { accepted: true, issuesReceipts: false }, `M5 ${token}`);
});
