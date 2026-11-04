import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseTeacherComprehensionDetail,
  parseTeacherComprehensionSummary,
} from "../src/modules/module5/services/teacherComprehension.ts";
import { filterTeacherOralReadingAttempts } from "../src/modules/module5/services/teacherOralReadingFilters.ts";
import type { TeacherOralReadingAttemptSummary } from "../src/modules/module5/types/oralReading.ts";

const attempts: TeacherOralReadingAttemptSummary[] = [
  {
    id: "attempt-a",
    learnerId: "student-a",
    learnerName: "Ana Cruz",
    moduleId: "module-trees",
    moduleTitle: "Trees and Air",
    pronunciationAccuracy: 87,
    readingSpeedWpm: 112,
    detectedErrorCount: 3,
    completedAt: "2026-10-01T08:00:00.000Z",
    comprehension: {
      status: "completed",
      firstCorrect: 5,
      totalQuestions: 6,
      firstAttemptPercentage: 83,
      hintsUsed: 2,
      completedAt: "2026-10-01T08:10:00.000Z",
    },
  },
  {
    id: "attempt-b",
    learnerId: "student-b",
    learnerName: "Ben Santos",
    moduleId: "module-water",
    moduleTitle: "The Water Cycle",
    pronunciationAccuracy: 94,
    readingSpeedWpm: 128,
    detectedErrorCount: 1,
    completedAt: "2026-10-01T09:00:00.000Z",
    comprehension: { status: "not_applicable" },
  },
];

test("Teacher search filters real attempt summaries by learner or module", () => {
  assert.deepEqual(
    filterTeacherOralReadingAttempts(attempts, {
      searchQuery: "ana",
      learnerId: "",
      moduleId: "",
    }).map((attempt) => attempt.id),
    ["attempt-a"],
  );
  assert.deepEqual(
    filterTeacherOralReadingAttempts(attempts, {
      searchQuery: "water",
      learnerId: "",
      moduleId: "",
    }).map((attempt) => attempt.id),
    ["attempt-b"],
  );
});

test("Teacher Student and Module filters combine without fake fallback rows", () => {
  assert.equal(filterTeacherOralReadingAttempts(attempts, {
    searchQuery: "",
    learnerId: "student-a",
    moduleId: "module-water",
  }).length, 0);
  assert.deepEqual(filterTeacherOralReadingAttempts(attempts, {
    searchQuery: "",
    learnerId: "student-b",
    moduleId: "module-water",
  }), [attempts[1]]);
});

test("Teacher comprehension status filter combines with search, learner, and module", () => {
  const base = { searchQuery: "", learnerId: "", moduleId: "" };
  assert.deepEqual(filterTeacherOralReadingAttempts(attempts, { ...base, comprehensionStatus: "completed" })
    .map((attempt) => attempt.id), ["attempt-a"]);
  assert.deepEqual(filterTeacherOralReadingAttempts(attempts, { ...base, comprehensionStatus: "not_applicable" })
    .map((attempt) => attempt.id), ["attempt-b"]);
  assert.equal(filterTeacherOralReadingAttempts(attempts, {
    ...base, searchQuery: "ana", comprehensionStatus: "not_started",
  }).length, 0);
  assert.equal(filterTeacherOralReadingAttempts(attempts, { ...base, comprehensionStatus: "" }).length, 2);
});

