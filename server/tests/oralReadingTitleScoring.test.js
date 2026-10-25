const assert = require("node:assert/strict");
const test = require("node:test");
const { scorePassage, splitEmbeddedTitle } = require("../services/oralReadingScoring");
const { buildAttemptInsert } = require("../services/oralReadingAttemptService");

const TITLE = "A Helping Hand";
const PASSAGE = `${TITLE}\nEvery Saturday, Lia helps her lola sweep.`;
const errors = (scoring) => scoring.wordMetrics.filter((word) => word.type !== "match");

test("an embedded title line is split off by the same rules as the story display", () => {
  assert.deepEqual(splitEmbeddedTitle(PASSAGE, TITLE), { title: TITLE, body: "Every Saturday, Lia helps her lola sweep." });
  // Case and punctuation differences still match the shown title.
  assert.equal(splitEmbeddedTitle("A HELPING HAND!\nLia sweeps.", TITLE).title, "A HELPING HAND!");
  // Title extracted on the same line as the first sentence.
  assert.deepEqual(splitEmbeddedTitle(`${TITLE} Every Saturday, Lia sweeps.`, TITLE),
    { title: TITLE, body: "Every Saturday, Lia sweeps." });
  // A first sentence that merely starts with the title words, in lower case, is story text.
  assert.equal(splitEmbeddedTitle(`${TITLE} is what Lia gives.`, TITLE).title, null);
  // No embedded title, no title, or a passage that is only the title: unchanged.
  for (const [passage, title] of [["Every Saturday, Lia sweeps.", TITLE], [PASSAGE, ""], [TITLE, TITLE]]) {
    assert.deepEqual(splitEmbeddedTitle(passage, title), { title: null, body: passage });
  }
});

test("skipping a hidden embedded title creates no omissions", () => {
  const scoring = scorePassage(PASSAGE, "Every Saturday Lia helps her lola sweep", "en", TITLE);
  assert.equal(scoring.expectedWords.length, 7);
  assert.deepEqual(errors(scoring), []);
  assert.ok(!scoring.wordMetrics.some((word) => ["a", "helping", "hand"].includes(word.expected)));
});

test("reading a hidden embedded title aloud creates no insertions", () => {
  const scoring = scorePassage(PASSAGE, "A helping hand. Every Saturday Lia helps her lola sweep", "en", TITLE);
  assert.deepEqual(errors(scoring), []);
  assert.equal(scoring.wordMetrics.length, 7);
  // Misheard title words are not graded either.
  assert.deepEqual(errors(scorePassage(PASSAGE, "a helping and every saturday lia helps her lola sweep", "en", TITLE)), []);
});

test("real body omissions and substitutions are still classified", () => {
  // The body is aligned exactly as it would be on its own (same tie-breaking).
  const body = "Every Saturday, Lia helps her lola sweep.";
  const scoring = scorePassage(PASSAGE, "A helping hand every Saturday Lia help lola sweep", "en", TITLE);
  assert.deepEqual(scoring.wordMetrics, scorePassage(body, "every Saturday Lia help lola sweep", "en").wordMetrics);
  assert.deepEqual(errors(scoring).map((word) => word.type).sort(), ["omission", "substitution"]);
  const skipped = scorePassage(PASSAGE, "every saturday lia helps her sweep", "en", TITLE);
  assert.deepEqual(errors(skipped), [{ expected: "lola", actual: null, type: "omission" }]);
});

test("passages without an embedded title are scored exactly as before", () => {
  const body = "Every Saturday, Lia helps her lola sweep.";
  for (const transcript of ["Every Saturday Lia helps her lola sweep", "A helping hand every Saturday Lia helps her lola sweep", "every lia help sweep"]) {
    assert.deepEqual(scorePassage(body, transcript, "en", TITLE), scorePassage(body, transcript, "en"));
  }
  // The header title read aloud before a plain passage remains extra speech, as before.
  assert.equal(errors(scorePassage(body, "A helping hand every Saturday Lia helps her lola sweep", "en", TITLE)).length, 3);
});

test("a title whose words also start the story never removes story words", () => {
  const scoring = scorePassage("Run\n\nRun, Tom, run!", "run tom run", "en", "Run");
  assert.equal(scoring.expectedWords.length, 3);
  assert.deepEqual(errors(scoring), []);
  assert.deepEqual(errors(scorePassage("Run\n\nRun, Tom, run!", "tom run", "en", "Run")),
    [{ expected: "run", actual: null, type: "omission" }]);
});

test("Filipino passages with an embedded title use the same rule", () => {
  const passage = "Ang Mabait na Bata\nTumutulong si Lia sa kanyang lola.";
  const title = "Ang Mabait na Bata";
  assert.deepEqual(errors(scorePassage(passage, "tumutulong si lia sa kanyang lola", "fil", title)), []);
  assert.deepEqual(errors(scorePassage(passage, "ang mabait na bata tumutulong si lia sa kanyang lola", "fil", title)), []);
  assert.deepEqual(errors(scorePassage(passage, "tumutulong si lia sa lola", "fil", title)),
    [{ expected: "kanyang", actual: null, type: "omission" }]);
});

test("the saved score uses the title shown on screen and keeps the full passage snapshot", () => {
  const module = { id: "module", title: "Module", passageTitle: TITLE, passage: PASSAGE, language: "en" };
  const insert = buildAttemptInsert({ user: { id: "user" } }, module,
    { transcript: "Every Saturday Lia helps her lola sweep", durationSeconds: 30 });
  assert.equal(insert.pronunciation_accuracy, 100);
  assert.equal(insert.expected_word_count, 7);
  assert.equal(insert.detected_error_count, 0);
  assert.equal(insert.passage_snapshot, PASSAGE);
  assert.equal(insert.reading_speed_wpm, 14);
  // An assigned material without a separate passage title falls back to its title.
  const material = buildAttemptInsert({ user: { id: "user" } }, { ...module, passageTitle: undefined, title: TITLE },
    { transcript: "Every Saturday Lia helps her lola sweep", durationSeconds: 30 });
  assert.equal(material.detected_error_count, 0);
});
