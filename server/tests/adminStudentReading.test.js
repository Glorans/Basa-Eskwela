// Admin "Student Reading Assessments": authorization, scope, privacy and logging.
// Real Admin authorization and service code over a fake database that refuses
// every write. No network, no Supabase, no speech service.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createAdminStudentReadingRouter } = require("../routes/adminStudentReading");
const { SupabaseAuthenticationError } = require("../services/supabaseAdmin");

const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const ADMIN = id(1), OTHER_ADMIN = id(2), TEACHER = id(3), STUDENT = id(4), UNENROLLED = id(5), NO_READINGS = id(6), LEARNER = id(7);
const EN = id(100), EN_OLD = id(101), FIL = id(102), UNENROLLED_ATTEMPT = id(103);
const LEARNER_ATTEMPT = id(200), TEACHER_ATTEMPT = id(201), ADMIN_ATTEMPT = id(202), OTHER_ADMIN_ATTEMPT = id(203), MISSING = id(999);
const SECRET_TRANSCRIPT = "every saturday private transcript words";

const attempt = (attemptId, user, completedAt, extra = {}) => ({
  id: attemptId, user_id: user, module_id: id(50), passage_id: id(51), room_id: null, material_id: null, activity_assignment_id: null, assignment_id: null,
  module_title_snapshot: "Grade 5 Stories", passage_title_snapshot: "A Helping Hand", language_snapshot: "en", passage_snapshot: "Every Saturday.",
  transcript: SECRET_TRANSCRIPT, duration_seconds: 10, reading_speed_wpm: 99, pronunciation_accuracy: 98.65, expected_word_count: 2,
  detected_error_count: 0, word_metrics: [{ type: "match", expected: "every", actual: "every" }, { type: "match", expected: "saturday", actual: "saturday" }],
  stt_confidence: null, scoring_version: 2, completed_at: completedAt, ...extra,
});

const SCHOOL = id(901), SCHOOL_2 = id(902), OTHER_SCHOOL_STUDENT = id(903), OTHER_SCHOOL_ADMIN = id(904), OTHER_SCHOOL_ATTEMPT = id(905);

function fakeDatabase() {
  const tables = {
    profiles: [
      { id: ADMIN, role: "admin", full_name: "Admin One", school_id: SCHOOL }, { id: OTHER_ADMIN, role: "admin", full_name: "Admin Two", school_id: SCHOOL },
      { id: TEACHER, role: "teacher", full_name: "Teacher", teacher_status: "approved", school_id: SCHOOL },
      { id: STUDENT, role: "student", full_name: "Ana Cruz", nickname: "Ana", school_id: SCHOOL }, { id: UNENROLLED, role: "student", full_name: "Ben Reyes", school_id: SCHOOL },
      { id: NO_READINGS, role: "student", full_name: "Cara Lim", school_id: SCHOOL }, { id: LEARNER, role: "general_user", full_name: "Indie Learner" },
      // M1 multi-tenancy: a School 2 Student and School Admin (never visible to School 1's School Admin).
      { id: OTHER_SCHOOL_STUDENT, role: "student", full_name: "Other School Student", school_id: SCHOOL_2 },
      { id: OTHER_SCHOOL_ADMIN, role: "admin", full_name: "Other School Admin", school_id: SCHOOL_2 },
    ],
    oral_reading_attempts: [
      attempt(EN, STUDENT, "2026-11-04T20:00:00Z"), attempt(EN_OLD, STUDENT, "2026-11-03T20:00:00Z"),
      attempt(FIL, STUDENT, "2026-11-02T20:00:00Z", { language_snapshot: "fil" }), attempt(UNENROLLED_ATTEMPT, UNENROLLED, "2026-11-01T20:00:00Z"),
      attempt(LEARNER_ATTEMPT, LEARNER, "2026-11-04T10:00:00Z"), attempt(TEACHER_ATTEMPT, TEACHER, "2026-11-04T11:00:00Z"),
      attempt(ADMIN_ATTEMPT, ADMIN, "2026-11-04T12:00:00Z"), attempt(OTHER_ADMIN_ATTEMPT, OTHER_ADMIN, "2026-11-04T13:00:00Z"),
      attempt(OTHER_SCHOOL_ATTEMPT, OTHER_SCHOOL_STUDENT, "2026-11-04T14:00:00Z"),
    ],
    oral_reading_recordings: [EN, LEARNER_ATTEMPT, TEACHER_ATTEMPT, ADMIN_ATTEMPT].map((attemptId) => ({ attempt_id: attemptId, segments: [`path/${attemptId}/000`] })),
    oral_reading_pronunciation_checks: [{
      attempt_id: EN, user_id: STUDENT, status: "completed", accuracy: 95, fluency: 97, words_to_practice: ["saturday"], complete: true, part_count: 1,
      utterance_count: 1, assessed_seconds: 10, unassessed_seconds: 0, completed_at: "2026-11-04T20:01:00Z", claim_id: id(300), claimed_at: "2026-11-04T20:00:30Z",
      parts: [{ utterances: [{ words: [{ word: "Every", accuracy: 95, errorType: "None" }, { word: "Saturday", accuracy: 30, errorType: "Mispronunciation" }] }] }],
    }],
  };
  const db = { tables, writes: 0, signed: [], queried: [] };
  class Query {
    constructor(table) { this.table = table; this.filters = []; }
    select() { return this; }
    eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
    in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
    order() { return this; }
    range(from, to) { this.window = [from, to + 1]; return this; }
    single() { this.mode = "single"; return this; }
    maybeSingle() { this.mode = "maybe"; return this; }
    then(resolve, reject) { return this.run().then(resolve, reject); }
    async run() {
      db.queried.push(this.table);
      if (db.failTable === this.table) return { data: null, error: { code: "XX000", message: "private query detail" } };
      let rows = (tables[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row)));
      if (this.window) rows = rows.slice(...this.window);
      if (this.mode === "single") return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116" } };
      if (this.mode === "maybe") return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    }
  }
  const refuse = () => { db.writes += 1; throw new Error("A write was attempted"); };
  db.from = (table) => Object.assign(new Query(table), { insert: refuse, update: refuse, upsert: refuse, delete: refuse });
  db.storage = { from: (bucket) => ({
    createSignedUrl: async (path, seconds) => { db.signed.push({ bucket, path, seconds }); return { data: { signedUrl: `https://signed.example/${path}?token=SECRET_SIGNED_TOKEN` }, error: null }; },
    upload: refuse, remove: refuse,
  }) };
  return db;
}

