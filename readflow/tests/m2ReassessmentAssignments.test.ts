import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";

// M2 F9 Assign Reassessment, frontend. Synthetic data only; no network.
const require = createRequire(import.meta.url);
const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test("routes: the assignment page exists only for School Admin and Teacher", () => {
  const app = src("App.tsx");
  assert.equal((app.match(/<ReassessmentAssignmentsPage role=/g) ?? []).length, 2);
  const admin = app.slice(app.indexOf('path="/admin"'), app.indexOf("{/* Teacher routes */}"));
  assert.match(admin, /path="reassessment-assignments" element=\{<ReassessmentAssignmentsPage role="admin" \/>\}/);
  const teacher = app.slice(app.indexOf('<RequireRole allowedRoles={["teacher"]} />'));
  assert.match(teacher.slice(0, teacher.indexOf("</Route>\n        </Route>")), /path="reassessment-assignments" element=\{<ReassessmentAssignmentsPage role="teacher" \/>\}/);
  const sa = app.slice(app.indexOf('<RequireRole allowedRoles={["system_admin"]} />'), app.indexOf("{/* Admin (School Admin) routes */}"));
  assert.doesNotMatch(sa, /ReassessmentAssignments/);
  assert.doesNotMatch(app.slice(app.indexOf('<RequireRole allowedRoles={["general_user"]} />')), /ReassessmentAssignments/);
});

test("navigation: Assessment > Assignments for School Admin and Teacher; none for System Admin or learners", () => {
  const layout = src("modules/module3/components/M3Layout.tsx");
  const nav = src("modules/module2/components/AssessmentNavigation.tsx");
  // School Admin and Teacher: one expandable Assessment group each (Packages, Assignments); System Admin keeps its own.
  assert.equal((layout.match(/label: "Assessment", to: ASSESSMENT_GROUP/g) ?? []).length, 2);
  assert.match(layout, /role === "system_admin" && <AssessmentNavigation/);
  assert.match(layout, /<AssessmentNavigation key=\{to\} role=\{role === "admin" \? "admin" : "teacher"\}/);
  assert.doesNotMatch(layout, /label: "Reassessment (Packages|Assignments)"|label: "Try Assessment"/, "no separate sidebar entries any more");
  assert.equal((nav.match(/label: "Assignments", to: "\/admin\/reassessment-assignments"/g) ?? []).length, 1);
  assert.equal((nav.match(/label: "Assignments", to: "\/m3\/teacher\/reassessment-assignments"/g) ?? []).length, 1);
  const sa = layout.slice(layout.indexOf('if (role === "system_admin") {'), layout.indexOf('return [{ label: "Dashboard"'));
  assert.doesNotMatch(sa, /Assignments|reassessment-assignments/);
  const general = layout.slice(layout.indexOf('if (role === "general_user")'));
  assert.doesNotMatch(general.slice(0, general.indexOf("return items")), /Reassessment Assignments|Reassessment Packages|reassessment-assignments/,
    "Independent Learners get no staff assignment or package entries");
  const sidebar = src("components/basa/BasaSidebar.tsx");
  assert.doesNotMatch(sidebar, /reassessment-assignments|Reassessment Assignments/);
  assert.equal((sidebar.match(/to: "\/dashboard\/reassessments"/g) ?? []).length, 1, "only the Student's own My Reassessments link");
});

