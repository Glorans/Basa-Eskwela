// M4 archived rooms at the API: the real M5/M6 services against an isolated in-memory database.
// Saving is refused for an archived room's activities on every request; reading stays open.
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createDatabase, material } = require("./fixtures/materialDatabase");
const { isArchivedRoomDatabaseError, isRoomArchived } = require("../services/roomArchive");

const STUDENT = "11111111-1111-4111-8111-111111111111";
const TEACHER = "22222222-2222-4222-8222-222222222222";
const MATERIAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTIVITY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROOM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ACTIVITY2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const owner = { user: { id: STUDENT }, profile: { role: "student" } };
const current = { db: null };
const context = { materialId: MATERIAL, activityAssignmentId: ACTIVITY, roomId: ROOM };

function fixture() {
  const db = createDatabase({
    profiles: [{ id: STUDENT, role: "student", full_name: "Reader" }],
    rooms: [{ id: ROOM, teacher_id: TEACHER, archived_at: null }],
    enrollments: [{ id: "enrollment-1", room_id: ROOM, student_id: STUDENT }],
    reading_activity_assignments: [{ id: ACTIVITY, material_id: MATERIAL, room_id: ROOM, student_id: STUDENT, status: "assigned" },
      { id: ACTIVITY2, material_id: MATERIAL, room_id: ROOM, student_id: STUDENT, status: "assigned" }],
    uploaded_materials: [material(MATERIAL, TEACHER)],
    oral_reading_attempts: [], m6_comprehension_attempts: [], m6_comprehension_responses: [],
  });
  const from = db.from.bind(db);
  db.from = (table) => {
    const q = from(table);
    q.is = function (column, value) { this.filters.push((row) => (row[column] ?? null) === value); return this; };
    const execute = q.execute.bind(q);
    q.execute = async function () {
      if (this.action !== "insert") return execute();
      const row = { id: randomUUID(), status: "in_progress", completed_at: null, ...this.payload };
      db.tables[table].push(row);
      return { error: null, data: { ...row } };
    };
    return q;
  };
  // Stand-in for the protected m6_apply_action: records the answer or completes the assessment.
  db.rpc = async (name, args) => {
    if (name !== "m6_apply_action") return { data: null, error: { code: "42883" } };
    const attempt = db.tables.m6_comprehension_attempts.find((row) => row.id === args.target_attempt);
    if (args.action_name === "complete") { attempt.status = "completed"; attempt.completed_at = new Date().toISOString(); return { data: { completed: true }, error: null }; }
    db.tables.m6_comprehension_responses.push({ id: randomUUID(), attempt_id: args.target_attempt, question_id: args.target_question,
      first_option_index: args.selected_option, first_answer_correct: true, resolved: true, answer_history: [{ requestId: args.request_id, optionIndex: args.selected_option }] });
    return { data: { correct: true }, error: null };
  };
  return db;
}
function addQuestions(db) {
  for (const type of ["literal", "inferential", "critical"]) {
    const id = randomUUID();
    db.tables.comprehension_questions.push({ id, material_id: MATERIAL, module_id: null, passage_id: null, question_type: type,
      question_text: `Fixture ${type} question`, options: ["A", "B", "C", "D"], scaffolding_hint: "Read again.", review_status: "reviewed", display_order: 1 });
    db.tables.comprehension_question_answers.push({ question_id: id, correct_answer: "A", answer_explanation: "Because.", supporting_evidence: "Reviewed reading text." });
  }
}

test("roomArchive helpers", async () => {
  const fake = (result) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }) });
  assert.equal(await isRoomArchived(fake({ data: { archived_at: "2026-11-08T00:00:00Z" }, error: null }), ROOM), true);
  assert.equal(await isRoomArchived(fake({ data: { archived_at: null }, error: null }), ROOM), false);
  assert.equal(await isRoomArchived(fake({ data: null, error: { code: "42703" } }), ROOM), false, "before m4_room_archive: nothing is archived");
  assert.equal(await isRoomArchived(null, null), false, "Independent Learner and Admin practice have no room");
  await assert.rejects(isRoomArchived(fake({ data: null, error: { code: "08006" } }), ROOM), { statusCode: 503 }, "fails closed on a database error");
  assert.equal(isArchivedRoomDatabaseError({ code: "55000", message: "This classroom is archived. Saved results are kept" }), true);
  assert.equal(isArchivedRoomDatabaseError({ code: "55000", message: "other" }), false);
  assert.equal(isArchivedRoomDatabaseError({ code: "23505", message: "archived" }), false);
});

