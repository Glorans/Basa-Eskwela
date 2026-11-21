// M5/M6 Teacher reading practice: backend authorization with the REAL default wiring.
// Supabase is replaced by an in-memory fake (no network); the services are reloaded after the
// fake is installed so their imported helpers use it. Prints nothing personal.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const express = require("express");

const ADMIN = "11111111-1111-4111-8111-111111111111";
const TEACHER = "22222222-2222-4222-8222-222222222222";
const PENDING = "33333333-3333-4333-8333-333333333333";
const REJECTED = "44444444-4444-4444-8444-444444444444";
const STUDENT = "55555555-5555-4555-8555-555555555555";
const LEARNER = "66666666-6666-4666-8666-666666666666";
const OTHER_TEACHER = "77777777-7777-4777-8777-777777777777";
const ROOM = "88888888-8888-4888-8888-888888888888";
const FOREIGN_TEACHER = "99999999-9999-4999-8999-999999999999";
const MOD = {
  adminEn: "a0000000-0000-4000-8000-000000000001", teacherFil: "a0000000-0000-4000-8000-000000000002",
  draft: "a0000000-0000-4000-8000-000000000003", deleted: "a0000000-0000-4000-8000-000000000004",
  archived: "a0000000-0000-4000-8000-000000000005", unknown: "a0000000-0000-4000-8000-000000000006",
  foreign: "a0000000-0000-4000-8000-000000000007",
};

function createDb() {
  const tables = {
    profiles: [
      { id: ADMIN, role: "admin", teacher_status: null, full_name: "A", nickname: "A", school_id: "00000000-0000-4000-8000-00000000c001" },
      { id: TEACHER, role: "teacher", teacher_status: "approved", full_name: "T", nickname: "T", school_id: "00000000-0000-4000-8000-00000000c001" },
      { id: OTHER_TEACHER, role: "teacher", teacher_status: "approved", full_name: "O", nickname: "O", school_id: "00000000-0000-4000-8000-00000000c001" },
      { id: PENDING, role: "teacher", teacher_status: "pending", full_name: "P", nickname: "P", school_id: "00000000-0000-4000-8000-00000000c001" },
      { id: REJECTED, role: "teacher", teacher_status: "rejected", full_name: "R", nickname: "R", school_id: "00000000-0000-4000-8000-00000000c001" },
      { id: STUDENT, role: "student", teacher_status: null, full_name: "S", nickname: "S" },
      { id: LEARNER, role: "general_user", teacher_status: null, full_name: "L", nickname: "L" },
      { id: FOREIGN_TEACHER, role: "teacher", teacher_status: "approved", full_name: "F", nickname: "F", school_id: "00000000-0000-4000-8000-00000000c002" },
    ],
    modules: [
      { id: MOD.adminEn, path_id: "en", title: "EN by Admin", difficulty: "Easy", status: "published", passage: "The cat sat.", deleted_at: null, created_by: ADMIN },
      { id: MOD.teacherFil, path_id: "fil", title: "FIL by other Teacher", difficulty: "Easy", status: "published", passage: "Ang pusa ay umupo.", deleted_at: null, created_by: OTHER_TEACHER },
      { id: MOD.draft, path_id: "en", title: "Draft", difficulty: "Easy", status: "draft", passage: "Draft.", deleted_at: null, created_by: TEACHER },
      { id: MOD.deleted, path_id: "en", title: "Deleted", difficulty: "Easy", status: "published", passage: "Gone.", deleted_at: "2026-11-01T00:00:00Z", created_by: ADMIN },
      { id: MOD.archived, path_id: "en", title: "Archived", difficulty: "Easy", status: "archived", passage: "Old.", deleted_at: null, created_by: ADMIN },
      { id: MOD.unknown, path_id: "xx", title: "Unknown", difficulty: "Easy", status: "published", passage: "Zzz.", deleted_at: null, created_by: ADMIN },
      { id: MOD.foreign, path_id: "en", title: "EN by another school", difficulty: "Easy", status: "published", passage: "A dog ran.", deleted_at: null, created_by: FOREIGN_TEACHER },
    ],
    learning_paths: [
      { id: "en", path_name: "English Easy", language: "English" },
      { id: "fil", path_name: "Filipino Easy", language: "Filipino" },
      { id: "xx", path_name: "Other", language: "Klingon" },
    ],
    module_passages: [], enrollments: [], room_modules: [],
  };
  const touched = new Set();
  return {
    touched,
    from(table) {
      touched.add(table);
      const rows = tables[table] ?? [];
      const filters = [];
      const q = {
        select: () => q, order: () => q, range: () => q,
        eq: (column, value) => { filters.push((row) => row[column] === value); return q; },
        in: (column, values) => { filters.push((row) => values.includes(row[column])); return q; },
        is: (column, value) => { filters.push((row) => row[column] === value); return q; },
        maybeSingle: async () => ({ data: rows.find((row) => filters.every((f) => f(row))) ?? null, error: null }),
        single: async () => {
          const row = rows.find((r) => filters.every((f) => f(r)));
          return row ? { data: row, error: null } : { data: null, error: { code: "PGRST116" } };
        },
        then: (resolve, reject) => Promise.resolve({ data: rows.filter((row) => filters.every((f) => f(row))), error: null }).then(resolve, reject),
      };
      return q;
    },
  };
}

