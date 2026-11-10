const test = require("node:test");
const assert = require("node:assert/strict");

// The read-only lookup behind "Continue to Questions" / "View Comprehension Result"
// on the M5 result page. In-memory rows; nothing is written.
const ANA = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const READING = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_READING = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let rows = []; // m6_comprehension_attempts
let readings = []; // oral_reading_attempts
let calls = [];
let failWith = null;
function database() {
  return {
    from(table) {
      const filters = [];
      const source = () => (table === "oral_reading_attempts" ? readings : rows);
      const found = () => source().filter((row) => filters.every(([column, value]) => row[column] === value));
      const query = {
        select(columns) { calls.push({ table, columns }); return query; },
        insert() { throw new Error("must not write"); },
        update() { throw new Error("must not write"); },
        upsert() { throw new Error("must not write"); },
        delete() { throw new Error("must not write"); },
        eq(column, value) { filters.push([column, value]); return query; },
        async single() { return this.maybeSingle(); },
        async maybeSingle() {
          if (failWith) return { data: null, error: failWith };
          const [first] = found();
          return { data: first ? { ...first } : null, error: null };
        },
        then(resolve, reject) {
          return Promise.resolve(failWith ? { data: null, error: failWith } : { data: found().map((row) => ({ ...row })), error: null })
            .then(resolve, reject);
        },
      };
      return query;
    },
  };
}
// One learning activity (a module passage with no classroom) read twice, and another activity.
const MODULE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PASSAGE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const reading = (id, user, extra = {}) => ({ id, user_id: user, module_id: MODULE, passage_id: PASSAGE, room_id: null,
  assignment_id: null, material_id: null, activity_assignment_id: null, ...extra });
const attempt = (id, user, readingId, status, extra = {}) => ({ id, user_id: user, oral_reading_attempt_id: readingId, status,
  module_id: MODULE, passage_id: PASSAGE, room_id: null, assignment_id: null, material_id: null, activity_assignment_id: null,
  created_at: "2026-11-06T01:00:00Z", completed_at: status === "completed" ? "2026-11-06T01:10:00Z" : null, ...extra });
// Mocked before the services load, because they keep the functions they imported.
let signedIn = ANA;
test.mock.method(require("../services/supabaseAdmin"), "getSupabaseAdmin", database);
test.mock.method(require("../services/supabaseAdmin"), "getAuthenticatedSupabaseUser", async () => ({ id: signedIn }));
const { findComprehensionForReading, ComprehensionError, authorizeComprehensionRequest } = require("../services/comprehensionAttemptService");
const { OralReadingAuthorizationError, loadAccessiblePublishedModule } = require("../services/oralReadingAttemptService");
const requester = (id) => ({ user: { id }, profile: { role: "student" } });

test.beforeEach(() => { rows = []; readings = []; calls = []; failWith = null; });

test("no M6 activity for the reading: null (reads only)", async () => {
  readings = [reading(READING, ANA)];
  assert.equal(await findComprehensionForReading(requester(ANA), READING), null);
  assert.deepEqual([...new Set(calls.map((call) => call.table))], ["oral_reading_attempts", "m6_comprehension_attempts"]);
});

