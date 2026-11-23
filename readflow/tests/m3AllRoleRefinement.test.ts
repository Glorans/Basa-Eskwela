import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  QUESTION_COUNT_INSTRUCTION, QUESTION_COUNT_MAX, allowedQuestionCounts, checkQuestionCount, isBalancedTotal, questionBreakdown,
} from "../src/modules/module3/utils/questionCount.ts";
import { difficultyPathIssue, resolveLearningPathByDifficulty } from "../src/modules/module3/utils/learningPathSelection.ts";

// M3 all-role refinement (2026-11-23): shared question count, bank validation, path-by-difficulty, navigation.
const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("question count: 6, 9 and 12 split equally; the maximum is the generator's real limit (12)", () => {
  assert.deepEqual(allowedQuestionCounts(), [6, 9, 12]);
  assert.equal(QUESTION_COUNT_MAX, 12);
  for (const [total, each] of [[6, 2], [9, 3], [12, 4]] as const) {
    const check = checkQuestionCount(String(total));
    assert.ok(check.ok);
    assert.deepEqual(check.ok && check.breakdown, { literal: each, inferential: each, critical: each });
    assert.deepEqual(questionBreakdown(total), { literal: each, inferential: each, critical: each });
  }
  assert.equal(QUESTION_COUNT_INSTRUCTION, "Enter at least 6 questions in multiples of 3. Questions will be divided equally into Literal, Inferential, and Critical.");
});

test("question count: invalid entries are refused with a reason and never adjusted", () => {
  const reason = (value: string, max?: number) => { const check = checkQuestionCount(value, max); return check.ok ? "OK" : check.error; };
  assert.equal(reason(""), "Enter the number of questions.");
  assert.equal(reason("   "), "Enter the number of questions.");
  assert.match(reason("7.5"), /whole number/);
  assert.match(reason("abc"), /whole number/);
  assert.match(reason("-6"), /whole number/);
  assert.equal(reason("3"), "Enter at least 6 questions.");
  assert.match(reason("8"), /multiple of 3/);
  assert.match(reason("15"), /at most 12/);
  assert.match(reason("9", 6), /at most 6/, "a database that supports only 6 limits the input to 6");
});

test("bank balance: the saved total must be allowed and split equally", () => {
  const bank = (l: number, i: number, c: number) => [
    ...Array(l).fill({ type: "literal" }), ...Array(i).fill({ type: "inferential" }), ...Array(c).fill({ type: "critical" })];
  assert.ok(isBalancedTotal(bank(2, 2, 2)) && isBalancedTotal(bank(3, 3, 3)) && isBalancedTotal(bank(4, 4, 4)));
  assert.ok(!isBalancedTotal(bank(3, 2, 1)), "unequal categories");
  assert.ok(!isBalancedTotal(bank(1, 1, 1)), "below the minimum");
  assert.ok(!isBalancedTotal(bank(5, 5, 5)), "above the maximum");
});

test("learning path from language + difficulty (no reading level asked); ambiguous or missing paths are refused", () => {
  const paths = [
    { id: "a", name: "English Foundations", language: "en", readingLevel: "Frustration", difficultyTier: "Easy" },
    { id: "b", name: "English Growing", language: "en", readingLevel: "Instructional", difficultyTier: "Medium" },
    { id: "c", name: "Filipino Panimula", language: "fil", readingLevel: "Frustration", difficultyTier: "Easy" },
  ] as never[];
  assert.equal(resolveLearningPathByDifficulty(paths, "en", "Medium")?.id, "b");
  assert.equal(resolveLearningPathByDifficulty(paths, "fil", "Easy")?.id, "c");
  assert.equal(resolveLearningPathByDifficulty(paths, "fil", "Hard"), null);
  assert.equal(difficultyPathIssue(paths, "", "Easy"), "Choose a language.");
  assert.match(difficultyPathIssue(paths, "fil", "Hard"), /No learning path is configured/);
  assert.match(difficultyPathIssue([...paths, paths[0]], "en", "Easy"), /More than one learning path/);
  assert.equal(difficultyPathIssue(paths, "en", "Easy"), "");
});

test("module editor: no Reading Level field or reading-level instructions; Difficulty kept", () => {
  const editor = read("modules/module3/components/AdminCollectionEditor.tsx");
  assert.doesNotMatch(editor, /module-reading-level|Select reading level|Choose a language and reading level|Language and reading level determine/);
  assert.match(editor, /Difficulty/);
  assert.match(editor, /resolveLearningPathByDifficulty\(learningPaths, language, difficulty\)/);
  assert.match(editor, /<QuestionCountInput/);
  assert.match(editor, /<PassageBankSummary/);
  assert.match(editor, /<PublishIssuesDialog/);
  assert.doesNotMatch(editor, /<BankSizeSelect|<PassageBank\b|<ReadOnlyPassageBank/);
});

