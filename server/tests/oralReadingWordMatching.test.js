const assert = require("node:assert/strict");
const test = require("node:test");
const { getReadingWords, scorePassage } = require("../services/oralReadingScoring");

// Synthetic transcripts in the forms Azure produced for "A Helping Hand".
const TITLE = "A Helping Hand";
const PASSAGE = `${TITLE}
Every Saturday, Ben visited Mrs. Santos, an elderly neighbor who
lived alone. In return, Mrs. Santos told him wonderful stories.`;
const misses = (transcript) => scorePassage(PASSAGE, transcript, "en", TITLE).wordMetrics.filter((word) => word.type !== "match");

test("a title Azure writes as the spoken word is the same word", () => {
  assert.deepEqual(getReadingWords("Mrs. Santos and Mr. Cruz", "en"), ["mrs", "santos", "and", "mr", "cruz"]);
  assert.deepEqual(getReadingWords("Missus Santos and Mister Cruz", "en"), ["mrs", "santos", "and", "mr", "cruz"]);
  assert.deepEqual(getReadingWords("Missis Santos", "en"), ["mrs", "santos"]);
  // Real words with other meanings are not rewritten.
  assert.deepEqual(getReadingWords("She misses Miss Santos", "en"), ["she", "misses", "miss", "santos"]);
  // English only.
  assert.deepEqual(getReadingWords("Missus", "fil"), ["missus"]);
});

test("Every, Mrs. and Santos match when they are in the transcript in any form Azure writes", () => {
  assert.deepEqual(misses("Every Saturday, Ben visited Mrs. Santos, an elderly neighbor who lived alone. In return, Missus Santos told him wonderful stories."), []);
  // "Mrs. Santos" written as one token is two words that were both said.
  assert.deepEqual(misses("Every Saturday, Ben visited Mississantos, an elderly neighbor who lived alone. In return, Missussantos told him wonderful stories."), []);
});

test("recognition differences are still reported, not forgiven", () => {
  // The first word missing from the transcript stays not detected; a misheard name stays read differently.
  assert.deepEqual(misses("Saturday, Ben visited Mississantos, an elderly neighbor who lived alone. In return, Missus Sandcost told him wonderful stories."), [
    { expected: "every", actual: null, type: "omission" },
    { expected: "santos", actual: "sandcost", type: "substitution" },
  ]);
  // A title the reader really left out is still missing.
  assert.deepEqual(misses("Every Saturday, Ben visited Santos, an elderly neighbor who lived alone. In return, Mrs. Santos told him wonderful stories."),
    [{ expected: "mrs", actual: null, type: "omission" }]);
  // "Miss Santos" is a different title, not "Mrs. Santos".
  assert.deepEqual(misses("Every Saturday, Ben visited Miss Santos, an elderly neighbor who lived alone. In return, Mrs. Santos told him wonderful stories."),
    [{ expected: "mrs", actual: "miss", type: "substitution" }]);
});

test("joined tokens are split only into consecutive passage words, never guessed", () => {
  const score = (passage, transcript) => scorePassage(passage, transcript, "en").wordMetrics.filter((word) => word.type !== "match");
  // "Mississippi" is not "Mrs." plus a passage word, so it stays one wrong word.
  assert.deepEqual(score("Mrs. Santos sat.", "Mississippi sat"), [
    { expected: "mrs", actual: null, type: "omission" },
    { expected: "santos", actual: "mississippi", type: "substitution" },
  ]);
  // Words that are not next to each other in the passage are not joined.
  assert.deepEqual(score("Santos met Mrs. Cruz.", "Mrssantos met Mrs Cruz"), [
    { expected: "santos", actual: "mrssantos", type: "substitution" },
  ]);
  // A token that is itself a passage word is never split.
  assert.deepEqual(score("Every day is a good everyday story.", "every day is a good everyday story"), []);
  // An ordinary compound of two consecutive passage words was said in full.
  assert.deepEqual(score("We play every day.", "We play everyday"), []);
});

test("repeated words and proper names align in order without extra credit", () => {
  const passage = "Mrs. Santos and Mrs. Cruz met Mrs. Santos again.";
  assert.deepEqual(scorePassage(passage, "Missus Santos and Missis Cruz met Mississantos again", "en").wordMetrics
    .filter((word) => word.type !== "match"), []);
  const skipped = scorePassage(passage, "Missus Santos and Cruz met Mrs. Santos again", "en").wordMetrics.filter((word) => word.type !== "match");
  assert.deepEqual(skipped, [{ expected: "mrs", actual: null, type: "omission" }]);
  // Splitting never adds matches beyond the passage's own words.
  const extra = scorePassage(passage, "Mississantos Mississantos and Mrs Cruz met Mrs Santos again", "en");
  assert.equal(extra.wordMetrics.filter((word) => word.type === "match").length, extra.expectedWords.length);
  assert.equal(extra.wordMetrics.filter((word) => word.type === "insertion").length, 2, "the repeated name is extra speech");
});

test("the accuracy formula is unchanged: only the transcript's real words are credited", () => {
  const exact = scorePassage(PASSAGE, "Every Saturday Ben visited Mrs Santos an elderly neighbor who lived alone In return Mrs Santos told him wonderful stories", "en", TITLE);
  const joined = scorePassage(PASSAGE, "Every Saturday Ben visited Mississantos an elderly neighbor who lived alone In return Missus Santos told him wonderful stories", "en", TITLE);
  assert.deepEqual(joined.wordMetrics, exact.wordMetrics);
  // Reading speed counts the two words that were said, as for the exact transcript.
  assert.equal(joined.spokenWords.length, exact.spokenWords.length);
});
