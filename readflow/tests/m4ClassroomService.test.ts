import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, afterEach, beforeEach, test } from "node:test";

// Characterization tests: they lock in the CURRENT behavior of M4 service functions
// that no other test calls. Tests named "current behavior" pin behavior that looks
// odd; changing one of them should be a deliberate decision, not a test fix.

type Reply = { data: unknown; error: unknown };
type Call = { operation: string; args: unknown[] };

// Fake client copied from tests/m4Classroom.test.ts, extended with auth.getUser.
const calls: Call[] = [];
let replies: Reply[] = [];
let authReply: { data: { user: { id: string } | null }; error: unknown } = { data: { user: { id: "user-1" } }, error: null };
const client = {
  auth: {
    getUser() {
      calls.push({ operation: "getUser", args: [] });
      return Promise.resolve(authReply);
    },
  },
  rpc(...args: unknown[]) {
    calls.push({ operation: "rpc", args });
    return Promise.resolve(replies.shift());
  },
  from(table: string) {
    calls.push({ operation: "from", args: [table] });
    const query: Record<string, (...args: any[]) => any> = {};
    for (const operation of ["select", "eq", "is", "in", "order", "insert", "update", "delete", "single", "maybeSingle"]) {
      query[operation] = (...args: unknown[]) => {
        calls.push({ operation, args });
        return query;
      };
    }
    query.then = (resolve, reject) => Promise.resolve(replies.shift()).then(resolve, reject);
    return query;
  },
};

