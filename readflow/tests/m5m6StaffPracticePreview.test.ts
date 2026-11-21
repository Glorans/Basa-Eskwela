import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  comprehensionResultTarget, comprehensionTargetForReading, learningAreaTarget, readingResultTarget,
} from "../src/modules/module5/services/comprehensionNavigation.ts";
import {
  PRACTICE_PATHS, comprehensionPreviewTarget, isAdminPracticeRole, isPracticeRole, readAloudTarget,
} from "../src/modules/module5/services/oralReadingNavigation.ts";

// Appendix N M5 F1-F7 / M6 F1-F4 for the System Admin, and M6 F5 Preview for every role (2026-11-21).
const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
const ID = "11111111-1111-4111-8111-111111111111";
const reading = (overrides: Record<string, unknown> = {}) => ({
  id: ID, moduleId: "module", passageId: "passage", materialId: null, roomId: null, assignmentId: null,
  activityAssignmentId: null, readAloudOnly: false, ...overrides,
});
const block = (app: string, from: string, to: string) => app.slice(app.indexOf(from), app.indexOf(to));

test("System Admin practice lives under /system-admin/practice and reuses the shared M5/M6 navigation", () => {
  assert.equal(isPracticeRole("system_admin"), true);
  assert.equal(isAdminPracticeRole("system_admin") && isAdminPracticeRole("admin"), true);
  assert.equal(isAdminPracticeRole("teacher") || isAdminPracticeRole("student") || isAdminPracticeRole("general_user"), false);
  const url = new URL(readAloudTarget("system_admin", "module", { passageId: "passage" }), "http://localhost");
  assert.equal(url.pathname, "/system-admin/practice/modules/module/read-aloud");
  assert.equal(readingResultTarget("system_admin", ID), `/system-admin/practice/read-aloud/results/${ID}`);
  assert.equal(comprehensionResultTarget("system_admin", "c"), "/system-admin/practice/comprehension/c");
  assert.deepEqual(learningAreaTarget("system_admin", reading()), { to: "/system-admin/practice", kind: "module" });
  assert.equal(PRACTICE_PATHS.system_admin.history, "/system-admin/practice/history");
  // Continue to Questions: the same module and passage as the reading, never a classroom or uploaded material.
  const target = new URL(comprehensionTargetForReading("system_admin", reading()) ?? "", "http://localhost");
  assert.equal(target.pathname, "/system-admin/practice/modules/module/comprehension");
  assert.equal(target.searchParams.get("passageId"), "passage");
  assert.equal(target.searchParams.get("oralReadingAttemptId"), ID);
  for (const other of [reading({ roomId: "room" }), reading({ materialId: "material" }), reading({ passageId: null })]) {
    assert.equal(comprehensionTargetForReading("system_admin", other), null);
  }
});

test("System Admin routes: practice pages inside the System Admin guard, sidebar entries, no learner route", async () => {
  const app = await read("../src/App.tsx");
  const sa = block(app, 'allowedRoles={["system_admin"]}', "{/* Admin (School Admin) routes */}");
  for (const [path, page] of [["practice", 'AdminOralReadingPage role="system_admin"'], ["practice/modules/:moduleId/read-aloud", 'ReadAloudPage role="system_admin"'],
    ["practice/modules/:moduleId/preview", 'ComprehensionPreviewPage role="system_admin"'], ["practice/read-aloud/results/:attemptId", 'ReadingResultPage role="system_admin"'],
    ["practice/modules/:moduleId/comprehension", 'ComprehensionPage role="system_admin"'], ["practice/comprehension/:attemptId", 'ComprehensionPage role="system_admin"'],
    ["practice/history", 'ReadingHistoryPage role="system_admin"']]) {
    assert.ok(sa.includes(`path="${path}" element={<${page} />}`), path);
  }
  assert.equal((app.match(/role="system_admin" \/>/g) ?? []).filter(Boolean).length >= 7, true);
  assert.doesNotMatch(app.replace(sa, ""), /(ReadAloudPage|ReadingResultPage|ComprehensionPage|ReadingHistoryPage|ComprehensionPreviewPage) role="system_admin"/,
    "System Admin practice pages exist only inside the System Admin guard");
  const layout = await read("../src/modules/module3/components/M3Layout.tsx");
  const nav = layout.slice(layout.indexOf('if (role === "system_admin") {'), layout.indexOf('return [{ label: "Dashboard"'));
  assert.match(nav, /label: "Reading Practice", to: "\/system-admin\/practice", icon: Mic2, end: false/);
  assert.match(nav, /label: "Practice History", to: "\/system-admin\/practice\/history", icon: History, end: true/);
});