function loadService(calls: [string, string, unknown][], respond: (method: string, url: string, body?: unknown) => unknown = () => ({ data: {} })) {
  const client = Object.fromEntries(["get", "post"].map((method) => [method, async (url: string, a?: unknown, b?: unknown) => {
    calls.push([method, url, method === "get" ? (a as { params?: unknown })?.params ?? null : a]);
    void b;
    return respond(method, url, a);
  }]));
  return loadComponentModule(new URL("../src/modules/module2/services/reassessments.ts", import.meta.url), (id) => {
    if (id.endsWith("/AssessmentBackButton")) return { default: "AssessmentBackButton" }; if (id.endsWith("/TryInitialDiagnosticLink")) return { default: "TryInitialDiagnosticLink" }; if (id.endsWith("module1/utils/authOnboarding")) return require(new URL("../src/modules/module1/utils/authOnboarding.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
    if (id === "axios") return { default: { isAxiosError: (e: { isAxiosError?: boolean }) => Boolean(e?.isAxiosError) } };
    if (id.endsWith("/services/api")) return { default: client };
    if (id.endsWith("/services/authHeaders")) return { getSessionAuthHeaders: async () => ({ Authorization: "Bearer synthetic" }) };
    return require(id);
  }, { Intl });
}

test("service: endpoints, query parameters, encoded ids, and refusal details", async () => {
  const calls: [string, string, unknown][] = [];
  const service = loadService(calls);
  await service.getAssignmentOverview();
  await service.getAssignablePackages("room-1");
  await service.getRoomRoster("room/1", "v1");
  await service.listReassessmentAssignments("active");
  await service.createReassessmentAssignments({ roomId: "r", packageVersionId: "v", mode: "selected", studentIds: ["s"] });
  await service.cancelReassessmentAssignment("a?1", "Wrong Student");
  assert.deepEqual(plain(calls), [
    ["get", "/api/reassessments/overview", null],
    ["get", "/api/reassessments/assignable-packages", { roomId: "room-1" }],
    ["get", "/api/reassessments/rooms/room%2F1/students", { packageVersionId: "v1" }],
    ["get", "/api/reassessments/assignments", { status: "active" }],
    ["post", "/api/reassessments/assignments", { roomId: "r", packageVersionId: "v", mode: "selected", studentIds: ["s"] }],
    ["post", "/api/reassessments/assignments/a%3F1/cancel", { reason: "Wrong Student" }],
  ]);
  const refused = loadService([], () => { throw { isAxiosError: true, response: { data: { code: "STUDENTS_INELIGIBLE", message: "Nothing was assigned.",
    ineligible: [{ studentId: "s", name: "Ben", reason: "Already assigned this package version" }] } } }; });
  await assert.rejects(refused.createReassessmentAssignments({ roomId: "r", packageVersionId: "v", mode: "selected", studentIds: ["s"] }), (e: any) => {
    assert.equal(e.code, "STUDENTS_INELIGIBLE");
    assert.deepEqual(plain(e.ineligible), [{ studentId: "s", name: "Ben", reason: "Already assigned this package version" }]);
    return true;
  });
});

test("dates: stored instants are shown in Philippine time; the earliest due date is today in Manila", () => {
  const service = loadService([]);
  assert.equal(service.formatManilaDate("2026-11-19T15:59:59.000Z"), "Nov 19, 2026", "23:59:59 +08:00 stays on the 19th");
  assert.equal(service.formatManilaDate("2026-11-18T16:30:00.000Z"), "Nov 19, 2026", "00:30 in Manila is already the 19th");
  assert.equal(service.formatManilaDate(null), "");
  assert.equal(service.manilaToday(new Date("2026-11-18T23:30:00Z")), "2026-11-19");
});

const ROOM = { id: "room-a", name: "Room A", subject: "en" };
const READY = { packageId: "p1", versionId: "v1", versionLabel: "1.0", title: "River Story", category: "teacher", language: "en", eligible: true, reason: null };
const UNENDORSED = { packageId: "p2", versionId: "v2", versionLabel: "1.0", title: "Draft Story", category: "teacher", language: "en", eligible: false, reason: "Not published in the library" };
const ASSIGNMENT = { id: "a1", status: "active", language: "en", packageTitle: "River Story", versionLabel: "1.0", roomId: "room-a", roomName: "Room A",
  studentId: "s1", studentName: "Ana", assignedBy: "Teacher One", assignedAt: "2026-11-19T02:00:00Z", dueAt: "2026-11-25T15:59:59Z",
  completedAt: null, cancelledAt: null, cancelledBy: null, cancelReason: null };

function mountPage({ enabled = true, rooms = [ROOM], packages = [READY, UNENDORSED], assignments = [ASSIGNMENT] as unknown[],
  create = async (_input: unknown, _real?: any) => ({ created: 1, skipped: [], assignments: [] }) as unknown } = {}) {
  const runtime = createHookRuntime(require("react"));
  const calls: unknown[][] = [];
  const real = loadService([]);
  const mod = loadComponentModule(new URL("../src/modules/module2/pages/ReassessmentAssignmentsPage.tsx", import.meta.url), (id) => {
    if (id.endsWith("/AssessmentBackButton")) return { default: "AssessmentBackButton" }; if (id.endsWith("/TryInitialDiagnosticLink")) return { default: "TryInitialDiagnosticLink" }; if (id.endsWith("module1/utils/authOnboarding")) return require(new URL("../src/modules/module1/utils/authOnboarding.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id.endsWith("/services/reassessments")) return {
      ...real,
      getAssignmentOverview: async () => ({ enabled, rooms, packages }),
      getAssignablePackages: async (roomId: string) => { calls.push(["packages", roomId]); return { enabled, packages }; },
      getRoomRoster: async (roomId: string, version?: string) => {
        calls.push(["roster", roomId, version ?? null]);
        return { room: { id: roomId, name: "Room A" }, students: [
          { id: "s1", name: "Ana", reason: version ? "Already has an active English reassessment" : null },
          { id: "s2", name: "Ben", reason: null }, { id: "s3", name: "Carla", reason: null }] };
      },
      listReassessmentAssignments: async (status?: string) => { calls.push(["list", status ?? null]); return { enabled, assignments }; },
      createReassessmentAssignments: async (input: unknown) => { calls.push(["create", input]); return create(input, real); },
      cancelReassessmentAssignment: async (id: string, reason: string) => { calls.push(["cancel", id, reason]); return { assignment: {} }; },
    };
    return require(id);
  }, { Intl });
  const render = () => runtime.render(mod.default, { role: "teacher" });
  const settle = async () => { for (let i = 0; i < 6; i++) { await tick(); render(); } return render(); };
  return { render, settle, calls };
}
const button = (tree: any, label: RegExp) => findAll(tree, (n) => n.type === "button" && label.test(textOf(n)))[0];
const select = (tree: any, index: number) => findAll(tree, (n) => n.type === "select")[index];

test("gate OFF: the page explains that official reassessment is not enabled and the Assign button stays disabled", async () => {
  const page = mountPage({ enabled: false });
  page.render();
  let tree = await page.settle();
  assert.match(textOf(tree), /Official reassessment is not enabled yet/);
  assert.match(textOf(tree), /Students cannot take reassessments yet/);
  select(tree, 0).props.onChange({ target: { value: "room-a" } });
  tree = await page.settle();
  select(tree, 1).props.onChange({ target: { value: "v1" } });
  tree = await page.settle();
  const checkbox = findAll(tree, (n) => n.type === "input" && n.props.type === "checkbox")[1];
  checkbox.props.onChange();
  tree = page.render();
  assert.equal(button(tree, /Assign to 1 Student$/).props.disabled, true);
});

test("Teacher flow: room -> only eligible packages offered, reasons for the rest -> roster with reasons -> assign selected", async () => {
  const page = mountPage();
  page.render();
  let tree = await page.settle();
  assert.match(textOf(tree), /Assign your published reassessment packages/);
  select(tree, 0).props.onChange({ target: { value: "room-a" } });
  tree = await page.settle();
  const options = findAll(select(tree, 1), (n) => n.type === "option").map((o) => textOf(o));
  assert.deepEqual(options, ["Choose a package", "River Story · English · Version 1.0"], "ineligible packages are not selectable");
  assert.match(textOf(tree), /1 package not available/);
  assert.match(textOf(tree), /Draft Story: Not published in the library/);
  select(tree, 1).props.onChange({ target: { value: "v1" } });
  tree = await page.settle();
  assert.match(textOf(tree), /Anas*Already has an active English reassessment/, "the reason sits right under the Student");
  const boxes = findAll(tree, (n) => n.type === "input" && n.props.type === "checkbox");
  assert.equal(boxes[0].props.disabled, true, "an ineligible Student cannot be selected");
  boxes[1].props.onChange(); tree = page.render();
  findAll(tree, (n) => n.type === "input" && n.props.type === "checkbox")[2].props.onChange(); tree = page.render();
  findAll(tree, (n) => n.type === "input" && n.props.type === "date")[0].props.onChange({ target: { value: "2026-11-25" } });
  tree = page.render();
  assert.match(textOf(tree), /Students who join the room later are not assigned automatically/);
  button(tree, /Assign to 2 Students/).props.onClick();
  tree = await page.settle();
  const create = page.calls.find((c) => c[0] === "create");
  assert.deepEqual(plain(create![1]), { roomId: "room-a", packageVersionId: "v1", mode: "selected", studentIds: ["s2", "s3"], dueDate: "2026-11-25" });
  assert.match(textOf(tree), /Assigned "River Story" to 1 Student\./);
});

test("whole room: 'All eligible Students enrolled now' sends no list; skipped Students are reported", async () => {
  const page = mountPage({ create: async () => ({ created: 2, skipped: [{ studentId: "s1", name: "Ana", reason: "x" }], assignments: [] }) });
  page.render();
  let tree = await page.settle();
  select(tree, 0).props.onChange({ target: { value: "room-a" } }); tree = await page.settle();
  select(tree, 1).props.onChange({ target: { value: "v1" } }); tree = await page.settle();
  findAll(tree, (n) => n.type === "input" && n.props.type === "radio")[1].props.onChange(); tree = page.render();
  assert.match(textOf(tree), /All eligible Students enrolled now \(2\)/);
  button(tree, /Assign to 2 Students/).props.onClick();
  tree = await page.settle();
  assert.deepEqual(plain(page.calls.find((c) => c[0] === "create")![1]), { roomId: "room-a", packageVersionId: "v1", mode: "all_eligible" });
  assert.match(textOf(tree), /Assigned "River Story" to 2 Students\. 1 Student was not eligible and not assigned\./);
});

test("refusals are shown with each Student's reason; nothing is reported as assigned", async () => {
  // The error comes from the same service module instance the page uses (one sandbox realm, as in the browser).
  const page = mountPage({ create: async (_input, real) => { throw new real.ReassessmentRequestError("Some selected Students cannot receive this package. Nothing was assigned.",
    "STUDENTS_INELIGIBLE", [{ studentId: "s2", name: "Ben", reason: "Already assigned this package version" }]); } });
  page.render();
  let tree = await page.settle();
  select(tree, 0).props.onChange({ target: { value: "room-a" } }); tree = await page.settle();
  select(tree, 1).props.onChange({ target: { value: "v1" } }); tree = await page.settle();
  findAll(tree, (n) => n.type === "input" && n.props.type === "checkbox")[1].props.onChange(); tree = page.render();
  button(tree, /Assign to 1 Student/).props.onClick();
  tree = await page.settle();
  assert.match(textOf(tree), /Nothing was assigned\.Ben: Already assigned this package version/);
  assert.doesNotMatch(textOf(tree), /Assigned "/);
});

test("assignment table: Philippine dates, status, and cancellation only with a reason", async () => {
  const cancelled = { ...ASSIGNMENT, id: "a2", status: "cancelled", cancelledAt: "2026-11-19T03:00:00Z", cancelledBy: "School Admin", cancelReason: "Wrong room" };
  const page = mountPage({ assignments: [ASSIGNMENT, cancelled] });
  page.render();
  let tree = await page.settle();
  const text = textOf(tree);
  assert.match(text, /AnaRiver Story · English · Version 1\.0Room ANov 19, 2026 by Teacher OneNov 25, 2026Active/);
  assert.match(text, /Cancelled Wrong room \(School Admin, Nov 19, 2026\)/);
  assert.equal(findAll(tree, (n) => n.type === "button" && textOf(n) === "Cancel").length, 1, "only the active assignment can be cancelled");
  button(tree, /^Cancel$/).props.onClick(); tree = page.render();
  assert.equal(button(tree, /Confirm Cancel/).props.disabled, true, "a reason is required");
  findAll(tree, (n) => n.type === "input" && n.props.maxLength === 500)[0].props.onChange({ target: { value: "Assigned by mistake" } });
  tree = page.render();
  button(tree, /Confirm Cancel/).props.onClick();
  await page.settle();
  assert.deepEqual(plain(page.calls.find((c) => c[0] === "cancel")), ["cancel", "a1", "Assigned by mistake"]);
});
