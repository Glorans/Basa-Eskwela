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
  ["admin", "Admin", " Admin User ", "Admin User", "Admin"],
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
test("headers share loaded identity, settings links, and contain no duplicate branding", async () => {
  const basa = await source("components/basa/BasaHeader.tsx");
  const m3 = await source("modules/module3/components/M3Layout.tsx");
  for (const s of [basa, m3]) {
    assert.match(s, /const showIdentity = !loading && !!profile/);
    assert.match(s, /getProfileDisplayName\(profile\)/);
    assert.match(s, /showIdentity &&[\s\S]*\{shouldShowRole && <small>\{roleLabel\}<\/small>\}/);
    assert.doesNotMatch(s.slice(s.indexOf('<header')), /mascot|>Basa Eskwela</);
  }
  assert.match(basa, /<Link[^>]*to="\/dashboard\/settings"/);
  assert.match(m3, /<NavLink[^>]*to=\{getProfileRoute\(role\)\}/);
  for (const role of ["admin", "teacher", "general"]) assert.ok(m3.includes(`/m3/${role}/settings`));
  const app = await source("App.tsx");
  assert.equal(app.match(/<Route\s+path="settings"\s+element=\{<Settings\s*\/>\}\s*\/>/g)?.length, 4);
  assert.match(await source("modules/module1/pages/Settings.tsx"), /Profile and Account/);
  assert.match(await source("pages/StudentDashboard.tsx"), /!loading && profile \? getProfileDisplayName\(profile\)/);
});
test("sidebars retain logout, settings and mobile handlers without identity cards", async () => {
  const basa = await source("components/basa/BasaSidebar.tsx");
  const m3 = await source("modules/module3/components/M3Layout.tsx");
  assert.doesNotMatch(basa, /basa-sidebar-profile|useAuthenticatedProfile|displayName|roleLabel/);
  assert.doesNotMatch(m3, /m3-role-card/);
  assert.match(basa, /label: "Settings"/);
  assert.match(basa, /await logout\(\)/);
  assert.match(m3, /await logout\(\)/);
  for (const s of [basa, m3]) {
    assert.match(s, /disabled=\{loggingOut\}/);
    assert.match(s, /navigate\("\/login", \{ replace: true \}\)/);
  }
  assert.match(basa, /onClick=\{onClose\}/);
  assert.match(await source("components/basa/BasaLayout.tsx"), /onMenuClick=\{sidebar.toggle\}/);
  assert.match(m3, /onClick=\{sidebar.toggle\}/);
  assert.match(m3, /onClick=\{\(\) => sidebar.close\(\)\}/);
});
test("mobile styles retain names with truncation and hide role first", async () => {
  const basa = await source("components/basa/BasaHeader.css");
  const m3 = await source("modules/module3/styles/module3.css");
  assert.match(basa, /\.basa-account-copy small \{ display: none; \}/);
  assert.match(m3, /\.m3-user-copy small \{\s*display: none/);
  for (const css of [basa, m3]) assert.match(css, /text-overflow: ellipsis/);
  assert.doesNotMatch(m3, /m3-role-card|m3-role-icon/);
});

for (const [role, visible] of [["student", false], ["general_user", false], ["teacher", true], ["admin", true]] as const) {
  test(`${role} account role visibility is ${visible}`, async () => {
    for (const path of ["components/basa/BasaHeader.tsx", "modules/module3/components/M3Layout.tsx"]) {
      const layout = await source(path);
      // Exercise the actual visibility expression used by each component.
      const expression = layout.match(/const shouldShowRole = ([^;]+);/)?.[1];
      assert.ok(expression);
      const shouldShowRole = new Function("profile", `return ${expression};`);
      assert.equal(shouldShowRole({ role }), visible);
      assert.equal(shouldShowRole(null), false);
      assert.match(layout, /\{shouldShowRole && <small>\{roleLabel\}<\/small>\}/);
      assert.match(layout, /<strong>\{(?:getProfileDisplayName\(profile\)|displayName)\}<\/strong>/);
      assert.match(layout, /aria-label="Profile and Account"/);
    }
  });
}
