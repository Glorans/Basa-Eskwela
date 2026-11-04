// Placing saved pronunciation-check words in the story (repeated words, coverage).
// Pure function over saved parts; no database, no speech service.
const test = require("node:test");
const assert = require("node:assert/strict");
const { storyPlacement, toCheckDto, getSavedPronunciationCheck } = require("../services/pronunciationCheckService");

// Modelled on the reviewed reading: "Santos" appears twice; only the first was
// flagged; "In return," was never scored by the assessment.
const PASSAGE = "A Helping Hand\nEvery Saturday, Ben visited Mrs. Santos, an elderly neighbor. Her hands were weak. In return, Mrs. Santos told him stories.";
const attempt = { id: "a", language: "en", passageSnapshot: PASSAGE, passageTitle: "A Helping Hand" };
const w = (word, accuracy = 95, errorType = "None") => ({ word, accuracy, errorType });
const parts = [{ utterances: [
  { words: [w("Every"), w("Saturday")] },
  { words: [w("Ben"), w("visited"), w("Mrs."), w("Santos", 26, "Mispronunciation")] },
  { words: [w("an"), w("elderly"), w("neighbor")] },
  { words: [w("Her"), w("hands"), w("were", 23, "Mispronunciation"), w("weak")] },
  { words: [w("Mrs."), w("Santos", 91), w("told"), w("him"), w("stories")] },
] }];

test("a repeated word is placed at the occurrence that was flagged, not the first one", () => {
  const placement = storyPlacement(parts, attempt, ["santos", "were"]);
  // Story body (title hidden): every saturday ben visited mrs santos an elderly neighbor her hands were weak in return mrs santos told him stories
  assert.deepEqual(placement.practiceOccurrences, [
    { word: "santos", storyWordIndex: 5 },
    { word: "were", storyWordIndex: 11 },
  ]);
  // If only the SECOND Santos had been flagged, the second one is marked.
  const second = structuredClone(parts);
  second[0].utterances[1].words[3] = w("Santos", 91);
  second[0].utterances[4].words[1] = w("Santos", 30, "Mispronunciation");
  assert.deepEqual(storyPlacement(second, attempt, ["santos"]).practiceOccurrences, [{ word: "santos", storyWordIndex: 16 }]);
});

test("coverage counts story words the assessment never scored", () => {
  const placement = storyPlacement(parts, attempt, ["santos", "were"]);
  assert.equal(placement.storyWords, 20);
  assert.equal(placement.assessedStoryWords, 18, '"in return" was never scored');
});

test("a flagged word that does not line up exactly with the story is not placed", () => {
  const heardDifferently = [{ utterances: [{ words: [w("Every"), w("Saturday"), w("Ben"), w("visited"), w("Mrs."), w("Sampson", 20, "Mispronunciation")] }] }];
  const placement = storyPlacement(heardDifferently, attempt, ["sampson"]);
  assert.deepEqual(placement.practiceOccurrences, []);
  assert.equal(placement.assessedStoryWords, 5);
  // Words outside the saved practice list are never added.
  assert.deepEqual(storyPlacement(parts, attempt, ["were"]).practiceOccurrences, [{ word: "were", storyWordIndex: 11 }]);
  assert.equal(storyPlacement(parts, { ...attempt, passageSnapshot: "" }, ["santos"]), null);
  assert.equal(storyPlacement(undefined, attempt, ["santos"]), null);
});

test("the read endpoints add placement to the saved summary without changing it", async () => {
  const row = { status: "completed", completed_at: "2026-11-05T00:00:00Z", part_count: 1, utterance_count: 5, accuracy: 95, fluency: 97,
    words_to_practice: ["santos", "were"], assessed_seconds: 45, complete: true, unassessed_seconds: 0, parts };
  const frozen = JSON.stringify(row);
  const dto = toCheckDto(row, attempt);
  assert.deepEqual([dto.summary.accuracy, dto.summary.fluency, dto.summary.complete, dto.summary.wordsToPractice], [95, 97, true, ["santos", "were"]]);
  assert.equal(dto.summary.assessedStoryWords, 18);
  assert.equal(JSON.stringify(row), frozen, "the saved row is not modified");
  assert.equal(dto.summary.parts, 1, "summary.parts is the part count; raw parts are never sent");
  assert.doesNotMatch(JSON.stringify(dto), /"utterances":\[|errorType/);
  assert.doesNotMatch(JSON.stringify(dto), /azure|microsoft/i);
  // Without the attempt, the summary is unchanged from before.
  assert.equal("storyWords" in toCheckDto(row).summary, false);
  const supabase = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }) };
  const saved = await getSavedPronunciationCheck(supabase, attempt);
  assert.deepEqual(saved.check.summary.practiceOccurrences, [{ word: "santos", storyWordIndex: 5 }, { word: "were", storyWordIndex: 11 }]);
});
