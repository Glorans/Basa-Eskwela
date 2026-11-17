// Student Read Aloud opened from Reading Materials (the catalog), not from a classroom.
// Classroom reading: a module assigned in one of the Student's classrooms keeps the classroom path.
// Personal practice (2026-11-17): any other published module, with no classroom attached, for M5 only.
const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { createOralReadingRouter } = require("../routes/oralReading");
const { loadAccessiblePublishedModule, OralReadingAuthorizationError } = require("../services/oralReadingAttemptService");

const STUDENT = "11111111-1111-4111-8111-111111111111";
const LONER = "22222222-2222-4222-8222-222222222222"; // a Student with no classroom
const TEACHER = "44444444-4444-4444-8444-444444444444";
const ENGLISH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // published, assigned in ROOM (the working module)
const EARLY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab"; // published, assigned nowhere (the failing module)
const LEGACY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac"; // published, assigned, no module_passages rows
const DRAFT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PATH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ROOM = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OTHER_ROOM = "dddddddd-dddd-4ddd-8ddd-ddddddddddde";
const P_ENGLISH = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const P_EARLY = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
const NO_CLASSROOM = "This module must be assigned in a classroom where you are enrolled. Join your teacher's classroom first.";

class Query {
  constructor(db, table) { this.db = db; this.table = table; this.filters = []; }
  select() { return this; }
  eq(c, v) { this.filters.push(r => r[c] === v); return this; }
  in(c, vs) { this.filters.push(r => vs.includes(r[c])); return this; }
  maybeSingle() { this.maybe = true; return this; }
  single() { this.maybe = true; return this; }
  then(res, rej) {
    const rows = (this.db.tables[this.table] ?? []).filter(r => this.filters.every(f => f(r))).map(r => ({ ...r }));
    return Promise.resolve(this.maybe ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }).then(res, rej);
  }
}
function database() {
  return {
    tables: {
      modules: [
        { id: ENGLISH, path_id: PATH, title: "English", difficulty: "Easy", status: "published", passage: "Ana reads.", created_by: TEACHER },
        { id: EARLY, path_id: PATH, title: "Early Start", difficulty: "Easy", status: "published", passage: "Ben runs.", created_by: TEACHER },
        { id: LEGACY, path_id: PATH, title: "Legacy", difficulty: "Easy", status: "published", passage: "Old legacy text.", created_by: TEACHER },
        { id: DRAFT, path_id: PATH, title: "Draft", difficulty: "Easy", status: "draft", passage: "Hidden.", created_by: TEACHER },
      ],
      module_passages: [
        { id: P_ENGLISH, module_id: ENGLISH, title: "English", passage_text: "Ana reads a book.", display_order: 1 },
        { id: P_EARLY, module_id: EARLY, title: "Early Start", passage_text: "Ben runs fast.", display_order: 1 },
      ],
      learning_paths: [{ id: PATH, path_name: "English Foundations", language: "English" }],
      enrollments: [{ student_id: STUDENT, room_id: ROOM }],
      room_modules: [
        { id: "f0000000-0000-4000-8000-000000000001", room_id: ROOM, module_id: ENGLISH, removed_at: null },
        { id: "f0000000-0000-4000-8000-000000000002", room_id: ROOM, module_id: LEGACY, removed_at: null },
        { id: "f0000000-0000-4000-8000-000000000003", room_id: ROOM, module_id: DRAFT, removed_at: null },
      ],
      room_module_recipients: [],
    },
    from(table) { return new Query(this, table); },
  };
}
const student = (id = STUDENT) => ({ user: { id }, profile: { id, role: "student" } });
const deps = db => ({ getSupabaseAdmin: () => db });
const refusal = (code, message) => error => {
  assert.ok(error instanceof OralReadingAuthorizationError);
  assert.equal(error.statusCode, 403);
  assert.equal(error.code, code);
  if (message) assert.equal(error.message, message);
  return true;
};


const PERSONAL = { studentPersonal: true }; // what the M5 read-aloud load and save pass (never from a request)