test("Teacher comprehension responses are validated defensively", () => {
  assert.deepEqual(parseTeacherComprehensionSummary({ status: "weird" }), { status: "unavailable" });
  assert.deepEqual(parseTeacherComprehensionSummary(undefined), { status: "unavailable" });
  assert.deepEqual(parseTeacherComprehensionSummary({ status: "completed", firstCorrect: "5" }), { status: "unavailable" });
  assert.deepEqual(parseTeacherComprehensionSummary({ status: "not_started" }), { status: "not_started" });
  const group = { total: 1, answered: 1, firstCorrect: 1, resolved: 1, hintsUsed: 0, firstAttemptPercentage: 100 };
  const detail = {
    status: "in_progress", firstCorrect: 1, totalQuestions: 3, firstAttemptPercentage: 33, hintsUsed: 0, completedAt: null,
    byType: { literal: group, inferential: group, critical: group },
    questions: [{
      order: 1, type: "literal", prompt: "Who?", options: ["A", "B", "C", "D"], studentFirstAnswerIndex: 0,
      correctIndex: 0, firstAnswerCorrect: true, hintUsed: false, resolved: true,
    }],
  };
  const parsed = parseTeacherComprehensionDetail(detail);
  assert.equal(parsed.status, "in_progress");
  assert.equal("questions" in parsed && parsed.questions[0].correctIndex, 0);
  assert.deepEqual(parseTeacherComprehensionDetail({
    ...detail, questions: [{ ...detail.questions[0], correctIndex: 7 }],
  }), { status: "unavailable" });
});

test("Teacher results page loads the authenticated API and renders required empty states", async () => {
  const page = await readFile(
    new URL("../src/modules/module5/pages/TeacherOralReadingResultsPage.tsx", import.meta.url),
    "utf8",
  );
  const service = await readFile(
    new URL("../src/modules/module5/services/oralReadingService.ts", import.meta.url),
    "utf8",
  );
  assert.match(page, /getTeacherOralReadingAttempts/);
  assert.match(service, /\/api\/oral-reading\/teacher\/attempts/);
  assert.match(page, /title="Reading Results"/);
  assert.match(page, /No student reading results yet\./);
  assert.match(page, /No reading results match your filters\./);
  assert.match(page, /correct on first try/);
  assert.doesNotMatch(page, /Student A|Student B|87%|112/);
});

test("Teacher detail is read-only and displays transcript, saved accuracy, and practice words", async () => {
  const detail = await readFile(
    new URL("../src/modules/module5/pages/TeacherOralReadingAttemptPage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(detail, /Read-Aloud Transcript/);
  // The saved score is transcript-based reading accuracy, never labelled as pronunciation.
  assert.match(detail, /Reading Accuracy \(Transcript-based\)/);
  assert.doesNotMatch(detail, /Pronunciation Accuracy/);
  // One card per function: result, transcript, words, and the (unsaved) pronunciation check.
  for (const title of ["Oral Reading Result", "Read-Aloud Transcript", "Words to Practice", "Pronunciation Feedback and Accuracy"]) {
    assert.match(detail, new RegExp(`className="m5-review-panel-title" id="[\\w-]+">${title}</h2>`), title);
  }
  assert.match(detail, /are not saved yet, so their feedback, scores and words cannot be reviewed here/);
  assert.doesNotMatch(detail, /Azure/);
  assert.match(detail, /<RecordingPlayback attemptId=\{attempt\.id\} teacher language=\{attempt\.language \?\? "en"\} \/>/);
  assert.match(detail, /Pronunciation scoring is not available for Filipino readings/);
  assert.match(detail, /Words to Practice/);
  assert.match(detail, /getWordsToPractice\(attempt\.wordMetrics\)/);
  assert.match(detail, /Back to Reading Results/);
  assert.match(detail, /Question Review/);
  assert.match(detail, /The student has not started the questions yet\./);
  assert.doesNotMatch(detail, /<input|<textarea|Edit Transcript|Change Accuracy|Override Result|Mark Correct/);
});

test("Teacher review navigation and routes are Teacher-only", async () => {
  const layout = await readFile(
    new URL("../src/modules/module3/components/M3Layout.tsx", import.meta.url),
    "utf8",
  );
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const studentSidebar = await readFile(
    new URL("../src/components/basa/BasaSidebar.tsx", import.meta.url),
    "utf8",
  );
  assert.match(layout, /role === "teacher"[\s\S]*label: "Reading Results"/);
  assert.match(app, /allowedRoles=\{\["teacher"\]\}[\s\S]*path="oral-reading"/);
  assert.doesNotMatch(studentSidebar, /Reading Results/);
  assert.doesNotMatch(layout, /role === "general_user"[\s\S]*label: "Reading Results"/);
});
