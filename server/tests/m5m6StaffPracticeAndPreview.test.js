const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const express = require("express");

// Appendix N M5 F1-F7 / M6 F1-F4 for the System Admin, School Admin scope (their school + platform), and M6 F5 Preview
// for every role, through the real services against an in-memory database. No Supabase, no network, no paid calls.
const SCHOOL_1 = "00000000-0000-4000-8000-00000000c001";
const SCHOOL_2 = "00000000-0000-4000-8000-00000000c002";
const U = {
  sa: "10000000-0000-4000-8000-000000000001", admin1: "10000000-0000-4000-8000-000000000002",
  admin2: "10000000-0000-4000-8000-000000000003", teacher1: "10000000-0000-4000-8000-000000000004",
  teacher2: "10000000-0000-4000-8000-000000000005", pending: "10000000-0000-4000-8000-000000000006",
  student1: "10000000-0000-4000-8000-000000000007", student2: "10000000-0000-4000-8000-000000000008",
  learner: "10000000-0000-4000-8000-000000000009", noSchoolAdmin: "10000000-0000-4000-8000-00000000000a",
};
const M = { s1: "a0000000-0000-4000-8000-000000000001", s2: "a0000000-0000-4000-8000-000000000002",
  platform: "a0000000-0000-4000-8000-000000000003", draft: "a0000000-0000-4000-8000-000000000004" };
const P = { s1: "b0000000-0000-4000-8000-000000000001", s2: "b0000000-0000-4000-8000-000000000002",
  platform: "b0000000-0000-4000-8000-000000000003", draft: "b0000000-0000-4000-8000-000000000004" };
const ROOM_1 = "c0000000-0000-4000-8000-000000000001";
const PATH = "d0000000-0000-4000-8000-000000000001";
const STORY = "Every Saturday, Ben visited Mrs. Santos.";
const UNIQUE = { m6_comprehension_attempts: [["user_id", "submission_id"], ["user_id", "oral_reading_attempt_id"]] };
const ANSWER_FIELDS = ["correctOptionIndex", "correct_answer", "correctAnswer", "answerExplanation", "answer_explanation",
  "supportingEvidence", "supporting_evidence", "scaffoldingHint", "scaffolding_hint", "hint"];

function database(tables) {
  class Query {
    constructor(table) { Object.assign(this, { table, filters: [], action: "select", mode: null, max: undefined }); }
    select() { return this; }
    insert(row) { this.action = "insert"; this.row = row; return this; }
    update(row) { this.action = "update"; this.row = row; return this; }
    eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
    is(column, value) { this.filters.push((row) => (row[column] ?? null) === value); return this; }
    in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
    order(column, { ascending = true } = {}) { this.sort = { column, ascending }; return this; }
    range(start, end) { this.window = [start, end + 1]; return this; }
    limit(value) { this.max = value; return this; }
    maybeSingle() { this.mode = "maybe"; return this; }
    single() { this.mode = "one"; return this; }
    then(resolve, reject) { return this.run().then(resolve, reject); }
    async run() {
      tables.reads.push([this.action, this.table]);
      const rows = tables[this.table] ??= [];
      if (this.action === "insert") {
        for (const keys of UNIQUE[this.table] ?? []) {
          if (keys.every((key) => this.row[key] != null)
            && rows.some((row) => keys.every((key) => row[key] === this.row[key]))) return { data: null, error: { code: "23505" } };
        }
        const saved = { id: randomUUID(), created_at: new Date().toISOString(), status: "in_progress", ...this.row };
        rows.push(saved);
        return { data: { ...saved }, error: null };
      }
      let found = rows.filter((row) => this.filters.every((filter) => filter(row)));
      if (this.action === "update") { found.forEach((row) => Object.assign(row, this.row)); return { data: found, error: null }; }
      if (this.sort) {
        const { column, ascending } = this.sort;
        found = [...found].sort((a, b) => (a[column] > b[column] ? 1 : -1) * (ascending ? 1 : -1));
      }
      if (this.window) found = found.slice(...this.window);
      if (this.max !== undefined) found = found.slice(0, this.max);
      if (this.mode === "one") return found.length === 1 ? { data: { ...found[0] }, error: null } : { data: null, error: { code: "PGRST116" } };
      if (this.mode) return { data: found[0] ? { ...found[0] } : null, error: null };
      return { data: found.map((row) => ({ ...row })), error: null };
    }
  }
  return { tables, from: (table) => new Query(table), rpc: async (...args) => { tables.rpcCalls.push(args); return { data: { completed: true }, error: null }; } };
}

