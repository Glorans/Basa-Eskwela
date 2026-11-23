import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const src = new URL("../src/", import.meta.url);
const source = (path: string) => readFile(new URL(path, src), "utf8");

test("Independent Learners move a material to Trash (never a permanent delete), after an accurate confirmation", async () => {
  const library = await source("modules/module3/pages/MaterialLibraryPage.tsx");
  assert.match(library, /const personal = role === "general_user";/);
  assert.match(library, /if \(!\(await confirmReadFlow\(/);
  assert.match(library, /Move "\$\{material\.title\}" to Trash\?/);
  assert.match(library, /Nothing is erased: your file, text, questions and results are kept, and you can restore it from Trash\./);
  assert.match(library, /\{ confirm: "Move to Trash", cancel: "Keep material" \}/);
  assert.match(library, /\{deletingId === material\.id \? "Moving\.\.\." : "Move to Trash"\}/);
  assert.match(library, /was moved to Trash\./);
  assert.doesNotMatch(library, /permanent(ly)? delet/i);
});

test("Every role opens Trash from the header, left of Upload Material, and can restore (M3 all-role refinement)", async () => {
  const library = await source("modules/module3/pages/MaterialLibraryPage.tsx");
  assert.match(library, /const showTrash = trashInstalled && searchParams\.get\("view"\) === "trash";/);
  assert.match(library, /useEffect\(\(\) => \{ void loadTrash\(\); \}, \[loadTrash\]\);/);
  assert.match(library, /await \(personal \? restorePersonalMaterial\(material\.id\) : restoreStaffMaterial\(material\.id\)\);/);
  // [Trash (count)] [Upload Material]: the Trash button comes first in the header actions, for Independent Learners only.
  const actions = library.slice(library.indexOf("actions={<>"));
  assert.ok(actions.indexOf("m3-trash-button") > 0 && actions.indexOf("m3-trash-button") < actions.indexOf("Upload Material"));
  assert.match(actions, /\{trashInstalled && \(\s*<button type="button" className=\{`m3-button m3-button--secondary m3-trash-button/);
  assert.match(library, /<span className="m3-trash-button__count m3-trash-toggle__count" aria-hidden="true">\{trash\?\.length \?\? 0\}<\/span>/);
  assert.match(library, /Back to My Materials/);
  assert.doesNotMatch(library, /role="tablist"/);
  assert.match(library, /is back in My Materials\./);
  assert.match(library, /<h2>Trash is empty<\/h2>/);
});

test("Staff material deletion is a confirmed Move to Trash that keeps files, sets and results", async () => {
  const library = await source("modules/module3/pages/MaterialLibraryPage.tsx");
  assert.match(library, /setNotice\(`\$\{material\.title\} was moved to Trash\.`\);/);
  assert.match(library, /Nothing is erased: the file, its text, question sets, answer keys and learner results are kept\./);
  assert.match(library, /"Manage your source files and review generated comprehension questions\."/);
  // One shared confirmation for every role.
  assert.equal((library.match(/confirmReadFlow\(/g) ?? []).length, 1);
});

test("practice and M6 wording describe Trash and Restore, never permanent deletion", async () => {
  const panel = await source("modules/module3/components/PersonalMaterialPractice.tsx");
  const m6 = await source("modules/module6/pages/ComprehensionPage.tsx");
  assert.doesNotMatch(panel, /Deleting this material|permanently deleted/);
  assert.match(m6, /This material is in Trash\. Your saved answers are kept\. Restore it from Trash in Reading Materials to continue this assessment\./);
  assert.match(m6, /Nasa Trash ang babasahing ito\./);
  assert.doesNotMatch(m6, /This material was deleted\.|cannot continue/);
});
