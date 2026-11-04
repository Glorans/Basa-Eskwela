// M5 saved pronunciation checks (F2/F3/F4/F7 and Teacher review). Mocked
// speech service and an in-memory checks table: no Azure, Gemini or Supabase.
const assert = require("node:assert/strict");
const test = require("node:test");
const { once } = require("node:events");
const express = require("express");
const { createOralReadingRouter } = require("../routes/oralReading");
const { createRequestLimiter } = require("../services/speechAccess");
const { OralReadingAuthorizationError, OralReadingPersistenceError, listOwnOralReadingAttempts } = require("../services/oralReadingAttemptService");
const { SpeechTranscriptionError } = require("../services/speechErrors");
const {
  MAX_PART_ASSESSMENT_MS, STALE_CLAIM_MS, claimPronunciationCheck, summarizePronunciationParts, sanitizePart,
} = require("../services/pronunciationCheckService");
const { createPronunciationChecksTable } = require("./fixtures/pronunciationChecksTable");

const EN = "11111111-1111-4111-8111-111111111111";
const FIL = "22222222-2222-4222-8222-222222222222";
const OTHERS = "33333333-3333-4333-8333-333333333333";
const PASSAGE = "Every Saturday morning, Lina walks to the orchard.";
const scored = (accuracy = 88) => ({
  provider: "azure", locale: "en-US", scale: "0-100", complete: true, durationSeconds: 36, assessmentMs: 1200,
  utterances: [{ text: "Every Saturday", accuracy, fluency: 80, words: [
    { word: "Every", accuracy: 95, errorType: "None" },
    { word: "orchard,", accuracy: 40, errorType: "Mispronunciation" },
  ] }],
});

async function start(t, { assess, table = createPronunciationChecksTable(), now = () => Date.now() } = {}) {
  const calls = [];
  const attempts = {
    [EN]: { id: EN, userId: "learner-1", language: "en", passageSnapshot: PASSAGE },
    [FIL]: { id: FIL, userId: "learner-1", language: "fil", passageSnapshot: "Tuwing Sabado ng umaga." },
  };
  const app = express();
  app.use(createOralReadingRouter({
    authorizeOralReadingPracticeRequest: async (req) => {
      const token = req.get("authorization");
      if (token === "Bearer learner") return { user: { id: "learner-1" }, profile: { role: "student" } };
      if (token === "Bearer classmate") return { user: { id: "learner-2" }, profile: { role: "student" } };
      throw new OralReadingAuthorizationError("Not allowed.");
    },
    getOralReadingAttempt: async (requester, attemptId) => {
      const attempt = attempts[attemptId];
      if (!attempt || attempt.userId !== requester.user.id) {
        throw new OralReadingAuthorizationError("This oral-reading result is not available to your account.");
      }
      return attempt;
    },
    authorizeTeacherOralReadingRequest: async (req) => {
      const token = req.get("authorization");
      if (token === "Bearer teacher" || token === "Bearer other-teacher") return { user: { id: token.slice(7) }, profile: { role: "teacher" } };
      throw new OralReadingAuthorizationError("Approved Teacher access is required.");
    },
    getTeacherOralReadingAttempt: async (requester, attemptId) => {
      // Only "teacher" has learner-1 in a classroom; the real service applies the classroom rules.
      if (requester.user.id !== "teacher" || !attempts[attemptId]) {
        throw new OralReadingPersistenceError("Oral-reading result not found.", 404, "ATTEMPT_NOT_FOUND");
      }
      return { id: attemptId, language: attempts[attemptId].language };
    },
    assessPronunciation: async (buffer, language, reference, options) => {
      calls.push({ bytes: buffer.length, language, reference });
      return assess ? assess(calls.length, options) : scored();
    },
    pronunciationLimiter: createRequestLimiter({ limit: 60, windowMs: 60000 }),
    pronunciationTiming: () => {},
    getSupabaseAdmin: () => table.client,
    now,
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = "GET", token = "learner", parts = 1, names, fields = {} } = {}) {
    let body;
    if (method === "POST") {
      body = new FormData();
      for (const name of names ?? Array.from({ length: parts }, (_, index) => `part-${index}.wav`)) {
        body.append("audio", new Blob([Buffer.alloc(44 + 32000 * 2)], { type: "audio/wav" }), name);
      }
      for (const [name, value] of Object.entries(fields)) body.append(name, value);
    }
    const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, body });
    return { status: response.status, body: await response.json() };
  }
  return {
    calls, table,
    check: (attemptId = EN, options = {}) => request(`/attempts/${attemptId}/pronunciation`, { method: "POST", ...options }),
    saved: (attemptId = EN, options = {}) => request(`/attempts/${attemptId}/pronunciation`, options),
    teacher: (attemptId = EN, token = "teacher") => request(`/teacher/attempts/${attemptId}/pronunciation`, { token }),
  };
}