test("archived room: reading stays open, every save is refused, Restore re-enables it", async (t) => {
  const db = fixture();
  addQuestions(db);
  current.db = db;
  // Services keep the first mocked getSupabaseAdmin they load; it reads the current test database.
  t.mock.method(require("../services/supabaseAdmin"), "getSupabaseAdmin", () => current.db);
  const { loadAssignedReadingSource } = require("../services/assignedReadingSource");
  const { createOralReadingAttempt, getOralReadingAttempt } = require("../services/oralReadingAttemptService");
  const { saveOralReadingRecording } = require("../services/oralReadingRecordingService");
  const { startComprehensionAttempt } = require("../services/comprehensionAttemptService");
  const { applyComprehensionAction } = require("../services/comprehensionActionService");
  const deps = { getSupabaseAdmin: () => db, verifySavedReading: async () => ({ verified: false }) };
  const setArchived = (value) => { db.tables.rooms[0].archived_at = value ? "2026-11-08T00:00:00Z" : null; };
  async function read(activity = context) {
    const source = await loadAssignedReadingSource(owner, MATERIAL, activity, deps);
    return createOralReadingAttempt(owner, { ...activity, submissionId: randomUUID(), passageRevision: source.passageRevision,
      transcript: source.passage, durationSeconds: 10, pronunciationAccuracy: 1, wordMetrics: [], sttConfidence: 0.9 }, deps);
  }
  const ARCHIVED = { statusCode: 409, message: /classroom is archived/ };

  // Before the archive: a saved reading and an assessment left open after its first answer.
  const reading = await read();
  const assessment = await startComprehensionAttempt(owner, { ...context, oralReadingAttemptId: reading.id, submissionId: randomUUID() });
  const questionIds = assessment.questions.map((question) => question.id);
  await applyComprehensionAction(owner, assessment.id, { action: "answer", questionId: questionIds[0], optionIndex: 0, requestId: randomUUID() });
  // A second activity whose reading was saved before the archive, with no assessment yet.
  const context2 = { ...context, activityAssignmentId: ACTIVITY2 };
  const reading2 = await read(context2);
  const counts = () => ({ oral: db.tables.oral_reading_attempts.length, m6: db.tables.m6_comprehension_attempts.length,
    responses: db.tables.m6_comprehension_responses.length });

  setArchived(true);
  const before = counts();

  await t.test("the story still opens for silent reading, and saved results still open", async () => {
    const source = await loadAssignedReadingSource(owner, MATERIAL, context, deps);
    assert.ok(source.passage.length > 0);
    assert.equal((await getOralReadingAttempt(owner, reading.id, deps)).id, reading.id);
    const reopened = await startComprehensionAttempt(owner, { ...context, oralReadingAttemptId: reading.id, submissionId: randomUUID() });
    assert.equal(reopened.id, assessment.id, "the saved assessment reopens; nothing new is created");
  });

  await t.test("a new reading is refused with a clear message (code CLASSROOM_ARCHIVED)", async () => {
    await assert.rejects(read(), { ...ARCHIVED, code: "CLASSROOM_ARCHIVED" });
  });

  await t.test("a new comprehension assessment is refused", async () => {
    await assert.rejects(startComprehensionAttempt(owner, { ...context2, oralReadingAttemptId: reading2.id, submissionId: randomUUID() }), ARCHIVED);
  });

  await t.test("an answer or a submit from a tab opened before the archive is refused", async () => {
    await assert.rejects(applyComprehensionAction(owner, assessment.id, { action: "answer", questionId: questionIds[1], optionIndex: 0, requestId: randomUUID() }), ARCHIVED);
    await assert.rejects(applyComprehensionAction(owner, assessment.id, { action: "complete" }), ARCHIVED);
  });

  await t.test("a new recording is refused before any audio reaches storage", async () => {
    let storageUsed = false;
    const guarded = { ...deps, getSupabaseAdmin: () => new Proxy(db, { get: (target, key) => (key === "storage" ? (storageUsed = true, target.storage) : target[key]) }) };
    await assert.rejects(saveOralReadingRecording(owner, reading.id, [{ buffer: Buffer.from("x"), mimetype: "audio/webm" }], guarded), { ...ARCHIVED, code: "CLASSROOM_ARCHIVED" });
    assert.equal(storageUsed, false);
  });

  await t.test("nothing was written", async () => {
    assert.deepEqual(counts(), before);
  });

  await t.test("a write the database refuses mid-flight (archived meanwhile) gets the same clear message", async () => {
    setArchived(false);
    const from = db.from;
    db.from = (table) => {
      const q = from(table);
      if (table === "oral_reading_attempts") {
        const execute = q.execute.bind(q);
        q.execute = async function () {
          return this.action === "insert" ? { data: null, error: { code: "55000", message: "This classroom is archived. Saved results are kept" } } : execute();
        };
      }
      return q;
    };
    try { await assert.rejects(read(), { ...ARCHIVED, code: "CLASSROOM_ARCHIVED" }); } finally { db.from = from; }
  });

  await t.test("after Restore the open assessment continues and new readings save", async () => {
    setArchived(false);
    await applyComprehensionAction(owner, assessment.id, { action: "answer", questionId: questionIds[1], optionIndex: 0, requestId: randomUUID() });
    assert.equal(db.tables.m6_comprehension_responses.length, before.responses + 1);
  });
});

