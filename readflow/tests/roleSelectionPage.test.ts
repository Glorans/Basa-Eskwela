import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../src/modules/module1/pages/RoleSelectionPage.tsx", import.meta.url);
const optionUrl = new URL("../src/modules/module1/components/RoleOption.tsx", import.meta.url);
const appUrl = new URL("../src/App.tsx", import.meta.url);
const securitySqlUrl = new URL("../../supabase/m1_teacher_verification.sql", import.meta.url);

test("role selection exposes the required labels and internal values", async () => {
  const source = await readFile(pageUrl, "utf8");

  for (const [label, value] of [
    ["Student", "student"],
    ["Teacher", "teacher"],
    ["Independent Learner", "general_user"],
  ]) {
    assert.match(source, new RegExp(`value: "${value}"[\\s\\S]*?title: "${label}"`));
  }

  assert.doesNotMatch(source, /title: "general_user"/);
  assert.doesNotMatch(source, /value: "independent-learner"/);
});

test("role selection remains single-choice and uses the protected one-time RPC", async () => {
  const [pageSource, optionSource, appSource] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(optionUrl, "utf8"),
    readFile(appUrl, "utf8"),
  ]);

  assert.match(pageSource, /useState<Role \| null>\(null\)/);
  assert.match(pageSource, /disabled=\{checking \|\| saving \|\| !selectedRole\}/);
  assert.match(pageSource, /assignOwnRoleOnce\(selectedRole, inviteCode\)/);
  assert.doesNotMatch(pageSource, /\.from\("profiles"\)\.update/);
  assert.match(appSource, /path="\/select-role"\s+element=\{<RoleSelectionPage \/>\}/);
  assert.match(optionSource, /type="radio"/);
  assert.match(optionSource, /name=\{name\}/);
  assert.match(optionSource, /role-option--selected/);
});

test("role assignment is authenticated, one-time, and excludes Admin", async () => {
  const sql = await readFile(securitySqlUrl, "utf8");

  assert.match(sql, /create or replace function public\.assign_own_role\(\s*selected_role text\s*\)/i);
  assert.match(sql, /auth\.uid\(\) is null/i);
  assert.match(sql, /selected_role not in \('student','general_user'\)/i);
  assert.match(sql, /and role is null/i);
  assert.match(sql, /grant execute\s+on function public\.assign_own_role\(text\)[\s\S]*to authenticated/i);
  assert.doesNotMatch(
    sql.match(/create or replace function public\.assign_own_role[\s\S]*?\$\$;/i)?.[0] ?? "",
    /'admin'/i,
  );
});

test("an already assigned user is redirected instead of being allowed to change roles", async () => {
  const source = await readFile(pageUrl, "utf8");

  assert.match(source, /const destination = await getPostAuthenticationPath\(profile\)/);
  assert.match(source, /destination !== "\/select-role"/);
  assert.match(source, /getPostAuthenticationPath\(profile\)/);
});
