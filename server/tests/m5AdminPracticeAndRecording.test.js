const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const {
  authorizeOralReadingRequest,
  authorizeOralReadingPracticeRequest,
  loadAccessiblePublishedModule,
} = require("../services/oralReadingAttemptService");
const {
  getOralReadingRecording,
  saveOralReadingRecording,
} = require("../services/oralReadingRecordingService");
const { listAdminReadingPassages } = require("../services/adminOralReadingService");
const { createOralReadingRouter } = require("../routes/oralReading");

const ADMIN = "11111111-1111-4111-8111-111111111111";
const STUDENT = "22222222-2222-4222-8222-222222222222";
const GENERAL = "33333333-3333-4333-8333-333333333333";
const TEACHER = "44444444-4444-4444-8444-444444444444";
const MODULE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FIL_MODULE = "abababab-abab-4bab-8bab-abababababab";
const PATH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FIL_PATH = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";
const ROOM = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ATTEMPT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MATERIAL = "ffffffff-ffff-4fff-8fff-ffffffffffff";

class Query {
  constructor(db, table) { Object.assign(this, { db, table, filters: [], action: "select" }); }
  select() { return this; }
  insert(payload) { this.action = "insert"; this.payload = payload; return this; }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
  in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
  order() { return this; }
  gt(column, value) { this.filters.push((row) => row[column] > value); return this; }
  limit(count) { this.window = [0, count]; return this; }
  range(start, end) { this.window = [start, end + 1]; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  then(resolve, reject) { return this.run().then(resolve, reject); }
  async run() {
    this.db.queries.push(this.table);
    if (this.db.missing.has(this.table)) return { data: null, error: { code: "PGRST205" } };
    const rows = this.db.tables[this.table] ?? [];
    if (this.action === "insert") {
      if (rows.some((row) => row.attempt_id === this.payload.attempt_id)) return { data: null, error: { code: "23505" } };
      rows.push({ ...this.payload });
      return { data: null, error: null };
    }
    let selected = rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.window) selected = selected.slice(...this.window);
    if (this.mode === "single") return selected.length === 1 ? { data: selected[0], error: null } : { data: null, error: { code: "PGRST116" } };
    if (this.mode === "maybe") return { data: selected[0] ?? null, error: null };
    return { data: selected, error: null };
  }
}

function fakeDb({ missing = [] } = {}) {
  const db = {
    queries: [],
    missing: new Set(missing),
    uploads: [],
    removed: [],
    tables: {
      profiles: [
        { id: ADMIN, role: "admin", full_name: "Admin" },
        { id: STUDENT, role: "student", full_name: "Student" },
        { id: GENERAL, role: "general_user", full_name: "General" },
        { id: TEACHER, role: "teacher", teacher_status: "pending", full_name: "Teacher" },
      ],
      modules: [
        { id: MODULE, path_id: PATH, title: "Birds", difficulty: "Easy", status: "published", passage: "A bird rests.", deleted_at: null },
        { id: FIL_MODULE, path_id: FIL_PATH, title: "Ibon", difficulty: "Easy", status: "published", passage: "Ang ibon ay nagpapahinga.", deleted_at: null },
      ],
      learning_paths: [{ id: PATH, path_name: "English", language: "English" }, { id: FIL_PATH, path_name: "Filipino", language: "fil-PH" }],
      module_passages: [],
      enrollments: [{ room_id: ROOM, student_id: STUDENT }],
      room_modules: [],
      oral_reading_attempts: [],
      oral_reading_recordings: [],
    },
    storage: {
      from: (bucket) => ({
        upload: async (path, buffer, options) => { db.uploads.push({ bucket, path, bytes: buffer.length, ...options }); return { error: null }; },
        remove: async (paths) => { db.removed.push(...paths); return { error: null }; },
        createSignedUrl: async (path, seconds) => ({ data: { signedUrl: `https://signed.invalid/${path}?ttl=${seconds}` }, error: null }),
      }),
    },
    from: (table) => new Query(db, table),
  };
  return db;
}

const as = (id) => ({ getAuthenticatedSupabaseUser: async () => ({ id }) });
const deps = (db, id) => ({ ...as(id), getSupabaseAdmin: () => db });
const requester = (id, role) => ({ user: { id }, profile: { id, role } });
const ownAttempt = (owner) => async (who, attemptId) => {
  if (who.user.id !== owner) {
    const { OralReadingAuthorizationError } = require("../services/oralReadingAttemptService");
    throw new OralReadingAuthorizationError("This oral-reading result is not available to your account.");
  }
  return { id: attemptId };
};
const file = (text, mimetype = "audio/webm;codecs=opus") => ({ buffer: Buffer.from(text), mimetype });