const RELOAD = [
  "../services/oralReadingAttemptService", "../services/adminOralReadingService", "../services/comprehensionAttemptService",
  "../services/speechAccess", "../routes/speech", "../services/assignedReadingSource",
];
function load(t) {
  const supabase = require("../services/supabaseAdmin");
  const db = createDb();
  t.mock.method(supabase, "getSupabaseAdmin", () => db);
  t.mock.method(supabase, "getAuthenticatedSupabaseUser", async (req) => {
    const header = req.get?.("authorization") ?? req.headers?.authorization ?? "";
    const id = header.replace(/^Bearer /, "");
    if (!id) throw new supabase.SupabaseAuthenticationError();
    return { id };
  });
  for (const file of RELOAD) delete require.cache[require.resolve(file)];
  t.after(() => { for (const file of RELOAD) delete require.cache[require.resolve(file)]; });
  return {
    db,
    m5: require("../services/oralReadingAttemptService"),
    list: require("../services/adminOralReadingService"),
    m6: require("../services/comprehensionAttemptService"),
    assigned: require("../services/assignedReadingSource"),
    speech: require("../routes/speech"),
  };
}
const as = (id) => ({ get: (name) => (name.toLowerCase() === "authorization" ? `Bearer ${id}` : undefined), headers: { authorization: `Bearer ${id}` } });
const forbidden = (error) => error?.statusCode === 403;

test("M5/M6 practice authorization: approved Teachers pass; pending, rejected and status-less Teachers are refused", async (t) => {
  const { m5, m6 } = load(t);
  for (const id of [TEACHER, ADMIN, STUDENT, LEARNER]) {
    assert.equal((await m5.authorizeReadingPracticeRequest(as(id))).user.id, id);
    assert.equal((await m6.authorizeComprehensionRequest(as(id))).user.id, id);
  }
  for (const id of [PENDING, REJECTED]) {
    await assert.rejects(m5.authorizeReadingPracticeRequest(as(id)), (e) => forbidden(e) && /Approved Teacher/.test(e.message));
    await assert.rejects(m6.authorizeComprehensionRequest(as(id)), forbidden);
  }
});

test("unchanged role checks: M2 diagnostic/self-practice and classroom learner checks still refuse every Teacher", async (t) => {
  const { m5 } = load(t);
  for (const id of [TEACHER, PENDING]) {
    await assert.rejects(m5.authorizeOralReadingPracticeRequest(as(id)), forbidden, "M2 diagnostic speech role check");
    await assert.rejects(m5.authorizeOralReadingRequest(as(id)), forbidden, "classroom/learner role check");
  }
  for (const id of [ADMIN, STUDENT, LEARNER]) assert.ok(await m5.authorizeOralReadingPracticeRequest(as(id)));
});

