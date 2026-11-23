import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf } from "./helpers/hookRuntime.ts";

// Read-only question bank in the module detail view. M3 all-role refinement (2026-11-23): the old ReadOnlyPassageBank
// list was replaced by the shared compact summary (PassageBankSummary readOnly) with View Questions in a read-only
// modal. These tests keep the same guarantees for the new summary.
const require = createRequire(import.meta.url);
const url = new URL("../src/modules/module3/components/PassageBankSummary.tsx", import.meta.url);
const question = (id: string, type: string, reviewStatus = "reviewed") => ({
  id, type, questionText: `Q ${id}`, options: ["a", "b", "c", "d"], correctAnswer: "a", scaffoldingHint: "h", reviewStatus,
  answerExplanation: "e", supportingEvidence: "x",
});
const bank = (perType: number, reviewStatus = "reviewed") => ["literal", "inferential", "critical"]
  .flatMap((type) => Array.from({ length: perType }, (_, i) => question(`${type}-${i}`, type, reviewStatus)));

function render(questions: unknown[], editLink?: unknown) {
  const runtime = createHookRuntime(require("react"));
  const mod = loadComponentModule(url, (id) => {
    if (id === "react") return runtime.react;
    if (id === "lucide-react") return new Proxy({}, { get: () => "svg" });
    if (id === "./QuestionBankEditorModal" || id === "./ComprehensionStudentPreview") return { default: () => null };
    if (id === "../utils/questionCount") return require(new URL("../src/modules/module3/utils/questionCount.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
    return require(id);
  });
  return runtime.render(mod.default, {
    moduleTitle: "Module", passage: { id: "p1", title: "Passage", passageText: "x", questions }, readOnly: true, disabled: false,
    editLink, onOpenChange: () => {}, onSave: async () => {},
  });
}

test("a saved bank is summarized without any editable control", () => {
  const tree = render(bank(2));
  const text = textOf(tree);
  assert.match(text, /Question bank saved and reviewed/);
  assert.match(text, /6 questions.*2 Literal.*2 Inferential.*2 Critical/s);
  assert.equal(findAll(tree, (n) => ["input", "textarea", "select"].includes(n.type)).length, 0, "no editable field in the summary");
  const buttons = findAll(tree, (n) => n.type === "button").map((n) => textOf(n).trim());
  assert.deepEqual(buttons, ["View Questions", "Preview as Student"], "read-only: View, never View/Edit");
});

test("a missing bank is stated clearly", () => {
  const tree = render([]);
  assert.match(textOf(tree), /No question bank yet/);
  assert.equal(findAll(tree, (n) => n.type === "button").length, 0);
});

test("an unreviewed bank is flagged, with a link to edit the draft when one is given", () => {
  const tree = render(bank(2, "generated"), "EDIT-LINK");
  assert.match(textOf(tree), /Question bank saved · needs review/);
  assert.match(textOf(tree), /EDIT-LINK/);
});

test("nine- and twelve-question banks are counted per type", () => {
  assert.match(textOf(render(bank(3))), /9 questions.*3 Literal.*3 Inferential.*3 Critical/s);
  assert.match(textOf(render(bank(4))), /12 questions.*4 Literal.*4 Inferential.*4 Critical/s);
});

test("View Details renders the read-only summary and keeps editing controls out of detail mode", async () => {
  const editor = await readFile(new URL("../src/modules/module3/components/AdminCollectionEditor.tsx", import.meta.url), "utf8");
  assert.match(editor, /<PassageBankSummary moduleTitle=\{collection\.title\} passage=\{passage\} readOnly disabled=\{false\}/);
  const detail = editor.slice(editor.indexOf('{mode === "detail" ? ('), editor.indexOf(") : (", editor.indexOf('{mode === "detail" ? (')));
  assert.doesNotMatch(detail, /<input|<textarea|Generate|Save Reviewed/);
});