async function start(t) {
  const db = fakeDatabase();
  const logs = [];
  const app = express();
  const router = createAdminStudentReadingRouter({
    getSupabaseAdmin: () => db,
    getAuthenticatedSupabaseUser: async (req) => {
      const userId = /^Bearer (.+)$/.exec(req.get("authorization") ?? "")?.[1];
      if (!userId || userId === "invalid") throw new SupabaseAuthenticationError();
      return { id: userId };
    },
    accessLog: (entry) => logs.push(entry),
    logNow: () => "2026-11-05T00:00:00.000Z",
  });
  app.use("/api/oral-reading/admin", router);
  app.use("/api/oral-reading", (_req, res) => res.status(418).json({ reachedNextRouter: true }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const call = async (path, { as = ADMIN, method = "GET" } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/oral-reading/admin${path}`,
      { method, headers: as ? { Authorization: `Bearer ${as}` } : {} });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, body, text, cacheControl: response.headers.get("cache-control") };
  };
  return { db, logs, call };
}

test("M1 multi-tenancy: another school's Students and readings are invisible; that school's Admin sees only its own", async (t) => {
  const { call } = await start(t);
  const list = await call("/students");
  assert.equal(list.status, 200);
  assert.equal(list.body.students.some((s) => s.id === OTHER_SCHOOL_STUDENT), false);
  for (const path of [`/students/${OTHER_SCHOOL_STUDENT}/attempts`, `/attempts/${OTHER_SCHOOL_ATTEMPT}`, `/attempts/${OTHER_SCHOOL_ATTEMPT}/recording`]) {
    assert.equal((await call(path)).status, 404, path);
  }
  const other = await call("/students", { as: OTHER_SCHOOL_ADMIN });
  assert.deepEqual(other.body.students.map((s) => s.id), [OTHER_SCHOOL_STUDENT]);
  assert.equal((await call(`/attempts/${EN}`, { as: OTHER_SCHOOL_ADMIN })).status, 404);
});

const ROUTES = ["/students", `/students/${STUDENT}/attempts`, `/attempts/${EN}`, `/attempts/${EN}/pronunciation`, `/attempts/${EN}/recording`];

test("only a verified Admin reaches any route; other roles get nothing and touch no student data", async (t) => {
  const { db, call } = await start(t);
  for (const path of ROUTES) {
    assert.equal((await call(path, { as: null })).status, 401, `no session ${path}`);
    assert.equal((await call(path, { as: "invalid" })).status, 401, `invalid session ${path}`);
    for (const [label, as] of [["student", STUDENT], ["independent learner", LEARNER], ["approved teacher", TEACHER]]) {
      const denied = await call(path, { as });
      assert.equal(denied.status, 403, `${label} ${path}`);
      assert.doesNotMatch(denied.text, /private transcript|Ana|signed\.example|"attempt"|"students"/, `${label} ${path}`);
    }
  }
  assert.deepEqual([...new Set(db.queried)], ["profiles"], "denied requests only ever read the requester's own profile");
  assert.deepEqual(db.signed, [], "no recording link was issued");
});

test("the role comes from the database on every request, not from anything the browser sends", async (t) => {
  const { db, call } = await start(t);
  assert.equal((await call(`/attempts/${EN}`)).status, 200);
  db.tables.profiles.find((profile) => profile.id === ADMIN).role = "teacher";
  assert.equal((await call(`/attempts/${EN}`)).status, 403, "a demoted Admin loses access at once");
});

test("the student list holds only students with saved readings, including unenrolled ones, and no private fields", async (t) => {
  const { call } = await start(t);
  const { status, body, text, cacheControl } = await call("/students");
  assert.equal(status, 200);
  assert.equal(cacheControl, "no-store");
  assert.deepEqual(body.students, [
    { id: STUDENT, name: "Ana", readingCount: 3, latestCompletedAt: "2026-11-04T20:00:00Z" },
    { id: UNENROLLED, name: "Ben Reyes", readingCount: 1, latestCompletedAt: "2026-11-01T20:00:00Z" },
  ]);
  assert.doesNotMatch(text, /Indie Learner|Teacher|Admin One|Cara Lim|email|private transcript/);
});

test("a student's reading list is that student's only, and only for accounts in scope", async (t) => {
  const { call } = await start(t);
  const { status, body, text } = await call(`/students/${STUDENT}/attempts`);
  assert.equal(status, 200);
  assert.equal(body.student.name, "Ana");
  assert.deepEqual(body.attempts.map((row) => row.id), [EN, EN_OLD, FIL]);
  assert.deepEqual(body.attempts[0].pronunciationCheck.accuracy, 95);
  assert.equal("pronunciationCheck" in body.attempts[1], false);
  assert.doesNotMatch(text, /private transcript|user_id/);
  const refused = [];
  for (const other of [LEARNER, TEACHER, ADMIN, OTHER_ADMIN, MISSING, "not-a-uuid", "..%2F..%2Fstudents"]) {
    const response = await call(`/students/${other}/attempts`);
    assert.equal(response.status, 404, other);
    refused.push(response.text);
  }
  assert.equal(new Set(refused).size, 1, "every refusal is identical, so an ID reveals nothing");
});

test("manipulated attempt IDs and out-of-scope owners are refused identically on all three attempt routes", async (t) => {
  const { db, call } = await start(t);
  for (const suffix of ["", "/pronunciation", "/recording"]) {
    const refused = [];
    for (const attemptId of [LEARNER_ATTEMPT, TEACHER_ATTEMPT, ADMIN_ATTEMPT, OTHER_ADMIN_ATTEMPT, MISSING, "not-a-uuid", "1%20OR%201=1"]) {
      const response = await call(`/attempts/${attemptId}${suffix}`);
      assert.equal(response.status, 404, `${attemptId}${suffix}`);
      assert.doesNotMatch(response.text, /private transcript|signed\.example|Indie|Admin One/, `${attemptId}${suffix}`);
      refused.push(response.text);
    }
    assert.equal(new Set(refused).size, 1, `every refusal on "${suffix}" is identical`);
  }
  assert.deepEqual(db.signed, [], "no recording link for any out-of-scope attempt, including the Admin's own");
});

test("an in-scope assessment is returned read-only with its saved values", async (t) => {
  const { db, call } = await start(t);
  const before = JSON.stringify(db.tables);
  const { status, body, cacheControl } = await call(`/attempts/${EN}`);
  assert.equal(status, 200);
  assert.equal(cacheControl, "no-store");
  assert.equal(body.attempt.learnerName, "Ana");
  assert.deepEqual([body.attempt.pronunciationAccuracy, body.attempt.readingSpeedWpm, body.attempt.transcript], [98.65, 99, SECRET_TRANSCRIPT]);
  assert.equal((await call(`/attempts/${UNENROLLED_ATTEMPT}`)).status, 200, "a student outside any classroom is in scope");
  // A language that was never saved stays unknown, and the reading still opens.
  db.tables.oral_reading_attempts.find((row) => row.id === EN_OLD).language_snapshot = null;
  assert.equal((await call(`/attempts/${EN_OLD}`)).body.attempt.language, null);
  db.tables.oral_reading_attempts.find((row) => row.id === EN_OLD).language_snapshot = "en";
  assert.equal(JSON.stringify(db.tables), before, "nothing was changed");
  assert.equal(db.writes, 0);
});

test("the saved check is read without assessing: Filipino is unsupported, raw parts are never sent", async (t) => {
  const { db, call } = await start(t);
  const saved = await call(`/attempts/${EN}/pronunciation`);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.status, "completed");
  assert.equal(saved.body.check.summary.accuracy, 95);
  assert.deepEqual(saved.body.check.summary.wordsToPractice, ["saturday"]);
  assert.deepEqual(saved.body.check.summary.practiceOccurrences, [{ word: "saturday", storyWordIndex: 1 }]);
  assert.doesNotMatch(saved.text, /errorType|"utterances":\[|claim_id|azure/i);
  assert.equal((await call(`/attempts/${FIL}/pronunciation`)).body.status, "unsupported");
  assert.deepEqual([(await call(`/attempts/${EN_OLD}/pronunciation`)).body.status], ["none"]);
  assert.equal(db.writes, 0, "no claim row: reading never starts a check");
});

test("this router cannot start an assessment or change anything: only GET exists and no speech code is loaded", async (t) => {
  const { db, call } = await start(t);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    for (const path of ROUTES) assert.equal((await call(path, { method })).status, 418, `${method} ${path} is not handled here`);
  }
  assert.equal(db.writes, 0);
  const { readFileSync } = require("node:fs");
  for (const file of ["../routes/adminStudentReading.js", "../services/adminStudentReadingService.js"]) {
    const source = readFileSync(require.resolve(file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.doesNotMatch(source, /azureSpeech|assessPronunciation|runPronunciationCheck|multer|router\.(post|put|patch|delete)|\.insert\(|\.update\(|\.upsert\(|\.delete\(/, file);
  }
});

test("recordings stay private: links are short-lived and only issued for in-scope attempts", async (t) => {
  const { db, call } = await start(t);
  const { status, body, cacheControl } = await call(`/attempts/${EN}/recording`);
  assert.equal(status, 200);
  assert.equal(cacheControl, "no-store");
  assert.equal(body.recording.available, true);
  assert.deepEqual(db.signed, [{ bucket: "oral-reading-recordings", path: `path/${EN}/000`, seconds: 300 }]);
  assert.deepEqual((await call(`/attempts/${EN_OLD}/recording`)).body.recording, { available: false, segments: [] }, "no saved recording");
});

test("each request logs only the five approved fields; never names, transcripts, tokens or signed URLs", async (t) => {
  const { logs, call } = await start(t);
  await call(`/attempts/${EN}`);
  await call(`/attempts/${EN}/recording`);
  await call(`/attempts/${EN}/pronunciation`);
  await call("/students");
  await call(`/attempts/${LEARNER_ATTEMPT}`);
  await call(`/attempts/${EN}`, { as: STUDENT });
  await call(`/attempts/${EN}`, { as: null });
  await call("/attempts/injected%0Afake-log-line");
  const at = "2026-11-05T00:00:00.000Z";
  assert.deepEqual(logs, [
    { adminId: ADMIN, attemptId: EN, at, operation: "view_assessment", outcome: "allowed" },
    { adminId: ADMIN, attemptId: EN, at, operation: "open_recording", outcome: "allowed" },
    { adminId: ADMIN, attemptId: EN, at, operation: "view_pronunciation", outcome: "allowed" },
    { adminId: ADMIN, attemptId: null, at, operation: "list_students", outcome: "allowed" },
    { adminId: ADMIN, attemptId: LEARNER_ATTEMPT, at, operation: "view_assessment", outcome: "not_found" },
    { adminId: null, attemptId: EN, at, operation: "view_assessment", outcome: "forbidden" },
    { adminId: null, attemptId: EN, at, operation: "view_assessment", outcome: "unauthenticated" },
    { adminId: ADMIN, attemptId: null, at, operation: "view_assessment", outcome: "not_found" },
  ]);
  assert.doesNotMatch(JSON.stringify(logs), /private transcript|Ana|SECRET_SIGNED_TOKEN|signed\.example|Bearer|fake-log-line/);
});

test("a database failure is a safe error that exposes no query details", async (t) => {
  const { db, call } = await start(t);
  db.failTable = "oral_reading_attempts";
  const failed = await call(`/attempts/${EN}`);
  assert.equal(failed.status, 503);
  assert.doesNotMatch(failed.text, /private query detail|XX000/);
});

test("other /admin paths continue to the existing oral-reading routes", async (t) => {
  const { call, logs } = await start(t);
  assert.equal((await call("/passages")).status, 418, "/admin/passages is not captured by this router");
  assert.deepEqual(logs, []);
});
