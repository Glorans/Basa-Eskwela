import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";
import {
  APP_ROLES,
  getRoleHomePath,
  isAppRole,
  requiresProfileSetup,
  resolveUserDestination,
  ROLE_LABELS,
} from "../src/modules/module1/utils/authOnboarding.ts";
import { canDeleteManagedUser } from "../src/modules/module1/pages/admin/userManagementFilters.ts";

// M1 (Appendix N) with five roles: System Admin, School Admin (the existing "admin"), Teacher, Student,
// Independent Learner. The server is the authority (server/tests/m1FiveRoles.test.js); these tests cover the UI.

const require = createRequire(import.meta.url);
const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const real = (rel: string) => require(fileURLToPath(new URL(`../src/modules/module1/${rel}`, import.meta.url)));

const SYSTEM = { role: "system_admin", visibleRoles: "all" as const, deletableRoles: ["general_user", "admin"], canCreateSchoolAdmin: true };
const SCHOOL = { role: "admin", visibleRoles: ["teacher", "student"], deletableRoles: ["teacher", "student"], canCreateSchoolAdmin: false };
const account = (id: string, role: string, extra = {}) => ({
  id, role, email: `${id}@example.invalid`, fullName: `${id} name`, nickname: id, status: "active",
  createdAt: "2026-11-01T00:00:00.000Z", teacherStatus: role === "teacher" ? "pending" : null, ...extra,
});

test("five roles with the Appendix N labels; each signs in to its own home", () => {
  assert.deepEqual([...APP_ROLES], ["system_admin", "admin", "teacher", "student", "general_user"]);
  assert.deepEqual(ROLE_LABELS, {
    system_admin: "System Admin", admin: "School Admin", teacher: "Teacher", student: "Student", general_user: "Independent Learner",
  });
  assert.equal(getRoleHomePath("system_admin"), "/system-admin/users");
  assert.equal(getRoleHomePath("admin"), "/m3/admin/dashboard", "School Admin keeps the existing Admin home");
  const go = (role: string) => resolveUserDestination({ role, nickname: "N", fullName: "Full Name", hasCompletedDiagnostic: true, teacherStatus: "approved" });
  assert.equal(go("system_admin"), "/system-admin/users");
  assert.equal(go("admin"), "/m3/admin/dashboard");
  assert.equal(go("teacher"), "/m3/teacher/dashboard");
  assert.equal(go("student"), "/dashboard");
  assert.equal(go("general_user"), "/m3/general/dashboard");
  assert.equal(requiresProfileSetup("system_admin", null, null), false);
  for (const spoof of ["superadmin", "System Admin", "SYSTEM_ADMIN", "school_admin"]) assert.equal(isAppRole(spoof), false, spoof);
  assert.throws(() => go("school_admin"), /unsupported role/);
});

test("Delete is offered only inside the manager's scope and never for their own account", () => {
  const me = "me";
  for (const [perm, role, expected] of [
    [SYSTEM, "general_user", true], [SYSTEM, "admin", true], [SYSTEM, "system_admin", false],
    [SYSTEM, "teacher", false], [SYSTEM, "student", false],
    [SCHOOL, "teacher", true], [SCHOOL, "student", true], [SCHOOL, "general_user", false],
    [SCHOOL, "admin", false], [SCHOOL, "system_admin", false],
  ] as const) assert.equal(canDeleteManagedUser(perm, { id: "x", role }, me), expected, `${perm.role} -> ${role}`);
  assert.equal(canDeleteManagedUser(SYSTEM, { id: me, role: "admin" }, me), false, "never self");
  assert.equal(canDeleteManagedUser(SYSTEM, { id: "x", role: "admin" }, undefined), false, "unknown session");
  assert.equal(canDeleteManagedUser({ deletableRoles: [] }, { id: "x", role: "student" }, me), false, "no permissions = no delete");
});