test("lists and cards: no reading level metadata or filter in M3 module management", () => {
  const list = read("modules/module3/pages/Module3Page.tsx");
  assert.doesNotMatch(list, /Reading level|readingLevel/);
  assert.match(list, /<span>Difficulty<\/span>/);
  assert.doesNotMatch(read("modules/module3/pages/ModuleDetailPage.tsx"), /Reading Level/);
});

test("navigation: no duplicate entries; removed items now open from page buttons", () => {
  const layout = read("modules/module3/components/M3Layout.tsx");
  assert.doesNotMatch(layout, /label: "My Reading Modules"/);
  assert.doesNotMatch(layout, /label: "Upload Material"/);
  assert.match(layout, /\{ label: "Reading Materials", to: "\/m3\/admin\/materials", icon: Files, end: false \}/);
  assert.match(layout, /path\.endsWith\("\/\*"\) \? pathname\.startsWith\(path\.slice\(0, -1\)\) : path === pathname/);
  const catalog = read("modules/module3/pages/ModuleCatalogPage.tsx");
  assert.match(catalog, /to="\/m3\/teacher\/content"><FilePlus2[^>]*\/> My Reading Modules<\/Link>/, "the page button stays");
  assert.match(read("modules/module3/pages/MaterialLibraryPage.tsx"), /to=\{`\$\{root\}\/materials\/upload`\}/, "Upload Material stays on the page");
  const app = read("App.tsx");
  assert.match(app, /<Route path="materials" element=\{<MaterialLibraryPage role="admin" \/>\} \/>/);
  assert.match(app, /<Route path="materials\/upload" element=\{<UploadMaterialPage role="admin" \/>\} \/>/);
  assert.match(app, /path="materials\/upload"\s*element=\{<UploadMaterialPage role="general_user" \/>\}/, "the learner upload route still works");
});

test("Student preview never contacts the server and creates nothing", () => {
  const preview = read("modules/module3/components/ComprehensionStudentPreview.tsx");
  assert.doesNotMatch(preview, /api\.|fetch\(|supabase|services\//);
  assert.match(preview, /m6-question-card/, "uses the Student comprehension screen's layout");
  assert.match(preview, /Preview only: nothing is saved\./);
});

test("question editor validation: answer keys, unique choices, evidence from the passage, equal categories", async () => {
  const { createRequire } = await import("node:module");
  const { loadComponentModule } = await import("./helpers/hookRuntime.ts");
  const require = createRequire(import.meta.url);
  const mod = loadComponentModule(new URL("../src/modules/module3/components/QuestionBankEditorModal.tsx", import.meta.url), (id: string) => {
    if (id.endsWith(".css")) return {};
    if (id === "lucide-react") return new Proxy({}, { get: () => "svg" });
    if (id.endsWith("/ReadFlowDialog") || id.endsWith("./M3Dialog")) return { confirmReadFlow: async () => true, default: () => null };
    if (id === "../utils/questionCount") return require(new URL("../src/modules/module3/utils/questionCount.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
    return require(id);
  });
  const passage = "Mara woke up early. She ran to the bus stop.";
  const q = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, questionText: "Why?", options: ["a", "b", "c", "d"],
    correctIndex: 0, scaffoldingHint: "Think.", answerExplanation: "Because.", supportingEvidence: "She ran to the bus stop.", ...extra });
  const good = [q("1", "literal"), q("2", "literal"), q("3", "inferential"), q("4", "inferential"), q("5", "critical"), q("6", "critical")];
  const rules = { requireExplanation: true, requireEvidence: true, evidenceSource: passage };
  assert.ok(mod.validateEditableBank(good, rules).ok);
  const bad = [...good];
  bad[0] = q("1", "literal", { correctIndex: 7 });
  bad[1] = q("2", "literal", { options: ["a", "A", "c", "d"] });
  bad[2] = q("3", "inferential", { supportingEvidence: "Text that is not in the passage." });
  const check = mod.validateEditableBank(bad, rules);
  assert.equal(check.ok, false);
  assert.match(check.perQuestion.get(0).join(" "), /Choose the correct answer/);
  assert.match(check.perQuestion.get(1).join(" "), /must be different/);
  assert.match(check.perQuestion.get(2).join(" "), /copied exactly from the passage/);
  const unequal = good.map((item, index) => (index === 5 ? { ...item, type: "literal" } : item));
  assert.match(mod.validateEditableBank(unequal, rules).bank.join(" "), /Keep the categories equal/);
  assert.ok(mod.validateEditableBank(good.map((item) => ({ ...item, answerExplanation: "", supportingEvidence: "" })),
    { requireExplanation: false, requireEvidence: false }).ok, "material sets keep explanation and evidence optional");
});
