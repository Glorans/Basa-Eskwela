import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";

// Behavior tests for ClassroomDetailsPage's edit-room, remove-student and
// assign-module actions: service call, failure message and list update.
// Elements are found by visible text and id, never by handler name, and child
// components are rendered, so these hold when sections move into components.

const require = createRequire(import.meta.url);
const pageUrl = new URL("../src/modules/module4/pages/ClassroomDetailsPage.tsx", import.meta.url);

const room = {
  id: "room", teacher_id: "teacher-1", room_name: "Readers", section: "Grade 4",
  room_code: "ABCD2345", description: "Morning class", created_at: "2026-10-01",
};
const students = [
  { enrollment_id: "enr-1", student_id: "stu-1", display_name: "Ana Reyes", full_name: "Ana Reyes", enrolled_at: "2026-10-02" },
  { enrollment_id: "enr-2", student_id: "stu-2", display_name: "Ben Cruz", full_name: "Ben Cruz", enrolled_at: "2026-10-03" },
];
const modules = [
  { id: "mod-1", title: "Fables", difficulty: "Easy", status: "published", language: "en" },
  { id: "mod-2", title: "Myths", difficulty: null, status: "published", language: "en" },
  { id: "mod-3", title: "Alamat", difficulty: "Easy", status: "published", language: "fil" },
  { id: "mod-4", title: "No path language", difficulty: null, status: "published", language: null },
];

type Options = {
  updateError?: unknown;
  removeError?: unknown;
  assignError?: unknown;
  confirm?: boolean;
  user?: { id: string } | null;
  /** True once the proposed due-date and unassign migrations are applied. */
  optionalColumns?: boolean;
  activities?: any[];
};

/** Replaces function-type elements with what they render, recursively. */
function expand(node: any): any {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object") return node;
  if (typeof node.type === "function") return expand(node.type(node.props));
  const children = node.props?.children;
  return children === undefined ? node : { ...node, props: { ...node.props, children: expand(children) } };
}

