import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getActivityText } from "../src/pages/reading-activity/activityLanguage.ts";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("reading feedback says a word was not detected rather than that the learner skipped it", () => {
  const result = source("pages/reading-activity/ReadingResultPage.tsx");
  assert.doesNotMatch(result, /t\("skipped"\)|"Skipped"|sounded different|read it very clearly/);
  assert.match(result, /t\("not detected"\)/);
  assert.match(result, /t\("read differently"\)/);
  assert.match(result, /Speech recognition can make mistakes, so this is not always a reading or pronunciation mistake\./);
  // Reading Accuracy and the English pronunciation check stay separate measurements.
  assert.match(result, /t\("Reading Accuracy"\)/);
  assert.match(result, /<PronunciationFeedback /);
});

test("new feedback wording has Filipino equivalents", () => {
  const fil = getActivityText("fil");
  for (const text of [
    "not detected",
    "read differently",
    "Wow, we heard almost every word of the story!",
    "Highlighted words did not match the story. Speech recognition can make mistakes.",
    "\"Not detected\" means we did not hear the word in your reading. You may have skipped it, or the recording may have missed it. \"Read differently\" means we heard another word. Speech recognition can make mistakes, so this is not always a reading or pronunciation mistake.",
  ] as const) assert.notEqual(fil.t(text), text, text);
  assert.equal(fil.t("not detected"), "hindi narinig");
  assert.equal(getActivityText("en").t("not detected"), "not detected");
});

test("the pronunciation check never claims every word of the story was pronounced correctly", () => {
  const feedback = source("modules/module5/components/PronunciationFeedback.tsx");
  assert.doesNotMatch(feedback, /Every word/);
  assert.match(feedback, /The words we checked sounded clear\./);
  assert.match(feedback, /it can make mistakes/);
});

test("every read-aloud processing and saving step has a Filipino status", () => {
  const fil = getActivityText("fil");
  for (const text of ["Preparing your recording...", "Sending your recording...", "Processing your reading...",
    "Saving your result...", "Saving your recording...", "Speech processing timed out. Please try again.",
    "The connection is too slow right now. Please check your internet and try again."] as const) {
    assert.notEqual(fil.message(text, "Unable to load activity."), text, text);
    assert.notEqual(fil.message(text, "Unable to load activity."), fil.t("Unable to load activity."), text);
  }
});

test("the pronunciation card says when only part of the speech was checked", () => {
  const feedback = source("modules/module5/components/PronunciationFeedback.tsx");
  assert.match(feedback, /summary\.complete === false \?/);
  assert.match(feedback, /could\s+not be checked/);
  assert.match(feedback, /These results cover\s+only the/);
  // "Checked your whole recording" appears only on the complete branch.
  const partialBranch = feedback.slice(feedback.indexOf("summary.complete === false ? ("), feedback.indexOf(") : (", feedback.indexOf("summary.complete === false ? (")));
  assert.doesNotMatch(partialBranch, /whole recording/);
});