const globals = globalThis as typeof globalThis & { __m4ServiceClient?: typeof client };
globals.__m4ServiceClient = client;
const url = new URL("../src/modules/module4/services/classroomService.ts", import.meta.url).href;
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL === url && specifier.endsWith("/supabaseClient")) {
    return { url: "data:text/javascript,export const supabase = globalThis.__m4ServiceClient", shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
const service = await import(url) as typeof import("../src/modules/module4/services/classroomService.ts");

const originalRandom = Math.random;
const originalConsoleError = console.error;
let logged: unknown[][] = [];

beforeEach(() => {
  calls.length = 0;
  replies = [];
  authReply = { data: { user: { id: "user-1" } }, error: null };
  logged = [];
  console.error = (...args: unknown[]) => { logged.push(args); };
});

afterEach(() => {
  Math.random = originalRandom;
  console.error = originalConsoleError;
});

after(() => {
  hooks.deregister();
  delete globals.__m4ServiceClient;
});

function respond(...queued: Reply[]) {
  replies = queued;
}
const ok = (data: unknown): Reply => ({ data, error: null });
const fail = (error: unknown): Reply => ({ data: null, error });
const ops = (name: string) => calls.filter((call) => call.operation === name).map((call) => call.args);
const tables = () => ops("from").map((args) => args[0]);
const sameError = (expected: unknown) => (actual: unknown) => actual === expected;

/** Makes Math.random pick the given alphabet indexes, in order, then repeat. */
function pickIndexes(indexes: number[]) {
  let position = 0;
  Math.random = () => (indexes[position++ % indexes.length] + 0.5) / 32;
}

const room = { id: "room-1", teacher_id: "user-1", room_name: "Readers", section: null, room_code: "AAAAAAAA", description: null, created_at: "2026-10-01" };

// getTeacherClassrooms

test("getTeacherClassrooms reads the teacher's rooms newest first", async () => {
  respond(ok([room]));
  assert.deepEqual(await service.getTeacherClassrooms("teacher-1"), [room]);
  assert.deepEqual(tables(), ["rooms"]);
  assert.deepEqual(ops("select"), [["*"]]);
  assert.deepEqual(ops("eq"), [["teacher_id", "teacher-1"]]);
  assert.deepEqual(ops("order"), [["created_at", { ascending: false }]]);
});

test("getTeacherClassrooms returns an empty list for null data", async () => {
  respond(ok(null));
  assert.deepEqual(await service.getTeacherClassrooms("teacher-1"), []);
});

test("getTeacherClassrooms logs and rethrows the same query error", async () => {
  const error = { code: "42501", message: "denied" };
  respond(fail(error));
  await assert.rejects(service.getTeacherClassrooms("teacher-1"), sameError(error));
  assert.deepEqual(logged, [["Error fetching teacher classrooms:", error]]);
});

// createClassroom

test("createClassroom draws 8-character codes from the 32-character alphabet without I, O, 0 or 1", async () => {
  pickIndexes([...Array(32).keys()]);
  respond(ok({ id: "taken" }), ok({ id: "taken" }), ok({ id: "taken" }), ok(null), ok(room));
  await service.createClassroom({ subject: "en", teacherId: "user-1", roomName: "Readers", section: "", description: "" });
  const checkedCodes = ops("eq").filter((args) => args[0] === "room_code").map((args) => args[1]);
  assert.deepEqual(checkedCodes, ["ABCDEFGH", "JKLMNPQR", "STUVWXYZ", "23456789"]);
  assert.deepEqual(ops("select").slice(0, 4), [["id"], ["id"], ["id"], ["id"]]);
  assert.equal(ops("maybeSingle").length, 4);
});

test("createClassroom inserts a trimmed payload with blank optional fields as null and returns the saved row", async () => {
  pickIndexes([0]);
  respond(ok(null), ok(room));
  const saved = await service.createClassroom({ subject: "en", teacherId: "user-1", roomName: "  Readers  ", section: "   ", description: "  A class  " });
  assert.equal(saved, room);
  assert.deepEqual(tables(), ["rooms", "rooms"]);
  assert.deepEqual(ops("insert"), [[{ subject: "en", teacher_id: "user-1", room_name: "Readers", section: null, description: "A class", room_code: "AAAAAAAA" }]]);
  assert.equal(ops("single").length, 1);
});

test("current behavior: createClassroom inserts a blank room name as an empty string", async () => {
  // Odd: the service has no name validation; only the page blocks a blank name.
  pickIndexes([0]);
  respond(ok(null), ok(room));
  await service.createClassroom({ subject: "en", teacherId: "user-1", roomName: "   ", section: "", description: "" });
  assert.equal((ops("insert")[0][0] as { room_name: string }).room_name, "");
});

test("createClassroom retries a taken code and inserts the next free one", async () => {
  pickIndexes([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
  respond(ok({ id: "taken" }), ok(null), ok(room));
  await service.createClassroom({ subject: "en", teacherId: "user-1", roomName: "Readers", section: "", description: "" });
  assert.equal((ops("insert")[0][0] as { room_code: string }).room_code, "BBBBBBBB");
});

test("createClassroom gives up after 10 taken codes without inserting", async () => {
  pickIndexes([0]);
  respond(...Array.from({ length: 10 }, () => ok({ id: "taken" })));
  await assert.rejects(
    service.createClassroom({ subject: "en", teacherId: "user-1", roomName: "Readers", section: "", description: "" }),
    { message: "Unable to generate a unique classroom code. Please try again." },
  );
  assert.equal(ops("maybeSingle").length, 10);
  assert.deepEqual(ops("insert"), []);
});

test("createClassroom logs and rethrows a code-check error without inserting", async () => {
  pickIndexes([0]);
  const error = { code: "PGRST301", message: "expired" };
  respond(fail(error));
  await assert.rejects(service.createClassroom({ subject: "en", teacherId: "user-1", roomName: "Readers", section: "", description: "" }), sameError(error));
  assert.deepEqual(logged, [["Error checking room code:", error]]);
  assert.deepEqual(ops("insert"), []);
});

test("createClassroom logs and rethrows an insert error", async () => {
  pickIndexes([0]);
  const error = { code: "23505", message: "duplicate key" };
  respond(ok(null), fail(error));
  await assert.rejects(service.createClassroom({ subject: "en", teacherId: "user-1", roomName: "Readers", section: "", description: "" }), sameError(error));
  assert.deepEqual(logged, [["Error creating classroom:", error]]);
});

// getClassroomById

test("getClassroomById reads one room by id", async () => {
  respond(ok(room));
  assert.equal(await service.getClassroomById("room-1"), room);
  assert.deepEqual(tables(), ["rooms"]);
  assert.deepEqual(ops("select"), [["*"]]);
  assert.deepEqual(ops("eq"), [["id", "room-1"]]);
  assert.equal(ops("single").length, 1);
});

test("getClassroomById logs and rethrows the query error", async () => {
  const error = { code: "PGRST116", message: "no rows" };
  respond(fail(error));
  await assert.rejects(service.getClassroomById("room-1"), sameError(error));
  assert.deepEqual(logged, [["Error fetching classroom:", error]]);
});

// removeEnrolledStudent

test("current behavior: removeEnrolledStudent deletes by enrollment id only", async () => {
  // Odd: no room or teacher filter in the query; RLS is the only ownership check.
  respond(ok(null));
  assert.equal(await service.removeEnrolledStudent("enrollment-1"), undefined);
  assert.deepEqual(tables(), ["enrollments"]);
  assert.deepEqual(ops("delete"), [[]]);
  assert.deepEqual(ops("eq"), [["id", "enrollment-1"]]);
});

test("removeEnrolledStudent logs and rethrows the delete error", async () => {
  const error = { code: "42501", message: "denied" };
  respond(fail(error));
  await assert.rejects(service.removeEnrolledStudent("enrollment-1"), sameError(error));
  assert.deepEqual(logged, [["Error removing enrolled student:", error]]);
});

// updateClassroom

test("updateClassroom updates only trimmed name, section and description and returns the row", async () => {
  respond(ok(room));
  const saved = await service.updateClassroom("room-1", { roomName: "  Readers 2  ", section: "  ", description: " Notes " });
  assert.equal(saved, room);
  assert.deepEqual(tables(), ["rooms"]);
  assert.deepEqual(ops("update"), [[{ room_name: "Readers 2", section: null, description: "Notes" }]]);
  assert.deepEqual(ops("eq"), [["id", "room-1"]]);
  assert.deepEqual(ops("select"), [[]]);
  assert.equal(ops("single").length, 1);
});

test("updateClassroom logs and rethrows the update error", async () => {
  const error = { code: "42501", message: "denied" };
  respond(fail(error));
  await assert.rejects(service.updateClassroom("room-1", { roomName: "Readers", section: "", description: "" }), sameError(error));
  assert.deepEqual(logged, [["Error updating classroom:", error]]);
});

// getPublishedModules

test("getPublishedModules adds each module's learning-path language", async () => {
  respond(
    ok([
      { id: "m-1", title: "Fables", difficulty: "Easy", status: "published", path_id: "p-en" },
      { id: "m-2", title: "Alamat", difficulty: null, status: "published", path_id: "p-fil" },
      { id: "m-3", title: "Loose", difficulty: null, status: "published", path_id: null },
    ]),
    ok([{ id: "p-en", language: "English" }, { id: "p-fil", language: "fil" }]),
  );
  assert.deepEqual(await service.getPublishedModules(), [
    { id: "m-1", title: "Fables", difficulty: "Easy", status: "published", language: "en" },
    { id: "m-2", title: "Alamat", difficulty: null, status: "published", language: "fil" },
    { id: "m-3", title: "Loose", difficulty: null, status: "published", language: null },
  ]);
  assert.deepEqual(tables(), ["modules", "learning_paths"]);
  assert.deepEqual(ops("in"), [["id", ["p-en", "p-fil"]]]);
});

test("getPublishedModules keeps modules listed without a language when paths cannot be read", async () => {
  respond(
    ok([{ id: "m-1", title: "Fables", difficulty: "Easy", status: "published", path_id: "p-en" }]),
    fail({ code: "42501", message: "denied" }),
  );
  assert.deepEqual(await service.getPublishedModules(), [
    { id: "m-1", title: "Fables", difficulty: "Easy", status: "published", language: null },
  ]);
  assert.equal(logged.length, 1);
});

// getUploadedReadingMaterials

test("getUploadedReadingMaterials reads the signed-in teacher's completed materials newest first", async () => {
  const materials = [
    { id: "material-1", title: "Story", uploaded_by: "user-1", language: "en" },
    { id: "material-2", title: "Kuwento", uploaded_by: "user-1", language: "Filipino" },
  ];
  respond(ok(materials));
  assert.deepEqual(await service.getUploadedReadingMaterials(), [
    materials[0],
    { ...materials[1], language: "fil" },
  ]);
  assert.deepEqual(calls[0], { operation: "getUser", args: [] });
  assert.deepEqual(tables(), ["uploaded_materials"]);
  assert.deepEqual(ops("select"), [["id, title, uploaded_by, language"]]);
  assert.deepEqual(ops("eq"), [["uploaded_by", "user-1"], ["extraction_status", "completed"]]);
  assert.deepEqual(ops("order"), [["created_at", { ascending: false }]]);
});

test("getUploadedReadingMaterials returns an empty list for null data", async () => {
  respond(ok(null));
  assert.deepEqual(await service.getUploadedReadingMaterials(), []);
});

test("getUploadedReadingMaterials rethrows a getUser error without querying", async () => {
  const error = new Error("auth failed");
  authReply = { data: { user: null }, error };
  await assert.rejects(service.getUploadedReadingMaterials(), sameError(error));
  assert.deepEqual(tables(), []);
});

test("getUploadedReadingMaterials rejects a missing user without querying", async () => {
  authReply = { data: { user: null }, error: null };
  await assert.rejects(service.getUploadedReadingMaterials(), { message: "User not authenticated." });
  assert.deepEqual(tables(), []);
});

test("current behavior: getUploadedReadingMaterials rethrows a query error without logging", async () => {
  // Odd: every other M4 read logs with console.error before rethrowing; this one does not.
  const error = { code: "42501", message: "denied" };
  respond(fail(error));
  await assert.rejects(service.getUploadedReadingMaterials(), sameError(error));
  assert.deepEqual(logged, []);
});

// getStudentAssignedReadingMaterial

test("current behavior: getStudentAssignedReadingMaterial reads the material by id without a student filter", async () => {
  // Odd: the user is fetched but not used in the query; RLS alone limits it to assigned materials.
  const material = { id: "material-1", title: "Story", language: "fil", content_text: "Text" };
  respond(ok(material));
  assert.equal(await service.getStudentAssignedReadingMaterial("material-1"), material);
  assert.deepEqual(calls[0], { operation: "getUser", args: [] });
  assert.deepEqual(tables(), ["uploaded_materials"]);
  assert.deepEqual(ops("select"), [["id, title, language, content_text"]]);
  assert.deepEqual(ops("eq"), [["id", "material-1"]]);
  assert.equal(ops("single").length, 1);
});

test("getStudentAssignedReadingMaterial rethrows a getUser error without querying", async () => {
  const error = new Error("auth failed");
  authReply = { data: { user: null }, error };
  await assert.rejects(service.getStudentAssignedReadingMaterial("material-1"), sameError(error));
  assert.deepEqual(tables(), []);
});

test("getStudentAssignedReadingMaterial rejects a missing user without querying", async () => {
  authReply = { data: { user: null }, error: null };
  await assert.rejects(service.getStudentAssignedReadingMaterial("material-1"), { message: "User not authenticated." });
  assert.deepEqual(tables(), []);
});

test("getStudentAssignedReadingMaterial logs and rethrows the query error", async () => {
  const error = { code: "PGRST116", message: "no rows" };
  respond(fail(error));
  await assert.rejects(service.getStudentAssignedReadingMaterial("material-1"), sameError(error));
  assert.deepEqual(logged, [["Error fetching assigned reading material:", error]]);
});

test("new rooms persist Filipino and never silently retry without a subject", async () => {
  respond(ok(null), ok({ ...room, subject: "fil" }));
  const saved = await service.createClassroom({ subject: "fil", teacherId: "user-1", roomName: "Readers", section: "", description: "" });
  assert.equal(saved.subject, "fil");
  assert.equal((ops("insert")[0][0] as any).subject, "fil");
  for (const code of ["42703", "PGRST204"]) {
    calls.length = 0;
    respond(ok(null), fail({ code, message: "subject missing" }));
    await assert.rejects(service.createClassroom({ subject: "fil", teacherId: "user-1", roomName: "Readers", section: "", description: "" }), /Room subjects are not installed/);
    assert.equal(ops("insert").length, 1);
    assert.equal((ops("insert")[0][0] as any).subject, "fil");
  }
});
test("invalid room subjects are rejected before any database call", async () => {
  respond();
  for (const subject of [undefined, "", "Spanish"]) {
    await assert.rejects(service.createClassroom({ subject: subject as any, teacherId: "user-1", roomName: "Readers", section: "", description: "" }), /select English or Filipino/);
  }
  assert.deepEqual(calls, []);
});

test("legacy room subject options: missing RPC or failure means not supported; data is sanitized", async () => {
  replies = [{ data: null, error: { code: "PGRST202", message: "Could not find the function" } }];
  assert.equal(await service.getLegacyRoomSubjectOptions("room-1"), null);
  assert.deepEqual(calls[0], { operation: "rpc", args: ["m4_legacy_room_subject_options", { target_room: "room-1" }] });
  replies = [{ data: { subject: null, contentLanguages: ["fil"], choices: ["fil", "es"], canSet: true }, error: null }];
  assert.deepEqual(await service.getLegacyRoomSubjectOptions("room-1"),
    { subject: null, contentLanguages: ["fil"], choices: ["fil"], canSet: true });
  replies = [{ data: { subject: null, contentLanguages: ["en", "fil"], choices: [], canSet: "yes" }, error: null }];
  assert.equal((await service.getLegacyRoomSubjectOptions("room-1"))?.canSet, false);
});

test("setting a legacy room subject passes Teacher-facing refusals through and hides other errors", async () => {
  replies = [{ data: "fil", error: null }];
  assert.equal(await service.setLegacyRoomSubject("room-1", "fil"), "fil");
  assert.deepEqual(calls.at(-1), { operation: "rpc", args: ["m4_set_legacy_room_subject", { target_room: "room-1", new_subject: "fil" }] });
  replies = [{ data: null, error: { code: "23514", message: "This room has both English and Filipino readings, so its subject cannot be set." } }];
  await assert.rejects(service.setLegacyRoomSubject("room-1", "en"), /both English and Filipino readings/);
  replies = [{ data: null, error: { code: "XX000", message: "internal detail at line 4" } }];
  await assert.rejects(service.setLegacyRoomSubject("room-1", "en"), (error: Error) => !/internal detail/.test(error.message) && /Nothing was changed/.test(error.message));
});
