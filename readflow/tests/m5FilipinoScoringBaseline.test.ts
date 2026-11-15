// Characterization: the browser copy of the M2 oral-reading scorer (M2 diagnostic, and the M5
// on-screen result before saving) gives the CURRENT recorded values for the same synthetic
// Filipino readings as the server baseline. Not a statement that the values are correct.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calculateOralReadingMetrics } from "../src/modules/module2/services/diagnosticScoring.ts";

type Row = {
  name: string;
  label: string;
  input: { passage: string; transcript: string; durationSeconds: number; title: string };
  m2: { score: number; expected: number; match: number; wpm: number | null; wcpm: number | null };
};
const baseline = JSON.parse(readFileSync(new URL("../../server/tests/fixtures/m5FilipinoScoringBaseline.json", import.meta.url), "utf8")) as { rows: Row[] };
const round = (n: number | undefined) => (n === undefined ? null : Math.round(n * 100) / 100);

test("the browser M2 scorer matches the recorded server M2 values for every Filipino baseline reading", () => {
  assert.equal(baseline.rows.length, 33);
  for (const { name, input, m2 } of baseline.rows) {
    const k = calculateOralReadingMetrics(input.passage, input.transcript, input.durationSeconds, "fil");
    assert.deepEqual({
      score: round(k.wordReadingScore), expected: k.totalExpectedWords, match: k.correctWords,
      wpm: round(k.readingSpeedWpm), wcpm: round(k.correctWordsPerMinute),
    }, m2, name);
  }
});

test("browser M2 keeps the recorded M2/M5 differences (joined hyphen words, digits, unread title)", () => {
  const score = (name: string) => {
    const row = baseline.rows.find((item) => item.name === name)!;
    return round(calculateOralReadingMetrics(row.input.passage, row.input.transcript, row.input.durationSeconds, "fil").wordReadingScore);
  };
  assert.equal(score("hyphenated words written joined (arawaraw, benben)"), 84);
  assert.equal(score("number word as digit (isang -> 1)"), 96);
  assert.equal(score("title line not read"), 60);
});