function mountUsers(permissions: object, users: object[], changes: string[][] = [], confirmAnswer = true) {
  const runtime = createHookRuntime(require("react"));
  const page = loadComponentModule(new URL("../src/modules/module1/pages/admin/UserManagementPage.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id === "react-router-dom") return { Link: "a", useSearchParams: () => [new URLSearchParams()] };
    if (id.endsWith("/components/ReadFlowDialog")) return { confirmReadFlow: async (message: string, labels: { confirm: string }) => { changes.push(["confirm", labels.confirm, message]); return confirmAnswer; } };
    if (id.endsWith("/auth/useAuth")) return { useAuth: () => ({ user: { id: "me" } }) };
    if (id.endsWith("/services/adminUsers")) {
      return {
        getManagedAccounts: async () => ({ users, permissions }),
        setManagedUserStatus: async (userId: string, status: string) => { changes.push([userId, status]); return { account: { id: userId, status } }; },
        getAdminUserError: (e: Error) => e.message,
      };
    }
    if (id.endsWith("/utils/authOnboarding")) return real("utils/authOnboarding.ts");
    if (id.endsWith("/userManagementFilters")) return real("pages/admin/userManagementFilters.ts");
    if (id.endsWith("/SchoolAdminInvitationsPanel")) return { default: "SchoolAdminInvitationsPanel", SchoolAdminAuthorizationNote: "SchoolAdminAuthorizationNote" };
    if (id.endsWith(".css")) return {};
    return require(id);
  });
  const render = () => runtime.render(page.default, {});
  const settle = async () => { for (let i = 0; i < 6; i++) { await tick(); render(); } };
  const rows = () => findAll(render(), (n) => n.type === "tr").slice(1);
  const rowFor = (id: string) => rows().find((r) => textOf(r).includes(`${id}@example.invalid`));
  const statusButton = (id: string) => findAll(rowFor(id), (n) => n.type === "button")[0];
  return { render, settle, rows, rowFor, statusButton, selectTab: (role: string) => findAll(render(), (n) => n.props?.id === `school-tab-${role}`)[0].props.onClick(), text: () => textOf(render()) };
}

test("System Admin User Management: all roles listed; deactivates/reactivates only Independent Learners and School Admins", async () => {
  const users = ["me:system_admin", "sa:admin", "il:general_user", "t:teacher", "s:student", "other:system_admin"]
    .map((x) => account(x.split(":")[0], x.split(":")[1]));
  const changes: string[][] = [];
  const m = mountUsers({ ...SYSTEM, statusRoles: ["general_user", "admin"] }, users, changes);
  await m.settle();
  assert.equal(m.rows().length, 6);
  assert.match(m.text(), /deactivate and reactivate Independent Learner and School Admin accounts/);
  assert.doesNotMatch(m.text(), /Delete/, "no routine permanent deletion");
  const roleOptions = findAll(m.render(), (n) => n.type === "option").map((o) => o.props.value).filter((v: string) => APP_ROLES.includes(v as never));
  assert.deepEqual(roleOptions, [...APP_ROLES]);
  for (const [id, enabled] of [["me", false], ["sa", true], ["il", true], ["t", false], ["s", false], ["other", false]] as const) {
    if (enabled) { assert.equal(m.statusButton(id).props.disabled, false, id); assert.equal(textOf(m.statusButton(id)), "Deactivate", id); }
    else assert.equal(m.statusButton(id), undefined, id);
  }
  assert.equal(findAll(m.rowFor("t"), (n) => n.type === "a").length, 0, "Teacher review link is School Admin only");
  assert.match(textOf(m.rowFor("sa")), /School Admin/);
  assert.match(textOf(m.rowFor("t")), /Managed by School Admin/);
  assert.deepEqual(changes, [], "view-only rows have no status action");
  m.statusButton("sa").props.onClick();
  await m.settle();
  assert.equal(changes[0][0], "confirm"); assert.equal(changes[0][1], "Deactivate");
  assert.match(changes[0][2], /lose administrator access/); assert.match(changes[0][2], /records and learning history are kept/);
  assert.deepEqual(changes[1], ["sa", "inactive"]);
  assert.ok(m.rowFor("sa"), "the account stays listed");
  assert.match(textOf(m.rowFor("sa")), /Deactivated/);
  assert.equal(textOf(m.statusButton("sa")), "Reactivate");
  m.statusButton("sa").props.onClick();
  await m.settle();
  assert.equal(changes[2][1], "Reactivate");
  assert.deepEqual(changes[3], ["sa", "active"]);
  assert.match(textOf(m.rowFor("sa")), /Active/);
});

