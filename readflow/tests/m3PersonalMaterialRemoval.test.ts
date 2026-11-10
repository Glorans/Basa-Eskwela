import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const src = new URL("../src/", import.meta.url);
const source = (path: string) => readFile(new URL(path, src), "utf8");

test("Independent Learners remove (not permanently delete) a material, after an accurate confirmation", async () => {
  const library = await source("modules/module3/pages/MaterialLibraryPage.tsx");
  assert.match(library, /const personal = role === "general_user";/);
  assert.match(library, /if \(personal && !\(await confirmReadFlow\(/);
  assert.match(library, /This is not a permanent deletion\. Basa Eskwela keeps the uploaded file, its saved text, any private questions/);
  assert.match(library, /An unfinished comprehension assessment for it becomes read-only\./);
  assert.match(library, /\{ confirm: "Remove", cancel: "Keep material" \}/);
  assert.match(library, /personal \? "Remove from Reading Materials" : "Delete"/);
  assert.match(library, /was removed from your Reading Materials\. Its file, text and saved results are kept\./);
  // The library heading rules still apply (no "My Materials" wording).
  assert.doesNotMatch(library, /My Materials/);
});

test("Teacher material deletion keeps its existing label, notice and no new confirmation", async () => {
  const library = await source("modules/module3/pages/MaterialLibraryPage.tsx");
  assert.match(library, /: `\$\{material\.title\} was deleted\.`/);
  assert.match(library, /personal \? "Removing\.\.\." : "Deleting\.\.\."/);
  // The confirmation is guarded by the Independent Learner flag only.
  assert.equal((library.match(/confirmReadFlow\(/g) ?? []).length, 1);
});

test("personal practice and M6 wording describe removal and retention, never permanent deletion", async () => {
  const panel = await source("modules/module3/components/PersonalMaterialPractice.tsx");
  const m6 = await source("modules/module6/pages/ComprehensionPage.tsx");
  assert.match(panel, /It is not permanently deleted: the file, text, private questions and saved results are kept/);
  assert.doesNotMatch(panel, /Deleting this material/);
  assert.match(m6, /This material was removed from your Reading Materials\. Your saved answers are kept, but this unfinished assessment cannot continue\./);
  assert.doesNotMatch(m6, /This material was deleted\./);
});