test("M1 learner authorization is unchanged: admins and teachers stay excluded", async () => {
  const db = fakeDb();
  for (const id of [STUDENT, GENERAL]) assert.equal((await authorizeOralReadingRequest({}, deps(db, id))).profile.id, id);
  for (const id of [ADMIN, TEACHER]) await assert.rejects(authorizeOralReadingRequest({}, deps(db, id)), { statusCode: 403 });
});

test("M5 self-practice authorization adds admins only", async () => {
  const db = fakeDb();
  for (const id of [ADMIN, STUDENT, GENERAL]) assert.equal((await authorizeOralReadingPracticeRequest({}, deps(db, id))).profile.id, id);
  await assert.rejects(authorizeOralReadingPracticeRequest({}, deps(db, TEACHER)), { statusCode: 403 });
});

test("admins read published modules outside classrooms, never with a room or assignment", async () => {
  const db = fakeDb();
  const admin = requester(ADMIN, "admin");
  const module = await loadAccessiblePublishedModule(admin, MODULE, deps(db, ADMIN));
  assert.equal(module.id, MODULE);
  assert.equal(module.roomId, null);
  await assert.rejects(loadAccessiblePublishedModule(admin, MODULE, deps(db, ADMIN), { roomId: ROOM }), { statusCode: 403 });
  await assert.rejects(loadAccessiblePublishedModule(admin, MODULE, deps(db, ADMIN), { assignmentId: ROOM }), { statusCode: 403 });
  await assert.rejects(loadAccessiblePublishedModule(requester(TEACHER, "teacher"), MODULE, deps(db, TEACHER)), { statusCode: 403 });
});

