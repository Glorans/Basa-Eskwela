const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizePronunciationParts, toCheckDto } = require("../services/pronunciationCheckService");

// M5 result cards (2026-11-22): the saved list of words to practise keeps at most 10, but the card shows the full
// number of flagged words, read from the saved detailed results. Nothing new is stored.
const parts = [{ utterances: [{ accuracy: 70, fluency: 60, words: [
  ...Array.from({ length: 13 }, (_, i) => ({ word: `Word${i}.`, accuracy: 40 })),
  { word: "word0", accuracy: 30 }, // the same word again (case and punctuation ignored): counted once
  { word: "sun", errorType: "Mispronunciation", accuracy: 90 },
  { word: "clear", accuracy: 95 },
] }] }];

test("a new check reports the full flagged-word count beside the capped saved list", () => {
  const summary = summarizePronunciationParts(parts);
  assert.equal(summary.wordsToPractice.length, 10, "the saved list is still capped");
  assert.equal(summary.practiceWordCount, 14, "13 low-accuracy words + 1 mispronunciation; repeats and clear words excluded");
});

test("a saved check (and every reopening) reads the same full count from its saved parts; old rows stay valid", () => {
  const row = { completed_at: "2026-11-22T00:00:00Z", part_count: 1, utterance_count: 1, accuracy: 70, fluency: 60,
    words_to_practice: summarizePronunciationParts(parts).wordsToPractice, assessed_seconds: 10, complete: true, unassessed_seconds: 0, parts };
  assert.equal(toCheckDto(row).summary.practiceWordCount, 14);
  // A row without saved parts: never fewer than the saved list.
  assert.equal(toCheckDto({ ...row, parts: null }).summary.practiceWordCount, 10);
  assert.equal(toCheckDto({ ...row, parts: null, words_to_practice: [] }).summary.practiceWordCount, 0);
});
