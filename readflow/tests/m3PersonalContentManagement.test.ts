import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("practice shows short steps in order: check/edit text, questions (with preview), read aloud, answer", async () => {
  const panel = await source("modules/module3/components/PersonalMaterialPractice.tsx");
  assert.match(panel, /export const CHECK_TEXT_INSTRUCTION = 'Check the text below\. You can edit it if something is incorrect\.';/);
  const order = ['title="Check the text"', 'title="Get your questions"', 'title="Read aloud"', 'title="Answer the questions"']
    .map(step => panel.indexOf(step));
  assert.ok(order.every(i => i > 0) && order.every((i, n) => n === 0 || i > order[n - 1]), String(order));
  assert.match(panel, /<Link className="m3-action-link" to=\{`\$\{root\}\/questions`\}>Review \/ Edit Questions<\/Link>/);
  // Each step shows Done or To do.
  assert.match(panel, /\{done \? 'Done' : 'To do'\}/);
  assert.match(panel, /export const REVIEW_QUESTIONS_INSTRUCTION = 'Review your questions before starting comprehension\.';/);
  // The long, technical explanations are gone.
  assert.doesNotMatch(panel, /rolling 24 hours|AI-validated|Teacher-reviewed|page-extraction report|not permanently deleted|readable text|page\(s\)/);
});

test("the server decides when the text may be edited; a confirmed, unchanged text is never asked again", async () => {
  const panel = await source("modules/module3/components/PersonalMaterialPractice.tsx");
  assert.match(panel, /if \(typeof state\.canEditText === 'boolean'\) return state\.canEditText;/);
  assert.match(panel, /\{editable && <button type="button" className="m3-button m3-button--secondary"/);
  assert.match(panel, /\{!state\.reviewed && <button type="button" className="m3-button m3-button--primary"/);
  for (const label of ["Edit Text", "Save Changes", "Confirm Text"]) assert.ok(panel.includes(label), label);
  assert.match(panel, /savePersonalMaterialText\(materialId, draft, state\.revision\)/);
  assert.match(panel, /Finish your comprehension first\. Then you can edit the text\./);
  assert.match(panel, /Your text changed, so you need new questions\./);
  assert.match(panel, /Your answers and result stay the same\./);
  assert.match(panel, /Your original file stays the same\./);
});

test("comprehension is offered only when eligible and keeps the one-assessment rule", async () => {
  const panel = await source("modules/module3/components/PersonalMaterialPractice.tsx");
  assert.match(panel, /state\.attemptId\s*\? <Link className="m3-action-link" to=\{`\/m3\/general\/comprehension\/\$\{state\.attemptId\}`\}>\{completed \? 'View Comprehension Result' : 'Resume Comprehension'\}/);
  assert.match(panel, /: state\.questionSetId && state\.readingId && state\.reviewed/);
});

test("question preview list shows no answers; answers only in the explicit editor; never starts the assessment", async () => {
  const page = (await source("modules/module3/pages/PersonalQuestionPreviewPage.tsx"))
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); // code only, not comments
  const service = await source("modules/module3/services/materialService.ts");
  // M3 all-role refinement: the read-only list still renders only the question and its choices.
  const list = page.slice(page.indexOf('className="m3-question-preview__list"'), page.indexOf('className="m3-panel m3-question-preview__actions"'));
  assert.ok(list.length > 100);
  assert.doesNotMatch(list, /correct|explanation|supportingEvidence|scaffoldingHint|answerKey/i);
  // Answers appear only after choosing Edit Questions, which is offered only before the comprehension has started.
  assert.match(page, /\{!practice\.attemptId && <div className="m3-form-actions">/);
  assert.match(page, /This editor shows the correct answers\./);
  assert.match(service, /questions: \{ id: string; type: "literal" \| "inferential" \| "critical"; questionText: string; options: string\[\] \}\[\];/);
  assert.match(page, /const canStart = !practice\.attemptId && practice\.reviewed && Boolean\(practice\.readingId\);/);
  assert.match(page, /Your question set · \$\{preview\.questions\.length\} questions/);
  assert.match(page, /The answers appear after you finish, unless you open Edit Questions\./);
  // No POST: only reads.
  assert.doesNotMatch(page, /api\.post|fetch\(/);
});

test("the preview route is Independent Learner only and Teacher/Admin question routes are unchanged", async () => {
  const app = await source("App.tsx");
  const general = app.slice(app.indexOf('element={<MaterialLibraryPage role="general_user" />}'));
  assert.match(general.slice(0, 1200), /<Route path="materials\/:materialId\/questions" element=\{<PersonalQuestionPreviewPage \/>\} \/>/);
  assert.equal((app.match(/<PersonalQuestionPreviewPage \/>/g) ?? []).length, 1);
  assert.match(app, /element=\{<QuestionReviewPage role="teacher" \/>\}/);
  assert.match(app, /element=\{<QuestionReviewPage role="admin" \/>\}/);
});

test("Step 2: Preview always, Regenerate only when eligible, clear locks; no question editing or manual creation", async () => {
  const panel = await source("modules/module3/components/PersonalMaterialPractice.tsx");
  const preview = await source("modules/module3/pages/PersonalQuestionPreviewPage.tsx");
  assert.match(panel, /<Link className="m3-action-link" to=\{`\$\{root\}\/questions`\}>Review \/ Edit Questions<\/Link>/);
  assert.match(panel, /\{state\.canGetNewQuestions && <button type="button" className="m3-button m3-button--secondary"/);
  assert.match(panel, /confirmReadFlow\(REGENERATE_CONFIRMATION, \{ confirm: 'Regenerate Questions', cancel: 'Keep my questions' \}\)/);
  assert.match(preview, /confirmReadFlow\(REGENERATE_CONFIRMATION, \{ confirm: "Regenerate Questions", cancel: "Keep my questions" \}\)/);
  assert.match(panel, /This counts toward your 5 question sets for today\./);
  assert.match(panel, /assessment_unfinished: 'Your comprehension has started, so these questions are locked until you finish\.'/);
  assert.match(panel, /assessment_completed: 'You already answered these questions, so they stay the same\.'/);
  assert.match(panel, /\{state\.questionsLockedReason && <p className="m3-practice-note m3-practice-lock">/);
  for (const text of [panel, preview]) {
    assert.doesNotMatch(text.replace(/\/\*[\s\S]*?\*\//g, ""), /Create My Own|Get New Questions/);
  }
  // M3 all-role refinement: the learner edits their own set on the question page (never questions they did not get).
  assert.match(preview, /> \{opening \? "Opening\.\.\." : "Edit Questions"\}<\/button>/);
  // Generation failures stay friendly.
  assert.match(panel, /kind === 'generate' \|\| kind === 'regenerate' \? getQuestionGenerationError\(e\)/);
});
