import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getProfileDisplayName, getProfileInitials } from "../src/modules/module1/utils/profileFields.ts";
import { requiresProfileSetup, getNicknameValidationError, ROLE_LABELS } from "../src/modules/module1/utils/authOnboarding.ts";
const source = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
for (const [role, nickname, full_name, name, label] of [
  ["student", " Mariel ", "Legal Name", "Mariel", "Student"],
  ["general_user", " Pan ", "", "Pan", "Independent Learner"],
  ["general_user", "Pan", "Legal Name", "Pan", "Independent Learner"],
  ["teacher", "Ana", " Ana Cruz ", "Ana Cruz", "Teacher"],
  ["admin", "Admin", " Admin User ", "Admin User", "School Admin"],
  ["system_admin", "", " Sys Admin ", "Sys Admin", "System Admin"],
] as const) test(`${role} resolves ${name} and ${label}`, () => {
  assert.equal(getProfileDisplayName({ role, nickname, full_name }), name);
  assert.equal(ROLE_LABELS[role], label);
});
test("legacy placeholders fall back and require learner setup without rejecting normal names", () => {
  for (const role of ["student", "general_user"]) {
    for (const nickname of ["New User", " new USER ", ""]) {
      assert.equal(getProfileDisplayName({ role, nickname, full_name: "Valid Name" }), "Valid Name");
      assert.equal(getProfileDisplayName({ role, nickname, full_name: "New User" }), "\u2014");
      assert.equal(requiresProfileSetup(role, nickname, "Valid Name"), true);
    }
    assert.equal(requiresProfileSetup(role, "New Userton", ""), false);
  }
  assert.notEqual(getNicknameValidationError(" New User "), "");
  assert.equal(getNicknameValidationError("New Userton"), "");
  assert.equal(getProfileDisplayName({ role: "teacher", nickname: "Ana", full_name: " " }), "Ana");
  assert.equal(getProfileInitials({ role: "teacher", nickname: null, full_name: "Ana Cruz" }), "AC");
});
test("both layouts reuse the account menu and existing Settings routes", async () => {
 const basa = await source("components/basa/BasaHeader.tsx");
 const m3 = await source("modules/module3/components/M3Layout.tsx");
 for (const layout of [basa,m3]) assert.match(layout, /<ProfileDropdown/);
 assert.match(basa, /settingsPath="\/dashboard\/settings"/);
 for (const role of ["admin","teacher","general"]) assert.ok(m3.includes(`/m3/${role}/settings`));
 assert.ok(m3.includes("/system-admin/settings"));
 const app = await source("App.tsx");
 assert.equal(app.match(/<Route\s+path="settings"\s+element=\{<Settings\s*\/>\}\s*\/>/g)?.length,5);
});

test("sidebars contain module navigation without duplicate Settings or Logout", async () => {
 for(const path of ["components/basa/BasaSidebar.tsx","modules/module3/components/M3Layout.tsx"]){
  const layout=await source(path);
  assert.doesNotMatch(layout,/label: "(?:Profile Settings|Settings)"|await logout\(\)/);
  assert.match(layout,/<nav/);
 }
 const menu=await source("components/basa/ProfileDropdown.tsx");
 assert.match(menu,/await logout\(\)/);
 assert.match(menu,/navigate\("\/login", \{ replace: true \}\)/);
 assert.match(menu,/ROLE_LABELS\[profile.role\]/);
 assert.match(menu,/getProfileDisplayName\(profile\)/);
});