async function mount(options: Options = {}) {
  const calls: unknown[][] = [];
  const dialogs: string[] = [];
  const prompts: string[] = [];
  const assigned: any[] = [];
  const service = {
    getClassroomById: async () => ({ ...room }),
    getRoomEnrollments: async () => students.map((student) => ({ ...student })),
    getPublishedModules: async () => modules.map((module) => ({ ...module })),
    getAssignedModules: async (roomId: string) => {
      calls.push(["getAssignedModules", roomId]);
      return assigned.map((module) => ({ ...module }));
    },
    getUploadedReadingMaterials: async () => [{ id: "mat-1", title: "Kite story", language: "en" }],
    getClassroomReadingActivities: async () => (options.activities ?? []).map((activity) => ({ ...activity })),
    supportsOptionalColumn: async () => options.optionalColumns ?? false,
    parseOptionalDueDate: (value: string) => (value ? new Date(value).toISOString() : null),
    formatDueDateTime: (value: string) => `[${value}]`,
    setRoomModuleRemoved: async (id: string, removed: boolean) => {
      calls.push(["setRoomModuleRemoved", id, removed]);
      for (const module of assigned) if (module.assignment_id === id) module.removed_at = removed ? "2026-11-02T00:00:00Z" : null;
      return true;
    },
    setReadingActivityRemoved: async (id: string, removed: boolean) => {
      calls.push(["setReadingActivityRemoved", id, removed]);
      for (const activity of options.activities ?? []) if (activity.id === id) activity.removed_at = removed ? "2026-11-02T00:00:00Z" : null;
      return true;
    },
    getReadingActivityError: () => assert.fail("getReadingActivityError is not under test"),
    assignReadingActivity: async () => assert.fail("assignReadingActivity is not under test"),
    updateClassroom: async (roomId: string, input: { roomName: string; section: string; description: string }) => {
      calls.push(["updateClassroom", roomId, { ...input }]);
      if (options.updateError !== undefined) throw options.updateError;
      return { ...room, room_name: input.roomName.trim(), section: input.section.trim() || null, description: input.description.trim() || null };
    },
    removeEnrolledStudent: async (enrollmentId: string) => {
      calls.push(["removeEnrolledStudent", enrollmentId]);
      if (options.removeError !== undefined) throw options.removeError;
    },
    assignModuleToRoom: async (roomId: string, moduleId: string, teacherId: string, dueAt: string | null = null) => {
      calls.push(dueAt === null ? ["assignModuleToRoom", roomId, moduleId, teacherId] : ["assignModuleToRoom", roomId, moduleId, teacherId, dueAt]);
      if (options.assignError !== undefined) throw options.assignError;
      const module = modules.find((item) => item.id === moduleId)!;
      assigned.push({ assignment_id: `assignment-${assigned.length + 1}`, module_id: moduleId, title: module.title,
        difficulty: module.difficulty, assigned_at: "2026-10-18", due_at: dueAt, removed_at: null });
    },
  };
  const supabase = {
    auth: {
      getUser: async () => {
        calls.push(["getUser"]);
        return { data: { user: options.user === undefined ? { id: "teacher-1" } : options.user }, error: null };
      },
    },
  };

  const runtime = createHookRuntime(require("react"));
  const page = loadComponentModule(pageUrl, (id) => {
    if (id === "react") return runtime.react;
    if (id === "react-router-dom") return { useParams: () => ({ roomId: "room" }), Link: "a" };
    if (id.endsWith("/ReadFlowDialog")) {
      return {
        confirmReadFlow: async (message: string) => { prompts.push(message); return options.confirm ?? true; },
        showReadFlowDialog: async (message: string) => { dialogs.push(message); return true; },
      };
    }
    if (id.endsWith("/classroomService")) return service;
    if (id.endsWith("/materialService")) {
      return { getMaterialQuestionSets: async () => [], getMaterialServiceError: (_: unknown, fallback: string) => fallback };
    }
    if (id.endsWith("/supabaseClient")) return { supabase };
    return require(id);
  }, {
    console: { error() {} },
    window: { addEventListener() {}, removeEventListener() {}, setTimeout: () => 0, clearTimeout() {} },
  });

  const view = () => expand(runtime.render(page.default, {}));
  view();
  await tick();
  calls.length = 0;

  const byId = (id: string) => findAll(view(), (node) => node.props?.id === id)[0];
  const button = (label: string) => {
    const found = findAll(view(), (node) => node.type === "button" && textOf(node) === label);
    assert.equal(found.length, 1, `expected one "${label}" button`);
    return found[0];
  };
  return {
    calls, dialogs, prompts, byId, button,
    text: () => textOf(view()),
    heading: () => textOf(findAll(view(), (node) => node.type === "h1")[0]),
    alert: () => findAll(view(), (node) => node.props?.role === "alert").map(textOf).join(""),
    click: (label: string) => button(label).props.onClick(),
    change: (id: string, value: string) => byId(id).props.onChange({ target: { value } }),
    /** Submits the form that contains the element with this id. */
    submit: (fieldId: string) => findAll(view(), (node) => node.type === "form"
      && findAll(node, (child) => child.props?.id === fieldId).length > 0)[0].props.onSubmit({ preventDefault() {} }),
    /** Clicks the button with this label in the deepest element that shows this text. */
    clickFor: (text: string, label: string) => {
      const owners = findAll(view(), (node) => textOf(node).includes(text)
        && findAll(node, (child) => child.type === "button" && textOf(child) === label).length === 1);
      assert.ok(owners.length, `no "${label}" button for "${text}"`);
      findAll(owners.at(-1), (node) => node.type === "button" && textOf(node) === label)[0].props.onClick();
      // The handler confirms, saves and reloads asynchronously.
      return (async () => { for (let i = 0; i < 6; i++) await tick(); })();
    },
    /** Clicks Remove in the deepest element that shows this student's name. */
    remove: (name: string) => {
      const rows = findAll(view(), (node) => node.type === "div" && textOf(node).includes(name)
        && findAll(node, (child) => child.type === "button" && textOf(child) === "Remove").length === 1);
      return findAll(rows.at(-1), (node) => node.type === "button")[0].props.onClick();
    },
  };
}

