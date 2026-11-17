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

function mountUsers(permissions: object, users: object[], deleted: string[] = []) {
  const runtime = createHookRuntime(require("react"));
  const page = loadComponentModule(new URL("../src/modules/module1/pages/admin/UserManagementPage.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id === "react-router-dom") return { Link: "a" };
    if (id.endsWith("/components/ReadFlowDialog")) return { confirmReadFlow: async () => true };
    if (id.endsWith("/auth/useAuth")) return { useAuth: () => ({ user: { id: "me" } }) };
    if (id.endsWith("/services/adminUsers")) {
      return {
        getManagedAccounts: async () => ({ users, permissions }),
        deleteManagedUser: async (userId: string) => { deleted.push(userId); },
        getAdminUserError: (e: Error) => e.message,
      };
    }
    if (id.endsWith("/utils/authOnboarding")) return real("utils/authOnboarding.ts");
    if (id.endsWith("/userManagementFilters")) return real("pages/admin/userManagementFilters.ts");
    if (id.endsWith(".css")) return {};
    return require(id);
  });
  const render = () => runtime.render(page.default, {});
  const settle = async () => { for (let i = 0; i < 6; i++) { await tick(); render(); } };
  const rows = () => findAll(render(), (n) => n.type === "tr").slice(1);
  const rowFor = (id: string) => rows().find((r) => textOf(r).includes(`${id}@example.invalid`));
  const deleteButton = (id: string) => findAll(rowFor(id), (n) => n.type === "button")[0];
  return { render, settle, rows, rowFor, deleteButton, text: () => textOf(render()) };
}

test("System Admin User Management: all roles listed, deletes only Independent Learners and School Admins", async () => {
  const users = ["me:system_admin", "sa:admin", "il:general_user", "t:teacher", "s:student", "other:system_admin"]
    .map((x) => account(x.split(":")[0], x.split(":")[1]));
  const deleted: string[] = [];
  const m = mountUsers(SYSTEM, users, deleted);
  await m.settle();
  assert.equal(m.rows().length, 6);
  assert.match(m.text(), /delete Independent Learner and School Admin accounts/);
  const roleOptions = findAll(m.render(), (n) => n.type === "option").map((o) => o.props.value).filter((v: string) => APP_ROLES.includes(v as never));
  assert.deepEqual(roleOptions, [...APP_ROLES]);
  for (const [id, enabled] of [["me", false], ["sa", true], ["il", true], ["t", false], ["s", false], ["other", false]] as const) {
    assert.equal(m.deleteButton(id).props.disabled, !enabled, id);
  }
  assert.equal(findAll(m.rowFor("t"), (n) => n.type === "a").length, 0, "Teacher review link is School Admin only");
  assert.match(textOf(m.rowFor("sa")), /School Admin/);
  m.deleteButton("t").props.onClick();
  await m.settle();
  assert.deepEqual(deleted, [], "an out-of-scope click does nothing");
  m.deleteButton("sa").props.onClick();
  await m.settle();
  assert.deepEqual(deleted, ["sa"]);
  assert.equal(m.rowFor("sa"), undefined);
});

test("School Admin User Management: Teachers and Students only, with the existing Teacher review link", async () => {
  const m = mountUsers(SCHOOL, [account("t", "teacher"), account("s", "student")]);
  await m.settle();
  assert.match(m.text(), /view and delete Teacher and Student accounts/);
  const roleOptions = findAll(m.render(), (n) => n.type === "option").map((o) => o.props.value).filter(Boolean);
  assert.ok(roleOptions.includes("teacher") && roleOptions.includes("student"));
  assert.ok(!roleOptions.includes("general_user") && !roleOptions.includes("admin") && !roleOptions.includes("system_admin"));
  assert.equal(m.deleteButton("t").props.disabled, false);
  assert.equal(m.deleteButton("s").props.disabled, false);
  assert.equal(findAll(m.rowFor("t"), (n) => n.type === "a").length, 1);
});