test("1. a check is saved from the server's own assessment, with coverage and word findings", async (t) => {
  const app = await start(t);
  const result = await app.check();
  assert.equal(result.status, 200);
  assert.equal(result.body.saved, true);
  assert.deepEqual(result.body.check.summary, {
    parts: 1, utterances: 1, accuracy: 88, fluency: 80, wordsToPractice: ["orchard"],
    assessedSeconds: 36, complete: true, unassessedSeconds: 0,
    // Derived on read from the saved parts: 2 of the story's 8 words were scored,
    // and "orchard" was flagged at story word 7.
    storyWords: 8, assessedStoryWords: 2, practiceOccurrences: [{ word: "orchard", storyWordIndex: 7 }],
  });
  const row = app.table.rows.get(EN);
  assert.equal(row.status, "completed");
  assert.equal(row.user_id, "learner-1");
  assert.deepEqual([row.accuracy, row.fluency, row.language, row.locale, row.part_count], [88, 80, "en", "en-US", 1]);
  assert.deepEqual(row.words_to_practice, ["orchard"]);
  assert.equal(row.parts[0].utterances[0].words[1].errorType, "Mispronunciation", "word-level findings are kept");
  assert.equal("assessmentMs" in row.parts[0], false, "only known fields are stored");
  assert.equal(app.calls[0].reference, PASSAGE, "the reference text is the saved passage");
  // The learner-facing reply never names the provider.
  assert.doesNotMatch(JSON.stringify(result.body.check), /azure|microsoft/i);
});

test("1b. browser-supplied scores are refused before any assessment", async (t) => {
  const app = await start(t);
  const forged = await app.check(EN, { fields: { accuracy: "100" } });
  assert.equal(forged.status, 400);
  assert.equal(app.calls.length, 0);
  assert.equal(app.table.rows.size, 0);
});

test("2. after a refresh the saved result is read back without any speech-service call", async (t) => {
  const app = await start(t);
  assert.deepEqual((await app.saved()).body, { success: true, status: "none", check: null });
  await app.check();
  const reloaded = await app.saved();
  assert.equal(reloaded.body.status, "completed");
  assert.equal(reloaded.body.check.summary.accuracy, 88);
  assert.match(reloaded.body.check.checkedAt, /^\d{4}-/);
  assert.equal(app.calls.length, 1);
});

test("3. an existing result is reused: reopening or signing in again never pays twice", async (t) => {
  const app = await start(t);
  await app.check();
  for (let index = 0; index < 3; index++) {
    const again = await app.check();
    assert.deepEqual([again.status, again.body.saved, again.body.reused, again.body.check.summary.accuracy], [200, true, true, 88]);
  }
  assert.equal(app.calls.length, 1);
});

test("8. simultaneous requests: one paid assessment, the other is told a check is running", async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const app = await start(t, { assess: async () => { await gate; return scored(); } });
  const first = app.check();
  while (!app.calls.length) await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await app.check();
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "PRONUNCIATION_CHECK_IN_PROGRESS");
  assert.equal((await app.saved()).body.status, "running");
  release();
  assert.equal((await first).body.saved, true);
  assert.equal(app.calls.length, 1);
  assert.equal((await app.saved()).body.status, "completed");
});