async function withRouter(dependencies, run) {
  const app = express();
  app.use(express.json());
  app.use(createOralReadingRouter(dependencies));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("HTTP: admin reaches only M5 self-practice endpoints; classroom, material and teacher routes stay closed", async () => {
  const db = fakeDb();
  await withRouter(deps(db, ADMIN), async (url) => {
    assert.equal((await fetch(`${url}/modules/${MODULE}`)).status, 200);
    assert.equal((await fetch(`${url}/admin/passages`)).status, 200);
    assert.equal((await fetch(`${url}/rooms/${ROOM}/progress`)).status, 403);
    assert.equal((await fetch(`${url}/materials/${MATERIAL}?roomId=${ROOM}`)).status, 403);
    assert.equal((await fetch(`${url}/teacher/attempts`)).status, 403);
    assert.equal((await fetch(`${url}/teacher/attempts/${ATTEMPT}/recording`)).status, 403);
  });
});

test("HTTP: learners cannot list admin passages; unapproved teachers cannot open recordings", async () => {
  for (const id of [STUDENT, GENERAL]) {
    await withRouter(deps(fakeDb(), id), async (url) => {
      assert.equal((await fetch(`${url}/admin/passages`)).status, 403);
    });
  }
  await withRouter(deps(fakeDb(), TEACHER), async (url) => {
    assert.equal((await fetch(`${url}/teacher/attempts/${ATTEMPT}/recording`)).status, 403);
  });
});

test("HTTP: nobody can upload or open another account's recording; storage is never touched", async () => {
  const db = fakeDb();
  const dependencies = { ...deps(db, ADMIN), getOralReadingAttempt: ownAttempt(STUDENT) };
  await withRouter(dependencies, async (url) => {
    const form = new FormData();
    form.append("audio", new Blob(["x"], { type: "audio/webm" }), "segment-000");
    assert.equal((await fetch(`${url}/attempts/${ATTEMPT}/recording`, { method: "POST", body: form })).status, 403);
    assert.equal((await fetch(`${url}/attempts/${ATTEMPT}/recording`)).status, 403);
  });
  assert.deepEqual(db.uploads, []);
  assert.equal(db.queries.includes("oral_reading_recordings"), false);
});

test("recording segments are stored and replayed in recorder order", async () => {
  const db = fakeDb();
  const owner = requester(STUDENT, "student");
  const dependencies = { getSupabaseAdmin: () => db, getOralReadingAttempt: ownAttempt(STUDENT) };
  const files = Array.from({ length: 7 }, (_, index) => file(`part-${index}`)); // ~2 min 50 s at 25 s per part
  await saveOralReadingRecording(owner, ATTEMPT, files, dependencies);
  const paths = db.uploads.map((upload) => upload.path);
  assert.deepEqual(paths.map((path) => path.slice(-3)), ["000", "001", "002", "003", "004", "005", "006"]);
  assert.ok(paths.every((path) => path.startsWith(`${STUDENT}/${ATTEMPT}/`)));
  assert.ok(db.uploads.every((upload) => upload.contentType === "audio/webm" && upload.upsert === false && upload.bucket === "oral-reading-recordings"));
  assert.deepEqual(db.tables.oral_reading_recordings[0].segments, paths);

  const recording = await getOralReadingRecording(owner, ATTEMPT, false, dependencies);
  assert.equal(recording.available, true);
  assert.deepEqual(recording.segments.map((url) => new URL(url).pathname.slice(1)), paths);

  await saveOralReadingRecording(owner, ATTEMPT, [file("retry")], dependencies);
  assert.equal(db.uploads.length, 7, "a retry never replaces a saved recording");
});

test("HTTP: one continuous recording larger than a 25 s part is saved and replayed as one file", async () => {
  const db = fakeDb();
  const dependencies = { ...deps(db, STUDENT), getOralReadingAttempt: ownAttempt(STUDENT) };
  await withRouter(dependencies, async (url) => {
    const form = new FormData();
    // About five minutes of Opus audio: over the old 2 MB part limit, under 25 MB.
    form.append("audio", new Blob([Buffer.alloc(5 * 1024 * 1024, 1)], { type: "audio/webm;codecs=opus" }), "segment-000");
    assert.equal((await fetch(`${url}/attempts/${ATTEMPT}/recording`, { method: "POST", body: form })).status, 200);
    const { recording } = await (await fetch(`${url}/attempts/${ATTEMPT}/recording`)).json();
    assert.equal(recording.available, true);
    assert.equal(recording.segments.length, 1);
  });
  assert.equal(db.uploads.length, 1);
  assert.equal(db.tables.oral_reading_recordings[0].segments.length, 1);
});

test("HTTP: a recording over the 25 MB budget is still rejected before storage", async () => {
  const db = fakeDb();
  const dependencies = { ...deps(db, STUDENT), getOralReadingAttempt: ownAttempt(STUDENT) };
  await withRouter(dependencies, async (url) => {
    const form = new FormData();
    form.append("audio", new Blob([Buffer.alloc(25 * 1024 * 1024 + 1, 1)], { type: "audio/webm" }), "segment-000");
    assert.equal((await fetch(`${url}/attempts/${ATTEMPT}/recording`, { method: "POST", body: form })).status, 400);
  });
  assert.deepEqual(db.uploads, []);
});

test("invalid recordings are rejected before upload", async () => {
  const db = fakeDb();
  const owner = requester(STUDENT, "student");
  const dependencies = { getSupabaseAdmin: () => db, getOralReadingAttempt: ownAttempt(STUDENT) };
  for (const files of [[], [file("x", "text/plain")], [file("")], Array.from({ length: 33 }, () => file("x"))]) {
    await assert.rejects(saveOralReadingRecording(owner, ATTEMPT, files, dependencies), { code: "INVALID_RECORDING" });
  }
  assert.deepEqual(db.uploads, []);
});

test("before the M5 recording migration: playback reports no recording, saving reports a clear code", async () => {
  const db = fakeDb({ missing: ["oral_reading_recordings"] });
  const owner = requester(STUDENT, "student");
  const dependencies = { getSupabaseAdmin: () => db, getOralReadingAttempt: ownAttempt(STUDENT) };
  assert.deepEqual(await getOralReadingRecording(owner, ATTEMPT, false, dependencies), { available: false, segments: [] });
  await assert.rejects(saveOralReadingRecording(owner, ATTEMPT, [file("x")], dependencies), { code: "RECORDING_STORAGE_UNAVAILABLE", statusCode: 503 });
  assert.deepEqual(db.uploads, []);
});

test("teacher review keeps M5's controlled errors over M7 complete reads; weekly reports still abort", async () => {
  const { listTeacherOralReadingAttempts, OralReadingPersistenceError } = require("../services/oralReadingAttemptService");
  const teacher = requester(TEACHER, "teacher");
  await assert.rejects(
    listTeacherOralReadingAttempts(teacher, { getSupabaseAdmin: () => fakeDb({ missing: ["rooms"] }) }),
    (error) => error instanceof OralReadingPersistenceError && error.message === "Unable to load your classrooms.",
  );
  await assert.rejects(
    listTeacherOralReadingAttempts(teacher, { getSupabaseAdmin: () => fakeDb({ missing: ["rooms"] }), weeklyReportStrict: true }),
    /Unable to retrieve complete weekly report data \(rooms\)/,
  );
});

test("admin passage list is admin-only and reuses the shared Filipino language matching", async () => {
  const db = fakeDb();
  await assert.rejects(listAdminReadingPassages(requester(STUDENT, "student"), { getSupabaseAdmin: () => db }), { statusCode: 403 });
  const passages = await listAdminReadingPassages(requester(ADMIN, "admin"), { getSupabaseAdmin: () => db });
  assert.deepEqual(passages.map(({ moduleId, language }) => [moduleId, language]).sort(), [[MODULE, "en"], [FIL_MODULE, "fil"]].sort());
  assert.equal(db.queries.some((table) => ["profiles", "enrollments", "oral_reading_attempts"].includes(table)), false, "no learner data is read");
});
