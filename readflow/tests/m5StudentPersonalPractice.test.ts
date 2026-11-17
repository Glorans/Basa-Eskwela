import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { comprehensionActivityTarget, comprehensionResultTarget, comprehensionTargetForReading } from "../src/modules/module5/services/comprehensionNavigation.ts";

// Student personal practice (2026-11-17): a published module read and assessed outside any classroom, with the
// same M5 results and M6 comprehension as a classroom reading, labelled as personal practice.

const base = { id: "reading", moduleId: "module", materialId: null, passageId: "passage", activityAssignmentId: null, readAloudOnly: false };

test("a Student's personal reading continues to its comprehension without a classroom; a classroom one keeps its room", () => {
  assert.equal(comprehensionTargetForReading("student", { ...base, roomId: null, assignmentId: null }),
    "/dashboard/materials/module/comprehension?passageId=passage&oralReadingAttemptId=reading");
  assert.equal(
    comprehensionTargetForReading("student", { ...base, roomId: "room", assignmentId: "assignment" }),
    "/dashboard/materials/module/comprehension?passageId=passage&oralReadingAttemptId=reading&roomId=room&assignmentId=assignment",
  );
  // Independent Learners, Admin and Teacher practice are unchanged.
  assert.equal(comprehensionTargetForReading("general_user", { ...base, roomId: null, assignmentId: null }),
    "/m3/general/modules/module/comprehension?passageId=passage&oralReadingAttemptId=reading");
  assert.ok(comprehensionTargetForReading("admin", { ...base, roomId: null, assignmentId: null })?.startsWith("/admin/oral-reading/modules/module/comprehension"));
  assert.ok(comprehensionTargetForReading("teacher", { ...base, roomId: null, assignmentId: null })?.startsWith("/m3/teacher/practice/modules/module/comprehension"));
});

test("an unfinished assessment reopens on its own activity page (the route the introduction's Continue opens)", async () => {
  assert.equal(comprehensionActivityTarget("student", "c1"), "/dashboard/comprehension/c1");
  assert.equal(comprehensionResultTarget("student", "c1"), "/dashboard/comprehension/c1/results");
  // Other roles show the activity and its results on one page, unchanged.
  for (const role of ["general_user", "admin", "teacher"] as const) {
    assert.equal(comprehensionActivityTarget(role, "c1"), comprehensionResultTarget(role, "c1"), role);
  }
  const page = await readFile(new URL("../src/pages/reading-activity/ReadingResultPage.tsx", import.meta.url), "utf8");
  assert.match(page, /const introductionResume = !attempt\?\.materialId \|\| \(role === "general_user" && !attempt\.roomId && !attempt\.activityAssignmentId\);/);
  assert.match(page, /const unfinishedComprehension = introductionResume && linked\?\.attempt && linked\.attempt\.status !== "completed" \? linked\.attempt : null;/);
  assert.match(page, /to=\{unfinishedComprehension \? comprehensionActivityTarget\(role, unfinishedComprehension\.id\) : comprehensionTarget\}/);
  // Completed keeps its read-only result link; a new one keeps the introduction (comprehensionTarget).
  assert.match(page, /to=\{comprehensionResultTarget\(role, completedComprehension\.id\)\}/);
});

const source = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
const PERSONAL_NOTE = "Personal practice: this reading is saved to your Reading History. It is not part of any classroom.";
const RESULT_NOTE = "Personal practice: this reading and its comprehension are saved to your history. They are not part of any classroom.";
const CLASSROOM_EXISTS = "You already have a comprehension assessment for this passage from a classroom. Open it from your Reading History.";
const PERSONAL_EXISTS = "You already have a personal comprehension assessment for this passage. Open it from your Reading History.";

test("Read Aloud, result and history label personal practice for Students only; comprehension stays offered", async () => {
  const readAloud = await source("pages/reading-activity/ReadAloudPage.tsx");
  assert.match(readAloud, /role === "student" && module\.personalPractice === true && \(/);
  assert.ok(readAloud.includes(`t("${PERSONAL_NOTE}")`));
  const result = await source("pages/reading-activity/ReadingResultPage.tsx");
  assert.match(result, /const studentPersonalPractice = role === "student" && !attempt\.materialId && !attempt\.roomId;/);
  assert.match(result, /const comprehensionUnavailable = !comprehensionTarget && !isPracticeRole\(role\) && attempt\.readAloudOnly !== true;/);
  assert.ok(result.includes(`t("${RESULT_NOTE}")`));
  const history = await source("modules/module5/pages/ReadingHistoryPage.tsx");
  assert.match(history, /role === "student" && !attempt\.materialId && !attempt\.roomId && <> · \{rowT\("Personal practice"\)\}<\/>/);
});

test("personal-practice wording has Filipino translations", async () => {
  const language = await source("pages/reading-activity/activityLanguage.ts");
  for (const text of ["Personal practice", PERSONAL_NOTE, RESULT_NOTE, CLASSROOM_EXISTS, PERSONAL_EXISTS]) assert.ok(language.includes(`"${text}":`), text);
  for (const file of ["comprehensionAttemptService.js", "comprehensionActionService.js"]) {
    const server = await readFile(new URL(`../../server/services/${file}`, import.meta.url), "utf8");
    for (const text of [CLASSROOM_EXISTS, PERSONAL_EXISTS]) assert.ok(server.includes(`"${text}"`), `${file}: the server message matches the translated text`);
  }
});