function seed() {
  const modules = [
    { id: M.s1, created_by: U.teacher1 }, { id: M.s2, created_by: U.teacher2 }, { id: M.platform, created_by: U.sa },
    { id: M.draft, created_by: U.teacher1, status: "draft" },
  ].map((row) => ({ path_id: PATH, title: `Module ${row.id.slice(-1)}`, difficulty: "Easy", status: "published", passage: STORY, deleted_at: null, ...row }));
  const passages = Object.keys(M).map((k) => ({ id: P[k], module_id: M[k], title: `Passage ${k}`, passage_text: STORY, display_order: 1 }));
  // Saved out of category order on purpose: an assessment (and its preview) presents Literal, Inferential, Critical.
  const questions = Object.keys(M).flatMap((k) => ["critical", "literal", "inferential", "literal", "inferential", "critical"].map((type, index) => ({
    id: randomUUID(), module_id: M[k], passage_id: P[k], material_id: null, question_set_id: null, question_type: type,
    question_text: `${k} ${type} question ${index + 1}?`, options: ["A", "B", "C", "D"], scaffolding_hint: "Think about the story.",
    review_status: "reviewed", display_order: index + 1,
  })));
  return database({
    profiles: [
      { id: U.sa, role: "system_admin", school_id: null }, { id: U.admin1, role: "admin", school_id: SCHOOL_1 },
      { id: U.admin2, role: "admin", school_id: SCHOOL_2 }, { id: U.teacher1, role: "teacher", teacher_status: "approved", school_id: SCHOOL_1 },
      { id: U.teacher2, role: "teacher", teacher_status: "approved", school_id: SCHOOL_2 },
      { id: U.pending, role: "teacher", teacher_status: "pending", school_id: SCHOOL_1 },
      { id: U.student1, role: "student", school_id: SCHOOL_1 }, { id: U.student2, role: "student", school_id: SCHOOL_2 },
      { id: U.learner, role: "general_user", school_id: null }, { id: U.noSchoolAdmin, role: "admin", school_id: null },
    ].map((row) => ({ full_name: "Synthetic", nickname: "S", teacher_status: null, ...row })),
    modules, module_passages: passages,
    learning_paths: [{ id: PATH, path_name: "English Easy", language: "English" }],
    comprehension_questions: questions,
    comprehension_question_answers: questions.map((q) => ({ question_id: q.id, correct_answer: "B", answer_explanation: "Ben visited every Saturday.", supporting_evidence: "Every Saturday" })),
    enrollments: [{ room_id: ROOM_1, student_id: U.student1 }],
    room_modules: [{ id: randomUUID(), room_id: ROOM_1, module_id: M.s1, removed_at: null }],
    rooms: [{ id: ROOM_1, teacher_id: U.teacher1, archived_at: null }],
    oral_reading_attempts: [], m6_comprehension_attempts: [], m6_comprehension_responses: [], rpcCalls: [], reads: [],
  });
}

let current;
const supabase = require("../services/supabaseAdmin");
test.mock.method(supabase, "getSupabaseAdmin", () => current);
test.mock.method(supabase, "getAuthenticatedSupabaseUser", async (req) => {
  const id = (req.get?.("authorization") ?? req.headers?.authorization ?? "").replace(/^Bearer /, "");
  if (!id) throw new supabase.SupabaseAuthenticationError();
  return { id };
});
const m5 = require("../services/oralReadingAttemptService");
const list = require("../services/adminOralReadingService");
const m6 = require("../services/comprehensionAttemptService");
const { applyComprehensionAction } = require("../services/comprehensionActionService");
const as = (id) => ({ get: (name) => (name.toLowerCase() === "authorization" ? `Bearer ${id}` : undefined), headers: { authorization: `Bearer ${id}` } });
const who = async (id) => m5.authorizeReadingPracticeRequest(as(id));
const deps = () => ({ getSupabaseAdmin: () => current });
const hasAnswerField = (value) => JSON.stringify(value, (key, v) => { if (ANSWER_FIELDS.includes(key)) throw new Error(`leaked ${key}`); return v; }) && false;

test("the System Admin is admitted to M5/M6 reading practice; learner-only classroom checks still refuse staff", async () => {
  current = seed();
  for (const id of [U.sa, U.admin1, U.teacher1, U.student1, U.learner]) {
    assert.equal((await who(id)).user.id, id);
    assert.equal((await m6.authorizeComprehensionRequest(as(id))).user.id, id);
  }
  await assert.rejects(who(U.pending), { statusCode: 403 });
  for (const id of [U.sa, U.admin1, U.teacher1]) await assert.rejects(m5.authorizeOralReadingRequest(as(id)), { statusCode: 403 });
});

