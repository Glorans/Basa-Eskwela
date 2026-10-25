import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { activityLanguageFromState, activityLanguageState, getActivityText, normalizeActivityLanguage } from "../src/pages/reading-activity/activityLanguage.ts";

test("activity language comes only from saved metadata, with English fallback", () => {
  for (const value of ["Filipino", "Tagalog", "fil", "fil-PH", "tl", "TL-PH", " FILIPINO "]) assert.equal(normalizeActivityLanguage(value), "fil");
  for (const value of ["en", "English", "en-US", null, undefined, "", "es", {}, "Ang kuwentong Filipino"]) assert.equal(normalizeActivityLanguage(value), "en");
  assert.equal(activityLanguageFromState(activityLanguageState("tl")), "fil");
  assert.equal(activityLanguageFromState({ accountLanguage: "fil" }), undefined);
});

test("interface messages and dynamic values localize without changing English", () => {
  const en = getActivityText("en"), fil = getActivityText("fil");
  assert.equal(en.t("Start Recording"), "Start Recording");
  assert.equal(fil.t("Start Recording"), "Simulan ang Pagre-record");
  assert.equal(fil.t("Inferential"), "Inferensyal");
  assert.equal(fil.t("Critical"), "Kritikal");
  assert.equal(fil.t("{correct}/{total} correct on the first answer ({percentage}%)", { correct: 4, total: 6, percentage: 67 }), "4/6 tama sa unang sagot (67%)");
  assert.equal(fil.message(new Error("Network error detail"), "Your result could not be saved. Please try again."), fil.t("Your result could not be saved. Please try again."));
  assert.equal(en.message(new Error("Network error detail"), "Unable to load the result."), "Network error detail");
  assert.equal(fil.message(Object.assign(new Error("Provider detail"), { code: "NO_SPEECH" }), "Unable to load the result."), fil.t("No speech was detected. Please record your reading again."));
});

test("all shared recorder status messages have explicit Filipino translations", () => {
  const source = readFileSync(new URL("../src/modules/module2/hooks/useAudioRecorder.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("recorder.ts", source, ts.ScriptTarget.Latest, true);
  const strings: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "setMessage") {
      function collect(child: ts.Node) { if (ts.isStringLiteral(child)) strings.push(child.text); ts.forEachChild(child, collect); }
      node.arguments.forEach(collect);
    }
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "INITIAL_MESSAGE" && node.initializer && ts.isStringLiteral(node.initializer)) strings.push(node.initializer.text);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const ui = getActivityText("fil");
  for (const message of strings.filter(text => /[ .]/.test(text))) {
    assert.notEqual(ui.message(message, "Unable to load activity."), ui.t("Unable to load activity."), message);
    assert.notEqual(ui.message(message, "Unable to load activity."), message, message);
  }
  assert.ok(strings.length >= 12);
});

test("activity JSX contains no untranslated literal instructions", () => {
  for (const path of ["pages/reading-activity/ReadAloudPage.tsx", "pages/reading-activity/ReadingResultPage.tsx", "pages/reading-activity/ActivityHeader.tsx", "modules/module6/pages/ComprehensionPage.tsx", "modules/module5/components/OralReadingSummary.tsx",
    "components/reading-feedback/ReadingMascot.tsx", "components/reading-feedback/FeedbackSpeechControls.tsx"]) {
    const ast = ts.createSourceFile(path, readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node: ts.Node) {
      if (ts.isJsxText(node)) assert.doesNotMatch(node.text, /[A-Za-z]/, `${path}: ${node.text}`);
      if (ts.isJsxAttribute(node) && ["aria-label", "title", "placeholder"].includes(node.name.getText(ast)) && node.initializer && ts.isStringLiteral(node.initializer)) {
        assert.equal(node.initializer.text, "", `${path}: untranslated ${node.name.getText(ast)}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
});
