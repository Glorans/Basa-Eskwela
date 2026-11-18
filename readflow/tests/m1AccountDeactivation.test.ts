import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { accountStatusLabel, accountStatusView, canChangeManagedUserStatus, isDeactivated } from "../src/modules/module1/pages/admin/userManagementFilters.ts";
import { DEACTIVATED_ACCOUNT_MESSAGE, getLoginErrorMessage, runLoginFlow } from "../src/modules/module1/services/authLoginFlow.ts";

const SYSTEM = { statusRoles: ["general_user", "admin"] };
const SCHOOL = { statusRoles: ["teacher", "student"] };

test("Deactivate/Reactivate is offered only inside the manager's scope, never for their own account", () => {
  for (const [perm, role, expected] of [
    [SYSTEM, "general_user", true], [SYSTEM, "admin", true], [SYSTEM, "system_admin", false], [SYSTEM, "teacher", false], [SYSTEM, "student", false],
    [SCHOOL, "teacher", true], [SCHOOL, "student", true], [SCHOOL, "admin", false], [SCHOOL, "system_admin", false], [SCHOOL, "general_user", false],
  ] as const) assert.equal(canChangeManagedUserStatus(perm, { id: "x", role }, "me"), expected, `${role}`);
  assert.equal(canChangeManagedUserStatus(SYSTEM, { id: "me", role: "admin" }, "me"), false, "never self");
  assert.equal(canChangeManagedUserStatus(SYSTEM, { id: "x", role: "admin" }, undefined), false, "unknown session");
  assert.equal(canChangeManagedUserStatus({ statusRoles: [] }, { id: "x", role: "student" }, "me"), false);
});

test("a partial failure is visible and retryable: the action re-applies the stored status", () => {
  assert.deepEqual(accountStatusView({ status: "active", signInBlocked: false }), { label: "Active", action: "Deactivate", target: "inactive", needsRetry: false });
  assert.deepEqual(accountStatusView({ status: "inactive", signInBlocked: true }), { label: "Deactivated", action: "Reactivate", target: "active", needsRetry: false });
  assert.deepEqual(accountStatusView({ status: "active", signInBlocked: true }),
    { label: "Active (sign-in still blocked)", action: "Restore sign-in", target: "active", needsRetry: true }, "reactivation stopped before the unban");
  assert.deepEqual(accountStatusView({ status: "inactive", signInBlocked: false }),
    { label: "Deactivated (sign-in not blocked)", action: "Block sign-in", target: "inactive", needsRetry: true });
  assert.equal(accountStatusView({ status: "active", signInBlocked: null }).action, "Deactivate", "no Auth user: plain status");
});

test("status is shown as text (Active / Deactivated), not by colour alone", () => {
  assert.equal(accountStatusLabel({ status: "active" }), "Active");
  assert.equal(accountStatusLabel({ status: "inactive" }), "Deactivated");
  assert.equal(isDeactivated({ status: "inactive" }), true);
  assert.equal(isDeactivated({ status: "active" }), false);
});

test("the browser sends only the target id and the requested status; the server decides everything else", () => {
  const service = readFileSync(new URL("../src/modules/module1/services/adminUsers.ts", import.meta.url), "utf8");
  const fn = service.slice(service.indexOf("export async function setManagedUserStatus"), service.indexOf("export async function reviewTeacherRegistration"));
  assert.match(fn, /`\/api\/admin\/users\/\$\{encodeURIComponent\(userId\)\}\/status`/);
  assert.match(fn, /\{ status \}/);
  assert.doesNotMatch(fn, /role|actor|auth\.admin|service_role/i);
  assert.doesNotMatch(service, /deleteManagedUser|api\.delete\(/, "the browser has no permanent-deletion request");
  const page = readFileSync(new URL("../src/modules/module1/pages/admin/UserManagementPage.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /deleteManagedUser|handleDelete|>Delete</, "routine permanent deletion is no longer offered");
});

test("a deactivated account signing in sees a clear message; other sign-in errors are unchanged", async () => {
  const deps = (error: { message: string; code?: string } | null) => ({
    login: async () => ({ data: { user: error ? null : { id: "u" } }, error }),
    getProfile: async () => ({}) as never, resolveDestination: async () => "/home",
  });
  await assert.rejects(runLoginFlow("a@example.invalid", "pw", deps({ message: "User is banned", code: "user_banned" })), (e) => getLoginErrorMessage(e) === DEACTIVATED_ACCOUNT_MESSAGE);
  await assert.rejects(runLoginFlow("a@example.invalid", "pw", deps({ message: "User is banned" })), (e) => getLoginErrorMessage(e) === DEACTIVATED_ACCOUNT_MESSAGE);
  await assert.rejects(runLoginFlow("a@example.invalid", "pw", deps({ message: "Invalid login credentials", code: "invalid_credentials" })), (e) => getLoginErrorMessage(e) === "Invalid login credentials");
  assert.equal(await runLoginFlow("a@example.invalid", "pw", deps(null)), "/home");
});