test("8b. a claim race lost at insert time never assesses", async (t) => {
  const table = createPronunciationChecksTable();
  const app = await start(t, { table });
  // Another request claims between this request's lookup and its insert.
  table.rows.set(EN, { attempt_id: EN, user_id: "learner-1", status: "running", claim_id: "other", claimed_at: new Date().toISOString() });
  const original = table.client.from;
  let lookups = 0;
  table.client.from = (name) => {
    const builder = original(name);
    const maybeSingle = builder.maybeSingle;
    builder.maybeSingle = () => (lookups++ === 0 ? { then: (ok) => ok({ data: null, error: null }) } : maybeSingle());
    return builder;
  };
  const result = await app.check();
  assert.equal(result.status, 409);
  assert.equal(app.calls.length, 0);
});

test("8c. an abandoned claim can be taken over; a failed check can be retried", async (t) => {
  let clock = Date.parse("2026-11-05T08:00:00Z");
  const table = createPronunciationChecksTable();
  table.rows.set(EN, { attempt_id: EN, user_id: "learner-1", status: "running", claim_id: "crashed", claimed_at: new Date(clock).toISOString() });
  let fail = true;
  const app = await start(t, { table, now: () => clock, assess: () => {
    if (fail) throw new SpeechTranscriptionError("STT_QUOTA");
    return scored();
  } });
  clock += STALE_CLAIM_MS + 1000;
  const failed = await app.check();
  assert.equal(failed.body.code, "STT_QUOTA");
  assert.deepEqual([table.rows.get(EN).status, table.rows.get(EN).failure_code], ["failed", "STT_QUOTA"]);
  assert.equal((await app.saved()).body.status, "none", "a failed check can be run again");
  fail = false;
  assert.equal((await app.check()).body.saved, true);
  assert.equal(app.calls.length, 2);
});

test("9. a database failure is never reported as saved", async (t) => {
  let failUpdates = false;
  const table = createPronunciationChecksTable({ fail: { update: () => failUpdates } });
  const app = await start(t, { table });
  failUpdates = true;
  const result = await app.check();
  assert.equal(result.status, 200);
  assert.equal(result.body.saved, false);
  assert.equal(result.body.code, "PRONUNCIATION_NOT_SAVED");
  assert.match(result.body.message, /could not be saved/);
  assert.equal(result.body.check.saved, false);
  assert.equal(result.body.check.summary.accuracy, 88, "the paid result is still shown");
  assert.notEqual(table.rows.get(EN).status, "completed");
});

test("9b. if saved results cannot be looked up, no paid assessment runs", async (t) => {
  const table = createPronunciationChecksTable({ fail: { select: () => true } });
  const app = await start(t, { table });
  const result = await app.check();
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "PRONUNCIATION_STORE_UNAVAILABLE");
  assert.equal(app.calls.length, 0);
  assert.equal((await app.saved()).status, 503);
});

test("9c. before the migration, checks still work but are reported as not saved", async (t) => {
  const app = await start(t, { table: createPronunciationChecksTable({ installed: false }) });
  assert.equal((await app.saved()).body.status, "unavailable");
  const result = await app.check();
  assert.deepEqual([result.status, result.body.saved, result.body.code], [200, false, "PRONUNCIATION_NOT_SAVED"]);
});

test("10. Filipino readings never get a pronunciation score or a saved row", async (t) => {
  const app = await start(t);
  assert.deepEqual((await app.saved(FIL)).body, { success: true, status: "unsupported", check: null });
  const posted = await app.check(FIL);
  assert.deepEqual([posted.status, posted.body.code], [422, "PRONUNCIATION_UNSUPPORTED"]);
  assert.equal((await app.teacher(FIL)).body.status, "unsupported");
  assert.equal(app.calls.length, 0);
  assert.equal(app.table.rows.size, 0);
});

