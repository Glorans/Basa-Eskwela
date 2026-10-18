import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProposedPassageDatabase } from "../src/modules/module3/types/proposedPassageDatabase";
import type { ModuleCollectionDraft, PassageDraft, PassageQuestion } from "../src/modules/module3/types/modulePassages";
import {
  normalizeCollectionDraft, getCollectionPublishIssues, getCollectionQuestionCount,
  getPassageQuestions, getPassageSummaries, legacyModulePassage, movePassage, removeEmptyPassage, updatePassage,
} from "../src/modules/module3/services/modulePassageModel.ts";
import { createModulePassageRepository } from "../src/modules/module3/services/modulePassageService.ts";

const first: PassageDraft = { id: "11111111-1111-4111-8111-111111111111", title: "The Gift", passageText: "A reviewed story.", sourceMaterialId: null };
const second: PassageDraft = { ...first, id: "22222222-2222-4222-8222-222222222222", title: "The Park" };
const draft = (passages = [first]): ModuleCollectionDraft => ({ title: " English set ", learningPathId: "path", difficulty: "Easy", passages });
function bank(passageId: string): PassageQuestion[] {
  return (["literal", "literal", "inferential", "inferential", "critical", "critical"] as const).map((type, i) => ({
    id: `${passageId}-${i}`, passageId, type, questionText: `Question ${i + 1}?`,
    options: ["One", "Two", "Three", "Four"], scaffoldingHint: "Read the story again.", displayOrder: i + 1, reviewStatus: "reviewed",
  }));
}

