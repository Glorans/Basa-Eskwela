import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { requireDiagnosticAssessment } from "../src/modules/module2/data/diagnosticData.ts";
import { calculateComprehensionScore, classifyComprehensionLevel, getReadingWords } from "../src/modules/module2/services/diagnosticScoring.ts";
test("en exact supplied 10/20/30-word passage and six answer keys", () => {
 const a = requireDiagnosticAssessment("en");
 assert.equal(a.id, "grade5-en-passage-v3"); assert.equal(a.version, "3.0");
 assert.deepEqual(a.questions.map(q => q.correctChoiceId), ["a", "a", "a", "a", "a", "a"]);
 assert.ok(a.questions.every(q => q.choices.map(c => c.id).join("") === "abcd"));
 assert.deepEqual(a.passage.paragraphs.map(t => getReadingWords(t, "en").length), [10, 20, 30]);
 assert.equal(createHash("sha256").update(JSON.stringify({ passage: a.passage, questions: a.questions })).digest("hex"), "0db659c030f662c14b39160887a99ac0db795ae80da6f51fcbdd79749e12bf00");
});
test("fil exact supplied 10/20/30-word passage and six answer keys", () => {
 const a = requireDiagnosticAssessment("fil");
 assert.equal(a.id, "grade5-fil-passage-v3"); assert.equal(a.version, "3.0");
 assert.deepEqual(a.questions.map(q => q.correctChoiceId), ["a", "a", "a", "a", "a", "a"]);
 assert.ok(a.questions.every(q => q.choices.map(c => c.id).join("") === "abcd"));
 assert.deepEqual(a.passage.paragraphs.map(t => getReadingWords(t, "fil").length), [10, 20, 30]);
 assert.equal(createHash("sha256").update(JSON.stringify({ passage: a.passage, questions: a.questions })).digest("hex"), "356d4a147e695573cbc1c77ab5d89cafbe911c7b950bee346843055ead02c018");
});
for (const language of ["en", "fil"] as const) for (let correct = 0; correct <= 6; correct++) {
 test(`${language} comprehension ${correct}/6`, () => {
  const a = requireDiagnosticAssessment(language);
  const answers = Object.fromEntries(a.questions.map((q,i) => [q.id, i < correct ? q.correctChoiceId : "wrong"]));
  const score = calculateComprehensionScore(answers, a.questions)!;
  assert.equal(score, correct / 6 * 100);
  assert.equal(classifyComprehensionLevel(score), ["Frustration", "Frustration", "Frustration", "Frustration", "Instructional", "Independent", "Independent"][correct]);
 });
}