test("School Admin User Management: Teachers and Students only, with the existing Teacher review link", async () => {
  const changes: string[][] = [];
  const m = mountUsers({ ...SCHOOL, statusRoles: ["teacher", "student"] }, [account("t", "teacher"), { ...account("s", "student"), status: "inactive" }], changes);
  await m.settle();
  assert.match(m.text(), /view, deactivate and reactivate Teacher and Student accounts/);
  assert.equal(findAll(m.render(), (n) => n.props?.["aria-label"] === "Role filter").length, 0);
  assert.equal(findAll(m.render(), (n) => n.props?.role === "tab").length, 2);
  assert.equal(m.rowFor("s"), undefined);
  assert.equal(m.statusButton("t").props.disabled, false);
  m.selectTab("student");
  assert.equal(m.statusButton("s").props.disabled, false);
  assert.equal(textOf(m.statusButton("s")), "Reactivate", "a deactivated Student shows Reactivate");
  m.statusButton("s").props.onClick();
  await m.settle();
  assert.match(changes[0][2], /sign in again with the same account/);
  assert.deepEqual(changes[1], ["s", "active"]);
  m.selectTab("teacher");
  assert.equal(findAll(m.rowFor("t"), (n) => n.type === "a").length, 1);
});

test("Restore sign-in retries a reactivation that stopped before the Auth unban", async () => {
  const changes: string[][] = [];
  const m = mountUsers({ ...SCHOOL, statusRoles: ["teacher", "student"] }, [{ ...account("s", "student"), signInBlocked: true }], changes);
  await m.settle();
  m.selectTab("student");
  assert.match(textOf(m.rowFor("s")), /Active \(sign-in still blocked\)/);
  assert.equal(textOf(m.statusButton("s")), "Restore sign-in");
  m.statusButton("s").props.onClick();
  await m.settle();
  assert.match(changes[0][2], /sign-in is still blocked/);
  assert.deepEqual(changes[1], ["s", "active"]);
  assert.equal(textOf(m.statusButton("s")), "Deactivate", "reconciled");
});

test("Deactivate needs confirmation: Cancel changes nothing", async () => {
  const changes: string[][] = [];
  const m = mountUsers({ ...SCHOOL, statusRoles: ["teacher", "student"] }, [account("t", "teacher")], changes, false);
  await m.settle();
  m.statusButton("t").props.onClick();
  await m.settle();
  assert.deepEqual(changes.map((c) => c[0]), ["confirm"], "only the confirmation dialog");
  assert.equal(textOf(m.statusButton("t")), "Deactivate");
});

type DialogCall = { message: string; kind: string; labels: { title?: string; confirm?: string; cancel?: string } };
function mountCreate(createSchoolAdmin: (input: object) => Promise<object>, dialogAnswer: () => boolean = () => false) {
  const runtime = createHookRuntime(require("react"));
  const dialogs: DialogCall[] = [];
  const navigations: string[] = [];
  const page = loadComponentModule(new URL("../src/modules/module1/pages/admin/CreateSchoolAdminPage.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id === "react-router-dom") return { Link: "a", useSearchParams: () => [new URLSearchParams()], useNavigate: () => (to: string) => navigations.push(to) };
    if (id.endsWith("/components/ReadFlowDialog")) return {
      showReadFlowDialog: async (message: string, kind: string, labels: DialogCall["labels"]) => { dialogs.push({ message, kind, labels }); return dialogAnswer(); },
    };
    if (id.endsWith("/services/adminUsers")) return { createSchoolAdmin, getAdminUserError: (e: Error) => e.message,
      CONFIRMATION_METHODS: [["official_school_email", "Email from an official school address"], ["official_school_phone", "Call to the school's official phone number"]] };
    if (id.endsWith("/utils/authOnboarding")) return real("utils/authOnboarding.ts");
    if (id.endsWith(".css")) return {};
    return require(id);
  });
  const render = () => runtime.render(page.default, {});
  const settle = async () => { for (let i = 0; i < 6; i++) { await tick(); render(); } };
  const inputs = () => findAll(render(), (n) => n.type === "input");
  const type = (index: number, value: string) => { inputs()[index].props.onChange({ target: { value } }); render(); };
  const choose = (value: string) => { findAll(render(), (n) => n.type === "select")[0].props.onChange({ target: { value } }); render(); };
  const submit = async () => { findAll(render(), (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} }); await settle(); };
  const fill = () => { type(0, "Maria Santos"); type(1, "principal@school.example"); type(2, "School Principal"); type(3, "Request letter dated 2026-11-18"); choose("official_school_phone"); };
  return { render, settle, type, choose, submit, inputs, fill, dialogs, navigations, text: () => textOf(render()) };
}

