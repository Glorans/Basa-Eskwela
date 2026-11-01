import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { comprehensionTargetForReading } from "../src/modules/module5/services/comprehensionNavigation.ts";
import { readAloudTarget } from "../src/modules/module5/services/oralReadingNavigation.ts";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("admin read-aloud practice stays under the admin workspace", () => {
  const url = new URL(readAloudTarget("admin", "module", { passageId: "passage" }), "http://localhost");
  assert.equal(url.pathname, "/admin/oral-reading/modules/module/read-aloud");
  assert.deepEqual(Object.fromEntries(url.searchParams), { passageId: "passage" });
});

test("admins never receive an M6 comprehension link; learners keep theirs", () => {
  const attempt = { id: "attempt", moduleId: "module", materialId: null, passageId: "passage", roomId: null, assignmentId: null, activityAssignmentId: null, readAloudOnly: false };
  assert.equal(comprehensionTargetForReading("admin", attempt), null);
  assert.ok(comprehensionTargetForReading("general_user", attempt)?.startsWith("/m3/general/modules/module/comprehension"));
  assert.ok(comprehensionTargetForReading("student", attempt)?.startsWith("/dashboard/materials/module/comprehension"));
});

test("admin M5 routes are registered only inside the admin RequireRole group", async () => {
  const app = await read("../src/App.tsx");
  const adminGroup = app.indexOf('<RequireRole allowedRoles={["admin"]} />');
  const teacherGroup = app.indexOf('<RequireRole allowedRoles={["teacher"]} />');
  assert.ok(adminGroup > 0 && teacherGroup > adminGroup);
  for (const element of ["<AdminOralReadingPage />", '<ReadAloudPage role="admin" />', '<ReadingResultPage role="admin" />', '<ReadingHistoryPage role="admin" />']) {
    const at = app.indexOf(element);
    assert.ok(at > adminGroup && at < teacherGroup, `${element} must sit in the admin group`);
    assert.equal(app.indexOf(element, at + 1), -1, `${element} is registered once`);
  }
  assert.equal(app.match(/path="teacher-invitations"/g)?.length, 1, "no duplicate teacher-invitations route");
});

test("each role's sidebar gains only its own M5/M7/M8 entries", async () => {
  const layout = await read("../src/modules/module3/components/M3Layout.tsx");
  const admin = layout.slice(layout.indexOf('if (role === "admin")'), layout.indexOf("const root = getM3WorkspaceRoot(role);"));
  for (const to of ["/admin/oral-reading", "/admin/reading-history", "/admin/analytics"]) assert.ok(admin.includes(`to: "${to}"`), to);
  const teacher = layout.slice(layout.indexOf('if (role === "teacher")'), layout.indexOf('if (role === "general_user")'));
  for (const to of ["/m3/teacher/student-support", "/m3/teacher/analytics", "/m3/teacher/reports"]) assert.ok(teacher.includes(`to: "${to}"`), to);
  const general = layout.slice(layout.indexOf('if (role === "general_user")'));
  for (const to of ["/m3/general/leaderboard", "/m3/general/badges", "/m3/general/reading-history"]) assert.ok(general.includes(`to: "${to}"`), to);
  assert.match(layout, /getM3WorkspaceRoot\(role\)/, "M3 refactor helper is preserved");
  assert.match(layout, /await logout\(\)/, "M1 sign-out through authService is preserved");
});

test("admin practice uses the learner pages with admin-only return paths", async () => {
  const [history, readAloud, result] = await Promise.all([
    read("../src/modules/module5/pages/ReadingHistoryPage.tsx"),
    read("../src/pages/reading-activity/ReadAloudPage.tsx"),
    read("../src/pages/reading-activity/ReadingResultPage.tsx"),
  ]);
  assert.match(history, /role === "admin" \? "\/admin"/);
  assert.match(readAloud, /role === "admin"\s*\? `\/admin\/read-aloud\/results\/\$\{attemptId\}`/);
  assert.match(result, /const backTarget = role === "admin"\s*\? "\/admin\/oral-reading"/);
  assert.match(result, /<ReadingHistoryPage role=\{role\} language=\{language\} embedded key=/);
  assert.doesNotMatch(result, /className="result-history-link"/);
});
