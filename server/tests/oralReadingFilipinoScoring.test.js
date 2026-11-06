// M5 Filipino reading scores. Pure scoring; no database, no speech service.
const test = require("node:test");
const assert = require("node:assert/strict");
const { getReadingWords, scorePassage } = require("../services/oralReadingScoring");

const types = (metrics) => metrics.reduce((counts, metric) => ({ ...counts, [metric.type]: (counts[metric.type] ?? 0) + 1 }), {});
const nonMatches = (metrics) => metrics.filter((metric) => metric.type !== "match").map((metric) => [metric.type, metric.expected, metric.actual]);
/** The saved formula, unchanged: (expected words - all differences) / expected words. */
function result(story, heard, language = "fil", title = "", durationSeconds = 60) {
  const { expectedWords, spokenWords, wordMetrics } = scorePassage(story, heard, language, title);
  const errors = wordMetrics.filter((metric) => metric.type !== "match").length;
  return {
    wordMetrics, errors, expected: expectedWords.length,
    matched: wordMetrics.filter((metric) => metric.type === "match").length,
    accuracy: Math.min(100, Math.max(0, ((expectedWords.length - errors) / expectedWords.length) * 100)),
    wpm: (spokenWords.length / durationSeconds) * 60,
  };
}

// The reviewed reading: same story and recognizer output as the saved attempt.
const GRIPO = `May gripo sa plasa ng barangay nina Ella. Doon umiinom at
naghuhugas ng kamay ang mga tao. Isang hapon, nakita ni Ella
na bukas ang gripo at walang tao. Tumutulo ang tubig sa lupa.
Agad niyang isinara ang gripo. Napansin din niya na may butas
ang tubo. Pumunta siya sa barangay hall at sinabi ito kay Kapitan.
Kinabukasan, naayos na ang tubo. "Salamat, Ella," sabi ni
Kapitan. "Dapat alagaan natin ang tubig ng lahat."`;
const GRIPO_HEARD = "My grate po sa grasya ng Barangay Nina Ella doon umiinom at naghuhugas ng kamay ang mga tao. 1 hapon nakita ni Ella na bukas ang gripo at walang tao tumutulo ang tubig sa lupa agad niyang isinara ang gripo. Napansin din niyang Na may butas ang tubo. Pumunta siya sa barangay hall at sinabi ito kay Kapitan. Kinabukasan naayos na ang tubo. Salamat, Ela, sabi ni Kapitan. Dapat alagaan natin ang tubig mga lahat.";

test("the reviewed reading: only the digit for 'Isang' stops counting; every other difference is kept", () => {
  const scored = result(GRIPO, GRIPO_HEARD, "fil", "Ang Gripo sa Plasa", 39.93);
  assert.equal(scored.expected, 74);
  assert.equal(scored.matched, 68, "was 67: 'isang' heard as '1' now matches");
  assert.equal(scored.errors, 7, "was 8");
  assert.equal(scored.accuracy.toFixed(2), "90.54", "(74 - 7) / 74, the formula is unchanged");
  assert.equal(Math.round(scored.wpm), 113, "speed is unchanged: 75 spoken words in about 40 seconds");
  assert.deepEqual(nonMatches(scored.wordMetrics), [
    ["insertion", null, "my"], ["substitution", "may", "grate"], ["substitution", "gripo", "po"], ["substitution", "plasa", "grasya"],
    ["substitution", "niya", "niyang"], ["substitution", "ella", "ela"], ["substitution", "ng", "mga"],
  ]);
  // The spoken word stays as recognized, so F5 can line up with the saved transcript.
  assert.deepEqual(scored.wordMetrics.find((metric) => metric.expected === "isang"), { expected: "isang", actual: "1", type: "match" });
});