test("Create School Admin requires an authorization record, sends no role or password, and shows success or the server error", async () => {
  const calls: object[] = [];
  let fail = false;
  const m = mountCreate(async (input) => {
    calls.push(input);
    if (fail) throw new Error("An account with this email address already exists.");
    return { success: true, message: "Authorization recorded and invitation sent. The account gets School Admin access only after the invitee accepts." };
  });
  m.render();
  assert.equal(findAll(m.render(), (n) => n.type === "input" && n.props.type === "password").length, 0, "no password field");
  await m.submit();
  assert.match(m.text(), /Enter the School Admin's full name/);
  assert.match(m.text(), /Enter a valid email address/);
  assert.match(m.text(), /Enter the authorization reference/);
  assert.match(m.text(), /Choose how you confirmed the request/);
  assert.match(m.text(), /Enter the position of the person who authorized it/);
  assert.equal(calls.length, 0);
  assert.equal(m.dialogs.length, 0, "no modal for validation errors");
  assert.match(m.text(), /Record the basis for approving this School Admin invitation\. This is an internal record of the System Admin’s decision\. The invitee will receive School Admin access only after accepting the invitation\./);
  assert.doesNotMatch(m.text(), /Before inviting, confirm the request|not proof of identity|no documents are collected/, "old helper text is gone");
  assert.doesNotMatch(m.text(), /Supabase|SMTP|GoTrue/, "no provider names");
  assert.doesNotMatch(m.text(), /verified/i);

  m.type(0, "  Maria Santos ");
  m.type(1, " Principal@School.Example ");
  m.type(2, " School Principal ");
  m.type(3, " Request letter dated 2026-11-18 ");
  m.choose("official_school_phone");
  await m.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ email: "principal@school.example", fullName: "Maria Santos",
    authorization: { reference: "Request letter dated 2026-11-18", confirmationMethod: "official_school_phone", authorizingPosition: "School Principal" } }],
    "no role, no password in the request");
  assert.equal(m.inputs()[0].props.value, "", "form clears after success");
  assert.doesNotMatch(m.text(), /Authorization recorded and invitation sent|View in School Accounts/, "no inline success banner");
  assert.equal(m.dialogs.length, 1, "a modal appears immediately after a successful send");
  assert.deepEqual(JSON.parse(JSON.stringify(m.dialogs[0])), { kind: "confirmation",
    message: "The authorization was recorded and the invitation has been sent. The account will receive School Admin access only after the invitee accepts the invitation.",
    labels: { title: "Invitation sent", confirm: "View School Accounts", cancel: "Close" } });
  assert.deepEqual(m.navigations, [], "Close (or Escape) stays on the page");

  fail = true;
  m.fill();
  await m.submit();
  assert.match(m.text(), /already exists/);
  assert.equal(m.dialogs.length, 1, "no success modal when the send fails");
});

test("Create School Admin success modal: View School Accounts goes to the School Accounts section; Close stays", async () => {
  let answer = true;
  const m = mountCreate(async () => ({ success: true, message: "server text is not shown" }), () => answer);
  m.render();
  m.fill();
  await m.submit();
  assert.equal(m.dialogs.length, 1);
  assert.deepEqual(m.navigations, ["/system-admin/users?section=school"]);
  answer = false;
  m.fill();
  await m.submit();
  assert.equal(m.dialogs.length, 2);
  assert.deepEqual(m.navigations, ["/system-admin/users?section=school"], "Close does not navigate");
  assert.doesNotMatch(m.text(), /server text is not shown/);
});

