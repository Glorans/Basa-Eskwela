const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { createOralReadingRouter } = require("../routes/oralReading");
const {
  getTeacherOralReadingAttempt,
  listTeacherOralReadingAttempts,
} = require("../services/oralReadingAttemptService");
const { summarizeComprehension } = require("../services/comprehensionScoring");

const TEACHER_A = "11111111-1111-4111-8111-111111111111";
const TEACHER_B = "22222222-2222-4222-8222-222222222222";
const STUDENT_A = "33333333-3333-4333-8333-333333333333";
const STUDENT_B = "44444444-4444-4444-8444-444444444444";
const ROOM_A = "77777777-7777-4777-8777-777777777777";
const ROOM_B = "88888888-8888-4888-8888-888888888888";
const MATERIAL = "99999999-9999-4999-8999-999999999999";
const MODULE = "99999999-9999-4999-8999-999999999990";
const PASSAGE = "99999999-9999-4999-8999-999999999991";
const ACTIVITY_DONE = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const ACTIVITY_OPEN = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
const ACTIVITY_NEW = "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3";
const ACTIVITY_ALOUD = "a4a4a4a4-a4a4-4a4a-8a4a-a4a4a4a4a4a4";
const ACTIVITY_B = "a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5";
const ORAL_DONE = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
const ORAL_OPEN = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";
const ORAL_NEW = "b3b3b3b3-b3b3-4b3b-8b3b-b3b3b3b3b3b3";
const ORAL_ALOUD = "b4b4b4b4-b4b4-4b4b-8b4b-b4b4b4b4b4b4";
const ORAL_B = "b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5";
const ORAL_LEGACY = "b6b6b6b6-b6b6-4b6b-8b6b-b6b6b6b6b6b6";
const ORAL_PRACTICE = "b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7";
const COMP_DONE = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const COMP_OPEN = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const COMP_B = "c5c5c5c5-c5c5-4c5c-8c5c-c5c5c5c5c5c5";
const COMP_LEGACY = "c6c6c6c6-c6c6-4c6c-8c6c-c6c6c6c6c6c6";

const QUESTIONS = ["literal", "inferential", "critical", "literal"].map((type, index) => ({
  id: `d${index}d${index}d${index}d${index}-d${index}d${index}-4d${index}d-8d${index}d-d${index}d${index}d${index}d${index}d${index}d${index}`,
  type,
  questionText: `Question ${index + 1}?`,
  options: ["A", "B", "C", "D"],
  scaffoldingHint: "Look again.",
  correctOptionIndex: index % 4,
  answerExplanation: null,
  supportingEvidence: null,
}));

class Query {
  constructor(database, table) {
    this.database = database;
    this.table = table;
    this.filters = [];
    this.ordering = undefined;
    this.singleMode = undefined;
    database.calls.push(table);
  }

  select() { return this; }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
  in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
  order(column, options = {}) { this.ordering = { column, ascending: options.ascending !== false }; return this; }
  range() { return this; }
  single() { this.singleMode = "single"; return this; }
  maybeSingle() { this.singleMode = "maybe"; return this; }
  then(resolve, reject) { return this.execute().then(resolve, reject); }

  async execute() {
    if (this.database.failing.has(this.table)) {
      return { data: null, error: { message: `Failure in ${this.table}` } };
    }
    const rows = this.database.tables[this.table];
    if (!rows) return { data: null, error: { message: `Unknown table ${this.table}` } };
    const selected = rows.filter((row) => this.filters.every((filter) => filter(row)))
      .map((row) => structuredClone(row));
    if (this.ordering) {
      const direction = this.ordering.ascending ? 1 : -1;
      selected.sort((left, right) => left[this.ordering.column] > right[this.ordering.column]
        ? direction
        : -direction);
    }
    if (this.singleMode === "single") {
      return selected.length === 1
        ? { data: selected[0], error: null }
        : { data: null, error: { message: "Expected one row" } };
    }
    if (this.singleMode === "maybe") return { data: selected[0] ?? null, error: null };
    return { data: selected, error: null };
  }
}

function oral(id, userId, roomId, extra = {}) {
  return {
    id,
    user_id: userId,
    module_id: null,
    material_id: MATERIAL,
    room_id: roomId,
    assignment_id: null,
    module_title_snapshot: "Seeds",
    passage_title_snapshot: "Seeds",
    language_snapshot: "en",
    passage_snapshot: "Seeds need sun.",
    transcript: "Seeds need sun.",
    duration_seconds: 10,
    reading_speed_wpm: 18,
    pronunciation_accuracy: 100,
    expected_word_count: 3,
    detected_error_count: 0,
    word_metrics: [],
    completed_at: "2026-10-01T10:00:00.000Z",
    ...extra,
  };
}

function comprehension(id, userId, roomId, extra = {}) {
  return {
    id,
    user_id: userId,
    module_id: null,
    passage_id: null,
    material_id: MATERIAL,
    room_id: roomId,
    assignment_id: null,
    status: "completed",
    created_at: "2026-10-01T10:05:00.000Z",
    completed_at: "2026-10-01T10:10:00.000Z",
    question_snapshot: QUESTIONS,
    ...extra,
  };
}

