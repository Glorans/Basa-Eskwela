import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { ManagedUser } from "../src/modules/module1/services/adminUsers.ts";
import { filterManagedUsers, getManagedUserDisplayName } from "../src/modules/module1/pages/admin/userManagementFilters.ts";
import { ROLE_LABELS } from "../src/modules/module1/utils/authOnboarding.ts";

const users: ManagedUser[] = [
  {
    id: "admin-id",
    email: "admin@readflow.test",
    fullName: "M3 Test Admin",
    nickname: "Admin Nick",
    role: "admin",
    status: "active",
    createdAt: "2026-10-01T00:00:00.000Z",
  },
  {
    id: "student-id",
    email: "say123@example.invalid",
    fullName: "SAY123",
    nickname: "Bookworm",
    role: "student",
    status: "active",
    createdAt: "2026-10-01T00:00:00.000Z",
  },
  {
    id: "teacher-id",
    email: "teacher@example.com",
    fullName: "Reading Teacher",
    nickname: "Teach",
    role: "teacher",
    status: "inactive",
    createdAt: "2026-10-01T00:00:00.000Z",
  },
  {
    id: "learner-id",
    email: "learner@example.invalid",
    fullName: "Independent Reader",
    nickname: "Explorer",
    role: "general_user",
    status: "active",
    createdAt: "2026-10-01T00:00:00.000Z",
  },
];

test("search matches names and emails using trimmed, case-insensitive partial text", () => {
  assert.deepEqual(
    filterManagedUsers(users, { searchQuery: "  say  ", role: "", status: "" })
      .map((user) => user.id),
    ["student-id"],
  );
  assert.deepEqual(
    filterManagedUsers(users, { searchQuery: "@EXAMPLE.INVALID", role: "", status: "" })
      .map((user) => user.id),
    ["student-id", "learner-id"],
  );
});

test("role and status filters combine with search without mutating the source list", () => {
  const originalIds = users.map((user) => user.id);
  const result = filterManagedUsers(users, {
    searchQuery: "example.invalid",
    role: "student",
    status: "active",
  });

  assert.deepEqual(result.map((user) => user.id), ["student-id"]);
  assert.deepEqual(users.map((user) => user.id), originalIds);
});

test("All Roles retains existing Admin users while assignable role filters exclude them", () => {
  assert.equal(
    filterManagedUsers(users, { searchQuery: "", role: "", status: "" })
      .some((user) => user.role === "admin"),
    true,
  );
  assert.equal(
    filterManagedUsers(users, { searchQuery: "", role: "teacher", status: "" })
      .some((user) => user.role === "admin"),
    false,
  );
});

test("Admin user roles use the required read-only labels", async () => {
  const page = await readFile(
    new URL("../src/modules/module1/pages/admin/UserManagementPage.tsx", import.meta.url),
    "utf8",
  );

  assert.deepEqual(ROLE_LABELS, {
    system_admin: "System Admin",
    admin: "School Admin",
    teacher: "Teacher",
    student: "Student",
    general_user: "Independent Learner",
  });
  assert.match(page, /admin-users-role-readonly/);
  assert.match(page, /ROLE_LABELS\[user\.role\]/);
  assert.doesNotMatch(page, /handleRoleChange|updateManagedUserRole/);
  assert.doesNotMatch(page, /aria-label=\{`Role for/);
});

test("frontend Admin user service has no role-update request", async () => {
  const service = await readFile(
    new URL("../src/modules/module1/services/adminUsers.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(service, /updateManagedUserRole|\.patch\(|\/role/);
  assert.match(service, /getManagedUsers/);
  assert.match(service, /deleteManagedUser/);
});

for (const role of ["student", "general_user", "teacher", "admin"]) {
  test(`${role} display name uses the role preference and falls back through blank names`, () => {
    const user = { role, nickname: "  Nick  ", fullName: "  Full Name  " };
    assert.equal(getManagedUserDisplayName(user), ["student", "general_user"].includes(role) ? "Nick" : "Full Name");
    assert.equal(getManagedUserDisplayName({ ...user, nickname: "  " }), "Full Name");
    assert.equal(getManagedUserDisplayName({ ...user, fullName: "  " }), "Nick");
    assert.equal(getManagedUserDisplayName({ ...user, nickname: "", fullName: " " }), "\u2014");
    assert.equal(getManagedUserDisplayName({ ...user, nickname: "Profile", fullName: "Profile" }), "Profile");
  });
}

test("nickname-only matches are excluded from name and email search", () => {
  assert.deepEqual(filterManagedUsers(users, { searchQuery: "  BOOKworm  ", role: "student", status: "active" }).map(user => user.id), []);
  assert.deepEqual(filterManagedUsers(users, { searchQuery: "bookworm", role: "teacher", status: "" }), []);
  assert.deepEqual(filterManagedUsers(users, { searchQuery: "bookworm", role: "", status: "inactive" }), []);
});

test("Admin user table renders the role-aware display name", async () => {
  const page = await readFile(new URL("../src/modules/module1/pages/admin/UserManagementPage.tsx", import.meta.url), "utf8");
  assert.match(page, /<td>\{getManagedUserDisplayName\(user\)\}/);
});
