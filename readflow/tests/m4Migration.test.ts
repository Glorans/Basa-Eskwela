import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

// Static contracts only: these tests deliberately never connect to a database.
const source = await readFile(new URL("../supabase/migrations/20261005_m4_classroom_management.sql", import.meta.url), "utf8");
const sql = source.replace(/\r\n/g, "\n").replace(/--[^\n]*/g, "").trim();
const policies = [...sql.matchAll(/CREATE POLICY\s+"([^"]+)"\s+ON public\.(\w+)\s+FOR (\w+)\s+TO authenticated\s+([\s\S]*?);/g)];
function policy(name: string) {
  const match = policies.find((p) => p[1] === name);
  assert.ok(match, `Missing policy: ${name}`);
  return match[4];
}
function fn(name: string) {
  const match = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`));
  assert.ok(match, `Missing function: ${name}`);
  return match[0];
}

// Explicit inventory supplied from live Supabase, independent of SQL parsing.
// Each entry is [table, live name, sole replacement name (null = retired)].
const livePolicyPaths: [string, string, string | null][] = [
  ["rooms", "M6 Admin can view learning rooms", "M6 Admin can view learning rooms"],
  ["rooms", "M6 Students can view enrolled rooms", "M6 Students can view enrolled rooms"],
  ["rooms", "M6 Teachers can create their own rooms", "M6 Teachers can create learning rooms"],
  ["rooms", "M6 Teachers can edit their own rooms", "M6 Teachers can update own learning rooms"],
  ["rooms", "M6 Teachers can view their own rooms", "M6 Teachers can view own learning rooms"],
  ["enrollments", "M6 Admin can view classroom enrollments", "M6 Admin can view classroom enrollments"],
  ["enrollments", "M6 Students and teachers can view enrollments", "M6 Students and teachers can view enrollments"],
  ["enrollments", "M6 Students can join classrooms", null],
  ["enrollments", "M6 Teachers can remove enrolled students", "M6 Teachers can remove enrolled students"],
  ["room_modules", "M6 Admin can view assigned classroom modules", "M6 Admin can view assigned classroom modules"],
  ["room_modules", "M6 Students can view assigned modules in joined rooms", "M6 Students can view assigned classroom modules"],
  ["room_modules", "M6 Teachers can assign modules to their own rooms", "M6 Teachers can assign classroom modules"],
  ["room_modules", "M6 Teachers can view modules assigned to their rooms", "M6 Teachers can view assigned classroom modules"],
  ["profiles", "M6 Admin can view student profiles", "M6 Admin can view student profiles"],
  ["profiles", "M6 Teachers can view enrolled student profiles", "M6 Teachers can view enrolled student profiles"],
];
const m1Names = ["M1 users read own profile", "M1 users update own display name"];
const policyKey = (table: string, name: string) => `${table}:${name}`;

test("M4 drops every exact live and historical M6 name before its hardened replacement", () => {
  const drops = [...sql.matchAll(/DROP POLICY IF EXISTS\s+"([^"]+)"\s+ON public\.(\w+);/g)];
  for (const [table, live, replacement] of livePolicyPaths) {
    for (const name of new Set([live, ...(replacement ? [replacement] : [])])) {
      const drop = drops.find((d) => d[1] === name && d[2] === table);
      assert.ok(drop, `Missing exact drop for ${table}.${name}`);
      if (replacement) {
        const create = policies.find((p) => p[1] === replacement && p[2] === table);
        assert.ok(create);
        assert.ok(drop.index! < create.index!, `${name} must be dropped before replacement`);
      }
    }
  }
  assert.ok(!policies.some((p) => p[1] === "M6 Students can join classrooms"));
  for (const name of m1Names) {
    assert.ok(!drops.some((d) => d[1] === name), `${name} must survive`);
    assert.ok(!policies.some((p) => p[1] === name), `${name} must not be replaced`);
  }
});

test("M4 policy transitions leave one hardened policy per path on first application and rerun", () => {
  // Simulate only policy DDL, never SQL execution. Seed both live and historical
  // names to catch OR-permissive leftovers even when both versions coexist.
  const state = new Map<string, string>();
  for (const [table, live, replacement] of livePolicyPaths) {
    state.set(policyKey(table, live), "old permissive policy");
    if (replacement) state.set(policyKey(table, replacement), "old permissive policy");
  }
  for (const name of m1Names) state.set(policyKey("profiles", name), "untouched M1");
  const expected = [
    ...livePolicyPaths.filter((p) => p[2] !== null).map(([table, , name]) => policyKey(table, name!)),
    ...m1Names.map((name) => policyKey("profiles", name)),
  ].sort();
  const operations = [...sql.matchAll(/(DROP POLICY IF EXISTS|CREATE POLICY)\s+"([^"]+)"\s+ON public\.(\w+)[\s\S]*?;/g)];
  assert.equal(operations.filter((op) => op[1] === "CREATE POLICY").length, policies.length);
  for (let run = 0; run < 2; run++) {
    for (const op of operations) {
      const key = policyKey(op[3], op[2]);
      if (op[1] === "DROP POLICY IF EXISTS") state.delete(key);
      else {
        assert.ok(!state.has(key), `Duplicate policy creation: ${key}`);
        state.set(key, op[0]);
      }
    }
    assert.deepEqual([...state.keys()].sort(), expected);
    assert.ok(![...state.values()].includes("old permissive policy"));
    for (const name of m1Names) assert.equal(state.get(policyKey("profiles", name)), "untouched M1");
    for (const [key, definition] of state) {
      if (/FOR (INSERT|UPDATE|DELETE|ALL)\b/.test(definition)) {
        assert.match(definition, /public\.m4_current_role\(\) = 'teacher'/, key);
        assert.match(definition, /auth\.uid\(\) = teacher_id|rooms\.teacher_id = auth\.uid\(\)/, key);
      }
    }
  }
});

test("M4 migration is atomic and preserves existing data and equivalent constraints", () => {
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;$/);
  assert.doesNotMatch(sql, /\b(?:DROP\s+(?:TABLE|SCHEMA|FUNCTION|INDEX|CONSTRAINT)|TRUNCATE|DELETE\s+FROM|UPDATE\s+public\.|ADD\s+CONSTRAINT)\b/i);
  assert.match(sql, /pg_catalog\.pg_constraint/);
  assert.match(sql, /NOT c\.condeferrable/);
  for (const columns of ["['room_code']", "['room_id', 'student_id']", "['module_id', 'room_id']"]) {
    assert.ok(sql.includes(`ARRAY${columns}::text[]`));
  }
  assert.match(sql, /RAISE EXCEPTION 'Missing immediate UNIQUE prerequisite/);
  assert.equal((sql.match(/CREATE UNIQUE INDEX/g) ?? []).length, 1);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS rooms_room_code_normalized_unique\s+ON public\.rooms \(pg_catalog\.upper\(pg_catalog\.btrim\(room_code\)\)\)/);
});

test("M4 definer helpers have empty search paths and authenticated-only browser grants", () => {
  for (const [name, args] of [["is_admin", ""], ["m4_current_role", ""], ["m6_is_enrolled_in_room", "uuid"], ["join_room_by_code", "text"]]) {
    assert.match(fn(name), /SECURITY DEFINER\s+SET search_path = ''/);
    assert.match(sql, new RegExp(`REVOKE ALL\\s+ON FUNCTION public\\.${name}\\(${args}\\)\\s+FROM PUBLIC, anon, authenticated;`));
    assert.match(sql, new RegExp(`GRANT EXECUTE\\s+ON FUNCTION public\\.${name}\\(${args}\\)\\s+TO authenticated;`));
    assert.doesNotMatch(fn(name), /(?:FROM|JOIN|INSERT INTO)\s+(?!public\.)(?:profiles|rooms|enrollments)\b/i);
  }
  assert.match(fn("m4_current_role"), /SELECT p\.role FROM public\.profiles AS p WHERE p\.id = auth\.uid\(\)/);
  assert.match(fn("is_admin"), /id = auth\.uid\(\)\s+AND role = 'admin'/);
});

test("M4 join validates authentication, role and normalized input before inserting", () => {
  const join = fn("join_room_by_code");
  const insertion = join.indexOf("INSERT INTO");
  for (const guard of ["IF auth.uid() IS NULL", "IS DISTINCT FROM 'student'", "IF v_code IS NULL OR v_code = ''", "IF v_room_id IS NULL"]) {
    assert.ok(join.indexOf(guard) >= 0 && join.indexOf(guard) < insertion, guard);
  }
  assert.match(join, /v_code ~ '\^\[\[:space:\]\]\*\$'/);
  assert.match(join, /v_code := pg_catalog\.upper\(pg_catalog\.btrim\(p_room_code\)\)/);
  assert.match(join, /WHERE pg_catalog\.upper\(pg_catalog\.btrim\(room_code\)\) = v_code/);
  assert.match(join, /VALUES\s*\(\s*auth\.uid\(\),\s*v_room_id\s*\)/);
  assert.match(join, /RETURNS public\.enrollments/);
});

test("M4 duplicate joins use the unique key and return the existing enrollment without an update", () => {
  const join = fn("join_room_by_code");
  assert.match(join, /ON CONFLICT \(student_id, room_id\) DO NOTHING\s+RETURNING \* INTO v_enrollment/);
  assert.match(join, /IF NOT FOUND THEN\s+SELECT \* INTO v_enrollment\s+FROM public\.enrollments\s+WHERE student_id = auth\.uid\(\) AND room_id = v_room_id/);
  assert.match(join, /RAISE EXCEPTION 'Unable to join classroom\. Please try again\.'/);
  assert.match(join, /RETURN v_enrollment/);
  assert.doesNotMatch(join, /DO UPDATE|SQLERRM/);
  assert.match(sql, /DROP POLICY IF EXISTS\s+"M6 Students can join classrooms"/);
  assert.ok(!policies.some((p) => p[2] === "enrollments" && ["INSERT", "ALL"].includes(p[3])));
});

test("M4 mutations require teacher role and ownership and expose only implemented operations", () => {
  const mutations = policies.filter((p) => p[3] !== "SELECT");
  assert.deepEqual(mutations.map((p) => [p[2], p[3]]), [["rooms", "INSERT"], ["rooms", "UPDATE"], ["enrollments", "DELETE"], ["room_modules", "INSERT"]]);
  for (const p of mutations) {
    assert.match(p[4], /public\.m4_current_role\(\) = 'teacher'/);
    assert.match(p[4], /auth\.uid\(\) = teacher_id|rooms\.teacher_id = auth\.uid\(\)/);
    assert.doesNotMatch(p[4], /is_admin/);
  }
  const update = policy("M6 Teachers can update own learning rooms");
  for (const clause of update.split("WITH CHECK")) {
    assert.match(clause, /public\.m4_current_role\(\) = 'teacher'\s+AND auth\.uid\(\) = teacher_id/);
  }
  assert.match(policy("M6 Teachers can assign classroom modules"), /auth\.uid\(\) = assigned_by/);
});

test("M4 preserves enrollment-scoped reads and read-only admin classroom access", () => {
  assert.match(policy("M6 Students can view enrolled rooms"), /public\.m6_is_enrolled_in_room\(id\)/);
  assert.match(fn("m6_is_enrolled_in_room"), /room_id = target_room_id\s+AND student_id = auth\.uid\(\)/);
  assert.match(policy("M6 Students and teachers can view enrollments"), /auth\.uid\(\) = student_id/);
  assert.match(policy("M6 Students can view assigned classroom modules"), /enrollments\.room_id = room_modules\.room_id\s+AND enrollments\.student_id = auth\.uid\(\)/);
  const admins = policies.filter((p) => p[1].startsWith("M6 Admin"));
  assert.deepEqual(admins.map((p) => p[2]), ["rooms", "enrollments", "room_modules", "profiles"]);
  for (const p of admins) {
    assert.equal(p[3], "SELECT");
    assert.match(p[4], /public\.is_admin\(\)/);
  }
});

test("M4 profile access is limited to classroom students without replacing M1 protections", () => {
  const teacher = policy("M6 Teachers can view enrolled student profiles");
  assert.match(teacher, /profiles\.role = 'student'/);
  assert.match(teacher, /public\.m4_current_role\(\) = 'teacher'/);
  assert.match(teacher, /enrollments\.student_id = profiles\.id\s+AND rooms\.teacher_id = auth\.uid\(\)/);
  const admin = policy("M6 Admin can view student profiles");
  assert.match(admin, /profiles\.role = 'student'/);
  assert.match(admin, /enrollments\.student_id = profiles\.id/);
  assert.doesNotMatch(sql, /DROP POLICY IF EXISTS\s+"M1|(?:GRANT|REVOKE)[^;]*ON (?:TABLE )?public\.profiles/i);
  for (const p of policies) {
    assert.ok(p[1].startsWith("M6 "));
    assert.ok(sql.includes(`DROP POLICY IF EXISTS\n"${p[1]}"`));
  }
});

test("M4 source has no module6 imports", async () => {
  const root = new URL("../src/modules/module4/", import.meta.url);
  for (const file of await readdir(root, { recursive: true })) {
    if (!/\.[tj]sx?$/.test(file)) continue;
    const code = await readFile(new URL(file.replace(/\\/g, "/"), root), "utf8");
    assert.doesNotMatch(code, /(?:from\s*|import\s*\()["'][^"']*module6\//);
  }
});
