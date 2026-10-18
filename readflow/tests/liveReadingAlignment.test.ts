import assert from "node:assert/strict";
import test from "node:test";
import { getDiagnosticPracticeWords } from "../src/modules/module2/utils/diagnosticDisplay.ts";
import { processDiagnosticRecording } from "../src/modules/module2/services/diagnosticRecording.ts";
import { DiagnosticStreamingTranscript } from "../src/modules/module2/services/diagnosticStreamingTranscript.ts";
import {
  LiveReadingTracker,
  alignLiveReadingWords,
  tokenizePassageParagraphs,
} from "../src/modules/module2/services/liveReadingAlignment.ts";

test("tokenizes words while preserving punctuation, spacing, and paragraphs", () => {
  const paragraphs = [
    '"Hello, Mr. Frog!"',
    "I'm well-known.",
  ];
  const tokenized = tokenizePassageParagraphs(paragraphs);

  assert.equal(
    tokenized[0].map((token) => token.text).join(""),
    paragraphs[0],
  );
  assert.equal(
    tokenized[1].map((token) => token.text).join(""),
    paragraphs[1],
  );
  assert.deepEqual(
    tokenized.flatMap((paragraph) =>
      paragraph
        .filter((token) => token.type === "word")
        .map((token) => [token.text, token.normalized, token.wordIndex]),
    ),
    [
      ["Hello", "hello", 0],
      ["Mr", "mr", 1],
      ["Frog", "frog", 2],
      ["I'm", "im", 3],
      ["well", "well", 4],
      ["known", "known", 5],
    ],
  );
});

test("aligns a partial live transcript to the passage prefix", () => {
  assert.deepEqual(
    alignLiveReadingWords(
      "One day, a frog sat on a lily pad.",
      "one day a frog",
    ),
    {
      matchedWordIndexes: [0, 1, 2, 3],
      currentWordIndex: 3,
    },
  );
});

test("does not highlight arbitrary repeated-word occurrences", () => {
  assert.deepEqual(
    alignLiveReadingWords(
      "the frog saw the fish and the frog smiled",
      "the frog saw the fish",
    ),
    {
      matchedWordIndexes: [0, 1, 2, 3, 4],
      currentWordIndex: 4,
    },
  );
});

test("keeps correct live words highlighted around a recognition mismatch", () => {
  assert.deepEqual(
    alignLiveReadingWords(
      "the quick brown frog jumped",
      "the quick blue frog",
    ),
    {
      matchedWordIndexes: [0, 1, 3],
      currentWordIndex: 3,
    },
  );
});

test("uses diagnostic normalization for punctuation and Filipino words", () => {
  assert.deepEqual(
    alignLiveReadingWords(
      "Ako ay nag-aaral sa paaralan.",
      "ako ay nag aaral sa paaralan",
    ),
    {
      matchedWordIndexes: [0, 1, 2, 3, 4, 5],
      currentWordIndex: 5,
    },
  );
});

test("returns no live highlight before speech is recognized", () => {
  assert.deepEqual(alignLiveReadingWords("one two", ""), {
    matchedWordIndexes: [],
    currentWordIndex: null,
  });
});

for (const [label, spoken, recognized, bridged] of [
  ["exact", "one day a frog sat on a lily pad", [0,1,2,3,4,5,6,7,8], []],
  ["one omission", "one day frog sat on a lily pad", [0,1,3,4,5,6,7,8], [2]],
  ["two omissions", "one day frog sat on lily pad", [0,1,3,4,5,7,8], [2,6]],
  ["insertion", "one day um a frog sat", [0,1,2,3,4], []],
  ["substitution", "one day the frog sat", [0,1,3,4], [2]],
  ["repetition", "one one day a frog frog sat", [0,1,2,3,4], []],
] as const) {
  test(`bounded alignment handles ${label} without recognizing bridged words`, () => {
    const result = new LiveReadingTracker("one day a frog sat on a lily pad").update(spoken);
    assert.deepEqual(result.recognizedWordIndexes, recognized);
    assert.deepEqual(result.bridgedVisualWordIndexes, bridged);
    assert.ok(result.bridgedVisualWordIndexes.every(index => !result.recognizedWordIndexes.includes(index)));
  });
}
test("interim revision and stale finals cannot move confirmed or preview progress backward", () => {
  const tracker = new LiveReadingTracker("one day a frog sat on a lily pad");
  const first = tracker.update("one day", "a frog sat");
  const revision = tracker.update("one day", "a frog");
  assert.equal(revision.confirmedCursor, 1);
  assert.equal(revision.previewCursor, first.previewCursor);
  assert.deepEqual(revision.recognizedWordIndexes, [0,1]);
  tracker.update("one day a frog");
  assert.equal(tracker.update("one").confirmedCursor, 3);
  tracker.reset();
  assert.equal(tracker.update("").confirmedCursor, -1);
});
test("matching remains local and normalizes quote variants", () => {
  assert.equal(new LiveReadingTracker("one two three four five six seven far").update("far").confirmedCursor, -1);
  assert.deepEqual(new LiveReadingTracker("\u201cI\u2019m HERE!\u201d").update("i'm here").recognizedWordIndexes, [0,1]);
});

