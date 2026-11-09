import assert from "node:assert/strict";
import test from "node:test";

const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    get length() { return memory.size; },
    key: (i: number) => [...memory.keys()][i] ?? null,
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => { memory.set(k, String(v)); },
    removeItem: (k: string) => { memory.delete(k); },
  },
});

const {
  applyDraft, buildDraft, clearAllModuleDrafts, clearDraft, DRAFT_MAX_AGE_MS, draftDiffers, readDraft, writeDraft,
} = await import("../src/modules/module3/utils/moduleDraftStorage.ts");

test.beforeEach(() => memory.clear());

const saved = () => ({
  id: "m1", title: "Saved", learningPathId: "path-en", difficulty: "Easy", revision: 4,
  passages: [
    { id: "a", title: "A", passageText: "Saved A", sourceMaterialId: null, displayOrder: 1, questions: [{ id: "qa" }] },
    { id: "b", title: "B", passageText: "Saved B", sourceMaterialId: null, displayOrder: 2, questions: [{ id: "qb" }] },
  ],
});

test("edit drafts restore text and order but keep current question banks", () => {
  const draft = buildDraft({ userId: "u1", moduleKey: "m1", mode: "edit", collection: saved(), language: "en", readingLevel: "Instructional", removed: [] });
  draft.passages = [
    { id: "b", title: "B2", passageText: "Edited B", sourceMaterialId: null },
    { id: "a", title: "A", passageText: "Saved A", sourceMaterialId: null },
    { id: "new", title: "N", passageText: "New passage", sourceMaterialId: null },
  ];
  const { collection } = applyDraft(draft, saved(), { keepUnlistedPassages: true });
  assert.deepEqual(collection.passages.map((p) => [p.id, p.passageText, p.displayOrder, p.questions.length]),
    [["b", "Edited B", 1, 1], ["a", "Saved A", 2, 1], ["new", "New passage", 3, 0]]);
  assert.equal(collection.revision, 4, "saving still checks the module's current revision");
});

test("edit drafts keep passages saved elsewhere later and honour removals", () => {
  const draft = buildDraft({ userId: "u1", moduleKey: "m1", mode: "edit", collection: saved(), language: null, readingLevel: null, removed: ["b"] });
  draft.passages = draft.passages.filter((p) => p.id !== "b");
  const later = saved();
  later.passages.push({ id: "c", title: "C", passageText: "Added in another session", sourceMaterialId: null, displayOrder: 3, questions: [] });
  const { collection, removed } = applyDraft(draft, later, { keepUnlistedPassages: true });
  assert.deepEqual(collection.passages.map((p) => p.id), ["a", "c"]);
  assert.deepEqual(removed, ["b"]);
});

test("create drafts replace the blank starting passage", () => {
  const blank = { ...saved(), id: "fresh", revision: 0, passages: [{ id: "tmp", title: "", passageText: "", sourceMaterialId: null, displayOrder: 1, questions: [] }] };
  const draft = buildDraft({ userId: "u1", moduleKey: "new", mode: "create", collection: { ...blank, passages: [{ ...blank.passages[0], id: "p1", passageText: "Typed" }] }, language: "en", readingLevel: "Independent", removed: [] });
  const { collection } = applyDraft(draft, blank, { keepUnlistedPassages: false });
  assert.deepEqual(collection.passages.map((p) => [p.id, p.passageText]), [["p1", "Typed"]]);
});

test("drafts are scoped to account and module, expire, and reject corrupt data", () => {
  const draft = buildDraft({ userId: "u1", moduleKey: "m1", mode: "edit", collection: saved(), language: null, readingLevel: null, removed: [] });
  writeDraft(draft);
  assert.ok(readDraft("u1", "m1"));
  assert.equal(readDraft("u2", "m1"), null, "another account");
  assert.equal(readDraft("u1", "m2"), null, "another module");
  assert.equal(readDraft("u1", "m1", draft.savedAt + DRAFT_MAX_AGE_MS + 1), null, "expired");
  assert.equal(localStorage.getItem("basa:m3-module-draft:v1:u1:m1"), null, "expired drafts are removed");

  localStorage.setItem("basa:m3-module-draft:v1:u1:m1", "{not json");
  assert.equal(readDraft("u1", "m1"), null);
  localStorage.setItem("basa:m3-module-draft:v1:u1:m1", JSON.stringify({ ...draft, userId: "u2" }));
  assert.equal(readDraft("u1", "m1"), null, "a draft claiming another owner is refused");
});

test("unchanged drafts are not offered; clearing works per module and on logout", () => {
  const draft = buildDraft({ userId: "u1", moduleKey: "m1", mode: "edit", collection: saved(), language: null, readingLevel: null, removed: [] });
  assert.equal(draftDiffers(draft, saved()), false);
  draft.passages[0].passageText = "Changed";
  assert.equal(draftDiffers(draft, saved()), true);

  writeDraft(draft);
  writeDraft({ ...draft, moduleKey: "new" });
  localStorage.setItem("unrelated", "kept");
  clearDraft("u1", "m1");
  assert.equal(readDraft("u1", "m1"), null);
  assert.ok(readDraft("u1", "new"));
  clearAllModuleDrafts();
  assert.equal(readDraft("u1", "new"), null);
  assert.equal(localStorage.getItem("unrelated"), "kept", "only module drafts are removed");
});
