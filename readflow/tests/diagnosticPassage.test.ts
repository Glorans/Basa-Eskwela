import assert from "node:assert/strict";
import test from "node:test";
import { passageAnswers, passageReading, passageResult } from "./fixtures/diagnosticPassage.ts";
import { requireDiagnosticAssessment } from "../src/modules/module2/data/diagnosticData.ts";
import { createPassageDiagnosticResult } from "../src/modules/module2/services/diagnosticPassage.ts";
import { classifyComprehensionLevel, classifyWordRecognitionLevel } from "../src/modules/module2/services/diagnosticScoring.ts";
import { recoverDiagnosticSession, serializeDiagnosticSession } from "../src/modules/module2/services/diagnosticSession.ts";
import { processDiagnosticRecording } from "../src/modules/module2/services/diagnosticRecording.ts";

for (const language of ["en", "fil"] as const) {
  for (const [miscues, score, level] of [
    [0, 100, "Independent"], [1, 59 / 60 * 100, "Independent"], [2, 58 / 60 * 100, "Instructional"],
    [6, 90, "Instructional"], [7, 53 / 60 * 100, "Frustration"],
  ] as const) {
    test(`${language} 60-word passage: ${miscues} miscues = ${score.toFixed(2)}% ${level}`, () => {
      const result = passageResult(language, { miscues });
      assert.equal(result.oralReadingMetrics?.totalExpectedWords, 60);
      assert.equal(result.oralReadingMetrics?.detectableMiscues, miscues);
      assert.equal(result.orvScore, score);
      assert.equal(classifyWordRecognitionLevel(result.orvScore!), level);
    });
  }
}

test("2 miscues (96.67%) is Instructional even though it rounds to 97", () => {
  const score = passageResult("en", { miscues: 2 }).orvScore!;
  assert.equal(score.toFixed(2), "96.67");
  assert.equal(Math.round(score), 97);
  assert.equal(classifyWordRecognitionLevel(score), "Instructional");
});

for (const [correct, score, level] of [
  [6, 100, "Independent"], [5, 5 / 6 * 100, "Independent"], [4, 4 / 6 * 100, "Instructional"], [3, 50, "Frustration"],
] as const) {
  test(`comprehension ${correct}/6 = ${score.toFixed(2)} ${level}`, () => {
    const result = passageResult("en", { correct });
    assert.equal(result.comprehensionScore, score);
    assert.equal(classifyComprehensionLevel(result.comprehensionScore!), level);
  });
}

for (const [miscues, correct, readingLevel, difficultyTier] of [
  [3, 5, "Instructional", "Medium"],
  [1, 6, "Independent", "Hard"],
  [7, 6, "Frustration", "Easy"],
  [0, 3, "Frustration", "Easy"],
] as const) {
  test(`${miscues} miscues + ${correct}/6 -> ${readingLevel} (${difficultyTier})`, () => {
    const result = passageResult("en", { miscues, correct });
    assert.equal(result.readingLevel, readingLevel);
    assert.equal(result.difficultyTier, difficultyTier);
  });
}

test("whole-passage result keeps the saved shape and has no per-sentence data", () => {
  const result = passageResult("en", { miscues: 3, correct: 5, durationSeconds: 40 });
  assert.equal(result.assessmentId, "grade5-en-passage-v3");
  assert.equal(result.assessmentVersion, "3.0");
  assert.equal(result.language, "en");
  assert.equal(result.readingSpeedWpm, 60 * 60 / 40);
  assert.deepEqual(result.comprehensionAnswers, passageAnswers("en", 5));
  for (const key of ["sentences", "simpleAverage", "comprehensionCorrectBySentence", "wordReadingLevel", "comprehensionLevel"]) {
    assert.equal(key in result, false, key);
  }
});

test("reading speed is reported separately and never changes the reading level", () => {
  for (const durationSeconds of [10, 60, 300]) {
    assert.equal(passageResult("en", { miscues: 1, durationSeconds }).readingLevel, "Independent");
  }
});

test("scores are recalculated from the transcript; incomplete answers and invalid readings are rejected", () => {
  const a = requireDiagnosticAssessment("en");
  const tampered = { ...passageReading("en", 7), oralReadingMetrics: { recordingDurationSeconds: 30, wordReadingScore: 100 } };
  assert.equal(createPassageDiagnosticResult(a, tampered, passageAnswers("en")).readingLevel, "Frustration");
  assert.throws(() => createPassageDiagnosticResult(a, passageReading("en"), {}));
  for (const reading of [undefined, { transcription: { text: "..." }, oralReadingMetrics: { recordingDurationSeconds: 30 } },
    { ...passageReading("en"), oralReadingMetrics: { recordingDurationSeconds: 0 } }]) {
    assert.throws(() => createPassageDiagnosticResult(a, reading, passageAnswers("en")));
  }
});

test("v3.0 session recovery restores the single reading and recalculates tampered scores", () => {
  const a = requireDiagnosticAssessment("en");
  const reading = passageResult("en", { miscues: 2 });
  const session = { assessmentId: a.id, assessmentVersion: a.version, answers: passageAnswers("en", 3), questionIndex: 3,
    reading: { language: "en" as const, transcription: { text: reading.transcript! },
      oralReadingMetrics: { ...reading.oralReadingMetrics!, wordReadingScore: 100 } } };
  const raw = serializeDiagnosticSession(session, "reader");
  const restored = recoverDiagnosticSession(raw, "reader", a)!;
  assert.equal(restored.assessmentVersion, "3.0");
  assert.equal(restored.questionIndex, 3);
  assert.equal(restored.reading.oralReadingMetrics.detectableMiscues, 2);
  assert.equal(restored.reading.oralReadingMetrics.wordReadingScore, 58 / 60 * 100);
  assert.equal("sentences" in restored.reading, false);
  assert.equal(recoverDiagnosticSession(raw, "reader", { ...a, version: "2.0" }), null);
  assert.equal(recoverDiagnosticSession(raw, "other", a), null);
});

test("failed and empty mocked Google responses never produce a score", async () => {
  const input = { audioSegments: [new Blob(["audio"], { type: "audio/webm" })], language: "en" as const,
    expectedText: "Mia walked", recordingDurationSeconds: 3 };
  await assert.rejects(processDiagnosticRecording({ ...input, uploadSegment: async () => { throw new Error("provider failed"); } }));
  await assert.rejects(processDiagnosticRecording({ ...input, uploadSegment: async () => ({ success: true, message: "", transcription: { text: "" } }) }));
  await assert.rejects(processDiagnosticRecording({ ...input, streamingTranscription: { text: "..." }, uploadSegment: async () => { throw new Error("unused"); } }));
});
