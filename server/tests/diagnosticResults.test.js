const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");

const { createDiagnosticResultsRouter } = require("../routes/diagnosticResults");
const { createSpeechRouter } = require("../routes/speech");
const { createDiagnosticResultService, verifyReading, resolveDuration } = require("../services/diagnosticResultService");
const { createDiagnosticSpeechSession } = require("../services/diagnosticSpeechStream");
const { createTranscriptReceiptService, DiagnosticReceiptError } = require("../services/diagnosticTranscriptReceipts");
const {
  DIAGNOSTIC_ASSESSMENTS, getDiagnosticAssessmentBinding, getDiagnosticPassageText,
} = require("../services/diagnosticAssessments");
const { scoreDiagnostic, getReadingWords } = require("../services/diagnosticScoring");
const { SupabaseAuthenticationError } = require("../services/supabaseAdmin");
const { authorizeOralReadingRequest, authorizeOralReadingPracticeRequest } = require("../services/oralReadingAttemptService");
const { testReceipts } = require("./fixtures/diagnosticTrust");

const RID = "00000000-0000-4000-8000-0000000000a1";
const binding = (language) => getDiagnosticAssessmentBinding(language, DIAGNOSTIC_ASSESSMENTS[language].id, "3.0");
const RID_2 = "00000000-0000-4000-8000-0000000000a2";
const PROFILES = {
  student: { id: "student-1", role: "student" },
  "student-2": { id: "student-2", role: "student" },
  general: { id: "general-1", role: "general_user" },
  admin: { id: "admin-1", role: "admin" },
  teacher: { id: "teacher-1", role: "teacher" },
};

const authDependencies = {
  async getAuthenticatedSupabaseUser(req) {
    const token = /^Bearer\s+(.+)$/i.exec(req.get("authorization") ?? "")?.[1]?.trim();
    if (!token || !PROFILES[token]) throw new SupabaseAuthenticationError();
    return { id: PROFILES[token].id };
  },
  getSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: (_column, id) => ({
      single: async () => {
        const profile = Object.values(PROFILES).find((item) => item.id === id);
        return { data: { id, full_name: "", nickname: null, role: profile.role }, error: null };
      },
    }) }) }),
  }),
};

// Service-role stand-in for diagnostic_results with the DT1 partial unique
// indexes. Behaviour of the real grants/policies is tested in PostgreSQL.
function fakeAdmin({ beforeInsert } = {}) {
  const rows = [];
  const inserts = [];
  const versionKey = (row) => [row.user_id, row.assessment_type, row.language, row.assessment_id, row.assessment_version, row.verification_status].join("|");
  return {
    rows,
    inserts,
    from(table) {
      assert.equal(table, "diagnostic_results");
      const filters = [];
      const query = {
        select: () => query,
        eq(key, value) { filters.push([key, value]); return query; },
        maybeSingle: async () => {
          const found = rows.filter((row) => filters.every(([key, value]) => row[key] === value));
          return { data: found[0] ?? null, error: null };
        },
        insert(row) {
          return { select: () => ({ single: async () => {
            await beforeInsert?.(row, rows);
            inserts.push(row);
            if (rows.some((existing) => versionKey(existing) === versionKey(row))
              || rows.some((existing) => existing.user_id === row.user_id && existing.verification_recording_id === row.verification_recording_id)) {
              return { data: null, error: { code: "23505", message: "duplicate key" } };
            }
            const stored = { id: `row-${rows.length + 1}`, created_at: row.completed_at, ...row };
            rows.push(stored);
            return { data: stored, error: null };
          } }) };
        },
      };
      return query;
    },
  };
}

function passageWords(language, miscues = 0) {
  const words = getReadingWords(getDiagnosticPassageText(DIAGNOSTIC_ASSESSMENTS[language]), language);
  return words.map((word, index) => (index < miscues ? `zz${index}` : word));
}

function answers(language, correct = 6) {
  return Object.fromEntries(DIAGNOSTIC_ASSESSMENTS[language].questions.map((q, index) =>
    [q.id, index < correct ? q.correctChoiceId : "b"]));
}

function body(language, transcriptReceipts, extra = {}) {
  const assessment = DIAGNOSTIC_ASSESSMENTS[language];
  return { language, assessmentId: assessment.id, assessmentVersion: assessment.version,
    answers: answers(language), transcriptReceipts, recordingDurationSeconds: 40, ...extra };
}

