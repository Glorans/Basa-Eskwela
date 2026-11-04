import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf } from "./helpers/hookRuntime.ts";
import * as bankSize from "../src/modules/module3/utils/passageBankSize.ts";

// Admin View Details: saved banks are shown read-only, and a missing or
// incomplete bank is stated plainly.
const require = createRequire(import.meta.url);
const url = new URL("../src/modules/module3/components/ReadOnlyPassageBank.tsx", import.meta.url);

function render(questions: unknown[]) {
  const runtime = createHookRuntime(require("react"));
  const bank = loadComponentModule(url, (id) => (id === "react" ? runtime.react : id.endsWith("passageBankSize.ts") ? bankSize : require(id)));
  return runtime.render(bank.default, { passage: { id: "p1", title: "Kindness", passageText: "Text.", sourceMaterialId: null, displayOrder: 1, questions } });
}

const question = (n: number, type: string, reviewStatus = "reviewed") => ({
  id: `q${n}`, type, questionText: `Question text ${n}?`, options: [`Right ${n}`, `Wrong A${n}`, `Wrong B${n}`, `Wrong C${n}`],
  correctAnswer: `Right ${n}`, scaffoldingHint: `Hint ${n}`, reviewStatus,
  answerExplanation: `Because ${n}.`, supportingEvidence: `Evidence ${n}.`,
});
const fullBank = ["literal", "literal", "inferential", "inferential", "critical", "critical"].map((type, i) => question(i + 1, type));

test("a saved bank is listed without any editable control", () => {
  const tree = render(fullBank);
  assert.deepEqual(findAll(tree, (node) => ["input", "textarea", "select", "button", "form", "fieldset"].includes(node.type)), []);
  const text = textOf(tree);
  assert.match(text, /Saved Question Bank \(read-only\)/);
  assert.match(text, /Literal 2\/2 · Inferential 2\/2 · Critical 2\/2 · All questions reviewed/);
  for (let n = 1; n <= 6; n++) {
    assert.match(text, new RegExp(`Question text ${n}\\?`));
    assert.match(text, new RegExp(`Right ${n} \\(correct answer\\)`));
    assert.match(text, new RegExp(`Hint ${n}Answer explanationBecause ${n}\\.Supporting evidenceEvidence ${n}\\.`));
  }
  assert.equal(findAll(tree, (node) => node.props?.["data-correct"]).length, 6);
  assert.doesNotMatch(text, /does not have exactly two/);
});

test("a missing bank is stated clearly", () => {
  const text = textOf(render([]));
  assert.match(text, /No question bank yet\. Edit the draft to generate and review six questions \(2 literal, 2 inferential and 2 critical\)/);
});

test("an incomplete or unreviewed bank is flagged", () => {
  const text = textOf(render([question(1, "literal", "generated"), question(2, "inferential")]));
  assert.match(text, /Literal 1\/2 · Inferential 1\/2 · Critical 0\/2 · Some questions still need review/);
  assert.match(text, /does not have exactly two questions of each type/);
  assert.match(text, /Needs review/);
});

test("View Details renders the read-only bank and keeps editing controls out of detail mode", async () => {
  const editor = await readFile(new URL("../src/modules/module3/components/AdminCollectionEditor.tsx", import.meta.url), "utf8");
  const detail = editor.slice(editor.indexOf('{mode === "detail" ? ('), editor.indexOf(") : (", editor.indexOf('{mode === "detail" ? (')));
  assert.match(detail, /<ReadOnlyPassageBank passage=\{passage\} bankSizes=\{bankSizes\} \/>/);
  assert.doesNotMatch(detail, /<(input|textarea|select|PassageBank)\b/);
  // Generation and bank editing stay limited to edit mode.
  assert.match(editor, /\{mode !== "create" && mode !== "detail" && \(/);
});

test("with 6/9/12 support, a nine-question bank is counted against three per type", () => {
  const runtime = createHookRuntime(require("react"));
  const bank = loadComponentModule(url, (id) => (id === "react" ? runtime.react : id.endsWith("passageBankSize.ts") ? bankSize : require(id)));
  const nine = ["literal", "inferential", "critical"].flatMap((type, t) => [1, 2, 3].map((n) => question(t * 3 + n, type)));
  const text = textOf(runtime.render(bank.default, { bankSizes: [6, 9, 12], passage: { id: "p1", title: "T", passageText: "Text.", sourceMaterialId: null, displayOrder: 1, questions: nine } }));
  assert.match(text, /Literal 3\/3 · Inferential 3\/3 · Critical 3\/3 · All questions reviewed/);
  assert.doesNotMatch(text, /does not have exactly/);
  const empty = textOf(runtime.render(bank.default, { bankSizes: [6, 9, 12], passage: { id: "p2", title: "T", passageText: "Text.", sourceMaterialId: null, displayOrder: 1, questions: [] } }));
  assert.match(empty, /generate and review 6, 9 or 12 questions, with equal numbers of literal, inferential and critical questions for this passage/);
});