const overview = (students: number, modules: number) =>
  `Enrolled Students${students}Assigned Reading Modules${modules}`;

// Edit room

test("editing the room saves the trimmed fields, closes the form and shows the saved room", async () => {
  const page = await mount();
  assert.equal(page.heading(), "Readers");
  page.click("✎ Edit Learning Room");
  assert.equal(page.byId("roomName").props.value, "Readers");
  page.change("roomName", "  Story Club ");
  page.change("section", "Grade 5");
  page.change("description", "");
  await page.submit("roomName");
  assert.deepEqual(page.calls, [["updateClassroom", "room", { roomName: "  Story Club ", section: "Grade 5", description: "" }]]);
  assert.equal(page.byId("roomName"), undefined);
  assert.equal(page.heading(), "Story Club");
  assert.match(page.text(), /Grade 5/);
  assert.doesNotMatch(page.text(), /Morning class/);
  assert.deepEqual(page.dialogs, []);
});

for (const [label, error, message] of [
  ["the error's message", { message: "Room update denied." }, "Room update denied."],
  ["a fallback", "offline", "Unable to update classroom."],
] as const) {
  test(`a failed room update shows ${label} and keeps the form and the saved room`, async () => {
    const page = await mount({ updateError: error });
    page.click("✎ Edit Learning Room");
    page.change("roomName", "Story Club");
    await page.submit("roomName");
    assert.deepEqual(page.dialogs, [message]);
    assert.equal(page.byId("roomName").props.value, "Story Club");
    assert.equal(page.button("Save Changes").props.disabled, false);
    page.click("Cancel");
    assert.equal(page.heading(), "Readers");
  });
}

test("a blank room name is refused before saving", async () => {
  const page = await mount();
  page.click("✎ Edit Learning Room");
  page.change("roomName", "   ");
  await page.submit("roomName");
  assert.deepEqual(page.dialogs, ["Room name is required."]);
  assert.deepEqual(page.calls, []);
  assert.equal(page.byId("roomName").props.value, "   ");
});

test("cancelling an edit discards typed changes", async () => {
  const page = await mount();
  page.click("✎ Edit Learning Room");
  page.change("roomName", "Story Club");
  page.click("Cancel");
  assert.equal(page.heading(), "Readers");
  page.click("✎ Edit Learning Room");
  assert.equal(page.byId("roomName").props.value, "Readers");
  assert.deepEqual(page.calls, []);
});

// Remove student

test("removing a student confirms by name, deletes the enrollment and updates the roster", async () => {
  const page = await mount();
  assert.match(page.text(), new RegExp(overview(2, 0)));
  await page.remove("Ana Reyes");
  assert.deepEqual(page.prompts, ["Remove Ana Reyes from this classroom?"]);
  assert.deepEqual(page.calls, [["removeEnrolledStudent", "enr-1"]]);
  assert.doesNotMatch(page.text(), /Ana Reyes/);
  assert.match(page.text(), /Ben Cruz/);
  assert.match(page.text(), new RegExp(overview(1, 0)));
  assert.deepEqual(page.dialogs, []);
});

for (const [label, error, message] of [
  ["the error's message", { message: "Removal not allowed." }, "Removal not allowed."],
  ["a fallback", 42, "Unable to remove student."],
] as const) {
  test(`a failed removal shows ${label} and keeps the roster`, async () => {
    const page = await mount({ removeError: error });
    await page.remove("Ben Cruz");
    assert.deepEqual(page.dialogs, [message]);
    assert.match(page.text(), /Ana Reyes/);
    assert.match(page.text(), /Ben Cruz/);
    assert.match(page.text(), new RegExp(overview(2, 0)));
  });
}

test("declining the confirmation removes nobody and allows asking again", async () => {
  const page = await mount({ confirm: false });
  await page.remove("Ana Reyes");
  await page.remove("Ana Reyes");
  assert.equal(page.prompts.length, 2);
  assert.deepEqual(page.calls, []);
  assert.match(page.text(), /Ana Reyes/);
});

