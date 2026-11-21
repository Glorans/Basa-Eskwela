import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  comprehensionResultTarget, comprehensionTargetForReading, learningAreaTarget, readingResultTarget,
} from "../src/modules/module5/services/comprehensionNavigation.ts";
import { PRACTICE_PATHS, isPracticeRole, readAloudTarget } from "../src/modules/module5/services/oralReadingNavigation.ts";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
const ID = "11111111-1111-4111-8111-111111111111";
const reading = (overrides: Record<string, unknown> = {}) => ({
  id: ID, moduleId: "module", passageId: "passage", materialId: null, roomId: null, assignmentId: null,
  activityAssignmentId: null, readAloudOnly: false, ...overrides,
});

test("Teacher practice routes stay under /m3/teacher/practice, apart from the Students' Reading Results", () => {
  assert.equal(isPracticeRole("teacher"), true);
  assert.equal(isPracticeRole("student") || isPracticeRole("general_user"), false);
  const url = new URL(readAloudTarget("teacher", "module", { passageId: "passage" }), "http://localhost");
  assert.equal(url.pathname, "/m3/teacher/practice/modules/module/read-aloud");
  assert.deepEqual(Object.fromEntries(url.searchParams), { passageId: "passage" });
  assert.equal(readingResultTarget("teacher", ID), `/m3/teacher/practice/read-aloud/results/${ID}`);
  assert.equal(comprehensionResultTarget("teacher", "c"), "/m3/teacher/practice/comprehension/c");
  assert.deepEqual(learningAreaTarget("teacher", reading()), { to: "/m3/teacher/practice", kind: "module" });
  assert.equal(PRACTICE_PATHS.teacher.history, "/m3/teacher/practice/history");
  for (const path of Object.values(PRACTICE_PATHS.teacher)) assert.ok(!path.startsWith("/m3/teacher/oral-reading"), path);
});

test("Teacher M6 practice opens only from the Teacher's own module reading outside any classroom", () => {
  const target = new URL(comprehensionTargetForReading("teacher", reading()) ?? "", "http://localhost");
  assert.equal(target.pathname, "/m3/teacher/practice/modules/module/comprehension");
  assert.deepEqual(Object.fromEntries(target.searchParams), { passageId: "passage", oralReadingAttemptId: ID });
  for (const context of [{ roomId: "room" }, { assignmentId: "a" }, { materialId: "m", moduleId: null }, { activityAssignmentId: "x" },
    { passageId: null }]) {
    assert.equal(comprehensionTargetForReading("teacher", reading(context)), null, JSON.stringify(context));
  }
});

test("Student, Independent Learner and Admin paths are unchanged", () => {
  assert.equal(new URL(readAloudTarget("student", "m", { passageId: "p" }), "http://x").pathname, "/dashboard/materials/m/read-aloud");
  assert.equal(new URL(readAloudTarget("general_user", "m", { passageId: "p" }), "http://x").pathname, "/m3/general/modules/m/read-aloud");
  assert.equal(new URL(readAloudTarget("admin", "m", { passageId: "p" }), "http://x").pathname, "/admin/oral-reading/modules/m/read-aloud");
  assert.equal(readingResultTarget("student", ID), `/dashboard/read-aloud/results/${ID}`);
  assert.equal(readingResultTarget("general_user", ID), `/m3/general/read-aloud/results/${ID}`);
  assert.equal(comprehensionResultTarget("student", "c"), "/dashboard/comprehension/c/results");
  assert.equal(comprehensionResultTarget("general_user", "c"), "/m3/general/comprehension/c");
  assert.deepEqual(learningAreaTarget("general_user", reading()), { to: "/m3/general/modules/module?passageId=passage", kind: "module" });
  assert.deepEqual(learningAreaTarget("student", reading({ roomId: "r" })), { to: "/dashboard/learning-rooms/r", kind: "room" });
});

