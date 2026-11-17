import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as onboarding from "../src/modules/module1/utils/authOnboarding.ts";
import * as fields from "../src/modules/module1/utils/profileFields.ts";

// Basa Eskwela no longer collects age from any role. These tests keep it that way: profile setup never asks for,
// validates, reads or writes age, and existing users keep their destinations.

function fixture(role = "student") {
  const row: Record<string, unknown> = { id: "self", role, nickname: null, full_name: "",
    teacher_status: role === "teacher" ? "pending" : null, status: "active", created_at: "2026-10-14" };
  const writes: Record<string, unknown>[] = [];
  const rpcCalls: string[] = [];
  let updateError: { code: string } | null = null;
  let completedDiagnostic = false;
  const supabase = {
    from(table: string) {
      assert.equal(table, "profiles");
      let patch: Record<string, unknown> | undefined;
      const query = {
        select(columns: string) { assert.ok(!/\bage\b/.test(columns), "age is never selected"); return query; },
        eq(key: string, value: string) { assert.equal(key, "id"); assert.equal(value, "self"); return query; },
        update(value: Record<string, unknown>) { patch = value; writes.push(value); return query; },
        async single() {
          if (patch && updateError) return { data: null, error: updateError };
          if (patch) Object.assign(row, patch);
          return { data: { ...row }, error: null };
        },
      };
      return query;
    },
    async rpc(name: string) { rpcCalls.push(name); return { data: null, error: null }; },
  };
  const source = readFileSync(new URL("../src/modules/module1/services/authProfile.ts", import.meta.url), "utf8");
  const module = { exports: {} as typeof import("../src/modules/module1/services/authProfile.ts") };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, {
    module, exports: module.exports,
    require: (id: string) => {
      if (id.endsWith("supabaseClient")) return { supabase };
      if (id.endsWith("authOnboarding")) return onboarding;
      if (id.endsWith("profileFields")) return fields;
      if (id.endsWith("diagnosticDatabase")) return { hasCompletedInitialDiagnostic: async () => completedDiagnostic };
      throw Error(`Unexpected import: ${id}`);
    },
  });
  return { service: module.exports, row, writes, rpcCalls,
    failUpdate: (error: { code: string } | null) => { updateError = error; },
    completeDiagnostic: () => { completedDiagnostic = true; },
  };
}

test("no age helpers remain in onboarding", () => {
  for (const name of ["AGE_MIN", "AGE_MAX", "getAgeValidationError", "profileSetupAsksAge"]) {
    assert.equal(name in onboarding, false, name);
  }
});

for (const [role, field, destination] of [
  ["student", "nickname", "/diagnostic"],
  ["general_user", "nickname", "/diagnostic"],
  ["teacher", "full_name", "/teacher-verification"],
] as const) {
  test(`${role} profile setup saves only the ${field}; age is never asked, read or written`, async () => {
    const f = fixture(role);
    await f.service.completeProfileSetup("self", "  Taylor  ");
    assert.equal(f.writes.length, 1);
    assert.equal(JSON.stringify(f.writes[0]), JSON.stringify({ [field]: "Taylor" }));
    const saved = await f.service.getAuthProfile("self");
    assert.equal("age" in saved, false, "the profile carries no age");
    assert.equal(saved.role, role, "authorization is unchanged");
    assert.equal(await f.service.getPostAuthenticationPath(saved), destination);
    assert.deepEqual(f.rpcCalls, [], "get_own_profile_age is no longer called");
  });
}

test("invalid names and unsupported roles cannot write a profile", async () => {
  await assert.rejects(fixture().service.completeProfileSetup("self", ""), /nickname/);
  for (const role of ["admin", "system_admin", "unknown", ""]) {
    const unsupported = fixture(role);
    await assert.rejects(unsupported.service.completeProfileSetup("self", "Reader"), /does not use profile setup/);
    assert.equal(unsupported.writes.length, 0);
  }
});

test("a failed update leaves the profile incomplete and can be retried", async () => {
  const f = fixture();
  f.failUpdate({ code: "PGRST116" });
  await assert.rejects(f.service.completeProfileSetup("self", "Reader"));
  assert.equal(f.row.nickname, null);
  assert.equal(await f.service.getPostAuthenticationPath(await f.service.getAuthProfile("self")), "/setup-profile");
  f.failUpdate(null);
  await f.service.completeProfileSetup("self", "Reader");
  assert.equal(f.row.nickname, "Reader");
});

test("existing users keep their destinations", async () => {
  for (const [role, destination] of [["student", "/dashboard"], ["general_user", "/m3/general/dashboard"],
    ["teacher", "/m3/teacher/dashboard"], ["admin", "/m3/admin/dashboard"]]) {
    const f = fixture(role);
    Object.assign(f.row, { nickname: "Reader", full_name: "Existing User", teacher_status: role === "teacher" ? "approved" : null });
    f.completeDiagnostic();
    assert.equal(await f.service.getPostAuthenticationPath(await f.service.getAuthProfile("self")), destination);
  }
});

test("the profile setup page has no Age field", () => {
  const page = readFileSync(new URL("../src/modules/module1/pages/ProfileSetupPage.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /\bage\b|>Age</i);
  assert.match(page, /await completeProfileSetup\(profile\.id, normalizedValue\);/);
});