test("speech-to-text is refused before Azure for an archived classroom's reading; other readings still transcribe", async () => {
  const { createReadAloudAudioHandler } = require("../routes/readAloudAudio");
  const response = () => ({ headers: {}, statusCode: 200, body: undefined, locals: {}, on() {}, set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const request = (query) => ({ body: { language: "en" }, query, file: { path: "unused.wav", mimetype: "audio/wav", size: 100 }, readAloudReceivedAt: Date.now() });
  let azureCalls = 0;
  const handler = (archived) => createReadAloudAudioHandler({ remove: async () => {}, timing: () => {}, log: () => {}, recordReceipt: async () => {},
    transcribe: async () => { azureCalls += 1; return { text: "Azure text" }; }, contextArchived: async () => archived });
  const refused = response();
  await handler(true)(request({ roomId: ROOM, activityAssignmentId: ACTIVITY }), refused);
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.code, "CLASSROOM_ARCHIVED");
  assert.equal(azureCalls, 0, "no paid transcription");
  const allowed = response();
  await handler(false)(request({}), allowed);
  assert.equal(allowed.body.transcription.text, "Azure text");
  assert.equal(azureCalls, 1);
});

test("the reading context is resolved from trusted assignment rows, not only the page's roomId", async () => {
  const { isArchivedReadingContext } = require("../services/roomArchive");
  const db = fixture();
  const OTHER_ROOM = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  db.tables.rooms.push({ id: OTHER_ROOM, teacher_id: TEACHER, archived_at: null });
  db.tables.room_modules = [{ id: ACTIVITY2, room_id: ROOM, module_id: MATERIAL }];
  assert.equal(await isArchivedReadingContext(db, {}), false, "Independent Learner: no classroom context");
  assert.equal(await isArchivedReadingContext(db, { activityAssignmentId: ACTIVITY }), false, "active room");
  db.tables.rooms[0].archived_at = "2026-11-08T00:00:00Z";
  assert.equal(await isArchivedReadingContext(db, { activityAssignmentId: ACTIVITY }), true, "material assignment in the archived room");
  assert.equal(await isArchivedReadingContext(db, { assignmentId: ACTIVITY2 }), true, "module assignment in the archived room");
  assert.equal(await isArchivedReadingContext(db, { roomId: OTHER_ROOM, activityAssignmentId: ACTIVITY }), true, "a different roomId cannot hide the assignment's room");
  assert.equal(await isArchivedReadingContext(db, { roomId: OTHER_ROOM }), false, "the same story in an active room is not blocked");
});

test("the passage and the open assessment tell the page that the classroom is archived", async (t) => {
  const db = fixture();
  addQuestions(db);
  current.db = db;
  // Services keep the first mocked getSupabaseAdmin they load; it reads the current test database.
  t.mock.method(require("../services/supabaseAdmin"), "getSupabaseAdmin", () => current.db);
  const { loadAssignedReadingSource } = require("../services/assignedReadingSource");
  const { createOralReadingAttempt } = require("../services/oralReadingAttemptService");
  const { startComprehensionAttempt, getComprehensionAttempt } = require("../services/comprehensionAttemptService");
  const deps = { getSupabaseAdmin: () => db, verifySavedReading: async () => ({ verified: false }) };
  const source = await loadAssignedReadingSource(owner, MATERIAL, context, deps);
  const reading = await createOralReadingAttempt(owner, { ...context, submissionId: randomUUID(), passageRevision: source.passageRevision,
    transcript: source.passage, durationSeconds: 10, pronunciationAccuracy: 1, wordMetrics: [], sttConfidence: 0.9 }, deps);
  const assessment = await startComprehensionAttempt(owner, { ...context, oralReadingAttemptId: reading.id, submissionId: randomUUID() });
  assert.equal((await getComprehensionAttempt(owner, assessment.id)).roomArchived, false);
  db.tables.rooms[0].archived_at = "2026-11-08T00:00:00Z";
  assert.equal((await getComprehensionAttempt(owner, assessment.id)).roomArchived, true, "unfinished assessment opens read-only");

  // The passage route adds the same server flag (the page hides the recorder).
  const express = require("express");
  const { createOralReadingRouter } = require("../routes/oralReading");
  const app = express();
  app.use("/api/oral-reading", createOralReadingRouter({ authorizeOralReadingRequest: async () => owner, authorizeOralReadingPracticeRequest: async () => owner,
    getSupabaseAdmin: () => db }));
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/oral-reading/materials/${MATERIAL}?roomId=${ROOM}&activityAssignmentId=${ACTIVITY}`;
    const archived = await (await fetch(base)).json();
    assert.equal(archived.module.roomArchived, true);
    assert.ok(archived.module.passage.length > 0, "the story itself is still sent for silent reading");
    db.tables.rooms[0].archived_at = null;
    assert.equal((await (await fetch(base)).json()).module.roomArchived, false);
  } finally { server.close(); }
});
