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
test("M5 scores exactly the story words the read-aloud screen shows", async () => {
  const { storyParagraphs } = await import("../src/pages/reading-activity/storyDisplay.ts");
  for (const [passage, title, language] of [
    ["A Helping Hand\nEvery Saturday, Lia helps her lola.", "A Helping Hand", "en"],
    ["A HELPING HAND!\r\n\r\nLia sweeps.", "A Helping Hand", "en"],
    ["A Helping Hand Every Saturday, Lia sweeps.", "A Helping Hand", "en"],
    ["A Helping Hand is what Lia gives.", "A Helping Hand", "en"],
    ["Every Saturday, Lia sweeps.\nShe helps.", "A Helping Hand", "en"],
    ["The Seed\nA small seed\nneeds sun.", "Seeds", "en"],
    ["Ang Mabait na Bata\nTumutulong si Lia.", "Ang Mabait na Bata", "fil"],
    ["Run\n\nRun, Tom, run!", "Run", "en"],
  ] as const) {
    const shown = storyParagraphs(passage, title).join(" ");
    const scored = server.splitEmbeddedTitle(passage, title, language).body;
    assert.deepEqual(server.getReadingWords(scored, language), server.getReadingWords(shown, language), passage);
  }
});
