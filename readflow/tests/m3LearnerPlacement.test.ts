import assert from "node:assert/strict";
import test from "node:test";
import { getLearnerPlacement } from "../src/modules/module3/services/learnerPlacement.ts";
import { getPublishedStudentModules, getRecommendedStudentModules } from "../src/modules/module3/state/studentModuleState.ts";
import type { SavedDiagnosticResult } from "../src/modules/module2/types/diagnostic";
import type { MaterialLanguageCode, ReadingModule } from "../src/modules/module3/types/content";

const saved = (language: MaterialLanguageCode): SavedDiagnosticResult => ({
  id: language, userId: "reader", completedAt: "2026-10-06",
  assessmentType: "initial", createdAt: "2026-10-06", updatedAt: "2026-10-06",
  result: { language, assessmentId: `active-${language}`, assessmentVersion: "1.0",
    readingLevel: language === "en" ? "Instructional" : "Independent",
    difficultyTier: language === "en" ? "Medium" : "Hard" },
});
const base: ReadingModule = { id: "en-match", title: "English", learningPathId: "path", learningPath: "English path",
  language: "en", readingLevel: "Instructional", difficultyTier: "Medium", difficulty: "Easy",
  status: "published", createdAt: "2026-10-06", passage: "Text", questionCount: 5 };
const modules: ReadingModule[] = [base,
  { ...base, id: "fil-match", language: "fil", readingLevel: "Independent", difficultyTier: "Hard" },
  { ...base, id: "wrong-language", language: "fil" },
  { ...base, id: "wrong-level", readingLevel: "Frustration" },
  { ...base, id: "wrong-tier", difficultyTier: "Hard" },
  { ...base, id: "draft", status: "draft" },
  { ...base, id: "archived", status: "archived" },
];

for (const available of [[], ["en"], ["fil"], ["en", "fil"]] as MaterialLanguageCode[][]) {
  test(`isolated placements and recommendations for ${available.join(",") || "neither"}`, async () => {
    const reads: MaterialLanguageCode[] = [];
    const checks: MaterialLanguageCode[] = [];
    const source = {
      hasCompletedInitialDiagnostic: async (language: MaterialLanguageCode) => { checks.push(language); return available.includes(language); },
      getInitialDiagnosticResult: async (language: MaterialLanguageCode) => { reads.push(language); return saved(language); },
    };
    for (const language of ["en", "fil"] as const) {
      const placement = await getLearnerPlacement(language, source);
      assert.equal(placement.status, available.includes(language) ? "ready" : "missing");
      assert.equal(placement.language, language);
      assert.deepEqual(getRecommendedStudentModules(modules, language, placement).map(m => m.id), available.includes(language) ? [`${language}-match`] : []);
      assert.deepEqual(getRecommendedStudentModules(modules, language === "en" ? "fil" : "en", placement), []);
      if (placement.status === "ready") {
        assert.equal(placement.assessmentId, `active-${language}`);
        assert.equal(placement.assessmentVersion, "1.0");
      }
    }
    assert.deepEqual(checks, ["en", "fil"]);
    assert.deepEqual(reads, available);
    assert.equal(getPublishedStudentModules(modules).length, 5);
  });
}

test("missing, mismatched, and incomplete saved results never produce a default placement", async () => {
  for (const row of [null, saved("fil"), { ...saved("en"), result: { ...saved("en").result, difficultyTier: undefined } }]) {
    assert.deepEqual(await getLearnerPlacement("en", {
      hasCompletedInitialDiagnostic: async () => true,
      getInitialDiagnosticResult: async () => row,
    }), { status: "missing", language: "en" });
  }
});

test("stale assessment validity belongs to M2 and failed reads remain errors", async () => {
  assert.deepEqual(await getLearnerPlacement("en", {
    hasCompletedInitialDiagnostic: async () => false,
    getInitialDiagnosticResult: async () => { throw new Error("Must not load historical placement"); },
  }), { status: "missing", language: "en" });
  await assert.rejects(getLearnerPlacement("fil", {
    hasCompletedInitialDiagnostic: async () => true,
    getInitialDiagnosticResult: async () => { throw new Error("offline"); },
  }), /offline/);
  assert.deepEqual(getRecommendedStudentModules(modules, "en"), []);
});