test("App: Teacher practice routes reuse the shared M5/M6 pages; Reading Results routes are unchanged", async () => {
  const app = await read("../src/App.tsx");
  const teacher = app.slice(app.indexOf("{/* Teacher routes */}"), app.indexOf("{/* Independent learner routes */}"));
  for (const [path, element] of [
    ["practice", '<AdminOralReadingPage role="teacher" />'],
    ["practice/modules/:moduleId/read-aloud", '<ReadAloudPage role="teacher" />'],
    ["practice/read-aloud/results/:attemptId", '<ReadingResultPage role="teacher" />'],
    ["practice/modules/:moduleId/comprehension", '<ComprehensionPage role="teacher" />'],
    ["practice/comprehension/:attemptId", '<ComprehensionPage role="teacher" />'],
    ["practice/history", '<ReadingHistoryPage role="teacher" />'],
  ]) {
    assert.match(teacher, new RegExp(`path="${path.replace(/[/:]/g, "\\$&")}"\\s*element=\\{${element.replace(/[/]/g, "\\/")}\\}`), path);
  }
  // M5 F7 (Teacher review of Students' saved assessments) keeps its routes and pages.
  assert.match(teacher, /path="oral-reading"\s*element=\{<TeacherOralReadingResultsPage \/>\}/);
  assert.match(teacher, /path="oral-reading\/:attemptId"\s*element=\{<TeacherOralReadingAttemptPage \/>\}/);
  // Teacher routes are still inside the Teacher-only guard (approval is enforced by RequireAuth).
  assert.match(app.slice(app.indexOf("{/* Teacher routes */}")), /^\{\/\* Teacher routes \*\/\}\s*<Route element=\{<RequireRole allowedRoles=\{\["teacher"\]\} \/>\}>/);
});

test("Teacher sidebar: one Reading Practice entry, beside the unchanged Reading Results entry", async () => {
  const layout = await read("../src/modules/module3/components/M3Layout.tsx");
  const teacher = layout.slice(layout.indexOf('if (role === "teacher") {'), layout.indexOf('if (role === "general_user") {'));
  assert.match(teacher, /label: "Reading Practice", to: "\/m3\/teacher\/practice", icon: Mic2, end: false/);
  assert.match(teacher, /label: "Reading Results",\s*to: "\/m3\/teacher\/oral-reading"/);
  // The System Admin has its own entry (Appendix N M5/M6, 2026-11-21); no other role gets one.
  assert.match(layout, /label: "Reading Practice", to: "\/system-admin\/practice", icon: Mic2, end: false/);
  assert.equal((layout.match(/Reading Practice/g) ?? []).length, 2, "Teacher and System Admin only");
});

test("every staff practice list uses the shared, school-scoped catalog endpoint", async () => {
  const [page, service] = await Promise.all([
    read("../src/modules/module5/pages/AdminOralReadingPage.tsx"),
    read("../src/modules/module5/services/oralReadingService.ts"),
  ]);
  assert.match(page, /void getPracticeReadingPassages\(\)/);
  assert.doesNotMatch(page, /getAdminReadingPassages/);
  assert.match(page, /readAloudTarget\(role, passage\.moduleId/);
  assert.match(page, /to=\{PRACTICE_PATHS\[role\]\.history\}/);
  assert.match(service, /"\/api\/oral-reading\/practice\/passages"/);
  assert.match(service, /"\/api\/oral-reading\/admin\/passages"/);
});

test("language: Teachers get the reading's own (English or Filipino) interface; only the Admin workspaces force English", async () => {
  const [history, modal, language] = await Promise.all([
    read("../src/modules/module5/pages/ReadingHistoryPage.tsx"),
    read("../src/modules/module5/components/SavedAssessmentModal.tsx"),
    read("../src/pages/reading-activity/activityLanguage.ts"),
  ]);
  assert.match(history, /getActivityText\(\(role === "admin" \|\| role === "system_admin"\) \? "en" : attempt\.language\)/);
  assert.match(modal, /getActivityText\(\(role === "admin" \|\| role === "system_admin"\) \? "en" : summary\.language\)/);
  const { getActivityText } = await import("../src/pages/reading-activity/activityLanguage.ts");
  assert.equal(getActivityText("fil").t("Back to Reading Practice"), "Bumalik sa Pagsasanay sa Pagbasa");
  assert.equal(getActivityText("en").t("Back to Reading Practice"), "Back to Reading Practice");
  assert.ok(language.includes('"Back to Reading Practice"'));
});

test("voice-follow stays off for Teacher practice (no M2 diagnostic stream); other roles keep it", async () => {
  const page = await read("../src/pages/reading-activity/ReadAloudPage.tsx");
  assert.match(page, /const followVoice = role !== "teacher";/);
  assert.match(page, /onStreamReady: followVoice \? storyFollow\.onStreamReady : undefined,/);
  assert.match(page, /onStreamStopped: followVoice \? storyFollow\.onStreamStopped : undefined,/);
  // The hook only opens the speech stream when the recorder hands it the microphone stream.
  const hook = await read("../src/pages/reading-activity/useVoiceFollowStoryScroll.ts");
  assert.match(hook, /const onStreamReady = useCallback\(\(stream: MediaStream\) => \{/);
  assert.match(hook, /streaming\.start\(stream\);/);
  // No interface text claims automatic voice-follow.
  const language = await read("../src/pages/reading-activity/activityLanguage.ts");
  assert.doesNotMatch(language, /follow(s|ing)? your voice|scroll(s|ing)? (automatically|for you)/i);
});
