import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as onboarding from "../src/modules/module1/utils/authOnboarding.ts";

// Renders the real RequireAuth with stubbed auth state and router, using the real
// onboarding rules, and checks which element it returns for each account state.

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/components/auth/RequireAuth.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function Navigate() { return null; }
function Outlet() { return null; }

type AuthState = { user: unknown; profile: unknown; loading: boolean; profileError: boolean };
let auth: AuthState;
let pathname = "/";

const module = { exports: {} as any };
vm.runInNewContext(code, {
  module,
  exports: module.exports,
  require: (id: string) => {
    if (id === "react-router-dom") return { Navigate, Outlet, useLocation: () => ({ pathname }) };
    if (id.endsWith("/useAuth")) return { useAuth: () => auth };
    if (id.endsWith("/authOnboarding")) return onboarding;
    if (id.endsWith(".css")) return {};
    return require(id);
  },
});
const RequireAuth = module.exports.default as (props: Record<string, unknown>) => any;

const PROFILE_ALERT = "We couldn't verify your account profile. Please sign in again.";
const user = { id: "user-1" };
const profile = (fields: Record<string, unknown>) => ({
  id: "user-1", full_name: "", nickname: null, role: null, status: "active", created_at: "2026-10-01", teacher_status: null, ...fields,
});
const student = (nickname: string | null = "Reader") => profile({ role: "student", nickname });
const teacher = (teacher_status: string | null, full_name = "Ana Cruz") => profile({ role: "teacher", full_name, teacher_status });

function render(state: Partial<AuthState>, path: string, props: Record<string, unknown> = {}) {
  auth = { user, profile: null, loading: false, profileError: false, ...state };
  pathname = path;
  return RequireAuth(props);
}

function assertRedirect(element: any, to: string) {
  assert.equal(element?.type, Navigate, `expected a redirect to ${to}`);
  assert.equal(element.props.to, to);
  assert.equal(element.props.replace, true);
}

function assertOutlet(element: any) {
  assert.equal(element?.type, Outlet);
}

function assertProfileAlert(element: any) {
  assert.equal(element?.type, "div");
  assert.equal(element.props.role, "alert");
  assert.equal(element.props.className, "auth-route-status");
  assert.equal(element.props.children, PROFILE_ALERT);
}

test("loading renders nothing, even without a user", () => {
  assert.equal(render({ loading: true, user: null }, "/dashboard"), null);
  assert.equal(render({ loading: true, profile: student() }, "/dashboard"), null);
});

test("no user redirects to /login and remembers the requested path", () => {
  const element = render({ user: null }, "/m3/teacher/learning-rooms");
  assertRedirect(element, "/login");
  // The state object is created inside the vm context, so compare its fields, not its prototype.
  assert.deepEqual(Object.keys(element.props.state), ["from"]);
  assert.equal(element.props.state.from, "/m3/teacher/learning-rooms");
});

test("a profile error shows the profile alert", () => {
  assertProfileAlert(render({ profileError: true, profile: student() }, "/dashboard"));
});

test("a missing profile without an error flag shows the same alert", () => {
  assertProfileAlert(render({ profile: null }, "/dashboard"));
});

test("no role redirects to /select-role", () => {
  for (const role of [null, ""]) {
    const element = render({ profile: profile({ role }) }, "/dashboard");
    assertRedirect(element, "/select-role");
    assert.equal(element.props.state, undefined);
  }
});

test("no role renders the route when unassigned roles are allowed", () => {
  assertOutlet(render({ profile: profile({ role: null }) }, "/select-role", { allowUnassignedRole: true }));
});

test("a student without a nickname is sent to /setup-profile", () => {
  assertRedirect(render({ profile: student(null) }, "/dashboard"), "/setup-profile");
  assertRedirect(render({ profile: student("   ") }, "/dashboard"), "/setup-profile");
});

test("a student who needs setup can open /setup-profile", () => {
  assertOutlet(render({ profile: student(null) }, "/setup-profile", { allowedRoles: ["teacher", "student", "general_user"] }));
});

test("a teacher with the legacy placeholder name is sent to /setup-profile", () => {
  assertRedirect(render({ profile: teacher("approved", "New User") }, "/m3/teacher"), "/setup-profile");
});

test("a pending teacher is sent to /teacher-verification", () => {
  assertRedirect(render({ profile: teacher("pending") }, "/m3/teacher", { allowedRoles: ["teacher"] }), "/teacher-verification");
  // The Teacher Dashboard is inside the same guard: a pending Teacher cannot open it directly.
  assertRedirect(render({ profile: teacher("pending") }, "/m3/teacher/dashboard", { allowedRoles: ["teacher"] }), "/teacher-verification");
});

test("rejected and unset teacher statuses are also sent to /teacher-verification", () => {
  for (const status of ["rejected", null]) {
    assertRedirect(render({ profile: teacher(status) }, "/m3/teacher", { allowedRoles: ["teacher"] }), "/teacher-verification");
  }
});

test("an unapproved teacher can open /teacher-verification", () => {
  assertOutlet(render({ profile: teacher("pending") }, "/teacher-verification", { allowUnassignedRole: true }));
});

test("profile setup comes before teacher verification", () => {
  const unnamedPending = teacher("pending", "");
  assertRedirect(render({ profile: unnamedPending }, "/m3/teacher", { allowedRoles: ["teacher"] }), "/setup-profile");
  assertOutlet(render({ profile: unnamedPending }, "/setup-profile", { allowedRoles: ["teacher", "student", "general_user"] }));
});

test("an unrecognized role shows the profile alert", () => {
  assertProfileAlert(render({ profile: profile({ role: "superuser", full_name: "X", nickname: "X" }) }, "/dashboard"));
});

test("a role outside allowedRoles is sent to its home page", () => {
  assertRedirect(render({ profile: student() }, "/m3/teacher", { allowedRoles: ["teacher"] }), "/dashboard");
  assertRedirect(render({ profile: teacher("approved") }, "/dashboard", { allowedRoles: ["student"] }), "/m3/teacher/dashboard");
});

test("an approved teacher on an allowed route renders the route", () => {
  assertOutlet(render({ profile: teacher("approved") }, "/m3/teacher", { allowedRoles: ["teacher"] }));
});