async function startApp(t, { receipts = testReceipts(), admin = fakeAdmin(), now, rateLimit } = {}) {
  const uploadDirectory = await mkdtemp(path.join(tmpdir(), "readflow-dt1-"));
  const transcripts = [];
  const transcribeCalls = [];
  const logs = [];
  const app = express();
  app.use(express.json());
  app.use(createSpeechRouter({
    uploadDirectory,
    receipts,
    authorize: (req) => authorizeOralReadingPracticeRequest(req, authDependencies),
    transcribe: async (file, languageCode) => {
      transcribeCalls.push(languageCode);
      return transcripts.shift() ?? { text: "no speech configured" };
    },
    log: (...entry) => logs.push(entry),
  }));
  app.use(createDiagnosticResultsRouter({
    receipts,
    authorize: (req) => authorizeOralReadingRequest(req, authDependencies),
    service: createDiagnosticResultService({ receipts, getAdmin: () => admin, ...(now ? { now } : {}) }),
    ...(rateLimit ? { rateLimit } : {}),
    log: (...entry) => logs.push(entry),
  }));
  const server = await new Promise((resolveListen) => {
    const listening = app.listen(0, "127.0.0.1", () => resolveListen(listening));
  });
  t.after(async () => {
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(uploadDirectory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = (token) => (token ? { Authorization: `Bearer ${token}` } : {});
  return {
    admin, receipts, transcripts, transcribeCalls, logs,
    async upload(token, {
      language = "en", recordingId = RID, segmentIndex = 1, text,
      assessmentId = DIAGNOSTIC_ASSESSMENTS[language]?.id ?? "unknown", assessmentVersion = "3.0",
    } = {}) {
      if (text !== undefined) transcripts.push({ text, confidence: 0.9 });
      const form = new FormData();
      form.append("audio", new Blob([Buffer.from("wav")], { type: "audio/wav" }), "part.wav");
      form.append("language", language);
      if (recordingId !== null) form.append("recordingId", recordingId);
      if (segmentIndex !== null) form.append("segmentIndex", String(segmentIndex));
      if (assessmentId !== null) form.append("assessmentId", assessmentId);
      if (assessmentVersion !== null) form.append("assessmentVersion", assessmentVersion);
      const response = await fetch(`${base}/api/diagnostic/audio`, { method: "POST", headers: auth(token), body: form });
      return { status: response.status, json: await response.json() };
    },
    async submit(token, payload) {
      const response = await fetch(`${base}/api/diagnostic/results`, {
        method: "POST", headers: { ...auth(token), "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      return { status: response.status, json: await response.json() };
    },
  };
}

// Reads the passage in three uploaded parts and returns their receipts.
async function readInParts(app, token, language, { miscues = 0, recordingId = RID } = {}) {
  const words = passageWords(language, miscues);
  const parts = [words.slice(0, 20), words.slice(20, 40), words.slice(40)];
  const receipts = [];
  for (const [index, part] of parts.entries()) {
    const response = await app.upload(token, { language, recordingId, segmentIndex: index + 1, text: part.join(" ") });
    assert.equal(response.status, 200);
    receipts.push(response.json.transcription.receipt);
  }
  return receipts;
}

test("1/2/10. genuine EN and FIL submissions are scored on the server with the existing rubric", async (t) => {
  const app = await startApp(t);
  for (const [language, miscues, recordingId] of [["en", 3, RID], ["fil", 0, RID_2]]) {
    const receipts = await readInParts(app, "student", language, { miscues, recordingId });
    const response = await app.submit("student", body(language, receipts));
    assert.equal(response.status, 201);
    const row = response.json.result;
    const assessment = DIAGNOSTIC_ASSESSMENTS[language];
    const expected = scoreDiagnostic({ assessment, passageText: getDiagnosticPassageText(assessment),
      transcript: passageWords(language, miscues).join(" "), recordingDurationSeconds: 40, answers: answers(language) });
    assert.equal(row.language, language);
    assert.equal(row.assessment_id, assessment.id);
    assert.equal(row.orv_score, expected.orvScore);
    assert.equal(row.reading_level, expected.readingLevel);
    assert.equal(row.difficulty_tier, expected.difficultyTier);
    assert.equal(row.verification_status, "server_verified");
    assert.equal(row.verification_recording_id, recordingId);
    assert.equal(row.oral_reading_metrics.transcriptSource, "upload");
    assert.equal(row.oral_reading_metrics.durationSource, "client_reported");
  }
  assert.deepEqual(app.transcribeCalls, ["en-US", "en-US", "en-US", "fil-PH", "fil-PH", "fil-PH"]);
  // 3 miscues in 60 words = 95% -> Instructional; perfect Filipino reading -> Independent.
  assert.deepEqual(app.admin.rows.map((row) => [row.language, row.reading_level, row.difficulty_tier]),
    [["en", "Instructional", "Medium"], ["fil", "Independent", "Hard"]]);
});

test("3. forged scores, levels, tiers and transcripts in the request are ignored", async (t) => {
  const app = await startApp(t);
  const receipts = await readInParts(app, "student", "en", { miscues: 12 });
  const response = await app.submit("student", body("en", receipts, {
    orvScore: 100, comprehensionScore: 100, readingLevel: "Independent", difficultyTier: "Hard",
    reading_level: "Independent", difficulty_tier: "Hard", transcript: passageWords("en").join(" "),
    verification_status: "server_verified", user_id: "student-2",
  }));
  assert.equal(response.status, 201);
  assert.equal(response.json.result.reading_level, "Frustration");
  assert.equal(response.json.result.difficulty_tier, "Easy");
  assert.equal(response.json.result.user_id, "student-1");
  assert.match(response.json.result.transcript, /zz0/);
});

test("3. a transcript the browser edits inside a receipt fails the signature check", async (t) => {
  const app = await startApp(t);
  const [receipt] = await readInParts(app, "student", "en", { miscues: 12 });
  const [payload, signature] = receipt.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  const forgedPayload = Buffer.from(JSON.stringify({ ...claims, text: passageWords("en").slice(0, 20).join(" ") })).toString("base64url");
  for (const forged of [`${forgedPayload}.${signature}`, `${payload}.${signature.slice(0, -2)}AA`, `${payload}`, "", "a.b.c"]) {
    const response = await app.submit("student", body("en", [forged]));
    assert.equal(response.status, 422);
    assert.equal(response.json.code, "READING_NOT_VERIFIED");
  }
  // A receipt signed with another secret (another deployment, or an attacker's) is rejected.
  const foreign = createTranscriptReceiptService({ getSecret: () => "x".repeat(40) }).issue({
    userId: "student-1", language: "en", binding: binding("en"), recordingId: RID, segmentIndex: 1,
    source: "upload", text: passageWords("en").join(" "),
  });
  assert.equal((await app.submit("student", body("en", [foreign]))).status, 422);
  assert.equal(app.admin.rows.length, 0);
});

test("1. receipts are bound to the diagnostic: another assessment, version or passage text is rejected", async (t) => {
  const app = await startApp(t);
  const text = passageWords("en").join(" ");
  const issue = (overrides) => app.receipts.issue({
    userId: "student-1", language: "en", recordingId: RID, segmentIndex: 1, source: "upload", text,
    binding: { ...binding("en"), ...overrides },
  });
  for (const overrides of [
    { assessmentVersion: "2.0" },                        // retired version of the same diagnostic
    { assessmentId: DIAGNOSTIC_ASSESSMENTS.fil.id },     // the other language's diagnostic
    { assessmentId: "m5-module-passage" },              // any other reading activity
    { passageHash: "0".repeat(64) },                     // same id/version, different passage text
  ]) {
    const response = await app.submit("student", body("en", [issue(overrides)]));
    assert.equal(response.status, 422, JSON.stringify(overrides));
  }
  assert.equal((await app.submit("student", body("en", [issue({})]))).status, 201);
});

test("1. receipts without the diagnostic purpose and binding claims fail verification", async (t) => {
  const app = await startApp(t);
  const { createHmac } = require("node:crypto");
  const { TEST_RECEIPT_SECRET } = require("./fixtures/diagnosticTrust");
  // A correctly signed receipt in the pre-binding shape (no purpose/assessment/passage).
  const payload = Buffer.from(JSON.stringify({ v: 1, sub: "student-1", lang: "en", rid: RID, seg: 1, src: "upload",
    text: passageWords("en").join(" "), iat: Date.now() })).toString("base64url");
  const signature = createHmac("sha256", TEST_RECEIPT_SECRET).update(`readflow.m2.transcript-receipt.v1.${payload}`).digest("base64url");
  assert.equal((await app.submit("student", body("en", [`${payload}.${signature}`]))).status, 422);
  assert.throws(() => app.receipts.issue({ userId: "student-1", language: "en", recordingId: RID, segmentIndex: 1,
    source: "upload", text: "x" }), /Invalid transcript receipt claims/);
});

test("1/2. uploads get a receipt only for the active diagnostic; M5 reading uploads never do", async (t) => {
  const app = await startApp(t);
  for (const fields of [{ assessmentVersion: "2.0" }, { assessmentId: "m5-module-passage" },
    { language: "fil", assessmentId: DIAGNOSTIC_ASSESSMENTS.en.id }, { assessmentId: null }, { assessmentVersion: null }]) {
    const response = await app.upload("student", { ...fields, text: "x" });
    assert.equal(response.status, 400, JSON.stringify(fields));
  }
  const stale = await app.upload("student", { assessmentVersion: "2.0", text: "x" });
  assert.match(stale.json.message, /reload/);
  // Any diagnostic field turns the request into an M2 part, which must then be complete.
  const partial = await app.upload("student", { recordingId: null, segmentIndex: null, assessmentVersion: null, text: "x" });
  assert.equal(partial.status, 400);
  app.transcripts.length = 0;
  assert.deepEqual(app.transcribeCalls, []);
});

test("9. another learner's receipts, and receipts for the other language, are rejected", async (t) => {
  const app = await startApp(t);
  const studentTwo = await readInParts(app, "student-2", "en");
  const theirs = await app.submit("student", body("en", studentTwo));
  assert.equal(theirs.status, 422);
  const filipino = await readInParts(app, "student", "fil", { recordingId: RID_2 });
  assert.equal((await app.submit("student", body("en", filipino))).status, 422);
  assert.equal(app.admin.rows.length, 0);
});

test("parts must come from one recording, in order, with nothing missing or repeated", async (t) => {
  const app = await startApp(t);
  const first = await readInParts(app, "student", "en");
  const second = await readInParts(app, "student", "en", { recordingId: RID_2 });
  for (const tokens of [[first[0], second[1], first[2]], [first[1], first[0], first[2]], [first[0], first[2]],
    [first[1], first[2]], [first[0], first[0], first[1]], [], Array(13).fill(first[0]), "not-an-array"]) {
    assert.equal((await app.submit("student", body("en", tokens))).status, 422);
  }
  assert.equal((await app.submit("student", body("en", first.slice(0, 2)))).status, 201);
});

test("5. duplicate submissions and retries are idempotent; a second recording cannot replace the result", async (t) => {
  const app = await startApp(t);
  const receipts = await readInParts(app, "student", "en");
  const first = await app.submit("student", body("en", receipts));
  const retry = await app.submit("student", body("en", receipts, { answers: answers("en", 0) }));
  assert.equal(first.status, 201);
  assert.equal(retry.status, 200);
  assert.equal(retry.json.replayed, true);
  assert.deepEqual(retry.json.result, first.json.result);
  const better = await readInParts(app, "student", "en", { recordingId: RID_2 });
  const replaced = await app.submit("student", body("en", better));
  assert.equal(replaced.status, 409);
  assert.equal(replaced.json.code, "DIAGNOSTIC_ALREADY_COMPLETED");
  assert.equal(app.admin.rows.length, 1);
});

test("one recording cannot produce verified results for two diagnostics", async (t) => {
  const admin = fakeAdmin();
  admin.rows.push({ id: "other", user_id: "student-1", assessment_type: "initial", language: "fil",
    assessment_id: DIAGNOSTIC_ASSESSMENTS.fil.id, assessment_version: "3.0", verification_status: "server_verified", verification_recording_id: RID });
  const app = await startApp(t, { admin });
  const response = await app.submit("student", body("en", await readInParts(app, "student", "en")));
  assert.equal(response.status, 422);
  assert.equal(admin.rows.length, 1);
});

test("5. concurrent submissions of one recording store a single verified row", async (t) => {
  const admin = fakeAdmin();
  const app = await startApp(t, { admin });
  const receipts = await readInParts(app, "student", "en");
  const results = await Promise.all(Array.from({ length: 5 }, () => app.submit("student", body("en", receipts))));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 200, 200, 201]);
  assert.equal(admin.rows.length, 1);
  assert.ok(results.every((r) => r.json.result.id === admin.rows[0].id));
});

test("6. an existing unverified row does not block, and is not overwritten by, a verified result", async (t) => {
  const admin = fakeAdmin();
  const legacy = { id: "legacy", user_id: "student-1", assessment_type: "initial", language: "en",
    assessment_id: DIAGNOSTIC_ASSESSMENTS.en.id, assessment_version: "3.0", reading_level: "Independent",
    difficulty_tier: "Hard", orv_score: 100, verification_status: "unverified", verification_recording_id: null };
  admin.rows.push({ ...legacy });
  const app = await startApp(t, { admin });
  const response = await app.submit("student", body("en", await readInParts(app, "student", "en", { miscues: 12 })));
  assert.equal(response.status, 201);
  assert.deepEqual(admin.rows[0], legacy);
  assert.equal(admin.rows[1].reading_level, "Frustration");
});

test("8. missing, invalid or expired sessions and non-learner roles cannot submit", async (t) => {
  const app = await startApp(t);
  const receipts = await readInParts(app, "student", "en");
  for (const token of [undefined, "expired-token"]) {
    const response = await app.submit(token, body("en", receipts));
    assert.equal(response.status, 401);
    assert.equal(response.json.code, "AUTH_REQUIRED");
  }
  for (const token of ["teacher", "admin"]) {
    assert.equal((await app.submit(token, body("en", receipts))).status, 403);
  }
  assert.equal(app.admin.rows.length, 0);
});

test("8. receipts expire after the session recovery window", async (t) => {
  let clock = Date.parse("2026-10-23T00:00:00Z");
  const receipts = testReceipts({ now: () => clock });
  const app = await startApp(t, { receipts });
  const tokens = await readInParts(app, "student", "en");
  clock += 24 * 60 * 60 * 1000 + 1;
  const response = await app.submit("student", body("en", tokens));
  assert.equal(response.status, 422);
  assert.equal(response.json.code, "READING_NOT_VERIFIED");
});

test("assessment identity, answers and language are validated by the server", async (t) => {
  const app = await startApp(t);
  const receipts = await readInParts(app, "student", "en");
  assert.equal((await app.submit("student", body("en", receipts, { assessmentVersion: "2.0" }))).json.code, "ASSESSMENT_CHANGED");
  assert.equal((await app.submit("student", body("en", receipts, { assessmentId: "grade5-fil-passage-v3" }))).json.code, "ASSESSMENT_CHANGED");
  assert.equal((await app.submit("student", body("en", receipts, { language: "es" }))).json.code, "INVALID_ASSESSMENT");
  assert.equal((await app.submit("student", body("en", receipts, { answers: {} }))).json.code, "INVALID_ANSWERS");
  assert.equal((await app.submit("student", body("en", receipts, { answers: { ...answers("en"), "en-question-2": "z" } }))).json.code, "INVALID_ANSWERS");
  assert.equal(app.admin.rows.length, 0);
});

test("upload parts need a valid recording identity; M5 uploads are unchanged and get no receipt", async (t) => {
  const app = await startApp(t);
  for (const fields of [{ recordingId: "not-a-uuid" }, { segmentIndex: 0 }, { segmentIndex: 13 }, { segmentIndex: "1.5" },
    { recordingId: null }, { segmentIndex: null }]) {
    assert.equal((await app.upload("student", { ...fields, text: "x" })).status, 400);
  }
  app.transcripts.length = 0;
  const m5 = await app.upload("admin", { recordingId: null, segmentIndex: null, assessmentId: null, assessmentVersion: null, text: "practice reading" });
  assert.equal(m5.status, 200);
  assert.deepEqual(m5.json.transcription, { text: "practice reading", confidence: 0.9 });
});

test("without a receipt secret the diagnostic fails closed before Azure is called", async (t) => {
  const receipts = createTranscriptReceiptService({ getSecret: () => undefined });
  const app = await startApp(t, { receipts });
  const upload = await app.upload("student", { text: "x" });
  assert.equal(upload.status, 503);
  assert.deepEqual(app.transcribeCalls, []);
  // Module 5 read-aloud uploads do not depend on the receipt secret.
  app.transcripts.length = 0;
  const m5 = await app.upload("student", { recordingId: null, segmentIndex: null, assessmentId: null,
    assessmentVersion: null, text: "practice reading" });
  assert.equal(m5.status, 200);
  assert.equal(m5.json.transcription.receipt, undefined);
  const submit = await app.submit("student", body("en", ["a.b"]));
  assert.equal(submit.status, 503);
  assert.equal(submit.json.code, "DIAGNOSTIC_UNAVAILABLE");
  assert.throws(() => createTranscriptReceiptService({ getSecret: () => "short" }).assertConfigured());
});

test("the submission endpoint is throttled per learner", async (t) => {
  const app = await startApp(t, { rateLimit: { limit: 2, windowMs: 60000 } });
  const receipts = await readInParts(app, "student", "en");
  await app.submit("student", body("en", receipts));
  await app.submit("student", body("en", receipts));
  const limited = await app.submit("student", body("en", receipts));
  assert.equal(limited.status, 429);
  assert.equal((await app.submit("student-2", body("en", ["x"]))).status, 422);
});

test("logs never contain receipts, transcripts or answers", async (t) => {
  const admin = fakeAdmin({ beforeInsert: () => { throw new Error("boom with secret transcript"); } });
  const app = await startApp(t, { admin });
  const receipts = await readInParts(app, "student", "en");
  assert.equal((await app.submit("student", body("en", receipts))).status, 500);
  const logged = JSON.stringify(app.logs);
  assert.doesNotMatch(logged, /mia|walked|boom|en-question|\.ey/i);
});

test("streaming: the server signs its own FINAL transcript and counts the audio length", () => {
  const receipts = testReceipts();
  const sent = [];
  const stream = new (require("node:events").EventEmitter)();
  Object.assign(stream, { write: () => true, end() { setImmediate(() => stream.emit("end")); }, destroy() {} });
  const session = createDiagnosticSpeechSession({
    language: "fil",
    send: (message) => sent.push(message),
    close: () => {},
    createStream: () => stream,
    log: () => {},
    issueReceipt: ({ text, confidence, audioSeconds }) => receipts.issue({
      userId: "student-1", language: "fil", binding: binding("fil"), recordingId: RID, segmentIndex: 1,
      source: "stream", text, confidence, audioSeconds,
    }),
  });
  session.acceptAudio(Buffer.alloc(3200));
  session.acceptAudio(Buffer.alloc(3200));
  stream.emit("data", { results: [{ isFinal: true, endOffsetTicks: 10000000, text: "Maagang nagtungo", confidence: 0.8 }] });
  stream.emit("data", { results: [{ isFinal: true, endOffsetTicks: 20000000, text: "si Lito", confidence: 0.6 }] });
  session.stop();
  return new Promise((done) => setImmediate(() => {
    const complete = sent.find((message) => message.type === "complete");
    const claims = receipts.verify(complete.receipt);
    assert.equal(claims.text, "Maagang nagtungo si Lito");
    assert.equal(claims.src, "stream");
    assert.equal(claims.secs, 6400 / 32000);
    assert.ok(Math.abs(claims.conf - 0.7) < 1e-9);
    assert.equal(claims.aid, DIAGNOSTIC_ASSESSMENTS.fil.id);
    assert.equal(claims.p, "m2-initial-diagnostic");
    const reading = verifyReading({ tokens: [complete.receipt], userId: "student-1", language: "fil",
      binding: binding("fil"), receiptService: receipts });
    assert.equal(resolveDuration(reading, 299).source, "server_audio");
    assert.equal(resolveDuration(reading, 299).seconds, 0.2);
    done();
  }));
});

test("browser-reported duration only affects WPM and is bounded by the verified part count", () => {
  const reading = { segments: 2 };
  assert.deepEqual(resolveDuration(reading, 40), { seconds: 40, source: "client_reported" });
  for (const value of [0, -1, 56, Number.NaN, "40", undefined]) {
    assert.deepEqual(resolveDuration(reading, value), { seconds: undefined, source: "unavailable" });
  }
  assert.throws(() => verifyReading({ tokens: ["x"], userId: "u", language: "en", binding: binding("en"), receiptService: {
    verify: () => { throw new DiagnosticReceiptError("format"); } } }), /verify your reading/);
});
