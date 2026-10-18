import assert from "node:assert/strict";
import test from "node:test";
import { passageAnswers, passageReading } from "./fixtures/diagnosticPassage.ts";
import { requireDiagnosticAssessment } from "../src/modules/module2/data/diagnosticData.ts";
import { diagnosticSessionKey, recoverDiagnosticSession, serializeDiagnosticSession } from "../src/modules/module2/services/diagnosticSession.ts";
import { getReadingWords, calculateOralReadingMetrics } from "../src/modules/module2/services/diagnosticScoring.ts";

test("Filipino apostrophe and hyphen normalization uses scoring engine rules", () => {
 assert.deepEqual(getReadingWords("Bagama't mag-aaral", "fil"), ["bagamat", "mag", "aaral"]);
 assert.deepEqual(getReadingWords("One 1 Mr. mister", "fil"), ["one", "1", "mr", "mister"]);
 const text = requireDiagnosticAssessment("fil").passage.paragraphs[0];
 assert.equal(calculateOralReadingMetrics(text, text.replace("bukid", "hardin"), 10, "fil").detectableMiscues, 1);
});
test("Filipino sessions restore independently from English and prior versions", () => {
 const a = requireDiagnosticAssessment("fil"), reading = passageReading("fil", 1);
 const session = { assessmentId: a.id, assessmentVersion: a.version, reading, answers: passageAnswers("fil"), questionIndex: 5 };
 const raw = serializeDiagnosticSession(session, "reader");
 const restored = recoverDiagnosticSession(raw, "reader", a)!;
 assert.deepEqual(restored.answers, session.answers);
 assert.equal(restored.questionIndex, 5);
 assert.equal(restored.reading.oralReadingMetrics.detectableMiscues, 1);
 assert.equal(restored.reading.oralReadingMetrics.totalExpectedWords, 60);
 assert.equal(recoverDiagnosticSession(raw, "reader", requireDiagnosticAssessment("en")), null);
 assert.equal(recoverDiagnosticSession(raw, "reader", { ...a, version: "1.0" }), null);
 assert.notEqual(diagnosticSessionKey("reader", a), diagnosticSessionKey("reader", requireDiagnosticAssessment("en")));
});