test("interim matches persist as the learner advances, revises speech, and receives finals", () => {
  const tracker = new LiveReadingTracker("one day a frog sat");
  assert.deepEqual(tracker.update("", "one").visualReadWordIndexes, [0]);
  assert.deepEqual(tracker.update("", "one day a frog").visualReadWordIndexes, [0,1,2,3]);
  const revised = tracker.update("", "one day");
  assert.deepEqual(revised.visualReadWordIndexes, [0,1,2,3]);
  assert.deepEqual(revised.recognizedWordIndexes, []);
  assert.deepEqual(tracker.update("one day", "frog sat").visualReadWordIndexes, [0,1,2,3,4]);
  const final = tracker.update("one day frog sat");
  assert.deepEqual(final.visualReadWordIndexes, [0,1,2,3,4]);
  assert.deepEqual(final.recognizedWordIndexes, [0,1,3,4]);
});

test("bridged-only words never enter the visual trail", () => {
  const tracker = new LiveReadingTracker("one day a frog sat");
  assert.deepEqual(tracker.update("", "one day frog sat").visualReadWordIndexes, [0,1,3,4]);
  const final = tracker.update("one day frog sat");
  assert.deepEqual(final.bridgedVisualWordIndexes, [2]);
  assert.deepEqual(final.visualReadWordIndexes, [0,1,3,4]);
});

test("Record Again clears visual, confirmed, bridged and cursor progress, including interim-only attempts", () => {
  for (const confirmed of ["", "one day frog"]) {
    const tracker = new LiveReadingTracker("one day a frog sat");
    tracker.update(confirmed, "one day a frog sat");
    tracker.reset();
    assert.deepEqual(tracker.update(""), {
      visualReadWordIndexes: [], recognizedWordIndexes: [], bridgedVisualWordIndexes: [],
      confirmedCursor: -1, previewCursor: -1,
    });
  }
});

test("persistent provisional highlights cannot increase final transcript scores or WPM", async () => {
  const expectedText = "one day a frog sat";
  const tracker = new LiveReadingTracker(expectedText);
  const speech = new DiagnosticStreamingTranscript();
  speech.receive({ type: "interim", text: expectedText });
  assert.equal(tracker.update("", expectedText).visualReadWordIndexes.length, 5);
  speech.receive({ type: "final", segmentId: "1:1", sequence: 1, text: "one day frog sat" });
  const final = speech.finish(1);
  assert.ok(final);
  tracker.update(final.text);
  const result = await processDiagnosticRecording({
    audioSegments: [new Blob(["recording"], { type: "audio/webm" })],
    language: "en", expectedText, recordingDurationSeconds: 5,
    streamingTranscription: final,
    uploadSegment: async () => { throw new Error("Successful streaming must not upload"); },
  });
  assert.equal(result.transcription.text, "one day frog sat");
  assert.equal(result.oralReadingMetrics.correctWords, 4);
  assert.equal(result.oralReadingMetrics.omissions, 1);
  assert.equal(result.oralReadingMetrics.wordReadingScore, 80);
  assert.equal(result.oralReadingMetrics.readingSpeedWpm, 48);
  assert.deepEqual(getDiagnosticPracticeWords(result.oralReadingMetrics), ["a"]);
});

test("changing interim and visual progress leaves metrics unchanged; changing FINAL changes them", async () => {
  const expectedText = "one day a frog sat";
  async function score(finalText: string, interimText: string) {
    const speech = new DiagnosticStreamingTranscript();
    const tracker = new LiveReadingTracker(expectedText);
    speech.receive({ type: "interim", text: interimText });
    tracker.update("", interimText);
    assert.equal(speech.finish(0), null);
    speech.receive({ type: "final", segmentId: "1:1", sequence: 1, text: finalText });
    tracker.update(finalText);
    const final = speech.finish(1);
    assert.ok(final);
    return processDiagnosticRecording({
      audioSegments: [new Blob(["audio"], { type: "audio/webm" })],
      language: "en", expectedText, recordingDurationSeconds: 5,
      streamingTranscription: final,
      uploadSegment: async () => { throw new Error("Unexpected fallback"); },
    });
  }
  const omitted = await score("one day frog sat", expectedText);
  const differentVisuals = await score("one day frog sat", "unrelated words");
  assert.deepEqual(omitted.oralReadingMetrics, differentVisuals.oralReadingMetrics);
  assert.deepEqual(getDiagnosticPracticeWords(omitted.oralReadingMetrics), ["a"]);
  const correct = await score(expectedText, "unrelated words");
  assert.equal(correct.oralReadingMetrics.wordReadingScore, 100);
  assert.deepEqual(getDiagnosticPracticeWords(correct.oralReadingMetrics), []);
});