test("6/7. Teacher review: allowed classroom Teacher sees the saved check; others are denied", async (t) => {
  const app = await start(t);
  assert.equal((await app.teacher()).body.status, "none");
  await app.check();
  const review = await app.teacher();
  assert.equal(review.status, 200);
  assert.deepEqual([review.body.status, review.body.check.summary.accuracy, review.body.check.summary.wordsToPractice], ["completed", 88, ["orchard"]]);
  assert.equal("parts" in review.body.check, false);
  assert.equal((await app.teacher(EN, "other-teacher")).status, 404, "a Teacher without this student");
  assert.equal((await app.teacher(EN, "learner")).status, 403, "a learner cannot use the Teacher route");
  assert.equal((await app.teacher(EN, "admin")).status, 403, "no new Admin access to student records");
  assert.equal((await app.saved(EN, { token: "classmate" })).status, 403, "another learner");
  assert.equal((await app.check(EN, { token: "classmate" })).status, 403);
  assert.equal((await app.saved(EN, { token: "nobody" })).status, 403);
  assert.equal(app.calls.length, 1);
});

test("multi-file recordings are assessed in order in one request and saved as one result", async (t) => {
  const app = await start(t, { table: createPronunciationChecksTable({ recordings: { [EN]: ["u/a/000", "u/a/001"] } }), assess: (call) => call === 1
    ? scored(90)
    : { ...scored(70), complete: false, unassessedSegments: 1, unassessedSeconds: 2.4, durationSeconds: undefined } });
  const result = await app.check(EN, { parts: 2 });
  assert.equal(app.calls.length, 2);
  assert.deepEqual(result.body.check.summary, {
    parts: 2, utterances: 2, accuracy: 80, fluency: 80, wordsToPractice: ["orchard"],
    assessedSeconds: 38, complete: false, unassessedSeconds: 2,
    storyWords: 8, assessedStoryWords: 2, practiceOccurrences: [{ word: "orchard", storyWordIndex: 7 }],
  });
  assert.equal(result.body.pronunciation, undefined, "the legacy single-part shape is only for one part");
  assert.deepEqual([app.table.rows.get(EN).unassessed_segments, app.table.rows.get(EN).part_count], [1, 2]);
});

test("a silent recording is saved as an empty check, not a failure", async (t) => {
  const app = await start(t, { assess: () => { throw new SpeechTranscriptionError("NO_SPEECH"); } });
  const result = await app.check();
  assert.deepEqual([result.body.saved, result.body.check.summary.utterances, result.body.check.summary.accuracy], [true, 0, null]);
});

test("summary rules match the result screen's previous rules", () => {
  const part = (utterances, extra = {}) => sanitizePart({ utterances, ...extra });
  const summary = summarizePronunciationParts([
    part([{ text: "a", accuracy: 90, fluency: 80, words: [{ word: "A", accuracy: 90, errorType: "None" }, { word: "B", accuracy: 90, errorType: "None" }] }]),
    part([{ text: "b", accuracy: 60, fluency: 50, words: [{ word: "Saturday!", accuracy: 59, errorType: "None" }, { word: "ORCHARD", accuracy: 80, errorType: "Mispronunciation" }] }]),
  ], [44 + 32000 * 10, 44 + 32000 * 5]);
  assert.deepEqual(summary, {
    parts: 2, utterances: 2, accuracy: 75, fluency: 65, wordsToPractice: ["saturday", "orchard"],
    assessedSeconds: 15, complete: true, unassessedSeconds: 0, unassessedSegments: 0,
  });
  const unmeasured = summarizePronunciationParts([part([], { complete: false, unassessedSegments: 1, unassessedSeconds: null })], [44]);
  assert.deepEqual([unmeasured.complete, unmeasured.unassessedSeconds, unmeasured.accuracy], [false, null, null]);
});

// Moved unchanged from readflow/tests/azureSpeechClient.test.ts when summarizing moved to the server.
test("pronunciation summary averages only the service's own scores and lists words to practise", () => {
  const part = (utterances) => sanitizePart({ utterances });
  const summary = summarizePronunciationParts([
    part([{ text: "Every Saturday", accuracy: 90, fluency: 80, words: [
      { word: "Every", accuracy: 95, errorType: "None" },
      { word: "Saturday,", accuracy: 70, errorType: "Mispronunciation" },
    ] }]),
    part([{ text: "Lina walks with her", accuracy: 60, fluency: null, words: [
      { word: "Lina", accuracy: 40, errorType: "None" },
      { word: "walks", accuracy: 99, errorType: "None" },
      { word: "with", accuracy: null, errorType: null },
      { word: "her", accuracy: 80, errorType: "None" },
    ] }]),
    part([]),
  ], [44, 44, 44]);
  assert.equal(summary.parts, 3);
  assert.equal(summary.utterances, 2);
  assert.equal(summary.accuracy, 70); // (90 x 2 words + 60 x 4 words) / 6
  assert.equal(summary.fluency, 80); // the utterance without a fluency score is left out, not counted as zero
  assert.deepEqual(summary.wordsToPractice, ["saturday", "lina"]);
  const none = summarizePronunciationParts([part([{ text: "hi", accuracy: null, fluency: null, words: [] }])], [44]);
  assert.deepEqual([none.accuracy, none.fluency, none.wordsToPractice], [null, null, []], "no scores means no invented numbers");
});

