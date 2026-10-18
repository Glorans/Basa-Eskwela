const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createDatabase, material } = require("./fixtures/materialDatabase");

const STUDENT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const MATERIAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ASSIGNMENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROOM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MODULE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PASSAGE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const owner = { user: { id: STUDENT }, profile: { role: "student" } };
const context = { materialId: MATERIAL, activityAssignmentId: ASSIGNMENT, roomId: ROOM };

function fixture() {
  const db = createDatabase({
    profiles: [{ id: STUDENT, role: "student", full_name: "Reader" }],
    rooms: [{ id: ROOM, teacher_id: OTHER }],
    enrollments: [{ room_id: ROOM, student_id: STUDENT }],
    reading_activity_assignments: [{ id: ASSIGNMENT, material_id: MATERIAL, room_id: ROOM, student_id: STUDENT, status: "completed" }],
    uploaded_materials: [material(MATERIAL, OTHER)],
    oral_reading_attempts: [], m6_comprehension_attempts: [], m6_comprehension_responses: [],
    modules: [{ id: MODULE, title: "Module story", path_id: ROOM, status: "published", deleted_at: null }],
    module_passages: [{ id: PASSAGE, module_id: MODULE, title: "Passage", passage_text: "Reviewed reading text." }],
    learning_paths: [{ id: ROOM, path_name: "English", language: "en" }],
    room_modules: [{ id: ASSIGNMENT, module_id: MODULE, room_id: ROOM }],
  });
  const from = db.from.bind(db);
  db.from = table => {
    const q = from(table);
    q.is = function (column, value) { this.filters.push(row => (row[column] ?? null) === value); return this; };
    const execute = q.execute.bind(q);
    q.execute = async function () {
      if (this.action !== "insert") return execute();
      const rows = db.tables[table];
      if (rows.some(row => row.user_id === this.payload.user_id && (
        row.submission_id === this.payload.submission_id ||
        (this.payload.oral_reading_attempt_id && row.oral_reading_attempt_id === this.payload.oral_reading_attempt_id)
      ))) return { error: { code: "23505" }, data: null };
      const row = { id: randomUUID(), status: "in_progress", completed_at: null, ...this.payload };
      rows.push(row);
      return { error: null, data: { ...row } };
    };
    return q;
  };
  return db;
}

function addQuestions(db, moduleSource = false) {
  for (const type of ["literal", "inferential", "critical"]) {
    const id = randomUUID();
    db.tables.comprehension_questions.push({ id, material_id: moduleSource ? null : MATERIAL,
      module_id: moduleSource ? MODULE : null, passage_id: moduleSource ? PASSAGE : null,
      question_type: type, question_text: `Fixture ${type} question`,
      options: ["A", "B", "C", "D"], scaffolding_hint: "Read the details again.", review_status: "reviewed", display_order: 1 });
    db.tables.comprehension_question_answers.push({ question_id: id, correct_answer: "A",
      answer_explanation: "Fixture explanation", supporting_evidence: "Reviewed reading text." });
  }
}

