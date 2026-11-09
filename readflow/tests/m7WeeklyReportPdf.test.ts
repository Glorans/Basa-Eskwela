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
  const placed: { value: string; y: number; page: number }[] = [];
  let saved: { name: string; bytes: number; pages: number } | null = null;
  class CapturingPdf extends jsPDF {
    constructor(...args: unknown[]) {
      super(...args);
      const write = this.text;
      this.text = (value: unknown, ...rest: unknown[]) => {
        const values = [value].flat().map(String);
        text.push(...values);
        placed.push(...values.map(item => ({ value: item, y: Number(rest[1]), page: this.getCurrentPageInfo().pageNumber })));
        return write.call(this, value, ...rest);
      };
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
  return { all: text.join("\n"), text, placed, saved: saved as unknown as { name: string; bytes: number; pages: number } };
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
  assert.equal(saved.name, "Basa_Eskwela_Weekly_Report_2026-10-26_to_2026-11-01_abcdef12.pdf");
  assert.ok(saved.bytes > 1000 && saved.pages >= 1);
  assert.match(all, /2026-10-26 to 2026-11-01 \(PHT\)/);
  for (const shown of ["Reading Accuracy", "88.25", "WPM", "Ana Santos", "The Garden", "5", "83", "Grade 5 Sampaguita", "Student Support / Risk Classification", "At Risk", "75% benchmark"]) {
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
  assert.doesNotMatch(all, /Risk Classification/);
  assert.match(all, /No completed comprehension assessments during the selected period/);
});

// ---- Table layout -----------------------------------------------------------
const many = (count: number) => {
  const report = baseReport();
  report.reading.attempts = Array.from({ length: count }, (_, i) => ({ attemptId: `r${i}`, studentId: `s${i % 7}`, studentName: `Student ${i % 7}`,
    moduleTitle: i % 5 ? `Material ${i}` : `Ang Matalinong Pagong at ang Mabilis na Kuneho sa Gitna ng Kagubatan ${i}`,
    completedAt: new Date(Date.UTC(2026, 9, 26, 1, i)).toISOString(), pronunciationAccuracy: 50 + (i % 50) + 0.25, readingSpeedWpm: 200 + i + 0.75 }));
  report.comprehension.assessments = Array.from({ length: count }, (_, i) => ({ attemptId: `q${i}`, studentId: `s${i % 7}`, studentName: `Learner ${i % 7}`,
    moduleTitle: `Story ${i}`, completedAt: new Date(Date.UTC(2026, 9, 27, 2, i)).toISOString(), correctAnswers: i % 7, totalQuestions: 6 + (i % 3),
    scorePercentage: Math.round((i % 7) / (6 + (i % 3)) * 10000) / 100 }));
  return report;
};
const FOOTER = "Basa Eskwela | Weekly Performance Report | 2026-10-26 to 2026-11-01 (PHT)";

test("PDF is branded Basa Eskwela on every page and has no completion snapshot paragraph", () => {
  const { all, text, saved } = pdfOf(many(120));
  assert.ok(saved.pages > 2);
  assert.doesNotMatch(all, /ReadFlow/);
  assert.doesNotMatch(all, /not historical completion rates|reflect assignment status/);
  assert.equal(text.filter(value => value === FOOTER).length, saved.pages);
  for (let page = 1; page <= saved.pages; page += 1) assert.ok(text.includes(`Page ${page} of ${saved.pages}`));
  for (const heading of ["Reading Performance", "Comprehension Performance", "Classroom Completion", "Weekly Reading Activity Records", "Weekly Comprehension Results"]) {
    assert.ok(text.includes(heading), heading);
  }
  for (const header of ["Metric", "Result", "Total Assignments", "Completed", "Completion Rate", "Reading Material", "Date Completed (PHT)", "Speed (WPM)"]) {
    assert.ok(all.includes(header), header);
  }
});

test("every reading and comprehension record is printed with its exact saved values; repeats are kept", () => {
  const report = many(90);
  report.reading.attempts.push({ ...report.reading.attempts[1], attemptId: "repeat" });
  const lines = pdfOf(report).text;
  const count = (value: string) => lines.filter(line => line === value).length;
  for (const attempt of report.reading.attempts) {
    assert.ok(count(`${attempt.pronunciationAccuracy.toFixed(2)}%`) >= 1, attempt.attemptId);
  }
  // Speeds are unique per record, so each must print exactly once; the repeated attempt prints twice.
  for (const attempt of report.reading.attempts.slice(2, 90)) assert.equal(count(attempt.readingSpeedWpm.toFixed(2)), 1, attempt.attemptId);
  assert.equal(count(report.reading.attempts[1].readingSpeedWpm.toFixed(2)), 2, "repeated attempt is not merged");
  for (const assessment of report.comprehension.assessments) {
    assert.equal(count(assessment.moduleTitle), 1, assessment.moduleTitle);
    assert.ok(count(`${assessment.correctAnswers}/${assessment.totalQuestions}`) >= 1 && count(`${assessment.scorePercentage.toFixed(2)}%`) >= 1, assessment.attemptId);
  }
});

test("long tables repeat their headers, keep rows above the footer, and never leave a lone last row", () => {
  const { text, placed, saved } = pdfOf(many(150));
  const continued = (title: string) => text.filter(value => value === `${title} (continued)`).length;
  assert.ok(continued("Weekly Reading Activity Records") >= 2);
  assert.ok(continued("Weekly Comprehension Results") >= 2);
  assert.equal(text.filter(value => value === "Speed (WPM)").length, continued("Weekly Reading Activity Records") + 1, "header repeated on each continued page");
  assert.equal(text.filter(value => value === "Score").length, continued("Weekly Comprehension Results") + 1, "header repeated on each continued page");
  const body = placed.filter(item => item.value !== FOOTER && !/^Page \d+ of \d+$/.test(item.value));
  assert.ok(body.every(item => item.y < 297 - 18), "no body text in the footer area");
  const lastPageRows = placed.filter(item => item.page === saved.pages && /^\d+\/\d+$/.test(item.value));
  assert.ok(lastPageRows.length >= 2, "the final page carries at least two result rows");
});

test("Classroom Completion is a table with the saved totals; empty sections say so", () => {
  const { all } = pdfOf(baseReport());
  for (const shown of ["Grade 5 Sampaguita", "All classrooms (1)", "50.00%"]) assert.ok(all.includes(shown), shown);
  const empty = baseReport();
  empty.currentCompletionSnapshot = { ...empty.currentCompletionSnapshot, totalClassrooms: 0, totalAssignments: 0, completedAssignments: 0, completionRate: null, classrooms: [] } as never;
  assert.match(pdfOf(empty).all, /No classroom records available/);
});