test("5. Reading History lists saved scores for the learner's own English readings only", async () => {
  const table = createPronunciationChecksTable();
  const completedRow = (attemptId, userId, accuracy) => ({ attempt_id: attemptId, user_id: userId, status: "completed", accuracy, fluency: 70, complete: true, completed_at: "2026-11-05T08:00:00Z" });
  table.rows.set(EN, completedRow(EN, "learner-1", 82));
  table.rows.set(OTHERS, completedRow(OTHERS, "learner-2", 99));
  const attemptRows = [
    { id: EN, language_snapshot: "en", completed_at: "2026-11-05T08:00:00Z", pronunciation_accuracy: 91, reading_speed_wpm: 60, detected_error_count: 1 },
    { id: FIL, language_snapshot: "fil", completed_at: "2026-11-04T08:00:00Z", pronunciation_accuracy: 80, reading_speed_wpm: 50, detected_error_count: 2 },
    { id: OTHERS, language_snapshot: "en", completed_at: "2026-11-03T08:00:00Z", pronunciation_accuracy: 70, reading_speed_wpm: 40, detected_error_count: 3 },
  ];
  const attemptsQuery = { select: () => attemptsQuery, eq: () => attemptsQuery, order: () => attemptsQuery,
    range: async () => ({ data: attemptRows, error: null }) };
  const supabase = { from: (name) => (name === "oral_reading_attempts" ? attemptsQuery : table.client.from(name)) };
  const rows = await listOwnOralReadingAttempts({ user: { id: "learner-1" } }, undefined, { getSupabaseAdmin: () => supabase });
  assert.deepEqual(rows[0].pronunciationCheck, { accuracy: 82, fluency: 70, complete: true, checkedAt: "2026-11-05T08:00:00Z" });
  assert.equal("pronunciationCheck" in rows[1], false, "Filipino: no pronunciation score");
  assert.equal("pronunciationCheck" in rows[2], false, "another learner's saved check is never attached");
  assert.equal(rows[0].pronunciationAccuracy, 91, "the transcript-based reading accuracy is unchanged");
  // History still loads when saved checks are unavailable.
  const missing = createPronunciationChecksTable({ installed: false });
  const without = await listOwnOralReadingAttempts({ user: { id: "learner-1" } }, undefined, {
    getSupabaseAdmin: () => ({ from: (name) => (name === "oral_reading_attempts" ? attemptsQuery : missing.client.from(name)) }),
  });
  assert.equal(without.length, 3);
  assert.ok(without.every((row) => !("pronunciationCheck" in row)));
});

// --- B1: the upload must be the complete saved recording, checked before any claim or paid call ---

const twoFiles = () => createPronunciationChecksTable({ recordings: { [EN]: ["u/a/000", "u/a/001"] } });

test("E1. a complete single-file recording is accepted (new and older file names)", async (t) => {
  const app = await start(t);
  assert.equal((await app.check(EN, { names: ["part-0.wav"] })).body.saved, true);
  const legacy = await start(t);
  assert.equal((await legacy.check(EN, { names: ["part.wav"] })).body.saved, true, "older single-file clients keep working");
});

test("E2. a complete multi-file recording is checked part by part and saved once", async (t) => {
  const app = await start(t, { table: twoFiles() });
  const result = await app.check(EN, { parts: 2 });
  assert.deepEqual([result.status, result.body.saved, result.body.check.summary.parts], [200, true, 2]);
  assert.equal(app.calls.length, 2);
});

