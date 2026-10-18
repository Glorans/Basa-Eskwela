import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { calculateOralReadingMetrics, normalizeReadingText } from "../src/modules/module2/services/diagnosticScoring.ts";
const require = createRequire(import.meta.url);
const server = require("../../server/services/oralReadingScoring.js");
for (const language of ["en", "fil"] as const) {
  for (const [passage, transcript] of [
    ["Mr. has 1 seed.", "Mister has one seed"],
    ["One two three", "one extra three"],
    ["Bata sa paaralan", "bata paaralan"],
    ["1.5 -1 1/2 1st 10", "one five one one two first ten"],
    ["It\u2019s Ana\u2019s seed", "its anas seed"],
    ["seed seed sun", "seed sun seed"],
  ]) {
    test(`M5 frontend/server normalization and alignment agree (${language}): ${passage}`, () => {
      assert.equal(server.normalizeReadingText(passage, language), normalizeReadingText(passage, language));
      const frontend = calculateOralReadingMetrics(passage, transcript, 30, language);
      const backend = server.scorePassage(passage, transcript, language);
      assert.deepEqual(backend.wordMetrics, frontend.alignment.map(word => ({
        expected: "expectedWord" in word ? word.expectedWord : null,
        actual: "spokenWord" in word ? word.spokenWord : null, type: word.type,
      })));
      assert.equal(backend.spokenWords.length * 2, frontend.readingSpeedWpm);
    });
  }
}
test("M5 English equivalents do not forgive other words or apply to Filipino", () => {
  assert.equal(server.scorePassage("Mr. has 1", "mister has one", "en").wordMetrics.every((word: {type: string}) => word.type === "match"), true);
  assert.equal(server.scorePassage("Mr. has 1", "mister has one", "fil").wordMetrics.filter((word: {type: string}) => word.type !== "match").length, 2);
  assert.equal(server.scorePassage("seed", "seeds", "en").wordMetrics[0].type, "substitution");
});