test("number words match their digit, in both directions and in both written forms", () => {
  for (const [word, digit] of [["isa", "1"], ["isang", "1"], ["dalawa", "2"], ["dalawang", "2"], ["tatlo", "3"], ["tatlong", "3"], ["apat", "4"],
    ["lima", "5"], ["limang", "5"], ["anim", "6"], ["pito", "7"], ["pitong", "7"], ["walo", "8"], ["walong", "8"], ["siyam", "9"], ["sampu", "10"], ["sampung", "10"]]) {
    assert.deepEqual(types(scorePassage(`${word} bata`, `${digit} bata`, "fil").wordMetrics), { match: 2 }, `story ${word}, heard ${digit}`);
    assert.deepEqual(types(scorePassage(`${digit} bata`, `${word} bata`, "fil").wordMetrics), { match: 2 }, `story ${digit}, heard ${word}`);
  }
});

test("genuinely different numbers and words are never accepted", () => {
  for (const [story, heard, expectedDifference] of [
    ["isang bata", "2 bata", ["substitution", "isang", "2"]],
    ["dalawang bata", "1 bata", ["substitution", "dalawang", "1"]],
    ["isang bata", "11 bata", ["substitution", "isang", "11"]],
    ["labing isang bata", "11 bata", null],
    ["aso bata", "1 bata", ["substitution", "aso", "1"]],
    ["isang bata", "isa bata", ["substitution", "isang", "isa"]],
  ]) {
    const differences = nonMatches(scorePassage(story, heard, "fil").wordMetrics);
    if (expectedDifference) assert.deepEqual(differences, [expectedDifference], `${story} / ${heard}`);
    else assert.ok(differences.length > 0, `${story} / ${heard}`);
  }
  // A digit with no number to pair with is an extra word.
  assert.deepEqual(nonMatches(scorePassage("ang bata", "ang 1 bata", "fil").wordMetrics), [["insertion", null, "1"]]);
  // A number word that was skipped is still skipped.
  assert.deepEqual(nonMatches(scorePassage("isang bata", "bata", "fil").wordMetrics), [["omission", "isang", null]]);
});

test("a digit pairs with its own number word when the recognizer drops a linker (real Azure, both voices)", () => {
  // "siyam na kalabaw" came back as "9 kalabaw". The number is right; only "na" was not heard.
  assert.deepEqual(nonMatches(scorePassage("siyam na kalabaw sa bukid", "9 kalabaw sa bukid", "fil").wordMetrics), [["omission", "na", null]]);
  const heard = scorePassage("May isang bata, dalawang aso, tatlong pusa, apat na ibon, limang isda, anim na manok, pitong kambing, walong baka, siyam na kalabaw, at sampung kabayo sa bukid.",
    "May 1 bata, 2 aso, 3 pusa, 4 na ibon, 5 isda, 6 na manok, 7 kambing, 8 baka, 9 kalabaw at 10 kabayo sa bukid.", "fil").wordMetrics;
  assert.deepEqual(nonMatches(heard), [["omission", "na", null]], "every number matches");
  assert.deepEqual(heard.find((metric) => metric.expected === "siyam"), { expected: "siyam", actual: "9", type: "match" }, "the spoken word stays as recognized");
  // A wrong number never wins the alignment, even when it would be cheaper to accept.
  assert.deepEqual(nonMatches(scorePassage("May tatlong aso at limang pusa", "May 4 na aso at 6 na pusa", "fil").wordMetrics).filter(([type]) => type === "match"), []);
  assert.ok(nonMatches(scorePassage("May tatlong aso", "May 4 aso", "fil").wordMetrics).some(([, expected, actual]) => expected === "tatlong" && actual === "4"));
  assert.deepEqual(nonMatches(scorePassage("isa dalawa tatlo", "2 1 3", "fil").wordMetrics).length, 2, "numbers in the wrong places are differences");
});

test("the pronunciation check's alignment stays exact: two-argument alignWords never pairs digits", () => {
  const { alignWords } = require("../services/oralReadingScoring");
  assert.deepEqual(alignWords(["isang", "bata"], ["1", "bata"]).map((entry) => entry.type), ["substitution", "match"]);
  assert.deepEqual(alignWords(["isang", "bata"], ["1", "bata"], "en").map((entry) => entry.type), ["substitution", "match"]);
});