for (const [label, names] of [
  ["E3. a missing part", ["part-0.wav"]],
  ["E4a. a duplicated part", ["part-0.wav", "part-0.wav"]],
  ["E4b. reordered parts", ["part-1.wav", "part-0.wav"]],
  ["E4c. an extra part", ["part-0.wav", "part-1.wav", "part-2.wav"]],
  ["E4d. the older single-file name for a multi-file recording", ["part.wav"]],
]) {
  test(`${label} is refused before any claim or paid call`, async (t) => {
    const app = await start(t, { table: twoFiles() });
    const result = await app.check(EN, { names });
    assert.equal(result.status, 400);
    assert.equal(result.body.code, "PRONUNCIATION_RECORDING_MISMATCH");
    assert.equal(app.calls.length, 0, "no paid assessment");
    assert.equal(app.table.rows.size, 0, "no running reservation");
  });
}

test("E5. the part count comes from the saved recording, never the browser", async (t) => {
  // An older client sends only the first of two files: refused, nothing saved as complete.
  const app = await start(t, { table: twoFiles() });
  assert.equal((await app.check(EN, { names: ["part-0.wav"] })).status, 400);
  // A client-supplied count field is not accepted at all.
  assert.equal((await app.check(EN, { parts: 2, fields: { partCount: "2" } })).status, 400);
  assert.equal(app.calls.length, 0);
  // No saved recording, unreadable or corrupt recording metadata: refused before any claim.
  const none = await start(t, { table: createPronunciationChecksTable({ recordings: { [EN]: null } }) });
  const missing = await none.check();
  assert.deepEqual([missing.status, missing.body.code], [422, "PRONUNCIATION_RECORDING_MISSING"]);
  const broken = await start(t, { table: createPronunciationChecksTable({ fail: { recording: () => true } }) });
  assert.equal((await broken.check()).status, 503);
  const corrupt = await start(t, { table: createPronunciationChecksTable({ recordings: { [EN]: ["same", "same"] } }) });
  assert.equal((await corrupt.check(EN, { parts: 2 })).status, 422);
  for (const other of [none, broken, corrupt]) {
    assert.equal(other.calls.length, 0);
    assert.equal(other.table.rows.size, 0);
  }
});

// --- Lease: a long, legitimate check is never taken over; an abandoned one is ---

test("E6. a long multi-file check renews its lease and is never taken over while alive", async (t) => {
  let clock = Date.parse("2026-11-05T08:00:00Z");
  const files = Array.from({ length: 6 }, (_, index) => `u/a/${index}`);
  const table = createPronunciationChecksTable({ recordings: { [EN]: files } });
  const gates = [];
  const app = await start(t, { table, now: () => clock, assess: () => new Promise((resolve) => gates.push(() => resolve(scored()))) });
  const first = app.check(EN, { parts: 6 });
  for (let part = 0; part < 6; part++) {
    while (gates.length <= part) await new Promise((resolve) => setTimeout(resolve, 5));
    // Each part takes the worst-case per-part deadline: six parts take far longer
    // than STALE_CLAIM_MS in total, but the lease is renewed before each part.
    clock += MAX_PART_ASSESSMENT_MS;
    const second = await app.check(EN, { parts: 6 });
    assert.equal(second.status, 409, `part ${part}: still running, no second paid check`);
    gates[part]();
  }
  assert.equal((await first).body.saved, true);
  assert.ok(6 * MAX_PART_ASSESSMENT_MS > STALE_CLAIM_MS, "the scenario is longer than the lease");
  assert.ok(STALE_CLAIM_MS >= 2 * MAX_PART_ASSESSMENT_MS, "the lease outlasts one part's deadline with margin");
  assert.equal(app.calls.length, 6, "exactly one paid assessment per file");
});

