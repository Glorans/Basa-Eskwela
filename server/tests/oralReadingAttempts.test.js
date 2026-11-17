const assert = require("node:assert/strict");
const test = require("node:test");
const {
  OralReadingAuthorizationError,
  OralReadingPersistenceError,
  authorizeOralReadingRequest,
  createOralReadingAttempt,
  getOralReadingAttempt,
  loadAccessiblePublishedModule,
  listOwnOralReadingAttempts,
} = require("../services/oralReadingAttemptService");

const STUDENT = "11111111-1111-4111-8111-111111111111";
const OTHER_STUDENT = "22222222-2222-4222-8222-222222222222";
const GENERAL = "33333333-3333-4333-8333-333333333333";
const TEACHER = "44444444-4444-4444-8444-444444444444";
const MODULE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DRAFT_MODULE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PATH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ROOM = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ATTEMPT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

class Query {
  constructor(database, table) {
    this.database = database;
    this.table = table;
    this.action = "select";
    this.filters = [];
    this.rowLimit = undefined;
    this.singleMode = undefined;
    this.payload = undefined;
  }

  select() { return this; }
  insert(payload) { this.action = "insert"; this.payload = payload; return this; }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
  in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
  order(column, { ascending }) { (this.ordering ??= []).push({ column, ascending }); return this; }
  range(start, end) { this.rowOffset = start; this.rowLimit = end - start + 1; return this; }
  limit(value) { this.rowLimit = value; return this; }
  single() { this.singleMode = "single"; return this; }
  maybeSingle() { this.singleMode = "maybe"; return this; }
  then(resolve, reject) { return this.execute().then(resolve, reject); }

  async execute() {
    const rows = this.database.tables[this.table];
    if (!rows) return { data: null, error: { message: `Unknown table ${this.table}` } };
    if (this.action === "insert") {
      if (this.payload.submission_id && rows.some(row => row.user_id === this.payload.user_id && row.submission_id === this.payload.submission_id)) {
        return { data: null, error: { code: "23505" } };
      }
      const inserted = {
        id: ATTEMPT,
        completed_at: "2026-10-01T08:00:00.000Z",
        ...this.payload,
      };
      rows.push(inserted);
      return { data: { ...inserted }, error: null };
    }
    let selected = rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.ordering) {
      selected.sort((a,b) => {
        for (const { column, ascending } of this.ordering) {
          const comparison = String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1);
          if (comparison) return comparison;
        }
        return 0;
      });
    }
    if (this.rowOffset) selected = selected.slice(this.rowOffset);
    if (this.rowLimit !== undefined) selected = selected.slice(0, this.rowLimit);
    if (this.singleMode === "single") {
      return selected.length === 1
        ? { data: { ...selected[0] }, error: null }
        : { data: null, error: { message: "Expected one row" } };
    }
    if (this.singleMode === "maybe") {
      return { data: selected[0] ? { ...selected[0] } : null, error: null };
    }
    return { data: selected.map((row) => ({ ...row })), error: null };
  }
}

function createDatabase() {
  const database = {
    tables: {
      profiles: [
        { id: STUDENT, role: "student", full_name: "Student" },
        { id: OTHER_STUDENT, role: "student", full_name: "Other" },
        { id: GENERAL, role: "general_user", full_name: "Learner" },
        { id: TEACHER, role: "teacher", full_name: "Teacher" },
      ],
      modules: [
        { id: MODULE, path_id: PATH, title: "Seeds", difficulty: "Easy", status: "published", passage: "Seeds need sun and water." },
        { id: DRAFT_MODULE, path_id: PATH, title: "Draft", difficulty: "Easy", status: "draft", passage: "Hidden passage." },
      ],
      learning_paths: [{ id: PATH, path_name: "English Easy", language: "English" }],
      enrollments: [{ student_id: STUDENT, room_id: ROOM }],
      // An active classroom (saving checks the archive state on every request).
      rooms: [{ id: ROOM, teacher_id: TEACHER, archived_at: null }],
      room_modules: [{ id: ROOM, room_id: ROOM, module_id: MODULE }],
      module_passages: [],
      oral_reading_attempts: [],
    },
    from(table) { return new Query(this, table); },
  };
  return database;
}

function requester(id, role) {
  return { user: { id }, profile: { id, role } };
}

function dependencies(database) {
  return { getSupabaseAdmin: () => database };
}