test("punctuation and capitalization are not reading differences", () => {
  const scored = result("May GRIPO, sa plasa! \"Salamat, Ella.\"", "may gripo sa Plasa salamat ELLA");
  assert.deepEqual(types(scored.wordMetrics), { match: 6 });
  assert.equal(scored.accuracy, 100);
});

test("substitutions, skipped words, extra words and repeated words are all still counted", () => {
  assert.deepEqual(nonMatches(scorePassage("ang aso ay mabait", "ang pusa ay mabait", "fil").wordMetrics), [["substitution", "aso", "pusa"]]);
  assert.deepEqual(nonMatches(scorePassage("ang malaking aso", "ang aso", "fil").wordMetrics), [["omission", "malaking", null]]);
  // A repeated word: only the occurrence that was heard differently is marked.
  const repeated = scorePassage("si Ella at si Ella", "si ella at si ela", "fil").wordMetrics;
  assert.deepEqual(nonMatches(repeated), [["substitution", "ella", "ela"]]);
  assert.equal(repeated.findIndex((metric) => metric.type !== "match"), 4);
  // An extra word is a difference without taking away a match, so the percent can sit below matched / expected.
  const extra = result("ang aso ay mabait", "ang malaking aso ay mabait");
  assert.deepEqual(nonMatches(extra.wordMetrics), [["insertion", null, "malaking"]]);
  assert.deepEqual([extra.matched, extra.expected, extra.errors, extra.accuracy], [4, 4, 1, 75]);
});

test("Filipino proper names are never fuzzy-matched", () => {
  assert.deepEqual(nonMatches(scorePassage("Si Ella at Kapitan", "si ela at kapitan", "fil").wordMetrics), [["substitution", "ella", "ela"]]);
  assert.deepEqual(nonMatches(scorePassage("Si Mang Tonyo", "si magtonio", "fil").wordMetrics).map(([type]) => type).sort(), ["omission", "substitution"]);
});

test("a hidden title stays optional for Filipino, with numbers handled the same way", () => {
  const story = "Ang Gripo sa Plasa\nIsang hapon nakita ni Ella ang gripo.";
  for (const heard of ["1 hapon nakita ni Ella ang gripo", "Ang Gripo sa Plasa 1 hapon nakita ni Ella ang gripo"]) {
    assert.deepEqual(types(scorePassage(story, heard, "fil", "Ang Gripo sa Plasa").wordMetrics), { match: 7 }, heard);
  }
});

test("English scoring is unchanged: Filipino number words and digits stay differences", () => {
  // Santos, as saved: the recognizer's name mistake is one substitution.
  const santos = result("Every Saturday, Ben visited Mrs. Santos. In return, Mrs. Santos told him stories.",
    "Every Saturday Ben visited Mrs. Sampson's in return Mrs. Santos told him stories", "en");
  assert.deepEqual(nonMatches(santos.wordMetrics), [["substitution", "santos", "sampsons"]]);
  // The English rules still apply only to English.
  assert.deepEqual(types(scorePassage("one dog", "1 dog", "en").wordMetrics), { match: 2 });
  assert.deepEqual(types(scorePassage("Mrs. Santos", "Missus Santos", "en").wordMetrics), { match: 2 });
  for (const [story, heard] of [["isang bata", "1 bata"], ["2 dogs", "dalawa dogs"], ["sampu bata", "10 bata"]]) {
    assert.equal(types(scorePassage(story, heard, "en").wordMetrics).substitution, 1, `${story} / ${heard} in English`);
  }
  assert.equal(types(scorePassage("one dog", "1 dog", "fil").wordMetrics).substitution, 1, "the English 1 = one rule is not used for Filipino");
  assert.deepEqual(getReadingWords("Isang hapon, 1 tao!", "fil"), ["isang", "hapon", "1", "tao"], "normalization itself is unchanged");
});