test("Create School Admin: simplified introduction; two submits in the same tick send one invitation and open one modal", async () => {
  const calls: object[] = [];
  const m = mountCreate(async (input) => { calls.push(input); return { success: true, message: "ok" }; });
  assert.match(m.text(), /The new School Admin will receive an email to set up their account\. Access will be granted only after the invitation is accepted\./);
  assert.doesNotMatch(m.text(), /Record your authorization decision, then send an invitation|may expire sooner/);
  m.fill();
  const form = findAll(m.render(), (n) => n.type === "form")[0];
  form.props.onSubmit({ preventDefault() {} });
  form.props.onSubmit({ preventDefault() {} });
  await m.settle();
  assert.equal(calls.length, 1, "no duplicate invitation");
  assert.equal(m.dialogs.length, 1, "one modal");
});

test("shared dialog: optional title label; native modal keeps focus handling and Escape-to-close", () => {
  const dialog = src("components/ReadFlowDialog.tsx");
  assert.match(dialog, /title\?: string/);
  assert.match(dialog, /\{labels\?\.title \?\? \(kind === "confirmation" \? "Please confirm"/, "existing titles unchanged when no title is given");
  assert.match(dialog, /showModal\(\)/, "native modal: centered, focus moves in and is trapped");
  assert.match(dialog, /onCancel=\{event => \{ event\.preventDefault\(\); finish\(false\); \}\}/, "Escape resolves false (Close)");
});

test("routes: System Admin M1 pages remain isolated alongside M3 and M7 (F2, F4); School Admin keeps its routes", () => {
  const app = src("App.tsx");
  const block = app.slice(app.indexOf('allowedRoles={["system_admin"]}'), app.indexOf("{/* Admin (School Admin) routes */}"));
  assert.match(block, /path="\/system-admin" element=\{<M3Layout role="system_admin" \/>\}/);
  assert.deepEqual([...block.matchAll(/path="([^"]+)"/g)].map((m) => m[1]).filter(path => !path.startsWith("content")), ["/system-admin", "users", "school-admins/new", "analytics", "independent-learners", "settings"]);
  assert.equal((app.match(/allowedRoles=\{\["system_admin"\]\}/g) ?? []).length, 1, "System Admin has its own route guard");
  assert.match(app, /<Route element=\{<RequireRole allowedRoles=\{\["admin"\]\} \/>\}>\s*<Route\s+path="\/m3\/admin"/);

  const layout = src("modules/module3/components/M3Layout.tsx");
  const nav = layout.slice(layout.indexOf('if (role === "system_admin") {'), layout.indexOf("return [{ label: \"Dashboard\""));
  assert.deepEqual([...nav.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]), ["Content Management", "Create Module", "Reading Materials", "Upload Material", "User Management", "Platform Analytics", "Independent Learners", "Try Assessment"]);
});

test("security: no public System/School Admin registration, no role editing, no privileged keys in the frontend", () => {
  for (const path of ["modules/module1/pages/SignupPage.tsx", "modules/module1/pages/RoleSelectionPage.tsx"]) {
    const page = src(path);
    assert.doesNotMatch(page, /system_admin|"admin"/, path);
  }
  const service = src("modules/module1/services/adminUsers.ts");
  const start = service.indexOf("export async function createSchoolAdmin");
  const create = service.slice(start, service.indexOf("\nexport ", start + 1));
  assert.match(create, /\{ email: input\.email, fullName: input\.fullName, authorization: input\.authorization \}/);
  assert.doesNotMatch(create, /role|password/i);
  for (const path of ["modules/module1/pages/admin/UserManagementPage.tsx", "modules/module1/pages/admin/CreateSchoolAdminPage.tsx", "modules/module1/services/adminUsers.ts"]) {
    const file = src(path);
    assert.doesNotMatch(file, /service_role|SERVICE_ROLE|auth\.admin|updateManagedUserRole|handleRoleChange/, path);
  }
});

test("School Admin screens describe Teacher and Student scope only (no Independent Learner totals)", () => {
  const dashboard = src("pages/dashboard/AdminDashboard.tsx");
  assert.doesNotMatch(dashboard, /general_user|Independent Learner/, "no Independent Learner card or count");
  assert.match(src("modules/module7/components/AdminAnalyticsSections.tsx"), /Student readings and .* Student quizzes completed outside a classroom/);
  assert.match(src("pages/admin/AdminDiagnosticResultsPage.tsx"), /View Student reading diagnostic results and history/);
  // M2 F3: the single-school scope is stated on the page.
  assert.match(src("pages/admin/AdminDiagnosticResultsPage.tsx"), /School Admins currently see all Students\. Independent Learners are not shown\./);
});
