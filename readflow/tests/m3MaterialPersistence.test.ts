import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../src/modules/module3/", import.meta.url);

test("Teacher creates separate sets and regenerates only the selected set inline", async () => {
  const detail = await source("pages/MaterialDetailPage.tsx");
  const review = await source("pages/QuestionReviewPage.tsx");
  const sets = await source("components/MaterialQuestionSets.tsx");
  const admin = await source("components/AdminCollectionEditor.tsx");
  assert.doesNotMatch(detail + review + sets, /\b(?:confirm|alert)\s*\(/);
  assert.doesNotMatch(detail + review + sets + admin, /RegenerateQuestionsModal/);
  assert.match(sets, /Saved Question Sets/);
  assert.match(sets, /Generate New Question Set/);
  assert.match(sets, /createMaterialQuestionSet\(materialId, questionCount\)/);
  assert.match(review, /Regenerating will replace ONLY/);
  assert.match(review, /regenerateMaterialQuestionSet\(material.id, selectedSet.id, selectedSet.revision\)/);
  assert.match(review, />Cancel<\/button>/);
  assert.match(admin, /<InlineRegeneration/);
  await assert.rejects(source("components/RegenerateQuestionsModal.tsx"), { code: "ENOENT" });
});

async function source(relativePath: string) {
  return readFile(new URL(relativePath, root), "utf8");
}

test("M3 context initializes an empty real material collection and reloads it from the API", async () => {
  const context = await source("context/M3ContentContext.tsx");
  assert.match(context, /useState<UploadedMaterial\[]>\(\[\]\)/);
  assert.match(context, /setMaterials\(await getMaterials\(\)\)/);
  assert.match(context, /void refreshMaterials\(\)/);
  assert.doesNotMatch(context, /mockUploadedMaterials/);
});

test("runtime material pages contain no demo identities or mock ownership IDs", async () => {
  const runtime = (await Promise.all([
    source("pages/UploadMaterialPage.tsx"),
    source("pages/MaterialLibraryPage.tsx"),
    source("pages/MaterialDetailPage.tsx"),
    source("pages/QuestionReviewPage.tsx"),
  ])).join("\n");
  assert.doesNotMatch(runtime, /MOCK_TEACHER_ID|MOCK_GENERAL_USER_ID/);
  assert.doesNotMatch(runtime, /Ms\. Ana Reyes|Jamie Cruz|Pat Flores/);
  assert.doesNotMatch(runtime, /temporary material|current session|local mock library/i);
});

test("persisted material service uses authenticated list, detail, delete, generation, and review routes", async () => {
  const service = await source("services/materialService.ts");
  // The session token and Bearer header are tested in tests/authHeaders.test.ts.
  assert.match(service, /getSessionAuthHeaders\("Your session could not be verified\. Please sign in again and retry\."\)/);
  assert.match(service, /api\.get<[^]*>\(\s*"\/api\/materials"/);
  assert.match(service, /api\/materials\/\$\{encodeURIComponent\(materialId\)\}/);
  assert.match(service, /question-sets/);
  assert.match(service, /questions/);
});

test("upload completion refreshes persisted materials instead of creating a fake frontend row", async () => {
  const page = await source("pages/UploadMaterialPage.tsx");
  assert.match(page, /await refreshMaterials\(\)/);
  assert.doesNotMatch(page, /addMaterial|MockUploadedMaterial/);
});

test("Teacher upload runtime uses ASCII loading text without mojibake", async () => {
  const uploadForm = await source("components/UploadMaterialForm.tsx");
  const uploadPage = await source("pages/UploadMaterialPage.tsx");
  const materialLibrary = await source("pages/MaterialLibraryPage.tsx");
  const questionSets = await source("components/MaterialQuestionSets.tsx");
  const runtime = [uploadForm, uploadPage, materialLibrary, questionSets].join("\n");
  assert.doesNotMatch(runtime, /â€¦|Â|Ã|�|…/);
  for (const label of [
    "Saving Reviewed Material...",
    "Uploading material...",
    "Processing image text...",
    "Extracting document text...",
    "Working...",
    "Deleting...",
    "Generating and saving...",
  ]) assert.match(runtime, new RegExp(label.replace(/\./g, "\\.")));
});

test("General User has no generation or question-review controls", async () => {
  const detail = await source("pages/MaterialDetailPage.tsx");
  const library = await source("pages/MaterialLibraryPage.tsx");
  assert.match(detail, /role === "teacher"/);
  assert.match(detail, /role !== "general_user"/);
  assert.ok(library.includes('(role === "teacher" || role === "system_admin") &&'));
});

test("question review loads and saves one set through persisted APIs", async () => {
  const review = await source("pages/QuestionReviewPage.tsx");
  assert.match(review, /getMaterialQuestionSet\(materialId, setId\)/);
  assert.match(review, /await saveMaterialQuestionSet\(material.id, selectedSet.id, selectedSet.revision, normalized\)/);
});

test("question review renders the correct answer as read-only while other fields stay editable", async () => {
  const review = await source("pages/QuestionReviewPage.tsx");
  assert.match(review, /className="m3-readonly-answer"/);
  assert.match(review, /formatCorrectAnswer\(question\)/);
  assert.doesNotMatch(review, /updateQuestion\(question\.id, \{ correctAnswer:/);
  assert.doesNotMatch(review, /Select a correct answer/);
  assert.match(review, /type: event\.target\.value as QuestionType/);
  assert.match(review, /questionText: event\.target\.value/);
  assert.match(review, /updateOption\(question\.id, optionIndex, event\.target\.value\)/);
  assert.match(review, /scaffoldingHint: event\.target\.value/);
});

test("Teacher opens, cancels, and confirms the accessible Question Set deletion modal", async () => {
  const sets = await source("components/MaterialQuestionSets.tsx");
  const service = await source("services/materialService.ts");
  const review = await source("pages/QuestionReviewPage.tsx");
  const detail = await source("pages/MaterialDetailPage.tsx");
  // New sets offer only 9 (default) or 12 questions, split evenly across the three types.
  assert.match(sets, /useState<number>\(DEFAULT_NEW_QUESTION_SET_COUNT\)/);
  assert.match(sets, /NEW_QUESTION_SET_COUNTS\.map/);
  assert.match(service, /NEW_QUESTION_SET_COUNTS = \[9, 12\] as const/);
  assert.match(service, /DEFAULT_NEW_QUESTION_SET_COUNT = 9;/);
  assert.doesNotMatch(sets, /\[3, 6, 9, 12\]|useState\(6\)/);
  assert.match(sets, />Delete Set<\/button>/);
  assert.match(sets, /Delete \{deletingSet.name\}\? Its questions and answer keys will be permanently deleted\./);
  assert.match(sets, /setDeletingId\(set.id\)/);
  assert.match(detail, /material.uploadedById === profile\?\.id/);
  assert.match(detail, /canDelete=\{canDeleteSets\}/);
  assert.match(sets, /role="dialog" aria-modal="true"/);
  assert.match(sets, /Delete Question Set\?/);
  assert.match(sets, /ref=\{cancelDeleteRef\}/);
  assert.match(sets, /onClick=\{closeDeleteModal\}>Cancel/);
  assert.match(sets, /event.key === 'Escape'/);
  assert.match(sets, /event.key !== 'Tab'/);
  assert.match(sets, /await deleteMaterialQuestionSet\(materialId, set.id, set.revision\)/);
  assert.match(sets, /current.filter\(value => value.id !== set.id\)/);
  assert.match(sets, /setDeletingId\(null\)/);
  assert.doesNotMatch(sets, /window.confirm/);
  assert.match(sets, /className="m3-button m3-button--danger"/);
  assert.match(review, /Regenerating will replace ONLY/);
  assert.doesNotMatch(review, /role="dialog"|aria-modal/);
  assert.match(service, /api.delete\(setPath\(materialId, setId\)/);
  assert.match(service, /data: \{ revision \}/);
  assert.match(review, /selectedSet.questionCount \/ 3/);
});

test("material and question pages put the text beside the questions; assigned sets are protected", async () => {
  const detail = await source("pages/MaterialDetailPage.tsx");
  const review = await source("pages/QuestionReviewPage.tsx");
  const sets = await source("components/MaterialQuestionSets.tsx");
  const css = await source("styles/module3.css");
  const theme = await readFile(new URL("../src/styles/basa-theme.css", import.meta.url), "utf8");
  assert.match(detail, /showQuestionSets \? "m3-page-stack--wide" : "m3-page-stack--narrow"/);
  assert.match(detail, /showQuestionSets \? "m3-detail-card m3-material-split__text" : "m3-detail-card"/);
  assert.match(review, /className="m3-detail-card m3-material-split__text"/);
  assert.match(review, /material\.contentText/);
  assert.match(review, /disabled=\{busy \|\| !editing \|\| locked\}/);
  assert.ok(review.includes('(role === "teacher" || role === "system_admin") && selectedSet && !locked'));
  assert.match(sets, /disabled=\{busy \|\| deleteBusy \|\| Boolean\(set\.assignedCount\)\}/);
  assert.match(sets, /!set\.hasStudentAttempts && <Link/);
  assert.match(css, /\.m3-material-split__text \{[^}]*position: sticky;[^}]*max-height: calc\(100vh - 32px\);[^}]*overflow-y: auto;/);
  assert.match(css, /@media \(max-width: 1100px\) \{\s*\.m3-material-split \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.m3-page-stack--wide \{\s*max-width: 1440px;/);
  assert.match(css, /\.m3-button \{[^}]*border-radius: var\(--basa-btn-radius\);/);
  assert.match(css, /\.m3-action-link \{[^}]*border-radius: var\(--basa-btn-radius\);/);
  assert.match(theme, /--basa-btn-radius: 12px;/);
});