function mountCreate(createSchoolAdmin: (input: object) => Promise<object>) {
  const runtime = createHookRuntime(require("react"));
  const page = loadComponentModule(new URL("../src/modules/module1/pages/admin/CreateSchoolAdminPage.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id === "react-router-dom") return { Link: "a" };
    if (id.endsWith("/services/adminUsers")) return { createSchoolAdmin, getAdminUserError: (e: Error) => e.message };
    if (id.endsWith("/utils/authOnboarding")) return real("utils/authOnboarding.ts");
    if (id.endsWith(".css")) return {};
    return require(id);
  });
  const render = () => runtime.render(page.default, {});
  const settle = async () => { for (let i = 0; i < 6; i++) { await tick(); render(); } };
  const inputs = () => findAll(render(), (n) => n.type === "input");
  const type = (index: number, value: string) => { inputs()[index].props.onChange({ target: { value } }); render(); };
  const submit = async () => { findAll(render(), (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} }); await settle(); };
  return { render, settle, type, submit, inputs, text: () => textOf(render()) };
}

test("Create School Admin validates, sends only email and name, and shows success or the server error", async () => {
  const calls: object[] = [];
  let fail = false;
  const m = mountCreate(async (input) => {
    calls.push(input);
    if (fail) throw new Error("An account with this email address already exists.");
    return { success: true, message: "School Admin account created. A password-setup email was sent." };
  });
  m.render();
  assert.equal(findAll(m.render(), (n) => n.type === "input" && n.props.type === "password").length, 0, "no password field");
  await m.submit();
  assert.match(m.text(), /Enter the School Admin's full name/);
  assert.match(m.text(), /Enter a valid email address/);
  assert.equal(calls.length, 0);

  m.type(0, "  Maria Santos ");
  m.type(1, " Principal@School.Example ");
  await m.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ email: "principal@school.example", fullName: "Maria Santos" }], "no role, no password in the request");
  assert.match(m.text(), /password-setup email was sent/);
  assert.equal(m.inputs()[0].props.value, "", "form clears after success");

  fail = true;
  m.type(0, "Maria Santos");
  m.type(1, "principal@school.example");
  await m.submit();
  assert.match(m.text(), /already exists/);
});

test("routes: System Admin reaches only M1 pages; School Admin keeps every existing Admin route", () => {
  const app = src("App.tsx");
  const block = app.slice(app.indexOf('allowedRoles={["system_admin"]}'), app.indexOf("{/* Admin (School Admin) routes */}"));
  assert.match(block, /path="\/system-admin" element=\{<M3Layout role="system_admin" \/>\}/);
  assert.deepEqual([...block.matchAll(/path="([^"]+)"/g)].map((m) => m[1]), ["/system-admin", "users", "school-admins/new", "settings"]);
  assert.equal((app.match(/"system_admin"/g) ?? []).length, 2, "system_admin appears only in its own guard and layout");
  assert.match(app, /<Route element=\{<RequireRole allowedRoles=\{\["admin"\]\} \/>\}>\s*<Route\s+path="\/m3\/admin"/);

  const layout = src("modules/module3/components/M3Layout.tsx");
  const nav = layout.slice(layout.indexOf('if (role === "system_admin") {'), layout.indexOf("return [{ label: \"Dashboard\""));
  assert.deepEqual([...nav.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]), ["User Management", "Create School Admin"]);
});

test("security: no public System/School Admin registration, no role editing, no privileged keys in the frontend", () => {
  for (const path of ["modules/module1/pages/SignupPage.tsx", "modules/module1/pages/RoleSelectionPage.tsx"]) {
    const page = src(path);
    assert.doesNotMatch(page, /system_admin|"admin"/, path);
  }
  const service = src("modules/module1/services/adminUsers.ts");
  const create = service.slice(service.indexOf("export async function createSchoolAdmin"));
  assert.match(create, /\{ email: input\.email, fullName: input\.fullName \}/);
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
  assert.match(src("pages/admin/AdminDiagnosticResultsPage.tsx"), /View completed Student reading diagnostics/);
});