test("assigned-story M5/M6 integration (isolated database; no live records)", async t => {
  let db = fixture();
  t.mock.method(require("../services/supabaseAdmin"), "getSupabaseAdmin", () => db);
  const { loadAssignedReadingSource } = require("../services/assignedReadingSource");
  const { createOralReadingAttempt, getOralReadingAttempt, listOwnOralReadingAttempts,
    listTeacherOralReadingAttempts, getTeacherOralReadingAttempt } = require("../services/oralReadingAttemptService");
  const { startComprehensionAttempt, getComprehensionAttempt, loadReviewedQuestions } = require("../services/comprehensionAttemptService");
  const { applyComprehensionAction } = require("../services/comprehensionActionService");
  const deps = { getSupabaseAdmin: () => db };
  async function oral() {
    const source = await loadAssignedReadingSource(owner, MATERIAL, context, deps);
    return createOralReadingAttempt(owner, { ...context, submissionId: randomUUID(), passageRevision: source.passageRevision,
      transcript: source.passage, durationSeconds: 10, pronunciationAccuracy: 1, wordMetrics: [], sttConfidence: 0.9 }, deps);
  }
  const start = reading => ({ ...context, oralReadingAttemptId: reading.id, submissionId: randomUUID() });

  await t.test("saved material language aliases persist across M5, M6 and reopened results without editing questions", async () => {
    try {
      for (const language of ["en", "English", "fil", "Filipino", "Tagalog", "fil-PH", "tl", "TL-ph"]) {
        db = fixture();
        db.tables.uploaded_materials[0].language = language;
        addQuestions(db);
        const reviewed = structuredClone([db.tables.comprehension_questions, db.tables.comprehension_question_answers]);
        const expected = ["en", "English"].includes(language) ? "en" : "fil";
        const source = await loadAssignedReadingSource(owner, MATERIAL, context, deps);
        assert.equal(source.language, expected);
        const saved = await oral();
        assert.equal(saved.language, expected);
        assert.equal((await getOralReadingAttempt(owner, saved.id, deps)).language, expected);
        const comprehension = await startComprehensionAttempt(owner, start(saved));
        assert.equal(comprehension.language, expected);
        assert.equal((await getComprehensionAttempt(owner, comprehension.id)).language, expected);
        assert.deepEqual([db.tables.comprehension_questions, db.tables.comprehension_question_answers], reviewed);
      }
    } finally { db = fixture(); }
  });

  await t.test("explicit oral-only mode comes from the authorized assignment and rejects comprehension", async () => {
    db.tables.reading_activity_assignments[0].read_aloud_only = true;
    try {
      const source = await loadAssignedReadingSource(owner, MATERIAL, { ...context, readAloudOnly: false }, deps);
      assert.equal(source.readAloudOnly, true);
      const saved = await oral();
      assert.equal(saved.readAloudOnly, true);
      const result = await getOralReadingAttempt(owner, saved.id, deps);
      assert.equal(result.readAloudOnly, true);
      assert.equal(result.readAloudCompleted, true);
      const retry = await createOralReadingAttempt(owner, { ...context,
        submissionId: db.tables.oral_reading_attempts[0].submission_id, readAloudOnly: false }, deps);
      assert.equal(retry.id, saved.id);
      assert.equal(retry.readAloudOnly, true);
      await assert.rejects(startComprehensionAttempt(owner, { ...start(saved), readAloudOnly: false }), /read-aloud only/);
      await assert.rejects(getOralReadingAttempt({ ...owner, user: { id: OTHER } }, saved.id, deps), { statusCode: 403 });
    } finally {
      db = fixture();
    }
  });

  await t.test("correct material identity and existing completed classroom status are preserved", async () => {
    const before = structuredClone(db.tables.reading_activity_assignments);
    const saved = await oral();
    assert.equal(saved.moduleId, null);
    assert.equal(saved.materialId, MATERIAL);
    assert.equal(saved.activityAssignmentId, ASSIGNMENT);
    assert.equal(saved.pronunciationAccuracy, 100); // computed, not the submitted fake score
    assert.equal(saved.transcript, "Reviewed reading text.");
    assert.deepEqual(db.tables.reading_activity_assignments, before);
    assert.equal((await getOralReadingAttempt(owner, saved.id, deps)).passageSnapshot, saved.transcript);
    assert.equal((await listOwnOralReadingAttempts(owner, undefined, deps, context)).length, 1);
  });
  await t.test("foreign students, unenrolled students, independent learners and mixed IDs are denied", async () => {
    for (const requester of [{ ...owner, user: { id: OTHER } }, { ...owner, profile: { role: "general_user" } }]) {
      await assert.rejects(loadAssignedReadingSource(requester, MATERIAL, context, deps), { statusCode: 403 });
    }
    await assert.rejects(loadAssignedReadingSource(owner, MATERIAL, { ...context, moduleId: MODULE }, deps), { statusCode: 403 });
    await assert.rejects(loadAssignedReadingSource(owner, MATERIAL, { ...context, activityAssignmentId: ROOM }, deps), { statusCode: 403 });
    await assert.rejects(loadAssignedReadingSource(owner, MATERIAL, { ...context, roomId: OTHER }, deps), { statusCode: 403 });
    const enrollments = db.tables.enrollments;
    db.tables.enrollments = [];
    await assert.rejects(loadAssignedReadingSource(owner, MATERIAL, context, deps), { statusCode: 403 });
    db.tables.enrollments = enrollments;
  });
  await t.test("changed text cannot be saved against a recording of an older story", async () => {
    await assert.rejects(createOralReadingAttempt(owner, { ...context, passageRevision: "old", transcript: "old", durationSeconds: 5 }, deps), { statusCode: 409 });
  });
  await t.test("empty, unextracted and unsupported-language stories are unavailable", async () => {
    const source = db.tables.uploaded_materials[0];
    for (const change of [{ content_text: " " }, { extraction_status: "processing" }, { language: "Spanish" }]) {
      db.tables.uploaded_materials[0] = { ...source, ...change };
      await assert.rejects(loadAssignedReadingSource(owner, MATERIAL, context, deps), { statusCode: 422 });
    }
    db.tables.uploaded_materials[0] = source;
  });
  await t.test("M5 duplicate retries reuse the result and conflicting source IDs fail", async () => {
    const source = await loadAssignedReadingSource(owner, MATERIAL, context, deps);
    const input = { ...context, passageRevision: source.passageRevision, transcript: source.passage, durationSeconds: 5, submissionId: randomUUID() };
    const saved = await createOralReadingAttempt(owner, input, deps);
    assert.equal((await createOralReadingAttempt(owner, input, deps)).id, saved.id);
    await assert.rejects(createOralReadingAttempt(owner, { ...input, materialId: OTHER }, deps), { statusCode: 409 });
  });
  await t.test("existing teacher review scope includes uploaded-story transcripts", async () => {
    const teacher = { user: { id: OTHER }, profile: { role: "teacher" } };
    const saved = await oral();
    assert.ok((await listTeacherOralReadingAttempts(teacher, deps)).some(row => row.id === saved.id));
    assert.equal((await getTeacherOralReadingAttempt(teacher, saved.id, deps)).transcript, saved.transcript);
    await assert.rejects(getTeacherOralReadingAttempt({ user: { id: STUDENT } }, saved.id, deps), { statusCode: 404 });
  });
  await t.test("missing material questions never substitute an unrelated module bank", async () => {
    addQuestions(db, true);
    const reading = await oral();
    await assert.rejects(startComprehensionAttempt(owner, start(reading)), /Comprehension is not available yet/);
    assert.equal(db.tables.m6_comprehension_attempts.length, 0);
  });
  await t.test("all three reviewed categories are required and mismatched evidence is rejected", async () => {
    addQuestions(db);
    const materialQuestions = db.tables.comprehension_questions.filter(q => q.material_id === MATERIAL);
    materialQuestions[2].review_status = "generated";
    await assert.rejects(loadReviewedQuestions(null, null, "Reviewed reading text.", MATERIAL), /literal, inferential, and critical/);
    materialQuestions[2].review_status = "reviewed";
    const answer = db.tables.comprehension_question_answers.find(a => a.question_id === materialQuestions[0].id);
    answer.supporting_evidence = "Another story";
    await assert.rejects(loadReviewedQuestions(null, null, "Reviewed reading text.", MATERIAL), /does not match/);
    answer.supporting_evidence = "Reviewed reading text.";
  });
  await t.test("M6 requires the exact owner, oral result, story text, room and assignment", async () => {
    const reading = await oral();
    await assert.rejects(startComprehensionAttempt(owner, { ...start(reading), oralReadingAttemptId: ROOM }), { statusCode: 403 });
    const source = db.tables.uploaded_materials[0];
    source.content_text = "Changed story.";
    await assert.rejects(startComprehensionAttempt(owner, start(reading)), /story changed/);
    source.content_text = "Reviewed reading text.";
    await assert.rejects(startComprehensionAttempt({ ...owner, user: { id: OTHER } }, start(reading)), { statusCode: 403 });
  });
  await t.test("M6 stores exact passage and separate state; hides answers and feedback until resolved", async () => {
    const reading = await oral();
    const input = start(reading);
    const saved = await startComprehensionAttempt(owner, input);
    assert.equal(saved.materialId, MATERIAL);
    assert.equal(saved.passageText, reading.passageSnapshot);
    assert.equal(saved.status, "in_progress");
    assert.equal(db.tables.reading_activity_assignments[0].status, "completed");
    assert.deepEqual(saved.questions.map(q => q.type).sort(), ["critical", "inferential", "literal"]);
    for (const question of saved.questions) {
      assert.equal(question.correctOptionIndex, null);
      assert.equal(question.answerExplanation, null);
      assert.equal(question.supportingEvidence, null);
      assert.equal(question.hint, null);
    }
    const q = saved.questions[0];
    db.tables.m6_comprehension_responses.push({ attempt_id: saved.id, question_id: q.id,
      hint_used: true, resolved: false, first_option_index: 1, first_answer_correct: false });
    let reopened = await getComprehensionAttempt(owner, saved.id);
    assert.equal(reopened.questions[0].hint, "Read the details again.");
    assert.equal(reopened.questions[0].correctOptionIndex, null);
    db.tables.m6_comprehension_responses[0].resolved = true;
    reopened = await getComprehensionAttempt(owner, saved.id);
    assert.equal(reopened.questions[0].correctOptionIndex, 0);
    assert.equal(reopened.questions[0].answerExplanation, "Fixture explanation");
    assert.equal(reopened.questions[0].supportingEvidence, "Reviewed reading text.");
    assert.equal((await startComprehensionAttempt(owner, input)).id, saved.id);
    assert.equal((await startComprehensionAttempt(owner, start(reading))).id, saved.id);
    await assert.rejects(startComprehensionAttempt(owner, { ...input, materialId: OTHER }), { statusCode: 409 });
    await assert.rejects(getComprehensionAttempt({ user: { id: OTHER } }, saved.id), { statusCode: 404 });
    // Historical snapshots remain reopenable after source removal.
    const materials = db.tables.uploaded_materials;
    db.tables.uploaded_materials = [];
    assert.equal((await startComprehensionAttempt(owner, start(reading))).id, saved.id);
    assert.equal((await getOralReadingAttempt(owner, reading.id, deps)).transcript, reading.transcript);
    db.tables.uploaded_materials = materials;
  });
  await t.test("concurrent starts converge on one comprehension result", async () => {
    const reading = await oral();
    const results = await Promise.all([startComprehensionAttempt(owner, start(reading)), startComprehensionAttempt(owner, start(reading))]);
    assert.equal(results[0].id, results[1].id);
    assert.equal(db.tables.m6_comprehension_attempts.filter(a => a.oral_reading_attempt_id === reading.id).length, 1);
  });
  await t.test("hint, answer and completion keep the existing protected RPC contract", async () => {
    const reading = await oral();
    const saved = await startComprehensionAttempt(owner, start(reading));
    const calls = [];
    db.rpc = async (name, args) => { calls.push({ name, args }); return { data: { resolved: false } }; };
    for (const action of [{ action: "hint", questionId: saved.questions[0].id },
      { action: "answer", questionId: saved.questions[0].id, optionIndex: 0, requestId: randomUUID(), score: 100 }, { action: "complete" }]) {
      await applyComprehensionAction(owner, saved.id, action);
    }
    assert.deepEqual(calls.map(c => c.args.action_name), ["hint", "answer", "complete"]);
    assert.ok(calls.every(c => c.name === "m6_apply_action" && c.args.target_user === STUDENT && !("score" in c.args)));
  });
  await t.test("an assigned question set supplies exactly its reviewed questions in saved order", async () => {
    const SET = randomUUID();
    db.tables.material_question_sets.push({ id: SET, material_id: MATERIAL });
    const setQuestions = ["critical", "literal", "inferential"].map((type, index) => ({
      id: randomUUID(), material_id: MATERIAL, module_id: null, passage_id: null, question_set_id: SET,
      question_type: type, question_text: `Set ${type} question`, options: ["A", "B", "C", "D"],
      scaffolding_hint: "Look again.", review_status: "reviewed", display_order: 3 - index,
    }));
    db.tables.comprehension_questions.push(...setQuestions);
    for (const question of setQuestions) {
      db.tables.comprehension_question_answers.push({ question_id: question.id, correct_answer: "B",
        answer_explanation: null, supporting_evidence: null });
    }
    const assignment = db.tables.reading_activity_assignments[0];
    assignment.question_set_id = SET;
    try {
      assert.equal((await loadAssignedReadingSource(owner, MATERIAL, context, deps)).questionSetId, SET);
      const saved = await startComprehensionAttempt(owner, start(await oral()));
      assert.deepEqual(saved.questions.map(q => q.id), [...setQuestions].reverse().map(q => q.id));
      assert.ok(saved.questions.every(q => q.questionText.startsWith("Set ")));

      setQuestions[0].review_status = "generated";
      await assert.rejects(startComprehensionAttempt(owner, start(await oral())), { statusCode: 422, message: /not reviewed/ });
      setQuestions[0].review_status = "reviewed";

      db.tables.material_question_sets.at(-1).material_id = OTHER;
      await assert.rejects(startComprehensionAttempt(owner, start(await oral())), { statusCode: 422, message: /does not belong/ });
      db.tables.material_question_sets.at(-1).material_id = MATERIAL;
    } finally {
      assignment.question_set_id = null;
    }
    // A NULL set keeps the previous material-wide reviewed bank.
    const legacy = await startComprehensionAttempt(owner, start(await oral()));
    assert.ok(legacy.questions.some(q => q.questionText.startsWith("Fixture ")));
  });
  await t.test("standalone independent and classroom module M5/M6 still use module passages", async () => {
    for (const requester of [owner, { ...owner, profile: { role: "general_user" } }]) {
      const sourceContext = requester.profile.role === "student" ? { roomId: ROOM, assignmentId: ASSIGNMENT } : {};
      const reading = await createOralReadingAttempt(requester, { moduleId: MODULE, passageId: PASSAGE,
        ...sourceContext, transcript: "Reviewed reading text.", durationSeconds: 5, submissionId: randomUUID() }, deps);
      const saved = await startComprehensionAttempt(requester, { moduleId: MODULE, passageId: PASSAGE,
        ...sourceContext, oralReadingAttemptId: reading.id, submissionId: randomUUID() });
      assert.equal(saved.moduleId, MODULE);
      assert.equal(saved.passageId, PASSAGE);
      assert.equal(saved.materialId, null);
    }
  });
});
