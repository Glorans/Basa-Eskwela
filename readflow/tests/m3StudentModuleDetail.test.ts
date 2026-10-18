import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProposedPassageDatabase } from "../src/modules/module3/types/proposedPassageDatabase.ts";
import type { ReadingModule } from "../src/modules/module3/types/content.ts";
import type { ModulePassage } from "../src/modules/module3/types/modulePassages.ts";
import { createModulePassageRepository } from "../src/modules/module3/services/modulePassageService.ts";
import { adjacentPassageId, loadStudentModuleDetail } from "../src/modules/module3/services/studentModuleDetail.ts";

const module: ReadingModule = {
  id: "module", title: "Stories", difficulty: "Easy", learningPathId: "path",
  learningPath: "English", language: "en", readingLevel: "Instructional",
  difficultyTier: "Easy", status: "published", createdAt: "2026-10-07",
  passage: "Legacy text", questionCount: 0,
};
const passage = (id: string, displayOrder: number): ModulePassage => ({
  id, moduleId: module.id, title: `Story ${id}`, passageText: `Text ${id}`,
  displayOrder, sourceMaterialId: null, createdAt: "", updatedAt: "",
});
const load = (passages: ModulePassage[]) => loadStudentModuleDetail(module.id, {
  getModuleById: async () => module, getPassages: async () => passages,
});

test("one child supplies its stable identity, title and text instead of legacy text", async () => {
  const child = passage("first", 1);
  const detail = await load([child]);
  assert.ok(detail);
  assert.deepEqual(detail.passages, [child]);
  assert.equal(detail.passage, "Legacy text");
  assert.equal(adjacentPassageId(detail.passages, child.id, -1), undefined);
  assert.equal(adjacentPassageId(detail.passages, child.id, 1), undefined);
});

test("multiple passages are ordered without replacing stable IDs or mutating the source", async () => {
  const children = [passage("third", 3), passage("first", 1), passage("second", 2)];
  const detail = await load(children);
  assert.ok(detail);
  assert.deepEqual(detail.passages.map(p => p.id), ["first", "second", "third"]);
  assert.deepEqual(children.map(p => p.id), ["third", "first", "second"]);
});

test("successful empty child read preserves exact legacy text without inventing a passage ID", async () => {
  const detail = await load([]);
  assert.ok(detail);
  assert.deepEqual(detail.passages, []);
  assert.equal(detail.passage, module.passage);
  assert.equal(adjacentPassageId(detail.passages, undefined, 1), undefined);
});

test("next and previous navigate stable passage IDs in delivery order and stop at boundaries", async () => {
  const detail = await load([passage("third", 3), passage("first", 1), passage("second", 2)]);
  assert.ok(detail);
  let selected = detail.passages[0].id;
  assert.equal(selected, "first");
  assert.equal(adjacentPassageId(detail.passages, selected, -1), undefined);
  selected = adjacentPassageId(detail.passages, selected, 1)!;
  assert.equal(selected, "second");
  selected = adjacentPassageId(detail.passages, selected, 1)!;
  assert.equal(selected, "third");
  assert.equal(adjacentPassageId(detail.passages, selected, 1), undefined);
  selected = adjacentPassageId(detail.passages, selected, -1)!;
  assert.equal(selected, "second");
  selected = adjacentPassageId(detail.passages, selected, -1)!;
  assert.equal(selected, "first");
  assert.equal(adjacentPassageId(detail.passages, "missing", 1), undefined);
});

test("missing, draft and archived modules never request child passages", async () => {
  for (const row of [undefined, { ...module, status: "draft" as const }, { ...module, status: "archived" as const }]) {
    const detail = await loadStudentModuleDetail(module.id, {
      getModuleById: async () => row,
      getPassages: async () => { assert.fail("Must not read unavailable module children"); },
    });
    assert.equal(detail, undefined);
  }
});

test("missing route ID does not issue database reads", async () => {
  assert.equal(await loadStudentModuleDetail(undefined, {
    getModuleById: async () => { assert.fail("Unexpected module read"); },
    getPassages: async () => { assert.fail("Unexpected passage read"); },
  }), undefined);
});

test("authorization/query errors fail closed rather than displaying cached legacy text", async () => {
  await assert.rejects(loadStudentModuleDetail(module.id, {
    getModuleById: async () => { throw new Error("module denied"); },
    getPassages: async () => { assert.fail("Unexpected passage read"); },
  }), /module denied/);
  await assert.rejects(loadStudentModuleDetail(module.id, {
    getModuleById: async () => module,
    getPassages: async () => { throw new Error("passages denied"); },
  }), /passages denied/);
  await assert.rejects(load([{ ...passage("other", 1), moduleId: "other-module" }]), /does not belong/);
});

test("passage repository queries the parent and ordering without requesting questions or keys", async () => {
  const calls: unknown[][] = [];
  const query = {
    select(value: string) { calls.push(["select", value]); return this; },
    eq(key: string, value: string) { calls.push(["eq", key, value]); return this; },
    async order(key: string, options: unknown) {
      calls.push(["order", key, options]);
      return { data: [{ id: "child", module_id: module.id, title: "Title", passage_text: "Text",
        display_order: 1, source_material_id: null, created_at: "", updated_at: "" }], error: null };
    },
  };
  const client = { from(table: string) { calls.push(["from", table]); return query; } } as unknown as SupabaseClient<ProposedPassageDatabase>;
  const children = await createModulePassageRepository(client).getPassages(module.id);
  assert.equal(children[0].id, "child");
  assert.deepEqual(calls[0], ["from", "module_passages"]);
  assert.deepEqual(calls[2], ["eq", "module_id", module.id]);
  assert.deepEqual(calls[3], ["order", "display_order", { ascending: true }]);
  assert.doesNotMatch(JSON.stringify(calls), /correct_answer|comprehension_question/);
});