test("the working module (assigned in the Student's classroom) keeps the classroom path, also from the catalog", async () => {
  for (const options of [{}, PERSONAL]) {
    const module = await loadAccessiblePublishedModule(student(), ENGLISH, deps(database()), { passageId: P_ENGLISH }, options);
    assert.equal(module.passage, "Ana reads a book.");
    assert.equal(module.passageId, P_ENGLISH);
    assert.equal(module.roomId, ROOM);
    assert.equal(module.assignmentId, "f0000000-0000-4000-8000-000000000001");
    assert.equal(module.personalPractice, false, "a classroom reading is never relabelled as personal practice");
  }
});

test("M5 personal practice: an enrolled Student reads an unassigned published module with no classroom attached", async () => {
  const module = await loadAccessiblePublishedModule(student(), EARLY, deps(database()), { passageId: P_EARLY }, PERSONAL);
  assert.equal(module.passage, "Ben runs fast.");
  assert.equal(module.passageId, P_EARLY);
  assert.equal(module.roomId, null);
  assert.equal(module.assignmentId, null);
  assert.equal(module.personalPractice, true);
});

test("M5 personal practice: a Student with no classroom reads any published module (Early Start and English)", async () => {
  for (const [id, passageId, text] of [[EARLY, P_EARLY, "Ben runs fast."], [ENGLISH, P_ENGLISH, "Ana reads a book."]]) {
    const module = await loadAccessiblePublishedModule(student(LONER), id, deps(database()), { passageId }, PERSONAL);
    assert.equal(module.passage, text);
    assert.equal(module.roomId, null);
    assert.equal(module.personalPractice, true);
  }
});

test("without the M5 option (M6 comprehension, the M8 receipt) the classroom rule is unchanged", async () => {
  await assert.rejects(loadAccessiblePublishedModule(student(), EARLY, deps(database()), { passageId: P_EARLY }),
    refusal("CLASSROOM_ASSIGNMENT_REQUIRED", "This module must be assigned in a classroom where you are enrolled."));
  for (const id of [ENGLISH, EARLY]) {
    await assert.rejects(loadAccessiblePublishedModule(student(LONER), id, deps(database()), {}),
      refusal("CLASSROOM_ASSIGNMENT_REQUIRED", NO_CLASSROOM));
  }
  // The option cannot come from a request: only the fifth argument enables it.
  await assert.rejects(loadAccessiblePublishedModule(student(), EARLY, deps(database()), { studentPersonal: true }),
    refusal("CLASSROOM_ASSIGNMENT_REQUIRED"));
});

test("a named classroom or assignment never falls back to personal practice", async () => {
  // Not enrolled in the named room: plain refusal.
  for (const who of [student(), student(LONER)]) {
    await assert.rejects(loadAccessiblePublishedModule(who, ENGLISH, deps(database()), { roomId: OTHER_ROOM }, PERSONAL), error => {
      assert.ok(error instanceof OralReadingAuthorizationError);
      assert.equal(error.code, undefined);
      assert.equal(error.message, "This oral-reading activity is not available to your account.");
      return true;
    });
  }
  // Enrolled room, but the module is not assigned there: the assignment rule, not personal practice.
  await assert.rejects(loadAccessiblePublishedModule(student(), EARLY, deps(database()), { roomId: ROOM }, PERSONAL),
    refusal("CLASSROOM_ASSIGNMENT_REQUIRED"));
  await assert.rejects(loadAccessiblePublishedModule(student(), EARLY, deps(database()), { assignmentId: "f0000000-0000-4000-8000-000000000001" }, PERSONAL),
    refusal("CLASSROOM_ASSIGNMENT_REQUIRED"));
  await assert.rejects(loadAccessiblePublishedModule(student(LONER), EARLY, deps(database()), { assignmentId: "f0000000-0000-4000-8000-000000000001" }, PERSONAL),
    refusal("CLASSROOM_ASSIGNMENT_REQUIRED", NO_CLASSROOM));
});