// Assign module

test("assigning a module saves it for the signed-in teacher, reloads the list and closes the form", async () => {
  const page = await mount();
  assert.match(page.text(), /No reading modules assigned yet/);
  page.click("Assign Module");
  page.change("moduleLanguage", "en");
  page.change("readingModule", "mod-1");
  await page.submit("readingModule");
  assert.deepEqual(page.calls, [["getUser"], ["assignModuleToRoom", "room", "mod-1", "teacher-1"], ["getAssignedModules", "room"]]);
  assert.equal(page.byId("readingModule"), undefined);
  assert.doesNotMatch(page.text(), /No reading modules assigned yet/);
  assert.match(page.text(), /Fables/);
  assert.match(page.text(), new RegExp(overview(2, 1)));
  assert.equal(page.alert(), "");
  // The assigned module is no longer offered.
  page.click("Assign Module");
  const options = findAll(page.byId("readingModule"), (node) => node.type === "option").map((node) => node.props.value);
  assert.deepEqual(options, ["", "mod-2"]);
});

for (const [label, options] of [
  ["the save fails", { assignError: { message: "insert denied" } }],
  ["no teacher is signed in", { user: null }],
] as const) {
  test(`when ${label}, the module form shows an inline error and keeps the selection`, async () => {
    const page = await mount(options);
    page.click("Assign Module");
    page.change("moduleLanguage", "en");
    page.change("readingModule", "mod-1");
    await page.submit("readingModule");
    assert.equal(page.alert(), "Unable to assign reading module.");
    assert.equal(page.byId("readingModule").props.value, "mod-1");
    assert.equal(page.button("Assign Module").props.disabled, false);
    assert.match(page.text(), /No reading modules assigned yet/);
    assert.match(page.text(), new RegExp(overview(2, 0)));
    assert.equal(page.calls.some(([name]) => name === "getAssignedModules"), false);
  });
}

test("submitting without a module asks for one and saves nothing", async () => {
  const page = await mount();
  page.click("Assign Module");
  await page.submit("readingModule");
  assert.equal(page.alert(), "Please select a reading module.");
  assert.deepEqual(page.calls, []);
});

const moduleOptions = (page: Awaited<ReturnType<typeof mount>>) =>
  findAll(page.byId("readingModule"), (node) => node.type === "option").map((node) => node.props.value);

test("the classroom language decides which modules can be chosen", async () => {
  const page = await mount();
  page.click("Assign Module");
  assert.deepEqual(moduleOptions(page), [""]);
  assert.equal(page.byId("readingModule").props.disabled, true);
  assert.match(page.text(), /Select the classroom language to see matching modules/);
  page.change("moduleLanguage", "en");
  assert.deepEqual(moduleOptions(page), ["", "mod-1", "mod-2"]);
  page.change("readingModule", "mod-1");
  // Switching language drops the English choice and lists only Filipino modules.
  page.change("moduleLanguage", "fil");
  assert.deepEqual(moduleOptions(page), ["", "mod-3"]);
  assert.equal(page.byId("readingModule").props.value, "");
});

test("a module outside the classroom language is not saved", async () => {
  const page = await mount();
  page.click("Assign Module");
  page.change("moduleLanguage", "en");
  page.change("readingModule", "mod-3");
  await page.submit("readingModule");
  assert.equal(page.alert(), "Please select a reading module in the classroom language.");
  assert.deepEqual(page.calls, []);
});

const completedActivity = () => [{ id: "act-1", material_id: "mat-1", student_id: "stu-1", status: "completed",
  question_set_id: null, question_set_name: null, due_at: null, removed_at: null }];

async function assignFables(page: Awaited<ReturnType<typeof mount>>, dueAt?: string) {
  page.click("Assign Module");
  page.change("moduleLanguage", "en");
  page.change("readingModule", "mod-1");
  if (dueAt !== undefined) page.change("moduleDueAt", dueAt);
  await page.submit("readingModule");
}