test("E7. concurrent requests for a multi-file recording: one paid check", async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const app = await start(t, { table: twoFiles(), assess: async () => { await gate; return scored(); } });
  const first = app.check(EN, { parts: 2 });
  while (!app.calls.length) await new Promise((resolve) => setTimeout(resolve, 5));
  const results = await Promise.all([app.check(EN, { parts: 2 }), app.check(EN, { parts: 2 })]);
  assert.deepEqual(results.map((result) => result.status), [409, 409]);
  release();
  assert.equal((await first).body.saved, true);
  assert.equal(app.calls.length, 2, "two files, one check");
});

test("E8. an abandoned lease (server crash) is recovered; a lost lease stops before paying again", async (t) => {
  let clock = Date.parse("2026-11-05T08:00:00Z");
  const table = twoFiles();
  // A crashed server left a running claim that was never renewed.
  table.rows.set(EN, { attempt_id: EN, user_id: "learner-1", status: "running", claim_id: "crashed",
    claimed_at: new Date(clock).toISOString(), failure_code: null });
  const app = await start(t, { table, now: () => clock });
  assert.equal((await app.check(EN, { parts: 2 })).status, 409, "a fresh lease is respected");
  clock += STALE_CLAIM_MS + 1;
  assert.equal((await app.check(EN, { parts: 2 })).body.saved, true, "an abandoned lease is recovered");
  assert.equal(app.calls.length, 2);

  // A request whose lease is lost mid-check stops before the next paid part.
  const lost = createPronunciationChecksTable({ recordings: { [EN]: ["a", "b"] } });
  let calls = 0;
  const second = await start(t, { table: lost, assess: () => { calls++; lost.rows.get(EN).claim_id = "someone-else"; return scored(); } });
  const interrupted = await second.check(EN, { parts: 2 });
  assert.deepEqual([interrupted.status, interrupted.body.code], [503, "PRONUNCIATION_CHECK_INTERRUPTED"]);
  assert.equal(calls, 1, "the second part was never sent");
  assert.equal(lost.rows.get(EN).status, "running", "the other request's claim is left alone");
});

test("E8b. a lease renewed after being read as stale is not taken over", async () => {
  const table = createPronunciationChecksTable();
  const old = new Date(Date.parse("2026-11-05T08:00:00Z")).toISOString();
  table.rows.set(EN, { attempt_id: EN, user_id: "learner-1", status: "running", claim_id: "alive", claimed_at: old, failure_code: null });
  // The reader sees the old lease; the owner renews it before the takeover update runs.
  const original = table.client.from;
  let reads = 0;
  table.client.from = (name) => {
    const builder = original(name);
    const maybeSingle = builder.maybeSingle;
    builder.maybeSingle = () => {
      const result = maybeSingle();
      if (++reads !== 1) return result;
      return { then: (ok, fail) => result.then((value) => {
        table.rows.get(EN).claimed_at = new Date(Date.parse(old) + 1000).toISOString();
        return value;
      }).then(ok, fail) };
    };
    return builder;
  };
  await assert.rejects(
    claimPronunciationCheck(table.client, { id: EN }, "learner-1", Date.parse(old) + STALE_CLAIM_MS + 1),
    (error) => error.code === "PRONUNCIATION_CHECK_IN_PROGRESS",
  );
  assert.equal(table.rows.get(EN).claim_id, "alive");
});

test("E9. a failed save during a multi-file check is reported as not saved", async (t) => {
  let failSave = false;
  const table = createPronunciationChecksTable({ recordings: { [EN]: ["a", "b"] }, fail: { update: () => failSave } });
  let calls = 0;
  const app = await start(t, { table, assess: () => { if (++calls === 2) failSave = true; return scored(); } });
  const result = await app.check(EN, { parts: 2 });
  assert.deepEqual([result.status, result.body.saved, result.body.code], [200, false, "PRONUNCIATION_NOT_SAVED"]);
  assert.notEqual(table.rows.get(EN).status, "completed");
});

test("E10. a saved multi-file result is read back after a refresh without any call", async (t) => {
  const app = await start(t, { table: twoFiles() });
  await app.check(EN, { parts: 2 });
  const saved = await app.saved();
  assert.deepEqual([saved.body.status, saved.body.check.summary.parts], ["completed", 2]);
  const again = await app.check(EN, { parts: 2 });
  assert.equal(again.body.reused, true);
  assert.equal(app.calls.length, 2);
});
