// How Filipino results from the real server scorer appear in F5 and F6. No network; no speech service.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { markStory, markTranscript } from "../src/modules/module5/services/resultWords.ts";
import { getActivityText } from "../src/pages/reading-activity/activityLanguage.ts";

const require = createRequire(import.meta.url);
const { scorePassage } = require("../../server/services/oralReadingScoring");

const STORY = "Isang hapon, nakita ni Ella ang gripo. Agad niyang isinara ang gripo.";
const HEARD = "1 hapon nakita ni Ela ang gripo agad isinara ang gripo";
const metrics = () => scorePassage(STORY, HEARD, "fil", "").wordMetrics;

test("F5: the recognizer's digit for a story number is not orange; real differences and skipped words still are", () => {
  const heard = markTranscript(HEARD, metrics(), "fil");
  assert.equal(heard.reliable, true, "the saved spoken word stays '1', so it lines up with the transcript");
  assert.deepEqual(heard.pieces.filter((piece) => piece.differs).map((piece) => [piece.text, piece.expected]), [["Ela", ["ella"]]]);
  const story = markStory(STORY, "", "fil", metrics());
  assert.ok(story);
  assert.deepEqual(story.flat().filter((piece) => piece.skipped).map((piece) => piece.text), ["niyang"]);
});

test("a saved reading scored before the fix keeps its saved result, with '1' shown as different", () => {
  const saved = metrics().map((metric: { expected: string; actual: string; type: string }) => (metric.actual === "1" ? { ...metric, type: "substitution" } : metric));
  const heard = markTranscript(HEARD, saved, "fil");
  assert.deepEqual(heard.pieces.filter((piece) => piece.differs).map((piece) => [piece.text, piece.expected]), [["1", ["isang"]], ["Ela", ["ella"]]]);
  assert.equal(saved.filter((metric: { type: string }) => metric.type === "match").length, metrics().filter((metric: { type: string }) => metric.type === "match").length - 1);
});

test("F5 and F6 keep their Filipino wording and the computer-can-be-wrong note", () => {
  const fil = getActivityText("fil");
  for (const key of ["The Story", "What We Heard", "Orange words are different from the story.", "Tap an orange word to compare it with the story.",
    "Words Matched", "Reading Speed", "Sometimes the computer can make mistakes when listening."] as const) {
    assert.notEqual(fil.t(key), key, key);
  }
});
