import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isUnapprovedTeacher, resolveUserDestination } from "../src/modules/module1/utils/authOnboarding.ts";
import { filterManagedUsers, isPendingTeacher } from "../src/modules/module1/pages/admin/userManagementFilters.ts";

test("Teacher approval fails closed; other roles retain their destinations", () => {
  for (const status of ["pending", "rejected", null, undefined, "invalid"]) {
    assert.equal(isUnapprovedTeacher("teacher", status), true);
    assert.equal(resolveUserDestination({ role: "teacher", fullName: "Maria Santos", nickname: null,
      hasCompletedDiagnostic: false, teacherStatus: status }), "/teacher-verification");
  }
  assert.equal(resolveUserDestination({ role: "teacher", fullName: "Maria Santos", nickname: null,
    hasCompletedDiagnostic: false, teacherStatus: "approved" }), "/m3/teacher/dashboard");
  for (const role of ["student", "general_user", "admin"]) assert.equal(isUnapprovedTeacher(role, null), false);
  assert.equal(resolveUserDestination({ role: "teacher", fullName: "", nickname: null,
    hasCompletedDiagnostic: false, teacherStatus: "pending" }), "/setup-profile");
});

test("pending Teacher review uses persisted status without including learners", () => {
  const base = { fullName: "Maria Santos", nickname: "", email: "teacher@example.test", createdAt: "2026-10-08", status: "active" };
  const users = [
    { ...base, id: "pending", role: "teacher", teacherStatus: "pending" as const },
    { ...base, id: "approved", role: "teacher", teacherStatus: "approved" as const },
    { ...base, id: "student", role: "student", teacherStatus: null },
  ];
  // Teacher Invitations > Pending lists exactly these users for approval.
  assert.deepEqual(users.filter(isPendingTeacher).map(({ id }) => id), ["pending"]);
  assert.deepEqual(filterManagedUsers(users, { searchQuery: "", role: "teacher", status: "" })
    .map(({ id }) => id), ["pending", "approved"]);
});

test("User Management has no separate Pending Teachers filter; review stays in Teacher Invitations", async () => {
  const read = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
  const page = await read("modules/module1/pages/admin/UserManagementPage.tsx");
  assert.doesNotMatch(page, />Pending Teachers</);
  assert.match(page, /isPendingTeacher\(user\) && \(/);
  assert.match(page, /to="\/admin\/teacher-invitations\?tab=pending">Review in Teacher Invitations/);
  const invitations = await read("modules/module1/pages/admin/TeacherInvitationsPage.tsx");
  assert.match(invitations, /tab === "pending" && <PendingTeacherApprovals \/>/);
});

test("manual Teacher URLs use the approval guard; waiting page has no Teacher tools", async () => {
  const read = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
  const guard = await read("components/auth/RequireAuth.tsx");
  assert.match(guard, /isUnapprovedTeacher\(profile.role, profile.teacher_status\)/);
  assert.match(guard, /<Navigate to="\/teacher-verification" replace/);
  const page = await read("modules/module1/pages/TeacherVerificationPage.tsx");
  assert.match(page, /Teacher Account Pending Approval/);
  assert.match(page, /registration was rejected/);
  assert.match(page, /await logout\(\)/);
  assert.match(page, /await refreshProfile\(\)/);
  assert.doesNotMatch(page, /M3Layout|UploadMaterial|LearningRooms/);
});