test("an approved Teacher opens any published catalog module outside a classroom, never drafts or classroom contexts", async (t) => {
  const { m5, db } = load(t);
  const teacher = await m5.authorizeReadingPracticeRequest(as(TEACHER));
  const english = await m5.loadAccessiblePublishedModule(teacher, MOD.adminEn, {}, {});
  assert.deepEqual([english.roomId, english.assignmentId, english.language], [null, null, "en"], "another author's module");
  const filipino = await m5.loadAccessiblePublishedModule(teacher, MOD.teacherFil, {}, {});
  assert.equal(filipino.language, "fil", "another Teacher's published module");
  assert.equal(db.touched.has("enrollments") || db.touched.has("room_modules"), false, "no enrollment or assignment is involved");
  for (const module of [MOD.draft, MOD.deleted, MOD.archived]) {
    await assert.rejects(m5.loadAccessiblePublishedModule(teacher, module, {}, {}), forbidden, module);
  }
  await assert.rejects(m5.loadAccessiblePublishedModule(teacher, MOD.adminEn, {}, { roomId: ROOM }), forbidden);
  await assert.rejects(m5.loadAccessiblePublishedModule(teacher, MOD.adminEn, {}, { assignmentId: ROOM }), forbidden);
  // Even if a pending Teacher's profile reached this function, it refuses them.
  const pending = { user: { id: PENDING }, profile: { role: "teacher", teacher_status: "pending" } };
  await assert.rejects(m5.loadAccessiblePublishedModule(pending, MOD.adminEn, {}, {}), forbidden);
  // Another school's module is never available (M1): "not found" for the Teacher and for the School Admin.
  await assert.rejects(m5.loadAccessiblePublishedModule(teacher, MOD.foreign, {}, {}), (e) => e.statusCode === 404);
  // School Admin practice (expanded 2026-11-21): every published module of their school, not only their own.
  const admin = await m5.authorizeReadingPracticeRequest(as(ADMIN));
  assert.ok(await m5.loadAccessiblePublishedModule(admin, MOD.adminEn, {}, {}));
  assert.equal((await m5.loadAccessiblePublishedModule(admin, MOD.teacherFil, {}, {})).language, "fil", "a Teacher's module of the same school");
  await assert.rejects(m5.loadAccessiblePublishedModule(admin, MOD.foreign, {}, {}), (e) => e.statusCode === 404);
});

test("Teachers cannot open uploaded classroom materials as practice", async (t) => {
  const { m5, assigned } = load(t);
  const teacher = await m5.authorizeReadingPracticeRequest(as(TEACHER));
  await assert.rejects(assigned.loadAssignedReadingSource(teacher, MOD.adminEn, { roomId: ROOM, activityAssignmentId: ROOM }), forbidden);
});

test("practice passage list: Teachers and School Admins see their school's and platform modules, never another school's", async (t) => {
  const { m5, list } = load(t);
  const teacher = await m5.authorizeReadingPracticeRequest(as(TEACHER));
  const rows = await list.listPracticeReadingPassages(teacher, {});
  assert.deepEqual(rows.map((row) => [row.moduleTitle, row.language]).sort(),
    [["EN by Admin", "en"], ["FIL by other Teacher", "fil"]], "published, not deleted, supported language; any author");
  assert.ok(rows.every((row) => !("passage" in row) && !("created_by" in row)), "titles only, no passage text or author");
  const admin = await m5.authorizeReadingPracticeRequest(as(ADMIN));
  assert.deepEqual((await list.listPracticeReadingPassages(admin, {})).map((row) => row.moduleTitle).sort(), ["EN by Admin", "FIL by other Teacher"]);
  assert.deepEqual((await list.listAdminReadingPassages(admin, {})).map((row) => row.moduleTitle).sort(), ["EN by Admin", "FIL by other Teacher"]);
  await assert.rejects(list.listAdminReadingPassages(teacher, {}), forbidden, "the Admin list stays Admin-only");
  for (const profile of [{ role: "teacher", teacher_status: "pending" }, { role: "student" }, { role: "general_user" }]) {
    await assert.rejects(list.listPracticeReadingPassages({ user: { id: PENDING }, profile }, {}), forbidden, profile.role);
  }
});