function perfectAttemptBody(overrides = {}) {
  return {
    moduleId: MODULE,
    userId: OTHER_STUDENT,
    transcript: "Seeds need sun and water.",
    durationSeconds: 30,
    sttConfidence: 0.9,
    wordMetrics: ["seeds", "need", "sun", "and", "water"].map((word) => ({
      type: "match",
      expected: word,
      actual: word,
    })),
    ...overrides,
  };
}

test("Student without enrollment cannot start M5 directly", async () => {
  await assert.rejects(loadAccessiblePublishedModule(requester(OTHER_STUDENT, "student"), MODULE,
    dependencies(createDatabase())), OralReadingAuthorizationError);
});

test("Student cannot start M5 for a draft module", async () => {
  const database = createDatabase();
  await assert.rejects(
    loadAccessiblePublishedModule(
      requester(OTHER_STUDENT, "student"), DRAFT_MODULE, dependencies(database),
    ),
    OralReadingAuthorizationError,
  );
});

test("Independent Learner can start M5 for a published module", async () => {
  const database = createDatabase();
  const module = await loadAccessiblePublishedModule(
    requester(GENERAL, "general_user"), MODULE, dependencies(database),
  );
  assert.equal(module.language, "en");
});

test("legacy module language aliases use the existing Filipino language value", async () => {
  for (const language of ["Filipino", "Tagalog", "fil", "fil-PH", "tl", "TL-PH"]) {
    const database = createDatabase();
    database.tables.learning_paths[0].language = language;
    const module = await loadAccessiblePublishedModule(requester(GENERAL, "general_user"), MODULE, dependencies(database));
    assert.equal(module.language, "fil");
    assert.equal(database.tables.learning_paths[0].language, language);
  }
});

test("draft and invalid modules cannot be used for learner M5", async () => {
  const database = createDatabase();
  await assert.rejects(
    loadAccessiblePublishedModule(
      requester(GENERAL, "general_user"), DRAFT_MODULE, dependencies(database),
    ),
    OralReadingAuthorizationError,
  );
  await assert.rejects(
    loadAccessiblePublishedModule(
      requester(GENERAL, "general_user"), "not-an-id", dependencies(database),
    ),
    OralReadingPersistenceError,
  );
});

test("oral-reading authorization trusts the profile role, not auth metadata", async () => {
  const database = createDatabase();
  const authorized = await authorizeOralReadingRequest({}, {
    getAuthenticatedSupabaseUser: async () => ({ id: STUDENT, user_metadata: { role: "teacher" } }),
    getSupabaseAdmin: () => database,
  });
  assert.equal(authorized.profile.role, "student");
  await assert.rejects(
    authorizeOralReadingRequest({}, {
      getAuthenticatedSupabaseUser: async () => ({ id: TEACHER }),
      getSupabaseAdmin: () => database,
    }),
    OralReadingAuthorizationError,
  );
});

test("completed attempt persists server-derived identity, score, and WPM", async () => {
  const database = createDatabase();
  const attempt = await createOralReadingAttempt(
    requester(STUDENT, "student"),
    perfectAttemptBody(),
    dependencies(database),
  );
  assert.equal(attempt.userId, STUDENT);
  assert.equal(database.tables.oral_reading_attempts[0].user_id, STUDENT);
  assert.equal(attempt.pronunciationAccuracy, 100);
  assert.equal(attempt.readingSpeedWpm, 10);
  assert.equal(database.tables.oral_reading_attempts[0].passage_snapshot, "Seeds need sun and water.");
});

test("substitutions, omissions, and insertions lower accuracy and clamp it to zero", async () => {
  const database = createDatabase();
  const errors = [
    { type: "substitution", expected: "seeds", actual: "trees" },
    { type: "omission", expected: "need", actual: null },
    { type: "insertion", expected: null, actual: "really" },
    { type: "omission", expected: "sun", actual: null },
    { type: "omission", expected: "and", actual: null },
    { type: "omission", expected: "water", actual: null },
  ];
  const attempt = await createOralReadingAttempt(
    requester(GENERAL, "general_user"),
    perfectAttemptBody({ transcript: "Trees really", wordMetrics: errors }),
    dependencies(database),
  );
  assert.equal(attempt.detectedErrorCount, 5);
  assert.equal(attempt.pronunciationAccuracy, 0);
});

