import * as adminLabels from '../src/modules/module7/services/adminClassroomLabels.ts';
// M7 Appendix N completion: Independent Learner progress, Admin student performance, Admin reports,
// navigation and labels. No network: the analytics request function is a stub.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as comprehensionNavigation from "../src/modules/module5/services/comprehensionNavigation.ts";
import * as dateDisplay from "../src/modules/module7/services/dateDisplay.ts";
import * as scoreDisplay from "../src/modules/module7/services/scoreDisplay.ts";
import * as supportClassification from "../src/modules/module7/services/studentSupportClassification.ts";
import { createHookRuntime, findAll, loadComponentModule, tick } from "./helpers/hookRuntime.ts";

const require = createRequire(import.meta.url);
const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const text = (tree: unknown) => JSON.stringify(tree);
const links = (tree: unknown) => findAll(tree, (node: any) => node.type === "a").map((node: any) => node.props.to);

function load(path: string, responses: Record<string, unknown>, requests: string[] = []) {
  const runtime = createHookRuntime(require("react"));
  const module = loadComponentModule(new URL(`../src/modules/module7/${path}`, import.meta.url), (id) => {
    if (id.endsWith('/adminClassroomLabels')) return adminLabels;
    if (id === "react") return runtime.react;
    if (id === "react/jsx-runtime") return require("react/jsx-runtime");
    if (id === "react-router-dom") return { Link: "a" };
    if (id.endsWith(".css")) return {};
    if (id.endsWith("/PerformanceSelector")) return { default: "selector" };
    if (id.endsWith("/classroomService")) return { getRoomEnrollments: async () => [] };
    if (id.endsWith("/comprehensionNavigation")) return comprehensionNavigation;
    if (id.endsWith("/dateDisplay")) return dateDisplay;
    if (id.endsWith("/scoreDisplay")) return scoreDisplay;
    if (id.endsWith("/studentSupportClassification")) return supportClassification;
    if (id.endsWith("/m7Service")) return { m7Request: async (path: string) => { requests.push(path); return responses[path] ?? (path === "/system" ? { details: { classroomOptions: [] } } : undefined); } };
    if (id.endsWith("/AdminAnalyticsPage")) return { default: "admin-analytics-page" };
    if (id.endsWith("/M7Pages")) return { MetricsCards: "metrics-cards", InterventionForm: "intervention-form" };
    throw new Error(`Unexpected import ${id}`);
  });
  return { runtime, module, requests };
}

const personal = {
  summary: { readingAttempts: 1, completedQuizzes: 1, pronunciationAccuracy: 86.49, readingSpeedWpm: 100.4, comprehensionScore: 50, invalidCompletedQuizzes: 0 },
  readings: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", completed_at: "2026-11-03T02:00:00Z", pronunciation_accuracy: 86.48648648648648, reading_speed_wpm: 100.4, detected_error_count: 3 }],
  quizzes: [{ id: "m6-1", title: "Story", completedAt: "2026-11-03T03:00:00Z", score: 50, firstCorrect: 1, totalQuestions: 2, hintsUsed: 0 }],
  activities: [{ id: "act", status: "Completed", roomId: "room", materialId: "mat", title: "Assigned story" }],
};