test("staff practice list: one school-scoped catalog for every staff role, honest text, history and preview links", async () => {
  const page = await read("../src/modules/module5/pages/AdminOralReadingPage.tsx");
  assert.match(page, /void getPracticeReadingPassages\(\)/);
  assert.doesNotMatch(page, /modules you created|your own modules/i, "no misleading own-modules text");
  assert.match(page, /never count as Student results/);
  assert.match(page, /to=\{PRACTICE_PATHS\[role\]\.history\}/);
  assert.match(page, /comprehensionPreviewTarget\(role, passage\.moduleId, \{ passageId: passage\.passageId \}\)/);
});

test("M6 F5 preview targets: each role's own route, with the same passage, classroom and assignment as the reading", () => {
  const check = (role: Parameters<typeof comprehensionPreviewTarget>[0], path: string, context = {}) => {
    const url = new URL(comprehensionPreviewTarget(role, "module", { passageId: "passage", ...context }), "http://localhost");
    assert.equal(url.pathname, path, role);
    return Object.fromEntries(url.searchParams);
  };
  check("system_admin", "/system-admin/practice/modules/module/preview");
  check("admin", "/admin/oral-reading/modules/module/preview");
  check("teacher", "/m3/teacher/practice/modules/module/preview");
  check("general_user", "/m3/general/modules/module/preview");
  assert.deepEqual(check("student", "/dashboard/materials/module/preview", { roomId: "room", assignmentId: "assignment" }),
    { passageId: "passage", roomId: "room", assignmentId: "assignment" });
});

test("M6 F5 preview routes exist for every role and use the read-only preview page", async () => {
  const app = await read("../src/App.tsx");
  for (const [role, path] of [["student", "materials/:moduleId/preview"], ["system_admin", "practice/modules/:moduleId/preview"],
    ["admin", "oral-reading/modules/:moduleId/preview"], ["teacher", "practice/modules/:moduleId/preview"], ["general_user", "modules/:moduleId/preview"]]) {
    assert.ok(app.includes(`path="${path}" element={<ComprehensionPreviewPage role="${role}" />}`), role);
  }
});

test("M6 F5 preview never handles answers and only reads: GET /api/comprehension/preview, no start, no action", async () => {
  const [page, service, learnerPage] = await Promise.all([
    read("../src/modules/module6/pages/ComprehensionPreviewPage.tsx"),
    read("../src/modules/module6/services/comprehensionService.ts"),
    read("../src/pages/StudentModuleViewPage.tsx"),
  ]);
  // Code only (the doc comment explains what is never sent).
  const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const field of ["correctOptionIndex", "answerExplanation", "supportingEvidence", "scaffolding", "hint"]) {
    assert.doesNotMatch(code, new RegExp(field, "i"), field);
  }
  assert.doesNotMatch(code, /startComprehension|applyComprehensionAction|api\.post|submit/i, "the preview never starts or answers");
  const fn = service.slice(service.indexOf("export async function getComprehensionPreview"));
  assert.match(fn, /api\.get<\{ success: boolean; preview: ComprehensionPreview \}>\(\s*`\/api\/comprehension\/preview\?\$\{params\}`/);
  const type = service.slice(service.indexOf("export interface ComprehensionPreviewQuestion"), service.indexOf("export interface ComprehensionPreview {"));
  assert.doesNotMatch(type, /correct|explanation|evidence|hint/i, "the preview type has no answer field");
  // The assessment itself still starts only after the read-aloud, from its result.
  assert.match(page, /readAloudTarget\(role, preview\.moduleId/);
  // Students and Independent Learners: Preview Questions beside Start Read-Aloud, in the same context as the reading.
  assert.match(learnerPage, /comprehensionPreviewTarget\(role, module\.id, \{\s*passageId: activePassage\.id,\s*roomId: cameFromClassroom \? roomId : undefined,\s*assignmentId: cameFromClassroom \? assignmentId : undefined,/);
  assert.match(learnerPage, /Preview Questions/);
});

test("M6 F5 preview text exists in English and Filipino", async () => {
  const { getActivityText } = await import("../src/pages/reading-activity/activityLanguage.ts");
  const fil = getActivityText("fil").t;
  assert.equal(fil("Preview Questions"), "Silipin ang mga Tanong");
  assert.equal(fil("{count} questions", { count: 6 }), "6 tanong");
  assert.equal(fil("Start Read-Aloud"), "Simulan ang Pagbasa nang Malakas");
  assert.equal(getActivityText("en").t("{count} questions", { count: 6 }), "6 questions");
});