test("refresh reloads an owner's persisted attempt even if the module is later unpublished", async () => {
  const database = createDatabase();
  await createOralReadingAttempt(
    requester(GENERAL, "general_user"), perfectAttemptBody(), dependencies(database),
  );
  database.tables.modules[0].status = "draft";
  const loaded = await getOralReadingAttempt(
    requester(GENERAL, "general_user"), ATTEMPT, dependencies(database),
  );
  assert.equal(loaded.id, ATTEMPT);
  assert.equal(loaded.transcript, "Seeds need sun and water.");
});

test("Student and Independent Learner cannot view another learner's attempt", async () => {
  const database = createDatabase();
  await createOralReadingAttempt(
    requester(STUDENT, "student"), perfectAttemptBody(), dependencies(database),
  );
  await assert.rejects(
    getOralReadingAttempt(
      requester(OTHER_STUDENT, "student"), ATTEMPT, dependencies(database),
    ),
    OralReadingAuthorizationError,
  );
  await assert.rejects(
    getOralReadingAttempt(
      requester(GENERAL, "general_user"), ATTEMPT, dependencies(database),
    ),
    OralReadingAuthorizationError,
  );
});

const SECOND_PASSAGE = "ffffffff-ffff-4fff-8fff-ffffffffffff";
test("selected passage is validated, scored and snapshotted instead of the legacy text", async () => {
  const db = createDatabase();
  db.tables.module_passages = [
    { id: MODULE, module_id: MODULE, title: "First", passage_text: "First text", display_order: 1 },
    { id: SECOND_PASSAGE, module_id: MODULE, title: "Second", passage_text: "Mr. has 1 seed.", display_order: 2 },
  ];
  await assert.rejects(loadAccessiblePublishedModule(requester(GENERAL, "general_user"), MODULE, dependencies(db)), /Select a valid passage/);
  await assert.rejects(createOralReadingAttempt(requester(GENERAL, "general_user"), perfectAttemptBody({ passageId: PATH }), dependencies(db)), /Select a valid passage/);
  const saved = await createOralReadingAttempt(requester(GENERAL, "general_user"), perfectAttemptBody({
    passageId: SECOND_PASSAGE, transcript: "Mister has one seed", wordMetrics: [], pronunciationAccuracy: 0,
  }), dependencies(db));
  assert.equal(saved.passageId, SECOND_PASSAGE);
  assert.equal(saved.passageSnapshot, "Mr. has 1 seed.");
  assert.equal(saved.pronunciationAccuracy, 100);
  db.tables.module_passages[1].passage_text = "Edited";
  db.tables.modules[0].title = "Edited title";
  assert.equal((await getOralReadingAttempt(requester(GENERAL, "general_user"), saved.id, dependencies(db))).moduleTitle, "Seeds");
});
test("client error labels cannot turn a different transcript into a perfect result", async () => {
  const saved = await createOralReadingAttempt(requester(GENERAL, "general_user"), perfectAttemptBody({ transcript: "Trees" }), dependencies(createDatabase()));
  assert.equal(saved.pronunciationAccuracy, 0);
  assert.equal(saved.detectedErrorCount, 5);
  assert.equal(saved.readingSpeedWpm, 2);
});
test("Student assignment and supplied classroom context are checked server-side", async () => {
  const db = createDatabase();
  const student = requester(STUDENT, "student");
  const module = await loadAccessiblePublishedModule(student, MODULE, dependencies(db), { roomId: ROOM, assignmentId: ROOM });
  assert.equal(module.roomId, ROOM);
  assert.equal(module.assignmentId, ROOM);
  await assert.rejects(loadAccessiblePublishedModule(student, MODULE, dependencies(db), { roomId: PATH }), OralReadingAuthorizationError);
  await assert.rejects(loadAccessiblePublishedModule(student, MODULE, dependencies(db), { assignmentId: PATH }), OralReadingAuthorizationError);
  db.tables.room_modules = [];
  // Without an assignment, a save that names the classroom is refused (classroom work is never relabelled)...
  await assert.rejects(createOralReadingAttempt(student, perfectAttemptBody({ roomId: ROOM }), dependencies(db)), OralReadingAuthorizationError);
  await assert.rejects(createOralReadingAttempt(student, perfectAttemptBody({ assignmentId: ROOM }), dependencies(db)), OralReadingAuthorizationError);
  // ...and a catalog save (no classroom named) is personal practice (2026-11-17), saved without a classroom.
  const personal = await createOralReadingAttempt(student, perfectAttemptBody(), dependencies(db));
  assert.equal(personal.roomId, null);
  assert.equal(personal.assignmentId, null);
  assert.equal(personal.practiceContext, "personal");
});
test("save retry reopens the existing submission without another insert", async () => {
  const db = createDatabase();
  const user = requester(GENERAL, "general_user");
  const body = perfectAttemptBody({ submissionId: ROOM });
  const first = await createOralReadingAttempt(user, body, dependencies(db));
  const second = await createOralReadingAttempt(user, body, dependencies(db));
  assert.equal(second.id, first.id);
  assert.equal(db.tables.oral_reading_attempts.length, 1);
});
test("save errors and arbitrary passage read errors fail clearly", async () => {
  const db = createDatabase();
  db.tables.oral_reading_attempts = null;
  await assert.rejects(createOralReadingAttempt(requester(GENERAL, "general_user"), perfectAttemptBody(), dependencies(db)), error => error.code === "ATTEMPT_SAVE_FAILED");
  delete db.tables.module_passages;
  await assert.rejects(loadAccessiblePublishedModule(requester(GENERAL, "general_user"), MODULE, dependencies(db)), /Unable to load the selected passage/);
});
test("legacy table absence supports only the legacy module identity", async () => {
  const db = createDatabase();
  const from = db.from.bind(db);
  db.from = table => table === "module_passages" ? {
    select() { return this; }, eq() { return Promise.resolve({ data: null, error: { code: "42P01" } }); },
  } : from(table);
  const module = await loadAccessiblePublishedModule(requester(GENERAL, "general_user"), MODULE, dependencies(db), { passageId: MODULE });
  assert.equal(module.passage, "Seeds need sun and water.");
  assert.equal(module.passageId, null);
  await assert.rejects(loadAccessiblePublishedModule(requester(GENERAL, "general_user"), MODULE, dependencies(db), { passageId: PATH }), OralReadingAuthorizationError);
});
test("invalid transcript, duration and excessive alignment requests are rejected", async () => {
  const { buildAttemptInsert } = require("../services/oralReadingAttemptService");
  const user = requester(GENERAL, "general_user");
  const module = { id: MODULE, title: "Test", passage: "Seeds", language: "en" };
  for (const body of [{ transcript: "" }, { durationSeconds: 0 }, { durationSeconds: 301 }]) {
    assert.throws(() => buildAttemptInsert(user, module, perfectAttemptBody(body)), OralReadingPersistenceError);
  }
  assert.throws(() => buildAttemptInsert(user, { ...module, passage: "seed ".repeat(2100) }, perfectAttemptBody({ transcript: "seed ".repeat(2100) })), /too large/);
});

