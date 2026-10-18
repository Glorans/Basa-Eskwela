import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isUnapprovedTeacher, resolveUserDestination } from "../src/modules/module1/utils/authOnboarding.ts";
import { filterManagedUsers } from "../src/modules/module1/pages/admin/userManagementFilters.ts";

test("Teacher approval fails closed; other roles retain their destinations", () => {
  for (const status of ["pending", "rejected", null, undefined, "invalid"]) {
    assert.equal(isUnapprovedTeacher("teacher", status), true);
    assert.equal(resolveUserDestination({ role: "teacher", fullName: "Maria Santos", nickname: null,
      hasCompletedDiagnostic: false, teacherStatus: status }), "/teacher-verification");
  }
  assert.equal(resolveUserDestination({ role: "teacher", fullName: "Maria Santos", nickname: null,
    hasCompletedDiagnostic: false, teacherStatus: "approved" }), "/m3/teacher");
  for (const role of ["student", "general_user", "admin"]) assert.equal(isUnapprovedTeacher(role, null), false);
  assert.equal(resolveUserDestination({ role: "teacher", fullName: "", nickname: null,
    hasCompletedDiagnostic: false, teacherStatus: "pending" }), "/setup-profile");
});

test("Pending Teachers filter uses persisted status without including learners", () => {
  const base = { fullName: "Maria Santos", nickname: "", email: "teacher@example.test", createdAt: "2026-10-08", status: "active" };
  const users = [
    { ...base, id: "pending", role: "teacher", teacherStatus: "pending" as const },
    { ...base, id: "approved", role: "teacher", teacherStatus: "approved" as const },
    { ...base, id: "student", role: "student", teacherStatus: null },
  ];
  assert.deepEqual(filterManagedUsers(users, { searchQuery: "", role: "", status: "", pendingTeachers: true })
    .map(({ id }) => id), ["pending"]);
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