test("practice catalog: System Admin every school + platform; School Admin and Teacher their school + platform", async () => {
  current = seed();
  const ids = async (id) => (await list.listPracticeReadingPassages(await who(id), deps())).map((row) => row.moduleId).sort();
  assert.deepEqual(await ids(U.sa), [M.s1, M.s2, M.platform].sort());
  assert.deepEqual(await ids(U.admin1), [M.s1, M.platform].sort());
  assert.deepEqual(await ids(U.admin2), [M.s2, M.platform].sort());
  assert.deepEqual(await ids(U.teacher1), [M.s1, M.platform].sort());
  assert.deepEqual(await ids(U.teacher2), [M.s2, M.platform].sort());
  assert.deepEqual((await list.listAdminReadingPassages(await who(U.sa), deps())).map((row) => row.moduleId).sort(), [M.s1, M.s2, M.platform].sort());
  for (const id of [U.student1, U.learner]) await assert.rejects(list.listPracticeReadingPassages(await who(id), deps()), { statusCode: 403 });
  await assert.rejects(list.listPracticeReadingPassages(await who(U.noSchoolAdmin), deps()), { statusCode: 403, message: /not assigned to a school/ });
});

test("module access: cross-school refused both ways; drafts and classroom contexts refused for every staff role", async () => {
  current = seed();
  const open = async (id, moduleId, context = {}) => m5.loadAccessiblePublishedModule(await who(id), moduleId, deps(), context);
  for (const moduleId of [M.s1, M.s2, M.platform]) assert.equal((await open(U.sa, moduleId)).id, moduleId);
  assert.equal((await open(U.admin1, M.s1)).id, M.s1);
  assert.equal((await open(U.admin1, M.platform)).id, M.platform);
  await assert.rejects(open(U.admin1, M.s2), { statusCode: 404, code: "MODULE_NOT_FOUND" });
  await assert.rejects(open(U.admin2, M.s1), { statusCode: 404, code: "MODULE_NOT_FOUND" });
  await assert.rejects(open(U.teacher2, M.s1), { statusCode: 404, code: "MODULE_NOT_FOUND" });
  for (const id of [U.sa, U.admin1, U.teacher1]) {
    await assert.rejects(open(id, M.draft), { statusCode: 403 });
    await assert.rejects(open(id, M.s1, { roomId: ROOM_1 }), { statusCode: 403 });
  }
  await assert.rejects(open(U.noSchoolAdmin, M.platform), { statusCode: 403, message: /not assigned to a school/ });
});

test("System Admin: M5 reading -> M6 assessment on the same module and passage -> completion -> own results only", async () => {
  current = seed();
  const sa = await who(U.sa);
  const reading = await m5.createOralReadingAttempt(sa, { moduleId: M.s2, passageId: P.s2, submissionId: randomUUID(),
    transcript: "Every Saturday Ben visited Mrs Santos", durationSeconds: 6 }, deps());
  assert.deepEqual([reading.userId, reading.moduleId, reading.passageId, reading.roomId ?? null], [U.sa, M.s2, P.s2, null]);
  assert.equal(reading.pronunciationAccuracy, 100, "the same server-side scoring as for learners");
  const attempt = await m6.startComprehensionAttempt(sa, { moduleId: M.s2, passageId: P.s2, oralReadingAttemptId: reading.id, submissionId: randomUUID() });
  assert.deepEqual([attempt.moduleId, attempt.passageId, attempt.oralReadingAttemptId], [M.s2, P.s2, reading.id]);
  assert.deepEqual(attempt.questions.map((q) => q.type), ["literal", "literal", "inferential", "inferential", "critical", "critical"]);
  const done = await applyComprehensionAction(sa, attempt.id, { action: "complete" });
  assert.deepEqual(done.outcome, { completed: true });
  assert.deepEqual(current.tables.rpcCalls.map(([name, args]) => [name, args.target_user, args.action_name]), [["m6_apply_action", U.sa, "complete"]]);
  // Own results only: nobody else can open them.
  for (const id of [U.admin2, U.teacher2]) {
    await assert.rejects(m5.getOralReadingAttempt(await who(id), reading.id, deps()), { statusCode: 403 });
    await assert.rejects(m6.getComprehensionAttempt(await who(id), attempt.id), { statusCode: 404 });
  }
  // A second comprehension for the same passage reopens the same activity (one try per passage, as for every account).
  const second = await m5.createOralReadingAttempt(sa, { moduleId: M.s2, passageId: P.s2, submissionId: randomUUID(), transcript: "Every Saturday", durationSeconds: 3 }, deps());
  const again = await m6.startComprehensionAttempt(sa, { moduleId: M.s2, passageId: P.s2, oralReadingAttemptId: second.id, submissionId: randomUUID() });
  assert.equal(again.id, attempt.id);
  assert.equal(current.tables.m6_comprehension_attempts.length, 1);
  // Practice History: the System Admin's own readings only (both readings of this module), never another account's.
  const history = await m5.listOwnOralReadingAttempts(sa, undefined, deps(), {});
  assert.deepEqual(history.map((row) => row.id).sort(), [reading.id, second.id].sort());
  assert.deepEqual(await m5.listOwnOralReadingAttempts(await who(U.admin2), undefined, deps(), {}), []);
});

