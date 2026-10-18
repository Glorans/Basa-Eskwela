import assert from "node:assert/strict";
import test from "node:test";
import { getProfileDisplayName, getEditableProfileValue } from "../src/modules/module1/utils/profileFields.ts";
import { getFullNameValidationError, requiresProfileSetup } from "../src/modules/module1/utils/authOnboarding.ts";
import { getManagedUserDisplayName, filterManagedUsers } from "../src/modules/module1/pages/admin/userManagementFilters.ts";

test("all role displays reject legacy sentinel variants and preserve real fallback names", () => {
  for (const role of ["student", "general_user", "teacher", "admin"]) {
    for (const legacy of ["New User", "new user", "NEW USER", " New User "]) {
      const profile = { role, nickname: legacy, full_name: legacy };
      assert.equal(getProfileDisplayName(profile), "\u2014");
      assert.equal(getEditableProfileValue(profile), "");
      assert.equal(getManagedUserDisplayName({ role, nickname: legacy, fullName: legacy }), "\u2014");
      assert.equal(getProfileDisplayName({ ...profile, nickname: "Real Nickname" }), "Real Nickname");
      assert.equal(getProfileDisplayName({ ...profile, full_name: "Real Full Name" }), "Real Full Name");
      if (role !== "admin") assert.equal(requiresProfileSetup(role, legacy, legacy), true);
      assert.notEqual(getFullNameValidationError(legacy), "");
    }
  }
  assert.equal(getProfileDisplayName(null), "\u2014");
  assert.equal(getFullNameValidationError("New Userton"), "");
});

test("Admin search matches persisted nickname, legacy full name and account email without inventing status", () => {
  const user = { id: "account", nickname: "Reader", fullName: "Legal Name", email: "reader@example.test", role: "student", status: "", createdAt: "2026-10-08" };
  for (const searchQuery of ["READER", "legal", "example.test"]) {
    assert.deepEqual(filterManagedUsers([user], { searchQuery, role: "", status: "" }), [user]);
  }
  assert.deepEqual(filterManagedUsers([user], { searchQuery: "", role: "", status: "active" }), []);
});
