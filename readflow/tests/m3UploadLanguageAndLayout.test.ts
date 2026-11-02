import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const src = new URL("../src/", import.meta.url);
const source = (path: string) => readFile(new URL(path, src), "utf8");

test("Step 1 has no language dropdown; the server detects English or Filipino", async () => {
  const form = await source("modules/module3/components/UploadMaterialForm.tsx");
  const upload = await source("modules/module3/services/materialUpload.ts");
  const step1 = form.slice(form.indexOf('<form className="m3-form-card"'));
  assert.doesNotMatch(step1, /<select/);
  assert.match(step1, /Detected automatically as English or Filipino/);
  assert.doesNotMatch(form, /useState<MaterialLanguageCode>\("en"\)/, "no silent English default");
  assert.match(upload, /if \(input\.language\) formData\.append\("language", input\.language\)/);
  assert.match(form, /\{ file: selectedFile, title: trimmedTitle, signal: controller\.signal \}/);
});

test("Step 2 shows the detected language, requires a confirmed one and saves the teacher's choice", async () => {
  const form = await source("modules/module3/components/UploadMaterialForm.tsx");
  const upload = await source("modules/module3/services/materialUpload.ts");
  assert.match(form, /<dt>Detected language<\/dt>/);
  assert.match(form, /<option value="" disabled>Choose English or Filipino<\/option>/);
  assert.match(form, /setLanguageChoice\(material\.language \?\? ""\)/, "uncertain detection selects nothing");
  assert.match(form, /if \(!languageChoice\) \{\s*setReviewError\("Choose English or Filipino for this material before saving\."\)/);
  assert.match(form, /language: languageChoice,/);
  assert.match(upload, /contentText,\s*language,\s*\},/, "finalize sends the confirmed language");
});

test("Change File and Remove File reset file-specific state and ignore stale extractions", async () => {
  const form = await source("modules/module3/components/UploadMaterialForm.tsx");
  assert.match(form, /Change File/);
  assert.match(form, /Remove File/);
  assert.match(form, /uploadRun\.current \+= 1;\s*uploadAbort\.current\?\.abort\(\);/);
  assert.match(form, /if \(!isCurrent\(\)\) \{\s*void deleteTemporaryMaterial\(material\.id\)/);
  assert.match(form, /if \(!isCurrent\(\) \|\| axios\.isCancel\(uploadError\)\) return;/);
  assert.match(form, /event\.target\.value = "";/, "the same file can be chosen again");
  assert.match(form, /Discard your edits\?/);
  assert.doesNotMatch(form, /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/);
});

test("saved-material language correction goes through the guarded server endpoint", async () => {
  const control = await source("modules/module3/components/MaterialLanguageControl.tsx");
  const service = await source("modules/module3/services/materialService.ts");
  const detail = await source("modules/module3/pages/MaterialDetailPage.tsx");
  assert.match(service, /api\.patch<[\s\S]*\/language`/);
  assert.match(control, /only before this material is assigned in a\s+Learning Room/);
  // The saved language shows at once, before the material list finishes refreshing.
  assert.match(control, /setSavedLanguage\(choice\);/);
  assert.match(control, /<strong>\{LANGUAGE_NAMES\[current\]\}<\/strong>/);
  assert.match(detail, /role !== "admin" && material && material\.uploadedById === profile\?\.id/);
  assert.match(detail, /if \(materialsLoading && !material\)/);
});

test("new question sets offer only 9 or 12 questions", async () => {
  const sets = await source("modules/module3/components/MaterialQuestionSets.tsx");
  const service = await source("modules/module3/services/materialService.ts");
  assert.match(service, /NEW_QUESTION_SET_COUNTS = \[9, 12\] as const/);
  assert.match(service, /createMaterialQuestionSet\(materialId: string, questionCount: number = DEFAULT_NEW_QUESTION_SET_COUNT\)/);
  assert.match(sets, /\{count \/ 3\} Literal, \{count \/ 3\} Inferential, \{count \/ 3\} Critical/);
  assert.doesNotMatch(sets, /\[3, 6/);
});

test("scroll areas contain absolutely positioned content and the Step 1 panel clears its heading", async () => {
  const basa = await source("components/basa/BasaLayout.css");
  const m3 = await source("modules/module3/styles/module3.css");
  assert.match(basa, /\.basa-content \{[^}]*position: relative;/);
  assert.match(m3, /\.m3-content \{[^}]*position: relative;/);
  assert.match(m3, /\.m3-image-guidance \{[^}]*margin: 12px 0 24px;/);
  assert.doesNotMatch(basa + m3, /\.(basa-content|m3-content) \{[^}]*overflow: hidden/);
});