test("School Admin: practises a Teacher's module of their school end to end; another school's module is refused", async () => {
  current = seed();
  const admin = await who(U.admin1);
  const reading = await m5.createOralReadingAttempt(admin, { moduleId: M.s1, passageId: P.s1, submissionId: randomUUID(), transcript: "Every Saturday Ben", durationSeconds: 3 }, deps());
  const attempt = await m6.startComprehensionAttempt(admin, { moduleId: M.s1, passageId: P.s1, oralReadingAttemptId: reading.id, submissionId: randomUUID() });
  assert.equal(attempt.moduleId, M.s1);
  await assert.rejects(m5.createOralReadingAttempt(admin, { moduleId: M.s2, passageId: P.s2, submissionId: randomUUID(), transcript: "x", durationSeconds: 1 }, deps()), { statusCode: 404 });
  await assert.rejects(m6.startComprehensionAttempt(admin, { moduleId: M.s2, passageId: P.s2, submissionId: randomUUID() }), { statusCode: 404 });
});

test("M6 F5 preview: questions, choices and categories in assessment order; no answer field; nothing created", async () => {
  current = seed();
  for (const [id, moduleId, passageId] of [[U.sa, M.s2, P.s2], [U.admin1, M.s1, P.s1], [U.teacher2, M.s2, P.s2], [U.learner, M.platform, P.platform],
    [U.student1, M.s1, P.s1], [U.student1, M.platform, P.platform]]) {
    const before = [current.tables.oral_reading_attempts.length, current.tables.m6_comprehension_attempts.length, current.tables.m6_comprehension_responses.length];
    const preview = await m6.previewComprehensionAssessment(await who(id), { moduleId, passageId });
    assert.deepEqual([preview.moduleId, preview.passageId], [moduleId, passageId], "the exact module and passage");
    assert.deepEqual(preview.questions.map((q) => q.type), ["literal", "literal", "inferential", "inferential", "critical", "critical"]);
    assert.ok(preview.questions.every((q) => q.questionText.startsWith(Object.keys(P).find((k) => P[k] === passageId)) && q.options.length === 4));
    assert.deepEqual(Object.keys(preview.questions[0]).sort(), ["id", "options", "questionText", "type"]);
    assert.equal(hasAnswerField(preview), false);
    assert.deepEqual([current.tables.oral_reading_attempts.length, current.tables.m6_comprehension_attempts.length, current.tables.m6_comprehension_responses.length], before);
    assert.equal(current.tables.reads.some(([action]) => action !== "select"), false, "the preview only reads");
  }
});

test("M6 F5 preview follows the start rule: cross-school, drafts, unassigned classrooms and pending Teachers refused", async () => {
  current = seed();
  const preview = async (id, query) => m6.previewComprehensionAssessment(await who(id), query);
  await assert.rejects(preview(U.admin1, { moduleId: M.s2, passageId: P.s2 }), { statusCode: 404 });
  await assert.rejects(preview(U.teacher1, { moduleId: M.s2, passageId: P.s2 }), { statusCode: 404 });
  await assert.rejects(preview(U.student1, { moduleId: M.s2, passageId: P.s2 }), { statusCode: 404 }, "a School 1 Student never previews School 2");
  await assert.rejects(preview(U.student2, { moduleId: M.s1, passageId: P.s1 }), { statusCode: 404 });
  await assert.rejects(preview(U.sa, { moduleId: M.draft, passageId: P.draft }), { statusCode: 403 });
  await assert.rejects(preview(U.student1, { moduleId: M.s1, passageId: P.s1, roomId: "c0000000-0000-4000-8000-0000000000ff" }), { statusCode: 403 });
  await assert.rejects(m6.previewComprehensionAssessment({ user: { id: U.pending }, profile: { id: U.pending, role: "teacher", teacher_status: "pending" } }, { moduleId: M.s1, passageId: P.s1 }), { statusCode: 403 });
  await assert.rejects(preview(U.sa, { moduleId: "not-a-uuid" }), { statusCode: 400 });
});

test("HTTP GET /api/comprehension/preview: no-store, answers never sent, unauthenticated refused", async () => {
  current = seed();
  const app = express();
  app.use("/api/comprehension", require("../routes/comprehension"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/comprehension/preview?moduleId=${M.s1}&passageId=${P.s1}`;
    const ok = await fetch(url, { headers: { authorization: `Bearer ${U.student1}` } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store");
    const text = await ok.text();
    for (const field of ANSWER_FIELDS) assert.equal(text.includes(`"${field}"`), false, field);
    assert.equal(text.includes("Ben visited every Saturday."), false, "no explanation text");
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { authorization: `Bearer ${U.student2}` } })).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
