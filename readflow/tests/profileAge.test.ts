import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as onboarding from "../src/modules/module1/utils/authOnboarding.ts";
import * as fields from "../src/modules/module1/utils/profileFields.ts";

test("age accepts only whole-number values from 1 through 120", () => {
  for (const value of ["1", "12", "35", "120", " 18 "]) {
    assert.equal(onboarding.getAgeValidationError(value), "", value);
  }
  for (const value of ["", "   "]) {
    assert.equal(onboarding.getAgeValidationError(value), "Enter your age.");
  }
  for (const value of ["0", "-1", "121", "12.5", "12.0", "1e2", "abc", "NaN", "Infinity"]) {
    assert.equal(onboarding.getAgeValidationError(value), "Enter a whole-number age from 1 to 120.", value);
  }
});

function fixture(role = "student", ageError: { code: string } | null = null) {
  const row: Record<string, unknown> = { id: "self", role, nickname: null, full_name: "", age: null,
    teacher_status: role === "teacher" ? "pending" : null, status: "active", created_at: "2026-10-14" };
  const writes: Record<string, unknown>[] = [];
  let updateError: { code: string } | null = null;
  let completedDiagnostic = false;
  const supabase = {
    from(table: string) {
      assert.equal(table, "profiles");
      let patch: Record<string, unknown> | undefined;
      const query = {
        select(columns: string) { assert.ok(!columns.includes("age")); return query; },
        eq(key: string, value: string) { assert.equal(key, "id"); assert.equal(value, "self"); return query; },
        update(value: Record<string, unknown>) { patch = value; writes.push(value); return query; },
        async single() {
          if (patch && updateError) return { data: null, error: updateError };
          if (patch) Object.assign(row, patch);
          const { age: _age, ...publicProfile } = row;
          return { data: publicProfile, error: null };
        },
      };
      return query;
    },
    async rpc(name: string, args: { profile_id: string }) {
      assert.equal(name, "get_own_profile_age");
      assert.equal(args.profile_id, "self");
      return { data: ageError ? null : row.age, error: ageError };
    },
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
  return { service: module.exports, row, writes,
    failUpdate: (error: { code: string } | null) => { updateError = error; },
    completeDiagnostic: () => { completedDiagnostic = true; },
  };
}

for (const role of ["student", "teacher"]) {
  test(`${role} saves name and age atomically and reloads age without changing authorization`, async () => {
    const f = fixture(role);
    await f.service.completeProfileSetup("self", "  Taylor  ", 18);
    assert.equal(f.writes.length, 1);
    const nameField = role === "teacher" ? "full_name" : "nickname";
    assert.equal(JSON.stringify(f.writes[0]), JSON.stringify({ [nameField]: "Taylor", age: 18 }));
    const saved = await f.service.getAuthProfile("self");
    assert.equal(saved.age, 18);
    assert.equal(saved.role, role);
    assert.equal(saved.teacher_status, role === "teacher" ? "pending" : null);
    assert.equal(await f.service.getPostAuthenticationPath(saved), role === "teacher" ? "/teacher-verification" : "/diagnostic");
  });
}

test("Independent Learner setup saves the nickname only: no age is asked, written or required", async () => {
  for (const age of [undefined, 18]) {
    const f = fixture("general_user");
    await f.service.completeProfileSetup("self", "  Taylor  ", age);
    assert.equal(f.writes.length, 1);
    assert.equal(JSON.stringify(f.writes[0]), JSON.stringify({ nickname: "Taylor" }), "age is never written for an Independent Learner");
    const saved = await f.service.getAuthProfile("self");
    assert.equal(saved.age, null, "the stored age is left as it was");
    assert.equal(saved.role, "general_user");
    assert.equal(await f.service.getPostAuthenticationPath(saved), "/diagnostic");
  }
  const kept = fixture("general_user");
  kept.row.age = 30;
  await kept.service.completeProfileSetup("self", "Reader");
  assert.equal(kept.row.age, 30, "an existing stored age is not deleted");
  await assert.rejects(fixture("general_user").service.completeProfileSetup("self", ""), /nickname/);
});

test("Students and Teachers must still give a valid age", async () => {
  for (const role of ["student", "teacher"]) {
    const f = fixture(role);
    await assert.rejects(f.service.completeProfileSetup("self", "Reader Name"), /Enter your age/);
    assert.equal(f.writes.length, 0);
  }
});

test("invalid ages, names and unsupported roles cannot write a profile", async () => {
  const f = fixture();
  for (const age of [0, -1, 121, 12.5, NaN, Infinity]) {
    await assert.rejects(f.service.completeProfileSetup("self", "Reader", age), /whole-number age/);
  }
  await assert.rejects(f.service.completeProfileSetup("self", "", 12), /nickname/);
  assert.equal(f.writes.length, 0);
  for (const role of ["admin", "unknown", ""]) {
    const unsupported = fixture(role);
    await assert.rejects(unsupported.service.completeProfileSetup("self", "Reader", 12), /does not use profile setup/);
    assert.equal(unsupported.writes.length, 0);
  }
});

test("failed or unauthorized updates leave the profile incomplete and can be retried", async () => {
  const f = fixture();
  f.failUpdate({ code: "PGRST116" });
  await assert.rejects(f.service.completeProfileSetup("self", "Reader", 12));
  assert.equal(f.row.age, null);
  assert.equal(f.row.nickname, null);
  assert.equal(await f.service.getPostAuthenticationPath(await f.service.getAuthProfile("self")), "/setup-profile");
  f.failUpdate(null);
  await f.service.completeProfileSetup("self", "Reader", 12);
  assert.equal((await f.service.getAuthProfile("self")).age, 12);
});

test("legacy users keep their destinations with null age, including before migration approval", async () => {
  for (const ageError of [null, { code: "PGRST202" }]) {
    for (const [role, destination] of [["student", "/dashboard"], ["general_user", "/m3/general/dashboard"], ["teacher", "/m3/teacher/dashboard"], ["admin", "/m3/admin/dashboard"]]) {
      const f = fixture(role, ageError);
      Object.assign(f.row, { nickname: "Reader", full_name: "Existing User", teacher_status: role === "teacher" ? "approved" : null });
      f.completeDiagnostic();
      const profile = await f.service.getAuthProfile("self");
      assert.equal(profile.age, null);
      assert.equal(await f.service.getPostAuthenticationPath(profile), destination);
    }
  }
});

test("unexpected age-read failures are surfaced rather than silently losing data", async () => {
  await assert.rejects(fixture("student", { code: "42501" }).service.getAuthProfile("self"));
});