test("M6: Teacher practice refuses classroom, assignment and uploaded-material contexts before any lookup", async (t) => {
  const { m5, m6 } = load(t);
  const teacher = await m5.authorizeReadingPracticeRequest(as(TEACHER));
  const ids = { moduleId: MOD.adminEn, passageId: MOD.adminEn, submissionId: "b0000000-0000-4000-8000-000000000001" };
  for (const extra of [{ roomId: ROOM }, { assignmentId: ROOM }]) {
    await assert.rejects(m6.startComprehensionAttempt(teacher, { ...ids, ...extra }),
      (e) => e.statusCode === 403 && /Staff comprehension practice is available only for published reading modules/.test(e.message));
  }
  await assert.rejects(m6.startComprehensionAttempt(teacher, {
    materialId: MOD.adminEn, activityAssignmentId: ROOM, oralReadingAttemptId: ROOM, submissionId: ids.submissionId,
  }), (e) => e.statusCode === 403);
});

test("speech: approved Teachers reach M5 read-aloud transcription and TTS, and the M2 diagnostic upload only for F7 Practice Mode", async (t) => {
  const { speech } = load(t);
  const uploadDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "teacher-speech-"));
  t.after(() => fs.rmSync(uploadDirectory, { recursive: true, force: true }));
  // Real default authorizers; transcription and synthesis are stubs that must not be reached by refused requests.
  const providerCalls = [];
  const app = express().use(express.json()).use(speech.createSpeechRouter({
    uploadDirectory,
    transcribe: async () => { providerCalls.push("stt"); return { text: "x" }; },
    synthesize: async () => { providerCalls.push("tts"); return Buffer.from("mp3"); },
    receipts: { record: async () => null },
    log: () => {},
  }));
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, id, body) => fetch(base + route, {
    method: "POST", headers: { authorization: `Bearer ${id}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const status = async (route, id, body) => (await post(route, id, body)).status;

  // Authorized requests without audio/text fail validation (400), proving the role check passed.
  assert.equal(await status("/api/read-aloud/audio", TEACHER), 400, "Teacher read-aloud transcription allowed");
  assert.equal(await status("/api/tts", TEACHER, { text: "", language: "en" }), 400, "Teacher TTS allowed");
  // M2 F7 Practice Mode: an approved Teacher passes the diagnostic upload's role check (400 = validation reached).
  // Only DIAGNOSTIC parts are accepted for Teachers (plain transcription is refused: diagnosticPractice.test.js),
  // and the official diagnostic result endpoint stays learner-only.
  assert.equal(await status("/api/diagnostic/audio", TEACHER), 400, "approved Teacher reaches the diagnostic upload (Practice Mode)");
  for (const id of [PENDING, REJECTED]) {
    for (const route of ["/api/read-aloud/audio", "/api/tts", "/api/diagnostic/audio"]) {
      assert.equal(await status(route, id, route === "/api/tts" ? { text: "Hi", language: "en" } : undefined), 403, `${id} ${route}`);
    }
  }
  // Learners and Admins keep every endpoint.
  for (const id of [STUDENT, LEARNER, ADMIN]) {
    assert.equal(await status("/api/diagnostic/audio", id), 400, `${id} diagnostic`);
    assert.equal(await status("/api/read-aloud/audio", id), 400, `${id} read-aloud`);
  }
  assert.deepEqual(providerCalls, [], "no provider call for refused or invalid requests");
});
