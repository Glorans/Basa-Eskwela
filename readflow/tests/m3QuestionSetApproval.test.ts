import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Guards the only UI path that marks a question set as reviewed. M4's activity
// form offers only reviewed sets, so losing this path silently blocks teachers
// from attaching questions to activities (see commit 38f450e and its revert).

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
const page = () => read("../src/modules/module3/pages/QuestionReviewPage.tsx");

test("QuestionReviewPage approves a set through reviewMaterialQuestionSet", async () => {
  const source = await page();
  assert.match(source, /import \{[^}]*\breviewMaterialQuestionSet\b[^}]*\} from "\.\.\/services\/materialService"/);

  const start = source.indexOf("async function approveQuestions()");
  assert.ok(start >= 0, "approveQuestions() is missing");
  const end = source.indexOf("async function", start + 1);
  const approve = source.slice(start, end < 0 ? undefined : end);
  assert.match(approve, /await reviewMaterialQuestionSet\(material\.id, selectedSet\.id, selectedSet\.revision\)/);
});

test("QuestionReviewPage renders a Mark as Reviewed control outside edit mode", async () => {
  const source = await page();
  const button = source.search(/<button[^>]*onClick=\{\(\) => void approveQuestions\(\)\}/);
  assert.ok(button >= 0, "no button calls approveQuestions()");
  assert.match(source.slice(button, button + 400), /"Mark as Reviewed"/);

  // Approval must not depend on entering edit mode: the button sits in the
  // actions block that is hidden only when students have answered the set.
  const actions = source.lastIndexOf('<div className="m3-form-actions">', button);
  assert.ok(actions >= 0, "approve button is not inside the form actions");
  assert.match(source.slice(actions - 40, actions), /\{!locked && $/);
});

test("the approve call reaches the server's review route", async () => {
  const [service, routes] = await Promise.all([
    read("../src/modules/module3/services/materialService.ts"),
    read("../../server/routes/materials.js"),
  ]);
  assert.match(service, /export async function reviewMaterialQuestionSet[\s\S]*?api\.post<[^>]*>\(`\$\{setPath\(materialId, setId\)\}\/review`/);
  assert.match(routes, /router\.post\("\/:materialId\/question-sets\/:setId\/review"/);
});