function response(attemptId, questionIndex, firstOptionIndex, extra = {}) {
  return {
    attempt_id: attemptId,
    question_id: QUESTIONS[questionIndex].id,
    first_option_index: firstOptionIndex,
    first_answer_correct: firstOptionIndex === QUESTIONS[questionIndex].correctOptionIndex,
    answer_history: [{ optionIndex: firstOptionIndex }],
    hint_used: false,
    resolved: true,
    ...extra,
  };
}

function createDatabase() {
  const database = {
    calls: [],
    failing: new Set(),
    tables: {
      profiles: [
        { id: TEACHER_A, full_name: "Teacher A", role: "teacher", teacher_status: "approved" },
        { id: TEACHER_B, full_name: "Teacher B", role: "teacher", teacher_status: "approved" },
        { id: STUDENT_A, full_name: "Student A", role: "student" },
        { id: STUDENT_B, full_name: "Student B", role: "student" },
      ],
      rooms: [{ id: ROOM_A, teacher_id: TEACHER_A }, { id: ROOM_B, teacher_id: TEACHER_B }],
      enrollments: [{ room_id: ROOM_A, student_id: STUDENT_A }, { room_id: ROOM_B, student_id: STUDENT_B }],
      modules: [{ id: MODULE, title: "Rivers", difficulty: "Easy" }],
      reading_activity_assignments: [
        { id: ACTIVITY_DONE, student_id: STUDENT_A, read_aloud_only: false },
        { id: ACTIVITY_OPEN, student_id: STUDENT_A, read_aloud_only: false },
        { id: ACTIVITY_NEW, student_id: STUDENT_A, read_aloud_only: false },
        { id: ACTIVITY_ALOUD, student_id: STUDENT_A, read_aloud_only: true },
        { id: ACTIVITY_B, student_id: STUDENT_B, read_aloud_only: false },
      ],
      oral_reading_attempts: [
        oral(ORAL_DONE, STUDENT_A, ROOM_A, { activity_assignment_id: ACTIVITY_DONE }),
        oral(ORAL_OPEN, STUDENT_A, ROOM_A, { activity_assignment_id: ACTIVITY_OPEN }),
        oral(ORAL_NEW, STUDENT_A, ROOM_A, { activity_assignment_id: ACTIVITY_NEW }),
        oral(ORAL_ALOUD, STUDENT_A, ROOM_A, { activity_assignment_id: ACTIVITY_ALOUD }),
        oral(ORAL_B, STUDENT_B, ROOM_B, { activity_assignment_id: ACTIVITY_B }),
        oral(ORAL_LEGACY, STUDENT_A, ROOM_A, {
          material_id: null, module_id: MODULE, passage_id: PASSAGE, assignment_id: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1",
          completed_at: "2026-09-01T10:00:00.000Z",
        }),
        oral(ORAL_PRACTICE, STUDENT_A, null, {
          material_id: null, module_id: MODULE, passage_id: PASSAGE, completed_at: "2026-09-02T10:00:00.000Z",
        }),
      ],
      m6_comprehension_attempts: [
        comprehension(COMP_DONE, STUDENT_A, ROOM_A, {
          activity_assignment_id: ACTIVITY_DONE, oral_reading_attempt_id: ORAL_DONE,
        }),
        comprehension(COMP_OPEN, STUDENT_A, ROOM_A, {
          activity_assignment_id: ACTIVITY_OPEN, oral_reading_attempt_id: ORAL_OPEN,
          status: "in_progress", completed_at: null,
        }),
        comprehension(COMP_B, STUDENT_B, ROOM_B, {
          activity_assignment_id: ACTIVITY_B, oral_reading_attempt_id: ORAL_B,
        }),
        comprehension(COMP_LEGACY, STUDENT_A, ROOM_A, {
          material_id: null, module_id: MODULE, passage_id: PASSAGE,
          assignment_id: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1",
          activity_assignment_id: null, oral_reading_attempt_id: null,
          created_at: "2026-09-01T10:05:00.000Z", completed_at: "2026-09-01T10:10:00.000Z",
        }),
      ],
      m6_comprehension_responses: [
        response(COMP_DONE, 0, 0),
        response(COMP_DONE, 1, 0, {
          hint_used: true,
          answer_history: [{ optionIndex: 0, correct: false }, { optionIndex: 1, correct: true }],
        }),
        response(COMP_DONE, 2, 2),
        response(COMP_DONE, 3, 1, { answer_history: [{ optionIndex: 1 }, { optionIndex: 2 }] }),
        response(COMP_OPEN, 0, 0),
        response(COMP_B, 0, 0),
        response(COMP_LEGACY, 0, 0),
        response(COMP_LEGACY, 1, 1),
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
    await callback(`http://127.0.0.1:${server.address().port}/api/oral-reading`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("Teacher sees own student's comprehension scored by the shared M6 summary", async () => {
  const database = createDatabase();
  const detail = await getTeacherOralReadingAttempt(requester(TEACHER_A), ORAL_DONE, dependencies(database));
  const expected = summarizeComprehension(
    QUESTIONS, database.tables.m6_comprehension_responses.filter((row) => row.attempt_id === COMP_DONE),
  );

  assert.equal(detail.pronunciationAccuracy, 100);
  assert.equal(detail.comprehension.status, "completed");
  assert.equal(detail.comprehension.firstCorrect, expected.firstCorrect);
  assert.equal(detail.comprehension.firstCorrect, 2);
  assert.equal(detail.comprehension.totalQuestions, 4);
  assert.equal(detail.comprehension.firstAttemptPercentage, expected.firstAttemptPercentage);
  assert.equal(detail.comprehension.hintsUsed, 1);
  assert.deepEqual(detail.comprehension.byType, expected.byType);
  assert.deepEqual(detail.comprehension.questions.map((question) => question.order), [1, 2, 3, 4]);
  assert.deepEqual(detail.comprehension.questions[1], {
    order: 2,
    type: "inferential",
    prompt: "Question 2?",
    options: ["A", "B", "C", "D"],
    studentFirstAnswerIndex: 0,
    correctIndex: 1,
    firstAnswerCorrect: false,
    hintUsed: true,
    resolved: true,
    secondAnswerIndex: 1,
  });
  assert.equal("secondAnswerIndex" in detail.comprehension.questions[0], false);
  assert.equal(detail.comprehension.questions[3].secondAnswerIndex, 2);
  assert.equal("scaffoldingHint" in detail.comprehension.questions[0], false);
});

test("Teacher list adds comprehension status for each attempt with batched queries", async () => {
  const database = createDatabase();
  const rows = await listTeacherOralReadingAttempts(requester(TEACHER_A), dependencies(database));
  const byId = new Map(rows.map((row) => [row.id, row.comprehension]));

  assert.deepEqual(byId.get(ORAL_DONE), {
    status: "completed", firstCorrect: 2, totalQuestions: 4, firstAttemptPercentage: 50,
    hintsUsed: 1, completedAt: "2026-10-01T10:10:00.000Z",
  });
  assert.equal(byId.get(ORAL_OPEN).status, "in_progress");
  assert.deepEqual(byId.get(ORAL_NEW), { status: "not_started" });
  assert.deepEqual(byId.get(ORAL_ALOUD), { status: "not_applicable" });
  assert.equal(byId.get(ORAL_LEGACY).status, "completed");
  assert.equal(byId.get(ORAL_LEGACY).firstCorrect, 2);
  assert.deepEqual(byId.get(ORAL_PRACTICE), { status: "not_applicable" });
  assert.equal(byId.has(ORAL_B), false);
  for (const row of rows) assert.equal("questions" in row.comprehension, false);
  for (const table of ["m6_comprehension_attempts", "m6_comprehension_responses", "reading_activity_assignments"]) {
    assert.equal(database.calls.filter((call) => call === table).length, 1, table);
  }
});

test("another Teacher cannot see a student's comprehension", async () => {
  const database = createDatabase();
  await assert.rejects(
    getTeacherOralReadingAttempt(requester(TEACHER_B), ORAL_DONE, dependencies(database)),
    (error) => error.statusCode === 404,
  );
  const rows = await listTeacherOralReadingAttempts(requester(TEACHER_B), dependencies(database));
  assert.deepEqual(rows.map((row) => row.id), [ORAL_B]);
  assert.equal(rows[0].comprehension.status, "completed");
  assert.equal(rows[0].comprehension.totalQuestions, 4);
});

test("a comprehension lookup failure keeps the oral result and marks comprehension unavailable", async () => {
  const database = createDatabase();
  database.failing.add("m6_comprehension_responses");
  const detail = await getTeacherOralReadingAttempt(requester(TEACHER_A), ORAL_DONE, dependencies(database));
  assert.equal(detail.transcript, "Seeds need sun.");
  assert.deepEqual(detail.comprehension, { status: "unavailable" });

  const list = await listTeacherOralReadingAttempts(requester(TEACHER_A), dependencies(createDatabase()));
  assert.ok(list.length > 0);
});

test("student routes never expose the Teacher comprehension answer key", async () => {
  const database = createDatabase();
  const deps = {
    ...dependencies(database),
    getAuthenticatedSupabaseUser: async () => ({ id: STUDENT_A }),
  };
  await withTestServer(deps, async (url) => {
    const headers = { Authorization: "Bearer student" };
    const own = await fetch(`${url}/attempts/${ORAL_DONE}`, { headers });
    const ownBody = await own.text();
    assert.equal(own.status, 200);
    assert.doesNotMatch(ownBody, /correctIndex|correctOptionIndex|comprehension/);

    const ownList = await fetch(`${url}/attempts`, { headers });
    assert.equal(ownList.status, 200);
    assert.doesNotMatch(await ownList.text(), /correctIndex|correctOptionIndex|comprehension/);

    for (const path of ["/teacher/attempts", `/teacher/attempts/${ORAL_DONE}`]) {
      const teacherRoute = await fetch(`${url}${path}`, { headers });
      assert.equal(teacherRoute.status, 403);
      assert.doesNotMatch(await teacherRoute.text(), /correctIndex|Question 1/);
    }
  });
});