test("unpublished, trashed and archived modules stay closed for personal practice", async () => {
  const db = database();
  db.tables.modules.push(
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad", path_id: PATH, title: "Trashed", status: "published", passage: "x", deleted_at: "2026-11-01T00:00:00Z" },
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae", path_id: PATH, title: "Archived", status: "archived", passage: "x" },
  );
  for (const id of [DRAFT, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae"]) {
    for (const who of [student(), student(LONER)]) {
      await assert.rejects(loadAccessiblePublishedModule(who, id, deps(db), {}, PERSONAL), /This reading module is not available for oral reading\./);
    }
  }
  await assert.rejects(loadAccessiblePublishedModule(student(LONER), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaf", deps(db), {}, PERSONAL),
    error => error.statusCode === 404);
});

test("classroom restrictions are not bypassed: removed and selected-students modules stay refused", async () => {
  const removed = database();
  removed.tables.room_modules[0].removed_at = "2026-11-01T00:00:00Z";
  await assert.rejects(loadAccessiblePublishedModule(student(), ENGLISH, deps(removed), {}, PERSONAL),
    refusal("MODULE_REMOVED_FROM_CLASSROOM"));
  const targeted = database();
  targeted.tables.room_modules[0].targeting_mode = "selected_students";
  await assert.rejects(loadAccessiblePublishedModule(student(), ENGLISH, deps(targeted), {}, PERSONAL),
    refusal("SELECTED_STUDENTS_ONLY"));
  targeted.tables.room_module_recipients.push({ room_module_id: targeted.tables.room_modules[0].id, student_id: STUDENT });
  assert.equal((await loadAccessiblePublishedModule(student(), ENGLISH, deps(targeted), {}, PERSONAL)).roomId, ROOM);
  // A Student outside that classroom is unaffected by its restriction and reads it as personal practice.
  assert.equal((await loadAccessiblePublishedModule(student(LONER), ENGLISH, deps(removed), {}, PERSONAL)).personalPractice, true);
});

test("assigned in two classrooms: the catalog still asks for the classroom (no silent pick, no relabel)", async () => {
  const db = database();
  db.tables.enrollments.push({ student_id: STUDENT, room_id: OTHER_ROOM });
  db.tables.room_modules.push({ id: "f0000000-0000-4000-8000-000000000009", room_id: OTHER_ROOM, module_id: ENGLISH, removed_at: null });
  await assert.rejects(loadAccessiblePublishedModule(student(), ENGLISH, deps(db), {}, PERSONAL), error => error.code === "CLASSROOM_REQUIRED");
});

test("a legacy module without passage rows opens with passageId = moduleId (the catalog button's fallback)", async () => {
  for (const who of [student(), student(LONER)]) {
    const module = await loadAccessiblePublishedModule(who, LEGACY, deps(database()), { passageId: LEGACY }, PERSONAL);
    assert.equal(module.passage, "Old legacy text.");
    assert.equal(module.passageId, null);
  }
});

test("the M5 route opens Early Start as personal practice and English as classroom reading", async () => {
  const db = database();
  const app = express();
  let who = student();
  app.use("/api/oral-reading", createOralReadingRouter({
    authorizeOralReadingPracticeRequest: async () => who, getSupabaseAdmin: () => db, isRoomArchived: async () => false,
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/oral-reading/modules/`;
    for (const person of [student(), student(LONER)]) {
      who = person;
      const early = await fetch(`${base}${EARLY}?passageId=${P_EARLY}`);
      assert.equal(early.status, 200);
      const earlyModule = (await early.json()).module;
      assert.deepEqual([earlyModule.passage, earlyModule.roomId, earlyModule.personalPractice], ["Ben runs fast.", null, true]);
    }
    who = student();
    const english = (await (await fetch(`${base}${ENGLISH}?passageId=${P_ENGLISH}`)).json()).module;
    assert.deepEqual([english.passage, english.roomId, english.personalPractice], ["Ana reads a book.", ROOM, false]);
    // A query parameter cannot switch classroom context off: naming the room keeps the classroom rule.
    const named = await fetch(`${base}${EARLY}?roomId=${ROOM}&studentPersonal=true`);
    assert.equal(named.status, 403);
    assert.equal((await named.json()).code, "CLASSROOM_ASSIGNMENT_REQUIRED");
  } finally { server.close(); }
});