test("collection draft supports one or multiple ordered passages without a question bank", () => {
  for (const passages of [[first], [first, second], []]) {
    const saved = normalizeCollectionDraft(draft(passages), ["path"]);
    assert.equal(saved.title, "English set");
    assert.deepEqual(saved.passages.map(p => p.id), passages.map(p => p.id));
  }
});
test("draft permits incomplete passage title and text; publication identifies their positions", () => {
  const values = draft([{ ...first, title: " ", passageText: " " }]);
  assert.doesNotThrow(() => normalizeCollectionDraft(values, ["path"]));
  assert.deepEqual(getCollectionPublishIssues(values, bank(first.id), ["path"]), ["Passage 1 needs a title.", "Passage 1 needs reading text."]);
});
test("metadata, duplicate passage IDs and malformed provenance are rejected", () => {
  for (const values of [
    { ...draft(), title: " " }, { ...draft(), learningPathId: "missing" },
    { ...draft(), difficulty: "Unknown" } as unknown as ModuleCollectionDraft,
    draft([first, first]), draft([{ ...first, title: "x".repeat(201) }]),
    draft([{ ...first, sourceMaterialId: "bad-id" }]),
  ]) assert.throws(() => normalizeCollectionDraft(values, ["path"]));
});
test("legacy backfill identity, exact text and timestamps are deterministic", () => {
  const row = { id: first.id, title: first.title, passage: "  Original text\nnext line  ", source_material_id: second.id, created_at: "2025-01-01", updated_at: "2025-01-02" };
  const [p] = legacyModulePassage(row);
  assert.deepEqual(p, { id: row.id, moduleId: row.id, title: row.title, passageText: row.passage, sourceMaterialId: second.id, displayOrder: 1, createdAt: row.created_at, updatedAt: row.updated_at });
  assert.deepEqual(legacyModulePassage(row), legacyModulePassage(row));
  assert.deepEqual(legacyModulePassage({ ...row, passage: null }), []);
});
test("passage question banks stay isolated even when display order overlaps", () => {
  const questions = [...bank(second.id), ...bank(first.id)];
  assert.deepEqual(getPassageQuestions(questions, first.id), bank(first.id));
  assert.equal(getCollectionQuestionCount([first], questions), 6);
  assert.equal(getCollectionQuestionCount([first, second], questions), 12);
  assert.deepEqual(getPassageQuestions(questions, "missing"), []);
});
test("publish blocks missing passages, missing questions and pending reviews", () => {
  assert.match(getCollectionPublishIssues(draft([]), [], ["path"]).join(), /At least 1 passage/);
  assert.match(getCollectionPublishIssues(draft([first, second]), bank(first.id), ["path"]).join(), /Passage 2 has no reviewed/);
  assert.match(getCollectionPublishIssues(draft(), bank(first.id).map(q => ({ ...q, reviewStatus: "generated" })), ["path"]).join(), /need review/);
});
test("publication readiness requires each category and valid questions on every passage", () => {
  assert.match(getCollectionPublishIssues(draft(), bank(first.id).slice(0, 4), ["path"]).join(), /critical/);
  const invalid = bank(first.id); invalid[0].options = ["same", "same", "same", "same"];
  assert.match(getCollectionPublishIssues(draft(), invalid, ["path"]).join(), /invalid question content/);
  assert.deepEqual(getCollectionPublishIssues(draft([first, second]), [...bank(first.id), ...bank(second.id)], ["path"]), []);
});
test("summaries derive counts and distinguish no questions from reviewed questions", () => {
  assert.deepEqual(getPassageSummaries([first, second], bank(first.id)).map(p => [p.questionCount, p.reviewStatus]), [[6, "reviewed"], [0, "missing"]]);
});
test("editing one passage leaves the others intact and does not mutate inputs", () => {
  const changed = updatePassage([first, second], first.id, { title: "Updated", passageText: "New text" });
  assert.equal(changed[1], second); assert.equal(first.title, "The Gift");
  assert.equal(changed[0].title, "Updated");
  assert.throws(() => updatePassage([first], "unknown", { title: "", passageText: "" }), /not found/);
});
test("reordering keeps stable identities and removing a bank-bearing passage is rejected", () => {
  const reordered = movePassage([first, second], second.id, -1);
  assert.deepEqual(reordered.map(p => p.id), [second.id, first.id]);
  assert.deepEqual(getPassageSummaries(reordered, []).map(p => p.displayOrder), [1, 2]);
  assert.deepEqual(movePassage([first, second], first.id, -1), [first, second]);
  assert.throws(() => removeEmptyPassage([first, second], first.id, bank(first.id)), /question bank/);
  assert.deepEqual(removeEmptyPassage([first, second], second.id, bank(first.id)), [first]);
});
test("repository creates drafts with one atomic RPC and propagates persistence failures", async () => {
  const calls: unknown[][] = [];
  let failure = false;
  const client = { rpc: async (...args: unknown[]) => { calls.push(args); return { data: first.id, error: failure ? new Error("denied") : null }; } } as unknown as SupabaseClient<ProposedPassageDatabase>;
  const repository = createModulePassageRepository(client);
  assert.equal(await repository.createDraft(first.id, draft([first, second]), ["path"]), first.id);
  assert.equal(calls.length, 1); assert.equal(calls[0][0], "m3_create_collection_draft");
  assert.deepEqual((calls[0][1] as { passage_drafts: PassageDraft[] }).passage_drafts.map(p => p.id), [first.id, second.id]);
  failure = true;
  await assert.rejects(repository.createDraft(first.id, draft(), ["path"]), /denied/);
});
const migration = () => readFile(new URL("../../supabase/m3_module_passages_phase1.sql", import.meta.url), "utf8");
test("migration preserves legacy rows, isolated answers, material scope and restrictive provenance", async () => {
  const sql = await migration();
  assert.match(sql, /set passage_id = module_id where module_id is not null/);
  assert.match(sql, /foreign key \(passage_id, module_id\) references public.module_passages\(id, module_id\)/);
  assert.match(sql, /material_id is null/);
  assert.match(sql, /source_material_id uuid references public.uploaded_materials\(id\) on delete restrict/);
  assert.doesNotMatch(sql, /drop column|delete from public.comprehension_questions|grant .*comprehension_question_answers/i);
});
test("migration fails closed for non-admin writes and premature multi-passage publication", async () => {
  const sql = await migration();
  assert.match(sql, /m3_current_role\(\) is distinct from 'admin'/);
  assert.match(sql, /revoke all on public.module_passages from public, anon, authenticated/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /Passage-aware learner delivery is not enabled/);
  assert.match(sql, /insert into public.m3_pending_collection_delivery\(module_id\) values \(target_id\)/);
  assert.match(sql, /revoke all on function public.m3_create_collection_draft.*from public/);
  assert.doesNotMatch(sql, /grant (insert|update|delete).*module_passages/i);
});