test("function 1: Independent Learners get Progress & Result with their own routes and no classroom section", async () => {
  for (const role of ["general_user", "student"] as const) {
    const { runtime, module, requests } = load("M7Pages.tsx", { "/personal": personal });
    runtime.render(module.StudentProgressPage, { role }); await tick();
    const tree = runtime.render(module.StudentProgressPage, { role });
    assert.deepEqual(requests, ["/personal"], "only the signed-in learner's endpoint");
    const all = text(tree);
    if (role === "general_user") {
      assert.doesNotMatch(all, /Activity progress|assigned reading activities/);
      assert.deepEqual(links(tree), ["/m3/general/read-aloud/results/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
    } else {
      assert.match(all, /Activity progress/);
      assert.deepEqual(links(tree), ["/dashboard/learning-rooms/room/reading-activities/mat", "/dashboard/read-aloud/results/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
    }
    // The quiz table (a child component) links each result with the learner's own role.
    const quizTable = findAll(tree, (node: any) => Array.isArray(node.props?.quizzes))[0];
    assert.equal(quizTable.props.own, role);
    assert.equal(comprehensionNavigation.comprehensionResultTarget(role, "m6-1"),
      role === "student" ? "/dashboard/comprehension/m6-1/results" : "/m3/general/comprehension/m6-1");
    // Readable rounding of the saved value; the raw long decimal is never shown.
    assert.match(all, /"86%"/);
    assert.doesNotMatch(all, /86\.4864/);
    assert.match(all, /"100 WPM"/);
    assert.match(all, /Words different from the story/);
  }
  const empty = load("M7Pages.tsx", { "/personal": { ...personal, readings: [], quizzes: [], activities: [] } });
  empty.runtime.render(empty.module.StudentProgressPage, { role: "general_user" }); await tick();
  assert.match(text(empty.runtime.render(empty.module.StudentProgressPage, { role: "general_user" })), /No results yet\. Read a story from Reading Modules/);
});

test("navigation: Independent Learner progress and the Admin pages are reachable only inside their role guards", () => {
  const app = read("App.tsx");
  const general = app.slice(app.indexOf('allowedRoles={["general_user"]}'));
  assert.match(general, /path="progress"\s*element=\{<StudentProgressPage role="general_user" \/>\}/);
  const admin = app.slice(app.indexOf('path="/admin"'), app.indexOf('allowedRoles={["general_user"]}'));
  assert.match(admin, /<Route path="student-performance" element=\{<AdminStudentPerformancePage \/>\} \/>/);
  assert.match(admin, /<Route path="reports" element=\{<AdminReportsPage \/>\} \/>/);
  assert.match(app.slice(app.indexOf('allowedRoles={["student"]}'), app.indexOf('allowedRoles={["general_user"]}')), /path="progress" element=\{<StudentProgressPage \/>\}/);
  const layout = read("modules/module3/components/M3Layout.tsx");
  assert.match(layout, /\{ label: "Student Performance", to: "\/admin\/student-performance"/);
  assert.match(layout, /\{ label: "Reports", to: "\/admin\/reports"/);
  assert.match(layout, /label: "Progress & Result", to: "\/m3\/general\/progress"/);
});

test("functions 4, 8, 9: Admin student list shows every Student, risk classification and no-data rows honestly", async () => {
  const rows = [
    { id: "s1", name: "Ana", classrooms: ["Grade 5"], classification: "Early Warning", readingAttempts: 1, completedQuizzes: 2, pronunciationAccuracy: 86.486, readingSpeedWpm: 100.4, comprehensionScore: 50, invalidCompletedQuizzes: 0, completion: { assigned: 1, completed: 1, completionRate: 100 } },
    { id: "s2", name: "Ben", classrooms: [], classification: "No assessment data", readingAttempts: 0, completedQuizzes: 0, pronunciationAccuracy: null, readingSpeedWpm: null, comprehensionScore: null, invalidCompletedQuizzes: 0, completion: { assigned: 0, completed: 0, completionRate: null } },
  ];
  const { runtime, module, requests } = load("AdminStudentPerformancePage.tsx", { "/admin/students": rows });
  runtime.render(module.default, {}); await tick();
  let tree = runtime.render(module.default, {});
  const selector = () => findAll(tree, (node: any) => node.props?.id === 'admin-student')[0];
  selector().props.onChange('s1'); tree = runtime.render(module.default, {});
  const first = text(tree);
  selector().props.onChange('s2'); tree = runtime.render(module.default, {});
  const all = first + text(tree);
  assert.deepEqual(requests, ["/system", "/admin/students"]);
  assert.match(all, /Independent Learners are not included/);
  assert.match(all, /"Early Warning"/);
  assert.match(all, /"No assessment data"/);
  assert.match(all, /"86\.49%"/);
  assert.match(all, /"100 WPM"/);
  assert.match(all, /"Not enrolled"/);
  assert.match(all, /"None assigned"/);
  assert.doesNotMatch(all, /"0%"|NaN|undefined/, "missing data is never shown as zero");
});

test("functions 9 and 10: Admin student detail shows competency counts, own interventions and only totals for others", async () => {
  const detail = {
    id: "s1", name: "Ana", classrooms: ["Grade 5"], classification: "Early Warning", readingAttempts: 1, completedQuizzes: 2, pronunciationAccuracy: 86.486,
    readingSpeedWpm: 100.4, comprehensionScore: 50, invalidCompletedQuizzes: 0, completion: { assigned: 1, completed: 1, completionRate: 100 },
    competency: { literal: { total: 2, correct: 2, score: 100 }, inferential: { total: 2, correct: 0, score: 0 }, critical: { total: 0, correct: 0, score: null } },
    contexts: [{ teacherId: "t", teacherName: "Teacher T", classrooms: ["Grade 5"], classification: "Early Warning", completedQuizzes: 2, latestScores: [{ score: 50, completedAt: "2026-11-04T03:00:00Z" }] }],
    quizzes: [{ id: "q", title: "Story", completedAt: "2026-11-04T03:00:00Z", score: 50, firstCorrect: 1, totalQuestions: 2 }],
    readings: [{ id: "r", title: "Seeds", completedAt: "2026-11-03T02:00:00Z", readingAccuracy: 86.486, readingSpeedWpm: 100.4 }],
    activities: [{ id: "a", roomName: "Grade 5", status: "Completed" }],
    interventions: { own: [{ id: "i", notes: "Admin note", intervention_date: "2026-11-04", status: "planned", follow_up_date: null, follow_up_notes: "" }], others: { total: 1, planned: 1, inProgress: 0, completed: 0 } },
  };
  const { runtime, module, requests } = load("AdminStudentPerformancePage.tsx", { "/admin/students/s1": detail });
  const props = { studentId: "s1", onClose() {}, onSaved() {} };
  runtime.render(module.StudentDetail, props); await tick();
  const tree = runtime.render(module.StudentDetail, props);
  const all = text(tree);
  assert.deepEqual(requests, ["/admin/students/s1"]);
  assert.match(all, /"2 of 2 correct"/);
  assert.match(all, /"0 of 2 correct"/);
  assert.match(all, /"No questions answered"/);
  assert.match(all, /Admin note/);
  assert.match(all, /Teacher interventions: .*1 \(1 planned, 0 in progress, 0 completed\)/);
  assert.match(all, /\[1," of ",1," assigned activities completed"/);
  // The record form posts to the Admin route.
  const record = findAll(tree, (node: any) => node.type === "button" && node.props.children === "Record intervention")[0];
  record.props.onClick();
  const form = findAll(runtime.render(module.StudentDetail, props), (node: any) => node.type === "intervention-form")[0];
  assert.deepEqual([form.props.basePath, form.props.studentId], ["/admin/students", "s1"]);
});

test("functions 6 and 7: Admin reports use the Admin-only routes and add school-wide sections", () => {
  const section = read("modules/module7/WeeklyReportSection.tsx");
  assert.match(section, /scope === "admin" \? "\/api\/admin\/weekly-reports" : "\/api\/weekly-reports"/);
  assert.match(section, /requestWeeklyReports\(cursor \? `\?cursor=\$\{encodeURIComponent\(cursor\)\}` : "", \{\}, scope\)/, "list");
  assert.match(section, /requestWeeklyReports\(\s*`\/\$\{encodeURIComponent\(reportId\)\}`,\s*\{\},\s*scope\s*\)/, "open");
  assert.match(section, /body: JSON\.stringify\(\{\s*period: \{\s*startDate,\s*endDate,\s*\},\s*\}\),\s*\}, scope\);/, "generate");
  for (const heading of ["Classroom Comparisons", "Student Performance Summaries", "Competency Results"]) {
    assert.equal(section.split(heading).length - 1, 2, `${heading} appears on screen and in the PDF`);
  }
  assert.match(read("modules/module7/AdminReportsPage.tsx"), /<WeeklyReportSection scope="admin" \/>/);
  assert.match(read("modules/module7/TeacherReportsPage.tsx"), /<WeeklyReportSection \/>/, "Teacher reports keep the default scope");
});

test("labels: M7 never calls transcript-based Reading Accuracy a pronunciation score", () => {
  for (const file of ["modules/module7/TeacherAnalyticsPage.tsx", "modules/module7/M7Pages.tsx", "modules/module7/AdminStudentPerformancePage.tsx", "modules/module7/WeeklyReportSection.tsx"]) {
    const visible = read(file).match(/"[^"]*[Pp]ronunciation accuracy[^"]*"|>[^<]*[Pp]ronunciation accuracy[^<]*</g) ?? [];
    assert.deepEqual(visible, [], file);
  }
  assert.match(read("modules/module7/TeacherAnalyticsPage.tsx"), /"Existing transcript-based reading accuracy\."/);
});