test("saved attempt lists are strictly learner-owned", async () => {
  const { listOwnOralReadingAttempts } = require("../services/oralReadingAttemptService");
  const db = createDatabase();
  await createOralReadingAttempt(requester(STUDENT, "student"), perfectAttemptBody(), dependencies(db));
  assert.equal((await listOwnOralReadingAttempts(requester(STUDENT, "student"), MODULE, dependencies(db))).length, 1);
  assert.deepEqual(await listOwnOralReadingAttempts(requester(GENERAL, "general_user"), MODULE, dependencies(db)), []);
});
test("saved classroom context survives reload and later assignment removal", async () => {
  const db = createDatabase();
  const user = requester(STUDENT, "student");
  await createOralReadingAttempt(user, perfectAttemptBody({ roomId: ROOM, assignmentId: ROOM }), dependencies(db));
  db.tables.room_modules = [];
  const saved = await getOralReadingAttempt(user, ATTEMPT, dependencies(db));
  assert.equal(saved.roomId, ROOM);
  assert.equal(saved.assignmentId, ROOM);
});
test("direct module and save API: an unenrolled Student reads a published module as personal practice only", async () => {
  const express = require("express");
  const { createOralReadingRouter } = require("../routes/oralReading");
  const db = createDatabase();
  const app = express();
  app.use(express.json());
  app.use(createOralReadingRouter({ ...dependencies(db), authorizeOralReadingRequest: async () => requester(OTHER_STUDENT, "student") }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    // A classroom the Student is not enrolled in, or a draft, stays refused; nothing is saved.
    assert.equal((await fetch(`${url}/modules/${MODULE}?roomId=${ROOM}`)).status, 403);
    assert.equal((await fetch(`${url}/modules/${DRAFT_MODULE}`)).status, 403);
    assert.equal((await fetch(`${url}/attempts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(perfectAttemptBody({ roomId: ROOM })) })).status, 403);
    assert.equal(db.tables.oral_reading_attempts.length, 0);
    // Personal practice: the published module opens and saves with no classroom, under this Student only.
    const opened = await fetch(`${url}/modules/${MODULE}`);
    assert.equal(opened.status, 200);
    const module = (await opened.json()).module;
    assert.equal(module.roomId, null);
    assert.equal(module.personalPractice, true);
    const saved = await fetch(`${url}/attempts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(perfectAttemptBody()) });
    assert.equal(saved.status, 201, await saved.clone().text());
    assert.equal(db.tables.oral_reading_attempts.length, 1);
    assert.equal(db.tables.oral_reading_attempts[0].user_id, OTHER_STUDENT);
    assert.equal(db.tables.oral_reading_attempts[0].room_id, null);
    assert.equal(db.tables.oral_reading_attempts[0].assignment_id, null);
    // No enrollment or classroom assignment was created.
    assert.deepEqual(db.tables.enrollments, [{ student_id: STUDENT, room_id: ROOM }]);
    assert.equal(db.tables.room_modules.length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("concurrent saves return one persisted attempt after the uniqueness conflict", async () => {
  const db = createDatabase();
  const user = requester(GENERAL, "general_user");
  const body = perfectAttemptBody({ submissionId: ROOM });
  const attempts = await Promise.all([createOralReadingAttempt(user, body, dependencies(db)), createOralReadingAttempt(user, body, dependencies(db))]);
  assert.equal(db.tables.oral_reading_attempts.length, 1);
  assert.equal(attempts[0].id, attempts[1].id);
});

test('deleted modules reject starts and saves for both learners but retain saved history', async () => {
  for (const [id, role] of [[STUDENT, 'student'], [GENERAL, 'general_user']]) {
    const db = createDatabase();
    const owner = requester(id, role);
    const saved = await createOralReadingAttempt(owner, perfectAttemptBody(), dependencies(db));
    db.tables.modules[0].deleted_at = '2026-10-08T00:00:00Z';
    await assert.rejects(loadAccessiblePublishedModule(owner, MODULE, dependencies(db)), OralReadingAuthorizationError);
    await assert.rejects(createOralReadingAttempt(owner, perfectAttemptBody(), dependencies(db)), OralReadingAuthorizationError);
    const history = await listOwnOralReadingAttempts(owner, undefined, dependencies(db));
    assert.equal(history[0].id, saved.id);
    assert.equal(history[0].moduleTitle, 'Seeds');
    assert.equal(history[0].pronunciationAccuracy, 100);
    assert.equal(history[0].language, 'en');
    const reopened = await getOralReadingAttempt(owner, saved.id, dependencies(db));
    assert.equal(reopened.transcript, saved.transcript);
  }
});

test('all-module history is newest first, owner scoped, and reads multiple database pages', async () => {
  const db = createDatabase();
  for (let i=0; i<155; i++) db.tables.oral_reading_attempts.push({
    id: String(i), user_id: GENERAL, module_id: i % 2 ? MODULE : DRAFT_MODULE,
    module_title_snapshot: 'Saved module', passage_title_snapshot: 'Saved passage',
    completed_at: new Date(Date.UTC(2026,0,i+1)).toISOString(),
    pronunciation_accuracy: '91.5', reading_speed_wpm: '75', detected_error_count: 2,
  });
  db.tables.oral_reading_attempts.push({ id: 'private', user_id: STUDENT });
  const rows = await listOwnOralReadingAttempts(requester(GENERAL,'general_user'), undefined, dependencies(db));
  assert.equal(rows.length,155);
  assert.equal(rows[0].id,'154');
  assert.equal(rows[0].pronunciationAccuracy,91.5);
  assert.equal(rows.some(row=>row.id==='private'),false);
  const filtered = await listOwnOralReadingAttempts(requester(GENERAL,'general_user'), MODULE, dependencies(db));
  assert.ok(filtered.every(row=>row.moduleId===MODULE));
  await assert.rejects(listOwnOralReadingAttempts(requester(GENERAL,'general_user'), 'invalid', dependencies(db)), /invalid/);
});

test('history returns an explicit error when persistence is unavailable', async () => {
  await assert.rejects(listOwnOralReadingAttempts(requester(GENERAL,'general_user'), undefined, {
    getSupabaseAdmin: () => ({ from: () => ({
      select() {return this;}, eq() {return this;}, order() {return this;}, range: async () => ({error: {message:'offline'}}),
    }) }),
  }), /Unable to load your saved results/);
});

const TITLED_PASSAGE = "99999999-9999-4999-8999-999999999999";
test("an embedded title the screen hides is not scored; snapshot and saved history stay unchanged", async () => {
  const db = createDatabase();
  db.tables.module_passages = [{ id: TITLED_PASSAGE, module_id: MODULE, title: "A Helping Hand",
    passage_text: "A Helping Hand\nLia helps her lola.", display_order: 1 }];
  const user = requester(GENERAL, "general_user");
  // A result saved before this change keeps its stored score on a save retry.
  db.tables.oral_reading_attempts.push({ id: ROOM, user_id: GENERAL, module_id: MODULE, passage_id: TITLED_PASSAGE,
    submission_id: SECOND_PASSAGE, module_title_snapshot: "Seeds", language_snapshot: "en",
    passage_snapshot: "A Helping Hand\nLia helps her lola.", transcript: "Lia helps her lola", duration_seconds: 30,
    reading_speed_wpm: 8, pronunciation_accuracy: 57.142857, expected_word_count: 7, detected_error_count: 3,
    word_metrics: [], completed_at: "2026-09-01T08:00:00.000Z" });
  const legacy = await createOralReadingAttempt(user, perfectAttemptBody({
    passageId: TITLED_PASSAGE, submissionId: SECOND_PASSAGE, transcript: "Lia helps her lola" }), dependencies(db));
  assert.equal(legacy.detectedErrorCount, 3);
  assert.equal(legacy.expectedWordCount, 7);

  const saved = await createOralReadingAttempt(user, perfectAttemptBody({
    passageId: TITLED_PASSAGE, transcript: "Lia helps her lola" }), dependencies(db));
  assert.equal(saved.pronunciationAccuracy, 100);
  assert.equal(saved.expectedWordCount, 4);
  assert.deepEqual(saved.wordMetrics.filter(word => word.type !== "match"), []);
  assert.equal(saved.passageSnapshot, "A Helping Hand\nLia helps her lola.");
});

test("selected-student module assignments can only be started by their recipients", async () => {
  const db = createDatabase();
  db.tables.enrollments.push({ student_id: OTHER_STUDENT, room_id: ROOM });
  db.tables.room_modules = [{ id: ROOM, room_id: ROOM, module_id: MODULE, targeting_mode: "selected_students" }];
  db.tables.room_module_recipients = [{ room_module_id: ROOM, student_id: STUDENT }];
  const module = await loadAccessiblePublishedModule(requester(STUDENT, "student"), MODULE, dependencies(db));
  assert.equal(module.assignmentId, ROOM);
  await assert.rejects(loadAccessiblePublishedModule(requester(OTHER_STUDENT, "student"), MODULE, dependencies(db)),
    (error) => error instanceof OralReadingAuthorizationError && /selected students only/.test(error.message));
  await assert.rejects(loadAccessiblePublishedModule(requester(OTHER_STUDENT, "student"), MODULE, dependencies(db), { roomId: ROOM, assignmentId: ROOM }),
    OralReadingAuthorizationError);
});

test("before the recipients migration, whole-class rows never query recipients", async () => {
  const db = createDatabase();
  db.tables.room_modules = [{ id: ROOM, room_id: ROOM, module_id: MODULE }];
  const module = await loadAccessiblePublishedModule(requester(STUDENT, "student"), MODULE, dependencies(db));
  assert.equal(module.assignmentId, ROOM, "room_module_recipients does not exist and is not read");
  db.tables.room_modules = [{ id: ROOM, room_id: ROOM, module_id: MODULE, targeting_mode: "whole_class" }];
  assert.equal((await loadAccessiblePublishedModule(requester(STUDENT, "student"), MODULE, dependencies(db))).assignmentId, ROOM);
});
