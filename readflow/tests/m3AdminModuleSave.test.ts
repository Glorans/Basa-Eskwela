import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { buildCreateModulePayload, buildUpdateModulePayload, type LearningPathRow } from "../src/modules/module3/services/moduleModel.ts";

const english: LearningPathRow = {
  id: "11111111-1111-4111-8111-111111111111", path_name: "English path",
  language: "en", reading_level: "Instructional", difficulty_tier: "Medium", description: null,
};
const filipino: LearningPathRow = {
  ...english, id: "22222222-2222-4222-8222-222222222222", path_name: "Filipino path",
  language: "fil", reading_level: "Independent", difficulty_tier: "Hard",
};
const values = { title: "Story", passage: "A reading passage.", learningPathId: english.id, difficulty: "Easy" as const };

test("payload builders reject unresolved or mismatched paths and omit redundant metadata", () => {
  for (const build of [
    (path: LearningPathRow | null) => buildCreateModulePayload(values, "admin", path),
    (path: LearningPathRow | null) => buildUpdateModulePayload(values, path),
  ]) {
    assert.throws(() => build(null), /valid learning path/);
    assert.throws(() => build(filipino), /valid learning path/);
  }
  for (const field of ["language", "readingLevel", "difficultyTier"] as const) {
    const conflicting = { ...values, [field]: "untrusted" };
    for (const payload of [buildCreateModulePayload(conflicting, "admin", english), buildUpdateModulePayload(conflicting, english)]) {
      assert.equal(Object.prototype.hasOwnProperty.call(payload, field), false);
      assert.equal(payload.path_id, english.id);
      assert.equal(payload.difficulty, "Easy");
    }
  }
});

test("real create/update service validates the database path before writing and maps its metadata", async (t) => {
  let selectedRow: LearningPathRow | null = english;
  let lookupError: Error | null = null;
  let stored: Record<string, unknown> = {};
  const writes: Record<string, unknown>[] = [];
  const fakeClient = {
    auth: { getUser: async () => ({ data: { user: { id: "admin" } }, error: null }) },
    from(table: string) {
      let queriedId = "";
      const finish = async () => table === "learning_paths"
        ? { data: selectedRow?.id === queriedId ? selectedRow : null, error: lookupError }
        : { data: { ...stored, id: "module", created_at: "2026-10-06", learning_paths: selectedRow, comprehension_questions: [] }, error: null };
      const query = {
        select() { return query; },
        eq(_field: string, id: string) { queriedId = id; return query; },
        insert(payload: Record<string, unknown>) { writes.push(payload); stored = { ...payload }; return query; },
        update(payload: Record<string, unknown>) { writes.push(payload); stored = { ...stored, ...payload }; return query; },
        single: finish, maybeSingle: finish,
      };
      return query;
    },
  };
  const globals = globalThis as typeof globalThis & { __m3AdminSaveClient?: typeof fakeClient };
  globals.__m3AdminSaveClient = fakeClient;
  const serviceUrl = new URL("../src/modules/module3/services/moduleService.ts", import.meta.url).href;
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    if (context.parentURL === serviceUrl) {
      if (specifier.endsWith("/supabaseClient")) return { url: "data:text/javascript,export const supabase = globalThis.__m3AdminSaveClient", shortCircuit: true };
      if (specifier === "./moduleModel") return { url: new URL("../src/modules/module3/services/moduleModel.ts", import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  } });
  try {
    const service = await import(serviceUrl) as typeof import("../src/modules/module3/services/moduleService.ts");
    for (const path of [english, filipino]) {
      await t.test(`create ${path.language} uses related path despite conflicting client metadata`, async () => {
        selectedRow = path;
        const result = await service.createModule({ ...values, learningPathId: path.id, ...{ language: "wrong", readingLevel: "wrong", difficultyTier: "wrong" } });
        assert.equal(result.language, path.language);
        assert.equal(result.readingLevel, path.reading_level);
        assert.equal(result.difficultyTier, path.difficulty_tier);
        assert.equal(result.difficulty, "Easy");
        assert.deepEqual(Object.keys(writes[writes.length - 1]).sort(), ["created_by", "difficulty", "passage", "path_id", "status", "title"]);
      });
    }
    await t.test("edit switches EN to FIL and back without retaining old metadata", async () => {
      selectedRow = english;
      await service.createModule(values);
      for (const path of [filipino, english]) {
        selectedRow = path;
        const result = await service.updateModule("module", { ...values, learningPathId: path.id });
        assert.equal(result.learningPathId, path.id);
        assert.equal(result.language, path.language);
        assert.equal(result.readingLevel, path.reading_level);
        assert.equal(result.difficultyTier, path.difficulty_tier);
        assert.equal(result.difficulty, "Easy");
      }
    });
    for (const scenario of ["malformed ID", "missing path", "lookup failure", "invalid language", "invalid reading level", "invalid tier"]) {
      await t.test(`${scenario} blocks both writes`, async () => {
        selectedRow = scenario === "missing path" ? null : { ...english };
        lookupError = scenario === "lookup failure" ? new Error("offline") : null;
        if (scenario === "invalid language") selectedRow!.language = "unknown";
        if (scenario === "invalid reading level") selectedRow!.reading_level = "unknown";
        if (scenario === "invalid tier") selectedRow!.difficulty_tier = "unknown";
        const input = { ...values, learningPathId: scenario === "malformed ID" ? "invalid" : english.id };
        const before = writes.length;
        await assert.rejects(service.createModule(input), /learning path|unsupported/);
        await assert.rejects(service.updateModule("module", input), /learning path|unsupported/);
        assert.equal(writes.length, before);
      });
    }
  } finally {
    hooks.deregister();
    delete globals.__m3AdminSaveClient;
  }
});
