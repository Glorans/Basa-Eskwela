const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { createOralReadingRouter } = require("../routes/oralReading");
const {
  OralReadingAuthorizationError,
  OralReadingPersistenceError,
  authorizeTeacherOralReadingRequest,
  getTeacherOralReadingAttempt,
  listTeacherOralReadingAttempts,
} = require("../services/oralReadingAttemptService");
const { SupabaseAuthenticationError } = require("../services/supabaseAdmin");

const TEACHER_A = "11111111-1111-4111-8111-111111111111";
const TEACHER_B = "22222222-2222-4222-8222-222222222222";
const STUDENT_A = "33333333-3333-4333-8333-333333333333";
const STUDENT_B = "44444444-4444-4444-8444-444444444444";
const GENERAL = "55555555-5555-4555-8555-555555555555";
const ADMIN = "66666666-6666-4666-8666-666666666666";
const ROOM_A = "77777777-7777-4777-8777-777777777777";
const ROOM_B = "88888888-8888-4888-8888-888888888888";
const MODULE = "99999999-9999-4999-8999-999999999999";
const ATTEMPT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ATTEMPT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ATTEMPT_GENERAL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

class Query {
  constructor(database, table) {
    this.database = database;
    this.table = table;
    this.filters = [];
    this.ordering = undefined;
    this.singleMode = undefined;
  }

  select() { return this; }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
  in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
  order(column, options = {}) { this.ordering = { column, ascending: options.ascending !== false }; return this; }
  // Keyset pagination used by the M7 complete-read helper (reportRows).
  gt(column, value) { this.filters.push((row) => row[column] > value); return this; }
  limit(count) { this.rowLimit = count; return this; }
  single() { this.singleMode = "single"; return this; }
  maybeSingle() { this.singleMode = "maybe"; return this; }
  then(resolve, reject) { return this.execute().then(resolve, reject); }

  async execute() {
    const rows = this.database.tables[this.table]?.map((row, index) => ({ id: `fixture-${String(index).padStart(6, "0")}`, ...row }));
    if (!rows) return { data: null, error: { message: `Unknown table ${this.table}` } };
    let selected = rows
      .filter((row) => this.filters.every((filter) => filter(row)))
      .map((row) => ({ ...row }));
    if (this.ordering) {
      const direction = this.ordering.ascending ? 1 : -1;
      selected.sort((left, right) => left[this.ordering.column] > right[this.ordering.column]
        ? direction
        : -direction);
    }
    if (this.rowLimit !== undefined) selected = selected.slice(0, this.rowLimit);
    if (this.singleMode === "single") {
      return selected.length === 1
        ? { data: selected[0], error: null }
        : { data: null, error: { message: "Expected one row" } };
    }
    if (this.singleMode === "maybe") return { data: selected[0] ?? null, error: null };
    return { data: selected, error: null };
  }
}

function attempt(id, userId, completedAt) {
  return {
    id,
    user_id: userId,
    module_id: MODULE,
    passage_snapshot: "Seeds need sun and water.",
    transcript: "Seeds need sun and water.",
    duration_seconds: 30,
    reading_speed_wpm: 10,
    pronunciation_accuracy: 80,
    expected_word_count: 5,
    detected_error_count: 1,
    word_metrics: [
      { type: "substitution", expected: "seeds", actual: "trees" },
      ...["need", "sun", "and", "water"].map((word) => ({
        type: "match", expected: word, actual: word,
      })),
    ],
    completed_at: completedAt,
  };
}

function createDatabase() {
  const database = {
    tables: {
      profiles: [
        { id: TEACHER_A, full_name: "Teacher A", role: "teacher" },
        { id: TEACHER_B, full_name: "Teacher B", role: "teacher" },
        { id: STUDENT_A, full_name: "Student A", role: "student" },
        { id: STUDENT_B, full_name: "Student B", role: "student" },
        { id: GENERAL, full_name: "Independent Learner", role: "general_user" },
        { id: ADMIN, full_name: "Admin", role: "admin" },
      ],
      rooms: [
        { id: ROOM_A, teacher_id: TEACHER_A },
        { id: ROOM_B, teacher_id: TEACHER_B },
      ],
      enrollments: [
        { id: "enrollment-1", room_id: ROOM_A, student_id: STUDENT_A },
        { id: "enrollment-2", room_id: ROOM_B, student_id: STUDENT_B },
        { id: "enrollment-3", room_id: ROOM_A, student_id: GENERAL },
      ],
      modules: [{ id: MODULE, title: "Seeds", difficulty: "Easy" }],
      oral_reading_attempts: [
        attempt(ATTEMPT_A, STUDENT_A, "2026-10-01T10:00:00.000Z"),
        attempt(ATTEMPT_B, STUDENT_B, "2026-10-01T09:00:00.000Z"),
        attempt(ATTEMPT_GENERAL, GENERAL, "2026-10-01T08:00:00.000Z"),
      ],
    },
    from(table) { return new Query(this, table); },
  };
  return database;
}

function dependencies(database) {
  return { getSupabaseAdmin: () => database };
}

function requester(id) {
  return { user: { id }, profile: { id, role: "teacher" } };
}

