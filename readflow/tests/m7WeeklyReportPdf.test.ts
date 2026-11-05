import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Runs the real downloadWeeklyReportPdf with real jsPDF. Report data is made up, nothing is read from a
// database, and save() is replaced, so no file is written.
const require = createRequire(import.meta.url);
const { jsPDF } = require("jspdf");
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;

function pdfOf(report: unknown, id = "abcdef12-0000-4000-8000-000000000000") {
  const text: string[] = [];
  let saved: { name: string; bytes: number; pages: number } | null = null;
  class CapturingPdf extends jsPDF {
    constructor(...args: unknown[]) {
      super(...args);
      const write = this.text;
      this.text = (value: unknown, ...rest: unknown[]) => { text.push(...[value].flat().map(String)); return write.call(this, value, ...rest); };
      this.save = (name: string) => { saved = { name, bytes: this.output("arraybuffer").byteLength, pages: this.getNumberOfPages() }; return this; };
    }
  }
  const scoreDisplay = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(compile(readFileSync(new URL("../src/modules/module7/services/scoreDisplay.ts", import.meta.url), "utf8")), { module: scoreDisplay, exports: scoreDisplay.exports, require: () => ({}) });
  const module = { exports: {} as Record<string, (saved: unknown) => void> };
  const source = readFileSync(new URL("../src/modules/module7/WeeklyReportSection.tsx", import.meta.url), "utf8") + "\nexport { downloadWeeklyReportPdf };\n";
  vm.runInNewContext(compile(source), { module, exports: module.exports, Intl, Date, Math, Number, String, JSON, Array, Object, Error, require: (name: string) => {
    if (name === "jspdf") return { jsPDF: CapturingPdf };
    if (name.endsWith("scoreDisplay")) return scoreDisplay.exports;
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    if (name === "lucide-react") return new Proxy({}, { get: () => "icon" });
    if (name.endsWith("apiUrl")) return { getApiUrl: () => "" };
    return { supabase: {} };
  } });
  module.exports.downloadWeeklyReportPdf({ id, periodStart: "2026-10-26", periodEnd: "2026-11-01", createdAt: "2026-11-02T01:00:00.000Z", report });
  return { all: text.join("\n"), saved: saved as unknown as { name: string; bytes: number; pages: number } };
}

const baseReport = () => ({
  period: { startDate: "2026-10-26", endDate: "2026-11-01" }, generatedAt: "2026-11-02T01:00:00.000Z",
  reading: { totalAttempts: 2, studentsWithAttempts: 1, averagePronunciationAccuracy: 88.25, averageReadingSpeedWpm: 101.5,
    attempts: [{ attemptId: "r1", studentId: "s", studentName: "Ana Santos", moduleTitle: "The Garden", completedAt: "2026-10-27T01:00:00Z", pronunciationAccuracy: 88.25, readingSpeedWpm: 101.5 }] },
  comprehension: { completedAssessments: 1, studentsWithAssessments: 1, averageScore: 83,
    assessments: [{ attemptId: "q1", studentId: "s", studentName: "Ana Santos", moduleTitle: "The Garden", completedAt: "2026-10-27T02:00:00Z", correctAnswers: 5, totalQuestions: 6, scorePercentage: 83 }] },
  currentCompletionSnapshot: { totalClassrooms: 1, totalAssignments: 2, completedAssignments: 1, inProgressAssignments: 0, notStartedAssignments: 1, incompleteAssignments: 1, completionRate: 50,
    classrooms: [{ roomId: "r", roomName: "Grade 5 Sampaguita", totalAssignments: 2, completedAssignments: 1, inProgressAssignments: 0, notStartedAssignments: 1, incompleteAssignments: 1, completionRate: 50 }], students: [] },
});

test("Teacher PDF: real values, Philippine-time period, labels, WPM and a safe filename", () => {
  const { all, saved } = pdfOf({ ...baseReport(), riskClassifications: { counts: { "At Risk": 1 }, students: [{ studentId: "s", studentName: "Ana Santos", classification: "At Risk" }] } });
  assert.equal(saved.name, "ReadFlow_Weekly_Report_2026-10-26_to_2026-11-01_abcdef12.pdf");
  assert.ok(saved.bytes > 1000 && saved.pages >= 1);
  assert.match(all, /2026-10-26 to 2026-11-01 \(PHT\)/);
  for (const shown of ["Reading Accuracy", "88.25", "WPM", "Ana Santos", "The Garden", "5", "83", "Grade 5 Sampaguita", "Current Risk Classifications", "At Risk", "75% benchmark"]) {
    assert.ok(all.includes(shown), shown);
  }
  assert.doesNotMatch(all, /pronunciation/i, "transcript accuracy is never called pronunciation");
  assert.doesNotMatch(all, /undefined|NaN|\[object Object\]/);
});

test("Admin PDF adds school-wide sections; competency is unavailable, not zero, for invalid evidence", () => {
  const { all } = pdfOf({ ...baseReport(), scope: "admin", learnerScope: "Students (Student accounts) only. Independent Learner practice is not included.",
    classroomComparisons: [{ roomId: "r", roomName: "Grade 5 Sampaguita", teacherName: "Ms. Cruz", enrolledStudents: 2, participatingStudents: 1, readingAttempts: 2, averageReadingAccuracy: 88.25, averageReadingSpeedWpm: 101.5, completedAssessments: 1, averageScore: 83 }],
    studentSummaries: [{ studentId: "s", studentName: "Ana Santos", readingAttempts: 2, averageReadingAccuracy: 88.25, averageReadingSpeedWpm: 101.5, completedAssessments: 1, averageScore: 83 }],
    competency: { literal: { total: 2, correct: 1, score: 50 }, inferential: { total: 0, correct: 0, score: null }, critical: { total: 2, correct: null, score: null } },
    riskClassifications: { counts: { "Needs Support": 1, "No assessment data": 1 }, students: [{ studentId: "s", studentName: "Ana Santos", classification: "Needs Support" }, { studentId: "q", studentName: "Ben Reyes", classification: "No assessment data" }] } });
  for (const shown of ["Independent Learner practice is not included", "Ms. Cruz", "Literal", "1/2", "No questions", "Evaluation unavailable", "Needs Support", "No assessment data", "Ben Reyes"]) {
    assert.ok(all.includes(shown), shown);
  }
  assert.doesNotMatch(all, /undefined|NaN|\[object Object\]/);
});

test("No data prints N/A, never 0%; a report saved before risk sections were added still downloads", () => {
  const empty = baseReport();
  empty.reading = { totalAttempts: 0, studentsWithAttempts: 0, averagePronunciationAccuracy: null, averageReadingSpeedWpm: null, attempts: [] } as never;
  empty.comprehension = { completedAssessments: 0, studentsWithAssessments: 0, averageScore: null, assessments: [] } as never;
  const { all, saved } = pdfOf(empty);
  assert.ok(saved.bytes > 0);
  assert.match(all, /N\/A/);
  assert.doesNotMatch(all, /\b0(\.00)?%/);
  assert.doesNotMatch(all, /Current Risk Classifications/);
  assert.match(all, /No completed comprehension assessments during the selected period/);
});