test("an activity in progress or completed: its ID and status only", async () => {
  readings = [reading(READING, ANA), reading(OTHER_READING, ANA, { passage_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" })];
  rows = [
    attempt("m6-a", ANA, READING, "in_progress", { score: 1 }),
    attempt("m6-b", ANA, OTHER_READING, "completed", { passage_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }),
  ];
  assert.deepEqual(await findComprehensionForReading(requester(ANA), READING), { id: "m6-a", status: "in_progress" });
  assert.deepEqual(await findComprehensionForReading(requester(ANA), OTHER_READING), { id: "m6-b", status: "completed" });
});

test("a repeated reading of the same activity finds that activity's one assessment, not a new opportunity", async () => {
  const SECOND = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  readings = [reading(READING, ANA), reading(SECOND, ANA)];
  rows = [attempt("m6-first", ANA, READING, "completed")];
  assert.deepEqual(await findComprehensionForReading(requester(ANA), SECOND), { id: "m6-first", status: "completed" });
  // Older data with an extra attempt for the activity (saved before the rule): the completed one is shown.
  rows.push(attempt("m6-extra", ANA, SECOND, "in_progress", { created_at: "2026-11-06T02:00:00Z" }));
  for (const id of [READING, SECOND]) {
    assert.deepEqual(await findComprehensionForReading(requester(ANA), id), { id: "m6-first", status: "completed" });
  }
  // The same passage in a classroom assignment is a different activity.
  const ROOM_READING = "abababab-abab-4bab-8bab-abababababab";
  readings.push(reading(ROOM_READING, ANA, { room_id: "r1", assignment_id: "a1" }));
  assert.equal(await findComprehensionForReading(requester(ANA), ROOM_READING), null);
});

test("another learner's activity for the same reading ID is never returned", async () => {
  readings = [reading(READING, BEN)];
  rows = [attempt("m6-ben", BEN, READING, "completed")];
  assert.equal(await findComprehensionForReading(requester(ANA), READING), null);
});

test("an invalid reading ID is rejected before any query; a database error is reported", async () => {
  for (const bad of [undefined, "", "not-a-uuid", "1; drop table"]) {
    await assert.rejects(findComprehensionForReading(requester(ANA), bad), (error) => error instanceof ComprehensionError && error.statusCode === 400);
  }
  assert.deepEqual(calls, []);
  failWith = { code: "XX000", message: "boom" };
  const quiet = test.mock.method(console, "error", () => {});
  await assert.rejects(findComprehensionForReading(requester(ANA), READING), /Unable to check your comprehension activity\./);
  quiet.mock.restore();
});

test("the route is a GET that reads only", () => {
  const source = require("node:fs").readFileSync(require.resolve("../routes/comprehension.js"), "utf8");
  assert.match(source, /router\.get\("\/readings\/:oralReadingAttemptId", async \(req, res\) => \{\s*try \{\s*const requester = await authorizeComprehensionRequest\(req\);\s*const attempt = await findComprehensionForReading\(requester, req\.params\.oralReadingAttemptId\);/);
});

test("M6 roles: Students, Independent Learners, Admin and approved-Teacher practice pass; other Teachers and roleless accounts are refused", async () => {
  // An Admin or approved Teacher passes only the role check; every read is owner-scoped, and a new
  // practice activity must be a published module outside any classroom (m6AdminPracticeBackend.test.js,
  // m6TeacherPracticeBackend.test.js).
  for (const [role, allowed, teacherStatus] of [["student", true], ["general_user", true], ["admin", true],
    ["teacher", true, "approved"], ["teacher", false, "pending"], ["teacher", false, "rejected"], ["teacher", false, null], [null, false]]) {
    rows = [{ id: ANA, role, full_name: "x", nickname: "x", teacher_status: teacherStatus ?? null }];
    signedIn = ANA;
    const attempt = authorizeComprehensionRequest({ headers: {} });
    if (allowed) assert.equal((await attempt).profile.role, role);
    else await assert.rejects(attempt, (error) => error instanceof OralReadingAuthorizationError && error.statusCode === 403, `${role} ${teacherStatus}`);
  }
});

test("an Independent Learner reads a published module without a classroom, and cannot claim one", async () => {
  const MODULE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const ROOM = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const tables = { modules: [{ id: MODULE, status: "published", deleted_at: null, path_id: "path", title: "M", difficulty: "Easy", passage: "Story." }],
    learning_paths: [{ id: "path", path_name: "English Easy", language: "English" }],
    module_passages: [], enrollments: [] };
  const touched = new Set();
  const db = { from: (table) => { touched.add(table); tables[table] ??= []; const filters = []; const q = {
    select: () => q, eq: (c, v) => { filters.push([c, v]); return q; }, in: () => q, order: () => q,
    maybeSingle: async () => ({ data: tables[table].find((row) => filters.every(([c, v]) => row[c] === v)) ?? null, error: null }),
    then: (resolve) => resolve({ data: tables[table].filter((row) => filters.every(([c, v]) => row[c] === v)), error: null }),
  }; return q; } };
  const learner = { user: { id: ANA }, profile: { role: "general_user" } };
  await assert.rejects(loadAccessiblePublishedModule(learner, MODULE, { getSupabaseAdmin: () => db }, { roomId: ROOM }),
    (error) => error instanceof OralReadingAuthorizationError, "classroom context is refused");
  const opened = await loadAccessiblePublishedModule(learner, MODULE, { getSupabaseAdmin: () => db }, {});
  assert.equal(opened.roomId ?? null, null, "no classroom");
  assert.equal(touched.has("enrollments") || touched.has("room_modules"), false, "no enrollment or assignment is looked up");
  tables.modules[0].status = "draft";
  await assert.rejects(loadAccessiblePublishedModule(learner, MODULE, { getSupabaseAdmin: () => db }, {}), OralReadingAuthorizationError);
});