async function withTestServer(dependenciesValue, callback) {
  const app = express();
  app.use(express.json());
  app.use("/api/oral-reading", createOralReadingRouter(dependenciesValue));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}/api/oral-reading`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("unauthenticated Teacher-attempt list is rejected", async () => {
  await withTestServer({
    authorizeTeacherOralReadingRequest: async () => { throw new SupabaseAuthenticationError(); },
  }, async (url) => {
    const response = await fetch(`${url}/teacher/attempts`);
    assert.equal(response.status, 401);
  });
});

test("Student, Independent Learner, and Admin cannot access Teacher review", async () => {
  for (const userId of [STUDENT_A, GENERAL, ADMIN]) {
    const database = createDatabase();
    await assert.rejects(
      authorizeTeacherOralReadingRequest({}, {
        getAuthenticatedSupabaseUser: async () => ({ id: userId }),
        getSupabaseAdmin: () => database,
      }),
      OralReadingAuthorizationError,
    );
  }
});

test("Teacher lists only attempts for enrolled Students in their own rooms", async () => {
  const database = createDatabase();
  const teacherAResults = await listTeacherOralReadingAttempts(
    requester(TEACHER_A), dependencies(database),
  );
  const teacherBResults = await listTeacherOralReadingAttempts(
    requester(TEACHER_B), dependencies(database),
  );
  assert.deepEqual(teacherAResults.map((row) => row.id), [ATTEMPT_A]);
  assert.deepEqual(teacherBResults.map((row) => row.id), [ATTEMPT_B]);
  assert.equal(Object.hasOwn(teacherAResults[0], "transcript"), false);
  assert.equal(teacherAResults.some((row) => row.id === ATTEMPT_GENERAL), false);
});

test("Teacher opens an authorized Student attempt with immutable review fields", async () => {
  const database = createDatabase();
  const result = await getTeacherOralReadingAttempt(
    requester(TEACHER_A), ATTEMPT_A, dependencies(database),
  );
  assert.equal(result.learnerName, "Student A");
  assert.equal(result.transcript, "Seeds need sun and water.");
  assert.equal(result.pronunciationAccuracy, 80);
  assert.equal(result.wordMetrics[0].expected, "seeds");
  assert.equal(result.passageSnapshot, "Seeds need sun and water.");
});

test("Teacher cannot open another Teacher's Student or Independent Learner attempt", async () => {
  const database = createDatabase();
  await assert.rejects(
    getTeacherOralReadingAttempt(requester(TEACHER_A), ATTEMPT_B, dependencies(database)),
    (error) => error instanceof OralReadingPersistenceError && error.statusCode === 404,
  );
  await assert.rejects(
    getTeacherOralReadingAttempt(requester(TEACHER_A), ATTEMPT_GENERAL, dependencies(database)),
    (error) => error instanceof OralReadingPersistenceError && error.statusCode === 404,
  );
});

test("invalid or missing Teacher attempt returns a safe 404", async () => {
  const database = createDatabase();
  await assert.rejects(
    getTeacherOralReadingAttempt(requester(TEACHER_A), "invalid", dependencies(database)),
    (error) => error instanceof OralReadingPersistenceError && error.statusCode === 404,
  );
  await assert.rejects(
    getTeacherOralReadingAttempt(
      requester(TEACHER_A), "dddddddd-dddd-4ddd-8ddd-dddddddddddd", dependencies(database),
    ),
    (error) => error instanceof OralReadingPersistenceError && error.statusCode === 404,
  );
});

test("Teacher review endpoints do not support update or delete", async () => {
  await withTestServer({
    authorizeTeacherOralReadingRequest: async () => requester(TEACHER_A),
    listTeacherOralReadingAttempts: async () => [],
    getTeacherOralReadingAttempt: async () => ({}),
  }, async (url) => {
    const headers = { Authorization: "Bearer teacher", "Content-Type": "application/json" };
    const updateResponse = await fetch(`${url}/teacher/attempts/${ATTEMPT_A}`, {
      method: "PUT", headers, body: JSON.stringify({ pronunciationAccuracy: 100 }),
    });
    const deleteResponse = await fetch(`${url}/teacher/attempts/${ATTEMPT_A}`, {
      method: "DELETE", headers,
    });
    assert.equal(updateResponse.status, 404);
    assert.equal(deleteResponse.status, 404);
  });
});

test("Teacher cannot inspect a contextual attempt from another classroom even for a shared student", async () => {
  const db = createDatabase();
  db.tables.oral_reading_attempts[0].room_id = ROOM_B;
  assert.equal((await listTeacherOralReadingAttempts(requester(TEACHER_A), dependencies(db))).length, 0);
  await assert.rejects(getTeacherOralReadingAttempt(requester(TEACHER_A), ATTEMPT_A, dependencies(db)), error => error.statusCode === 404);
});

test("removed enrollment revokes both historical attempt list and direct access", async () => {
  const db = createDatabase();
  db.tables.enrollments = db.tables.enrollments.filter(row => row.student_id !== STUDENT_A);
  assert.equal((await listTeacherOralReadingAttempts(requester(TEACHER_A), dependencies(db))).length, 0);
  await assert.rejects(getTeacherOralReadingAttempt(requester(TEACHER_A), ATTEMPT_A, dependencies(db)), error => error.statusCode === 404);
});

test("membership in another owned room does not authorize a former classroom attempt", async () => {
  const db = createDatabase();
  db.tables.rooms.find(row => row.id === ROOM_B).teacher_id = TEACHER_A;
  db.tables.oral_reading_attempts[0].room_id = ROOM_B;
  const listed = await listTeacherOralReadingAttempts(requester(TEACHER_A), dependencies(db));
  assert.ok(!listed.some(row => row.id === ATTEMPT_A));
  await assert.rejects(getTeacherOralReadingAttempt(requester(TEACHER_A), ATTEMPT_A, dependencies(db)), error => error.statusCode === 404);
  db.tables.enrollments.push({student_id: STUDENT_A, room_id: ROOM_B});
  const authorized = await getTeacherOralReadingAttempt(requester(TEACHER_A), ATTEMPT_A, dependencies(db));
  assert.equal(authorized.id, ATTEMPT_A);
  assert.equal(authorized.roomId, ROOM_B);
});