test("before the optional migrations, module deadlines and Remove/Restore stay hidden", async () => {
  const page = await mount({ activities: completedActivity() });
  page.click("Assign Module");
  assert.equal(page.byId("moduleDueAt"), undefined);
  page.click("Cancel");
  await assignFables(page);
  // No due_at is sent, so the insert also works on a schema without the column.
  assert.deepEqual(page.calls[1], ["assignModuleToRoom", "room", "mod-1", "teacher-1"]);
  assert.throws(() => page.clickFor("Fables", "Remove"));
  assert.throws(() => page.clickFor("Kite story", "Remove"));
});

test("an optional module deadline is saved and shown; empty means no deadline", async () => {
  const page = await mount({ optionalColumns: true });
  await assignFables(page, "2026-11-20T16:45");
  const due = new Date("2026-11-20T16:45").toISOString();
  assert.deepEqual(page.calls[1], ["assignModuleToRoom", "room", "mod-1", "teacher-1", due]);
  assert.ok(page.text().includes(`Due [${due}]`));
  page.click("Assign Module");
  assert.equal(page.byId("moduleDueAt").props.value, "", "the field resets after saving");
  page.change("moduleLanguage", "en");
  page.change("readingModule", "mod-2");
  await page.submit("readingModule");
  assert.deepEqual(page.calls.filter((call) => call[0] === "assignModuleToRoom").at(-1), ["assignModuleToRoom", "room", "mod-2", "teacher-1"]);
});

test("declining the module removal confirmation changes nothing", async () => {
  const page = await mount({ optionalColumns: true, confirm: false });
  await assignFables(page);
  page.calls.length = 0;
  await page.clickFor("Fables", "Remove");
  assert.match(page.prompts.at(-1)!, /Remove "Fables" from this classroom\?.*saved results, reading history and XP are kept/);
  assert.deepEqual(page.calls, []);
  assert.doesNotMatch(page.text(), /Removed · hidden/);
});

test("a confirmed module removal is soft, updates the count, and Restore brings it back", async () => {
  const page = await mount({ optionalColumns: true });
  await assignFables(page);
  page.calls.length = 0;
  await page.clickFor("Fables", "Remove");
  assert.deepEqual(page.calls[0], ["setRoomModuleRemoved", "assignment-1", true]);
  assert.match(page.text(), /Removed · hidden from students/);
  assert.match(page.text(), new RegExp(overview(2, 0)));
  // A removed module is not offered again; Restore is the way back.
  page.click("Assign Module");
  const options = findAll(page.byId("readingModule"), (node) => node.type === "option").map((node) => node.props.value);
  assert.deepEqual(options, ["", "mod-2"]);
  page.click("Cancel");
  await page.clickFor("Fables", "Restore");
  assert.match(page.prompts.at(-1)!, /Restore "Fables"/);
  assert.ok(page.calls.some((call) => call[0] === "setRoomModuleRemoved" && call[2] === false));
  assert.doesNotMatch(page.text(), /Removed · hidden/);
  assert.match(page.text(), new RegExp(overview(2, 1)));
});

test("a completed reading activity is removed for one student only after confirmation, then restored", async () => {
  const page = await mount({ optionalColumns: true, activities: completedActivity() });
  await page.clickFor("Kite story", "Remove");
  assert.match(page.prompts.at(-1)!, /Remove "Kite story" for Ana Reyes\?.*saved results, reading history and XP are kept/);
  assert.deepEqual(page.calls.filter((call) => call[0] === "setReadingActivityRemoved"), [["setReadingActivityRemoved", "act-1", true]]);
  assert.match(page.text(), /Removed · hidden from the student/);
  await page.clickFor("Kite story", "Restore");
  assert.deepEqual(page.calls.filter((call) => call[0] === "setReadingActivityRemoved").at(-1), ["setReadingActivityRemoved", "act-1", false]);
  assert.doesNotMatch(page.text(), /Removed · hidden from the student/);
  // Students are never removed from the roster by these actions.
  assert.ok(!page.calls.some((call) => call[0] === "removeEnrolledStudent"));
});
