import assert from "node:assert/strict";
import test from "node:test";
import { requireDiagnosticAssessment } from "../src/modules/module2/data/diagnosticData.ts";
import { diagnosticSessionKey, recoverDiagnosticSession, serializeDiagnosticSession } from "../src/modules/module2/services/diagnosticSession.ts";
import { calculateOralReadingMetrics } from "../src/modules/module2/services/diagnosticScoring.ts";

const assessment = { ...requireDiagnosticAssessment("en"), id: "legacy-session", version: "1.0" };
const session = {
  assessmentId: assessment.id, assessmentVersion: assessment.version,
  reading: { language: "en" as const, transcription: { text: "one day frog" }, oralReadingMetrics: calculateOralReadingMetrics("one day a frog", "one day frog", 3) },
  answers: { [assessment.questions[0].id]: assessment.questions[0].choices[0].id }, questionIndex: 1,
};

test("refresh recovers reading and answers, recalculating scores from real speech", () => {
  const raw = serializeDiagnosticSession(session, "reader");
  const restored = recoverDiagnosticSession(raw, "reader", assessment)!;
  assert.equal(restored.questionIndex, 1);
  assert.deepEqual(restored.answers, session.answers);
  assert.equal(restored.reading.oralReadingMetrics.numberOfWordsRead, 3);
  assert.ok(restored.reading.oralReadingMetrics.totalExpectedWords > 4);
  assert.doesNotMatch(raw, /audioBlob|data:audio|recognizedWordIndexes|bridgedVisual/);
});

test("recovery rejects different users, languages, versions, malformed, missing and expired state", () => {
  const raw = serializeDiagnosticSession(session, "reader");
  for (const input of [null, "{", raw.replace('"language":"en"', '"language":"fil"'), raw.replace('"text":"one day frog"', '"text":""')]) {
    assert.equal(recoverDiagnosticSession(input, "reader", assessment), null);
  }
  assert.equal(recoverDiagnosticSession(raw, "other", assessment), null);
  assert.equal(recoverDiagnosticSession(raw, "reader", { ...assessment, version: "new" }), null);
  assert.equal(recoverDiagnosticSession(raw, "reader", assessment, Date.now() + 86400001), null);
  assert.notEqual(diagnosticSessionKey("reader", assessment), diagnosticSessionKey("other", assessment));
});

test("recovery cannot skip unanswered questions or preserve invalid answer IDs", () => {
  const raw = serializeDiagnosticSession({ ...session, answers: { invalid: "fake" }, questionIndex: 6 }, "reader");
  const restored = recoverDiagnosticSession(raw, "reader", assessment)!;
  assert.equal(restored.questionIndex, 0);
  assert.deepEqual(restored.answers, {});
});
