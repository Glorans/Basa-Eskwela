import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { beforeEach, test } from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";

// M4 Admin classroom management (proposed m4_admin_room_management): the Admin creates a room for an
// approved Teacher, edits it and assigns modules through audited database functions. These tests cover
// the service calls and the Admin Learning Rooms page; the database rules are covered by
// supabase/tests/m4_admin_room_management_test.sql.

const require = createRequire(import.meta.url);
type Reply = { data: unknown; error: unknown };
const calls: { operation: string; args: unknown[] }[] = [];
let replies: Reply[] = [];
let signedIn = "admin-1";
const client = {
  auth: { getUser: () => Promise.resolve({ data: { user: { id: signedIn } }, error: null }) },
  rpc(...args: unknown[]) {
    calls.push({ operation: "rpc", args });
    return Promise.resolve(replies.shift());
  },
  from(table: string) {
    calls.push({ operation: "from", args: [table] });
    const query: Record<string, (...args: any[]) => any> = {};
    for (const operation of ["select", "eq", "is", "in", "order", "insert", "update", "delete", "single", "maybeSingle"]) {
      query[operation] = (...args: unknown[]) => { calls.push({ operation, args }); return query; };
    }
    query.then = (resolve, reject) => Promise.resolve(replies.shift()).then(resolve, reject);
    return query;
  },
};
(globalThis as any).__m4AdminClient = client;
const serviceUrl = new URL("../src/modules/module4/services/classroomService.ts", import.meta.url).href;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL === serviceUrl && specifier.endsWith("/supabaseClient")) {
    return { url: "data:text/javascript,export const supabase = globalThis.__m4AdminClient", shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
const service = await import(serviceUrl) as typeof import("../src/modules/module4/services/classroomService.ts");

beforeEach(() => { calls.length = 0; replies = []; signedIn = "admin-1"; console.error = () => {}; });
const rpcCalls = () => calls.filter((call) => call.operation === "rpc").map((call) => call.args);

// ---------------------------------------------------------------- service

test("adminCreateClassroom checks the generated code is free, then creates through the Admin function", async () => {
  replies = [{ data: null, error: null }, { data: { id: "room-9", room_code: "X", teacher_id: "teacher-1" }, error: null }];
  const room = await service.adminCreateClassroom({ teacherId: "teacher-1", subject: "fil", roomName: " Klase ", section: "", description: "" });
  assert.equal(room.id, "room-9");
  const [[name, args]] = rpcCalls() as [[string, Record<string, string>]];
  assert.equal(name, "m4_admin_create_room");
  assert.match(args.p_room_code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  const checked = calls.find((call) => call.operation === "eq")!.args;
  assert.deepEqual(checked, ["room_code", args.p_room_code]);
  assert.deepEqual({ ...args, p_room_code: "code" }, { p_teacher_id: "teacher-1", p_room_name: " Klase ", p_section: "",
    p_description: "", p_subject: "fil", p_room_code: "code" });
});

test("adminCreateClassroom refuses a missing Teacher or subject before calling the database", async () => {
  await assert.rejects(service.adminCreateClassroom({ teacherId: "", subject: "en", roomName: "A", section: "", description: "" }), /approved Teacher/);
  await assert.rejects(service.adminCreateClassroom({ teacherId: "t", subject: "" as any, roomName: "A", section: "", description: "" }), /English or Filipino/);
  assert.equal(calls.length, 0);
});

for (const [code, message] of [["42501", /Admin access is required/], ["23505", /room code was just taken/],
  ["22023", /Select an approved Teacher/], ["XX000", /Unable to create learning room/]] as const) {
  test(`adminCreateClassroom explains database error ${code}`, async () => {
    replies = [{ data: null, error: null }, { data: null, error: { code, message: "Select an approved Teacher for this learning room." } }];
    await assert.rejects(service.adminCreateClassroom({ teacherId: "t", subject: "en", roomName: "A", section: "", description: "" }), message);
  });
}

test("getApprovedTeachersForAdmin reads the Admin-only Teacher list", async () => {
  replies = [{ data: [{ id: "t1", display_name: "Ms. Cruz" }], error: null }];
  assert.deepEqual(await service.getApprovedTeachersForAdmin(), [{ id: "t1", display_name: "Ms. Cruz" }]);
  assert.deepEqual(rpcCalls(), [["m4_admin_classroom_teachers"]]);
  replies = [{ data: null, error: { code: "42501" } }];
  await assert.rejects(service.getApprovedTeachersForAdmin(), /Unable to load approved Teachers/);
});

test("adminUpdateClassroom edits only name, section and description", async () => {
  replies = [{ data: { id: "room", room_name: "New" }, error: null }];
  await service.adminUpdateClassroom("room", { roomName: "New", section: "B", description: "" });
  assert.deepEqual(rpcCalls(), [["m4_admin_update_room", { p_room_id: "room", p_room_name: "New", p_section: "B", p_description: "" }]]);
  replies = [{ data: null, error: { code: "55000" } }];
  await assert.rejects(service.adminUpdateClassroom("room", { roomName: "New", section: "", description: "" }), /archived/);
});

test("adminAssignModuleToRoom uses the whole-class RPC and never sends a Teacher id", async () => {
  replies = [{ data: "assignment-1", error: null }];
  assert.equal(await service.adminAssignModuleToRoom("room", "mod-1"), "assignment-1");
  assert.deepEqual(rpcCalls(), [["m4_assign_module", { p_room_id: "room", p_module_id: "mod-1", p_mode: "whole_class", p_students: [], p_due_at: null }]]);
  for (const [code, message] of [["42501", /Teacher must be approved/], ["23514", /does not match the classroom subject/],
    ["55000", /archived/], ["23505", /already assigned/]] as const) {
    replies = [{ data: null, error: { code } }];
    await assert.rejects(service.adminAssignModuleToRoom("room", "mod-1"), message);
  }
});

// ---------------------------------------------------------------- F7 service: on behalf of the room's Teacher

const ROOM = "11111111-1111-4111-8111-111111111111", MATERIAL = "22222222-2222-4222-8222-222222222222";
const STUDENT = "33333333-3333-4333-8333-333333333333";
function activityReplies(roomTeacher: string, uploader: string) {
  return [{ data: { id: ROOM, teacher_id: roomTeacher }, error: null },
    { data: { id: MATERIAL, uploaded_by: uploader, extraction_status: "completed" }, error: null },
    { data: [{ student_id: STUDENT }], error: null }, { data: [], error: null }, { data: null, error: null }];
}
const inserted = () => calls.filter((call) => call.operation === "insert").map((call) => call.args[0]) as any[][];

test("F7: an Admin assignment is attributed to the room's Teacher, never to the Admin", async () => {
  replies = activityReplies("teacher-1", "teacher-1");
  await service.assignReadingActivity(ROOM, MATERIAL, [STUDENT], null, null, { asAdmin: true });
  assert.equal(inserted().length, 1);
  assert.equal(inserted()[0][0].assigned_by, "teacher-1");
  assert.equal(inserted()[0][0].status, "assigned");
});

test("F7: an Admin cannot assign a material the room's Teacher did not upload", async () => {
  replies = activityReplies("teacher-1", "teacher-2");
  await assert.rejects(service.assignReadingActivity(ROOM, MATERIAL, [STUDENT], null, null, { asAdmin: true }),
    /uploaded by this classroom's Teacher/);
  assert.equal(inserted().length, 0);
});

test("F7: without the Admin option the Teacher path is unchanged", async () => {
  signedIn = "teacher-1";
  replies = activityReplies("teacher-1", "teacher-1");
  await service.assignReadingActivity(ROOM, MATERIAL, [STUDENT]);
  assert.equal(inserted()[0][0].assigned_by, "teacher-1");
  calls.length = 0;
  signedIn = "admin-1";
  replies = activityReplies("teacher-1", "teacher-1");
  await assert.rejects(service.assignReadingActivity(ROOM, MATERIAL, [STUDENT]), /belongs to another teacher/);
  assert.equal(inserted().length, 0);
});

test("F7: Admins load the classroom Teacher's materials by owner", async () => {
  replies = [{ data: [{ id: MATERIAL, title: "Story", uploaded_by: "teacher-1", language: "English" }], error: null }];
  const materials = await service.getUploadedReadingMaterials("teacher-1");
  assert.deepEqual(calls.filter((call) => call.operation === "eq").map((call) => call.args),
    [["uploaded_by", "teacher-1"], ["extraction_status", "completed"]]);
  assert.equal(materials[0].language, "en");
});

// ---------------------------------------------------------------- Admin Learning Rooms page

const pageUrl = new URL("../src/modules/module4/pages/AdminLearningRoomsPage.tsx", import.meta.url);
const formUrl = new URL("../src/modules/module4/components/LearningRoomForm.tsx", import.meta.url);

function expand(node: any): any {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object") return node;
  if (typeof node.type === "function") return expand(node.type(node.props));
  const children = node.props?.children;
  return children === undefined ? node : { ...node, props: { ...node.props, children: expand(children) } };
}

async function mountRooms(actions: string[], { createError }: { createError?: Error } = {}) {
  const log: unknown[][] = [];
  const rooms = [{ id: "r1", room_name: "Existing room", room_code: "EXIST234", created_at: "2026-11-01", section: null, description: null }];
  const runtime = createHookRuntime(require("react"));
  const query: any = { select: () => query, order: () => Promise.resolve({ data: rooms, error: null }) };
  const stub = (id: string): unknown => {
    if (id === "react") return runtime.react;
    if (id === "react-router-dom") return { useNavigate: () => (to: string) => log.push(["navigate", to]) };
    if (id.endsWith("/supabaseClient")) return { supabase: { from: () => query } };
    if (id.endsWith("/components/LearningRoomForm")) return loadComponentModule(formUrl, stub);
    if (id.endsWith("/classroomService")) return {
      getAdminClassroomActions: async () => actions,
      getApprovedTeachersForAdmin: async () => [{ id: "t1", display_name: "Ms. Cruz" }, { id: "t2", display_name: "Mr. Santos" }],
      adminCreateClassroom: async (input: unknown) => {
        log.push(["adminCreateClassroom", input]);
        if (createError) throw createError;
        return { id: "new", room_name: "Grade 4 Readers", room_code: "NEWROOM2", created_at: "2026-11-10", section: null, description: null };
      },
    };
    return require(id);
  };
  const page = loadComponentModule(pageUrl, stub, { console: { error() {} } });
  const view = () => expand(runtime.render(page.default, {}));
  view(); for (let i = 0; i < 4; i++) await tick();
  const byId = (id: string) => findAll(view(), (node) => node.props?.id === id)[0];
  const buttons = (label: string) => findAll(view(), (node) => node.type === "button" && textOf(node) === label);
  return {
    log, view, byId, buttons, text: () => textOf(view()),
    change: (id: string, value: string) => byId(id).props.onChange({ target: { value } }),
    submit: async () => { await findAll(view(), (node) => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); await tick(); },
    open: async () => { buttons("+ Create Learning Room")[0].props.onClick(); for (let i = 0; i < 3; i++) await tick(); },
  };
}

test("without the Admin migration the Admin Learning Rooms page looks as before (no create button)", async () => {
  const page = await mountRooms(["remove_enrollment"]);
  assert.equal(page.buttons("+ Create Learning Room").length, 0);
  assert.match(page.text(), /Existing room/);
});

test("Admin creates a room for a selected approved Teacher with the shared Teacher form", async () => {
  const page = await mountRooms(["remove_enrollment", "create_room", "update_room", "assign_module", "unassign_module"]);
  await page.open();
  assert.match(page.text(), /Create Learning Room/);
  assert.doesNotMatch(page.text(), /Existing room/);
  const options = findAll(page.byId("roomTeacher"), (node) => node.type === "option").map((node) => [node.props.value, textOf(node)]);
  assert.deepEqual(options, [["", "Choose an approved Teacher"], ["t1", "Ms. Cruz"], ["t2", "Mr. Santos"]]);
  // Same fields and validation as the Teacher form.
  assert.equal(page.byId("roomName").props.required, true);
  assert.equal(page.byId("subject").props.required, true);
  page.change("roomName", "Grade 4 Readers");
  page.change("subject", "en");
  await page.submit();
  assert.match(page.text(), /Select an approved Teacher/);
  assert.equal(page.log.length, 0);
  page.change("roomTeacher", "t2");
  page.change("section", "Rizal");
  await page.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(page.log)), [["adminCreateClassroom", { teacherId: "t2", subject: "en", roomName: "Grade 4 Readers", section: "Rizal", description: "" }]]);
  assert.match(page.text(), /"Grade 4 Readers" was created for Mr\. Santos\. Room code: NEWROOM2/);
  assert.match(page.text(), /Grade 4 Readers[\s\S]*Existing room/);
  assert.equal(findAll(page.view(), (node) => node.type === "form").length, 0);
});

test("a failed Admin creation keeps the form and the entered fields", async () => {
  const page = await mountRooms(["create_room"], { createError: new Error("That room code was just taken. Please try again.") });
  await page.open();
  page.change("roomTeacher", "t1");
  page.change("roomName", "Klase");
  page.change("subject", "fil");
  await page.submit();
  assert.match(page.text(), /That room code was just taken/);
  assert.equal(page.byId("roomName").props.value, "Klase");
  assert.equal(page.byId("roomTeacher").props.value, "t1");
});

test("Cancel closes the Admin form without saving", async () => {
  const page = await mountRooms(["create_room"]);
  await page.open();
  page.change("roomName", "Unsaved");
  page.buttons("Cancel")[0].props.onClick();
  assert.equal(findAll(page.view(), (node) => node.type === "form").length, 0);
  assert.equal(page.log.length, 0);
  assert.match(page.text(), /Existing room/);
});
