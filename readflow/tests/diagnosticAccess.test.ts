import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getDiagnosticPlacementDisplay } from "../src/modules/module2/utils/diagnosticDisplay.ts";
import { filterAdminDiagnosticResults } from "../src/pages/admin/diagnosticResultFilters.ts";
import type { AdminDiagnosticResult } from "../src/services/adminDiagnosticResults.ts";

function readSource(relativePath: string) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

const results: AdminDiagnosticResult[] = [
  {
    id: "student-result",
    userId: "student-id",
    learnerName: "Mariel",
    email: "student@example.com",
    role: "student",
    language: "en",
    orvScore: 98,
    comprehensionScore: 85.71,
    readingSpeedWpm: 82,
    readingLevel: "Independent",
    difficultyTier: "Hard",
    completedAt: "2026-10-01T00:00:00.000Z",
    verificationStatus: "server_verified",
  },
  {
    id: "learner-result",
    userId: "learner-id",
    learnerName: "Independent Learner",
    email: "learner@example.com",
    role: "general_user",
    language: "fil",
    orvScore: 94,
    comprehensionScore: 71.43,
    readingSpeedWpm: null,
    readingLevel: "Instructional",
    difficultyTier: "Medium",
    completedAt: "2026-10-01T00:00:00.000Z",
    verificationStatus: "unverified",
  },
];

test("dashboard diagnostic labels never fall back to mock placement", () => {
  assert.deepEqual(getDiagnosticPlacementDisplay("empty"), {
    readingLevel: "Not assessed yet",
    difficultyTier: "Not assessed yet",
  });
  assert.deepEqual(getDiagnosticPlacementDisplay("error"), {
    readingLevel: "Unavailable",
    difficultyTier: "Unavailable",
  });
  assert.deepEqual(getDiagnosticPlacementDisplay("ready", {
    readingLevel: "Independent",
    difficultyTier: "Hard",
  }), {
    readingLevel: "Independent",
    difficultyTier: "Hard",
  });
});

test("DiagnosticResult stays camelCase outside the database repository", async () => {
  const [typesSource, scoringSource, databaseSource] = await Promise.all([
    readSource("../src/modules/module2/types/diagnostic.ts"),
    readSource("../src/modules/module2/services/diagnosticScoring.ts"),
    readSource("../src/modules/module2/services/diagnosticRepository.ts"),
  ]);
  const databaseFieldNames =
    /\b(?:orv_score|comprehension_score|reading_level|difficulty_tier)\b/;

  assert.doesNotMatch(typesSource, databaseFieldNames);
  assert.doesNotMatch(scoringSource, databaseFieldNames);
  assert.match(databaseSource, /orvScore: row\.orv_score/);
  assert.match(databaseSource, /comprehensionScore: row\.comprehension_score/);
  // DT1: the browser only reads diagnostic rows; the backend writes them.
  assert.doesNotMatch(databaseSource, /\.(?:insert|upsert|update|delete)\(/);
  assert.doesNotMatch(databaseSource, /\b(?:orv_score|reading_level|difficulty_tier):/);
});

test("Admin diagnostic search and filters combine for both learner roles", () => {
  assert.deepEqual(
    filterAdminDiagnosticResults(results, {
      searchQuery: "  LEARNER@EXAMPLE  ",
      readingLevel: "",
      difficulty: "",
    }).map((result) => result.id),
    ["learner-result"],
  );
  assert.deepEqual(
    filterAdminDiagnosticResults(results, {
      searchQuery: "",
      readingLevel: "Independent",
      difficulty: "Hard",
    }).map((result) => result.id),
    ["student-result"],
  );
  assert.deepEqual(
    filterAdminDiagnosticResults(results, {
      searchQuery: "independent",
      readingLevel: "Instructional",
      difficulty: "Medium",
    }).map((result) => result.id),
    ["learner-result"],
  );
});


test("Admin diagnostic search matches the displayed nickname", async () => {
  assert.deepEqual(filterAdminDiagnosticResults(results, {
    searchQuery: "  MARiel ", readingLevel: "", difficulty: "",
  }).map(result => result.id), ["student-result"]);
  // The School Admin page now uses the shared class view (official results, displayed names from the server).
  const page = await readSource("../src/pages/admin/AdminDiagnosticResultsPage.tsx");
  assert.ok(page.includes("<ClassReadingResults load={getSchoolReadingProgress}"));
  assert.ok(!page.includes("result.fullName"));
});
