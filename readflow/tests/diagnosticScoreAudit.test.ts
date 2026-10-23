import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import test from "node:test";
import { requireDiagnosticAssessment } from "../src/modules/module2/data/diagnosticData.ts";
import { processDiagnosticRecording } from "../src/modules/module2/services/diagnosticRecording.ts";
import { createDiagnosticScoreAudit, logDiagnosticScoreAudit } from "../src/modules/module2/services/diagnosticScoreAudit.ts";
import {
  calculateComprehensionScore, calculateOralReadingMetrics, classifyDiagnosticPlacement,
  getReadingWords, normalizeReadingText,
} from "../src/modules/module2/services/diagnosticScoring.ts";
import { DiagnosticStreamingTranscript } from "../src/modules/module2/services/diagnosticStreamingTranscript.ts";
import { getDiagnosticPracticeWords } from "../src/modules/module2/utils/diagnosticDisplay.ts";

const require = createRequire(import.meta.url);
const { createDiagnosticSpeechSession } = require("../../server/services/diagnosticSpeechStream.js");
const assessment = requireDiagnosticAssessment("en");
const expectedText = "The colorfully-wrapped box was lying on the table when Mario got home. Thinking that it was his parents\u2019 birthday gift to him, he took it and quickly tore it open. It was the coolest looking pair of shoes he had ever seen. Mario put them on, walked out into the street and jumped into a puddle. \u201cMario, why are you wearing your brother\u2019s shoes?\u201d his Mother cried. When he looked down, he said, \u201cOh no, that\u2019s a lot of cleaning I have to do.\u201d";
const expectedTokens = getReadingWords(expectedText);

class AzureStreamFixture extends EventEmitter {
  write() { return true; }
  end() { /* Finals may arrive after the client has stopped sending audio. */ }
  destroy() { this.emit("close"); }
  final(text: string, endNanos: number) {
    // Azure reports utterance offset + duration in 100 ns ticks.
    this.emit("data", { results: [{ isFinal: true, text, confidence: 0.9, endOffsetTicks: endNanos / 100 }] });
  }
  interim(text: string) {
    this.emit("data", { results: [{ isFinal: false, text }] });
  }
}

/** Real server final forwarding -> browser accumulation -> processing -> audit.
 * Only Azure's response stream is simulated; this is not microphone evidence. */
async function scoreAzureFinalChunks(chunks: string[], duration = 60) {
  const azure = new AzureStreamFixture();
  const accumulator = new DiagnosticStreamingTranscript();
  const messages: Record<string, unknown>[] = [];
  const session = createDiagnosticSpeechSession({
    language: "en", createStream: () => azure, close: () => {}, log: () => {},
    send(message: Record<string, unknown>) {
      messages.push(message);
      if (message.type === "final" || message.type === "interim") accumulator.receive(message);
    },
  });
  try {
    session.acceptAudio(Buffer.alloc(3200));
    for (const [index, text] of chunks.entries()) {
      if (index === chunks.length - 1) session.stop(); // Include the trailing final after Stop.
      azure.interim("unrelated revised interim");
      azure.interim(""); // A pause cannot remove already finalized words.
      assert.equal(accumulator.snapshot.confirmedTranscript, chunks.slice(0, index).join(" "));
      azure.final(text, (index + 1) * 100000000);
      azure.final(text, (index + 1) * 100000000); // Transport/provider duplicate, same ID.
      assert.equal(accumulator.snapshot.confirmedTranscript, chunks.slice(0, index + 1).join(" "));
    }
    azure.emit("end");
    const completion = messages[messages.length - 1];
    assert.equal(completion.type, "complete");
    assert.equal(completion.finalCount, chunks.length);
    assert.equal(completion.audioBytes, 3200);
    const transcription = accumulator.finish(completion.finalCount);
    assert.ok(transcription);
    const processed = await processDiagnosticRecording({
      language: "en", expectedText, recordingDurationSeconds: duration,
      audioSegments: [new Blob(["captured audio"], { type: "audio/webm" })],
      streamingTranscription: transcription,
      uploadSegment: async () => { throw new Error("Complete finals must not select upload fallback"); },
    });
    return { processed, audit: createDiagnosticScoreAudit(expectedText, processed.transcription.text, processed.oralReadingMetrics) };
  } finally { session.dispose(); }
}

test("slow one-word finals and fast large finals produce the same complete transcript, alignment, practice list and score", async () => {
  const words = expectedText.split(/\s+/);
  const fastChunks = Array.from({ length: Math.ceil(words.length / 27) }, (_, i) => words.slice(i * 27, (i + 1) * 27).join(" "));
  const slow = await scoreAzureFinalChunks(words);
  const fast = await scoreAzureFinalChunks(fastChunks);
  assert.equal(slow.processed.transcription.text, fast.processed.transcription.text);
  assert.deepEqual(slow.processed.oralReadingMetrics, fast.processed.oralReadingMetrics);
  assert.deepEqual(slow.audit, fast.audit);
  assert.equal(slow.audit.googleFinalTranscript, expectedText);
  assert.deepEqual(slow.audit.normalizedExpectedTokens, expectedTokens);
  assert.deepEqual(slow.audit.normalizedTranscriptTokens, expectedTokens);
  assert.equal(expectedTokens.length, expectedTokens.length);
  assert.equal(slow.audit.matched.length, expectedTokens.length);
  assert.equal(slow.audit.wordRecognition, 100);
  assert.deepEqual(slow.audit.practiceWords, []);
  assert.equal(slow.processed.oralReadingMetrics.readingSpeedWpm, expectedTokens.length);
});

test("the three example final chunks are concatenated without dropping their boundary words or last final", async () => {
  const { processed } = await scoreAzureFinalChunks(["the colorfully wrapped box", "was lying on the table", "when mario got home"]);
  assert.equal(processed.transcription.text, "the colorfully wrapped box was lying on the table when mario got home");
  assert.equal(processed.oralReadingMetrics.numberOfWordsRead, 13);
  assert.equal(processed.oralReadingMetrics.correctWords, 13);
});

test("separate identical final chunks are retained as repeated speech, even within the same second", async () => {
  const { processed } = await scoreAzureFinalChunks(["one day", "one day", "a frog"]);
  assert.equal(processed.transcription.text, "one day one day a frog");
  assert.equal(processed.oralReadingMetrics.numberOfWordsRead, 6);
});

for (const word of ["the", "colorfully", "wrapped", "box", "mario", "parents", "shoes", "mother", "thats", "cleaning", "i"]) {
  test(`correctly transcribed ${word} is matched and never added to practice words in the full passage`, () => {
    const metrics = calculateOralReadingMetrics(expectedText, expectedText, 60);
    const audit = createDiagnosticScoreAudit(expectedText, expectedText, metrics);
    const positions = expectedTokens.flatMap((token, index) => token === word ? [index] : []);
    assert.ok(positions.length);
    assert.deepEqual(audit.matched.filter(item => item.expectedWord === word).map(item => item.expectedIndex), positions);
    assert.equal(audit.practiceWords.includes(word), false);
  });
}

for (const transcript of ["I'm", "im", "I’m", "‘I’m’", '"I\'m,"', "Iʼm", "I'M."]) {
  test(`normalizes the contraction ${transcript} to im without a practice word`, () => {
    assert.equal(normalizeReadingText(transcript), "im");
    const metrics = calculateOralReadingMetrics("I'm", transcript);
    assert.equal(metrics.detectableMiscues, 0);
    assert.deepEqual(getDiagnosticPracticeWords(metrics), []);
  });
}

test("capitalization, commas, periods and straight/curly quotation marks preserve word boundaries", () => {
  const spoken = '“ONE, DAY.” A FROG! THEN A DUCK WADDLED BY. “I,” ASKED.';
  assert.deepEqual(getReadingWords(spoken), ["one", "day", "a", "frog", "then", "a", "duck", "waddled", "by", "i", "asked"]);
  assert.equal(calculateOralReadingMetrics("One day a frog then a duck waddled by I asked", spoken).detectableMiscues, 0);
});

test("I is i, but I, I'm and I am are not silently equated", () => {
  assert.equal(normalizeReadingText("I"), "i");
  assert.equal(calculateOralReadingMetrics("I", "i").wordReadingScore, 100);
  for (const spoken of ["I", "I am"]) {
    const metrics = calculateOralReadingMetrics("I'm", spoken);
    assert.ok(metrics.detectableMiscues > 0);
    assert.deepEqual(getDiagnosticPracticeWords(metrics), ["im"]);
  }
});

test("Mr. and mister share the explicit English honorific representation", () => {
  const metrics = calculateOralReadingMetrics("Mr. Frog", "mister frog");
  assert.deepEqual(getReadingWords("Mr."), ["mr"]);
  assert.equal(metrics.substitutions, 0);
  assert.deepEqual(getDiagnosticPracticeWords(metrics), []);
});

for (const [expected, spoken] of [["One", "1"], ["frog", "Frog"], ["frog", "frog,"], ["Mr.", "mister"], ["One day", "1 day."], ["one", '“1,”']]) {
  test(`representation equivalence: ${expected} / ${spoken}`, () => {
    for (const [a, b] of [[expected, spoken], [spoken, expected]]) {
      const metrics = calculateOralReadingMetrics(a, b);
      assert.equal(metrics.wordReadingScore, 100);
      assert.equal(metrics.detectableMiscues, 0);
      assert.deepEqual(getDiagnosticPracticeWords(metrics), []);
    }
  });
}

for (const [expected, spoken] of [["duck", "dog"], ["swam", "swim"], ["asked", "ask"], ["bug", "Bob"], ["smiled", "smelled"], ["buzzing", "busing"]]) {
  test(`real transcript mismatch: ${expected} / ${spoken}`, () => {
    const metrics = calculateOralReadingMetrics(expected, spoken);
    assert.equal(metrics.substitutions, 1);
    assert.equal(metrics.correctWords, 0);
    assert.equal(metrics.wordReadingScore, 0);
    assert.deepEqual(getDiagnosticPracticeWords(metrics), [expected]);
  });
}

test("English aliases are narrow and do not expand numeric compounds or parts of words", () => {
  for (const text of ["10", "01", "1st", "a1", "1.5", "-1", "1/2", "1-2", "1:30", "misterious", "émister"]) {
    assert.equal(normalizeReadingText(text), normalizeReadingText(text, "fil"), text);
  }
});

test("Filipino preserves its previous normalization and does not acquire English aliases", async () => {
  assert.deepEqual(getReadingWords("One 1 Mr. mister", "fil"), ["one", "1", "mr", "mister"]);
  for (const streaming of [true, false]) {
    const processed = await processDiagnosticRecording({
      audioSegments: [new Blob(["audio"], { type: "audio/webm" })],
      language: "fil", expectedText: "One Mr.", recordingDurationSeconds: 10,
      streamingTranscription: streaming ? { text: "1 mister" } : undefined,
      uploadSegment: async () => ({ success: true, message: "Transcribed", transcription: { text: "1 mister" } }),
    });
    assert.equal(processed.oralReadingMetrics.substitutions, 2);
    assert.deepEqual(getDiagnosticPracticeWords(processed.oralReadingMetrics), ["one", "mr"]);
  }
});

test("English streaming and fallback normalize for scoring without rewriting the Google transcript", async () => {
  for (const streaming of [true, false]) {
    const processed = await processDiagnosticRecording({
      audioSegments: [new Blob(["audio"], { type: "audio/webm" })],
      language: "en", expectedText: "One Mr.", recordingDurationSeconds: 10,
      streamingTranscription: streaming ? { text: "1 mister" } : undefined,
      uploadSegment: async () => ({ success: true, message: "Transcribed", transcription: { text: "1 mister" } }),
    });
    assert.equal(processed.transcription.text, "1 mister");
    assert.equal(processed.oralReadingMetrics.wordReadingScore, 100);
    assert.deepEqual(getDiagnosticPracticeWords(processed.oralReadingMetrics), []);
  }
});

test("practice words deduplicate expected substitutions/omissions and exclude inserted speech", () => {
  const metrics = calculateOralReadingMetrics("duck duck frog", "dog dog frog extra");
  assert.equal(metrics.substitutions, 2);
  assert.equal(metrics.insertions, 1);
  assert.deepEqual(getDiagnosticPracticeWords(metrics), ["duck"]);
});

test("one omission or substitution at any passage position never shifts the remaining correct words", () => {
  for (let index = 0; index < expectedTokens.length; index++) {
    for (const kind of ["omission", "substitution"] as const) {
      const spoken = [...expectedTokens];
      spoken.splice(index, 1, ...(kind === "substitution" ? ["unrelatedtoken"] : []));
      const metrics = calculateOralReadingMetrics(expectedText, spoken.join(" "));
      assert.equal(metrics.correctWords, expectedTokens.length - 1, `${kind} at ${index}`);
      assert.equal(metrics.detectableMiscues, 1);
      assert.equal(metrics.omissions, kind === "omission" ? 1 : 0);
      assert.equal(metrics.substitutions, kind === "substitution" ? 1 : 0);
      assert.deepEqual(getDiagnosticPracticeWords(metrics), [expectedTokens[index]]);
    }
  }
});

test("an insertion at any passage boundary costs one miscue but creates no expected-word practice item", () => {
  for (let index = 0; index <= expectedTokens.length; index++) {
    const spoken = [...expectedTokens]; spoken.splice(index, 0, "extra");
    const metrics = calculateOralReadingMetrics(expectedText, spoken.join(" "), 60);
    assert.equal(metrics.correctWords, expectedTokens.length);
    assert.equal(metrics.insertions, 1);
    assert.equal(metrics.detectableMiscues, 1);
    assert.equal(metrics.readingSpeedWpm, expectedTokens.length + 1);
    assert.equal(metrics.wordReadingScore, (expectedTokens.length - 1) / expectedTokens.length * 100);
    assert.deepEqual(getDiagnosticPracticeWords(metrics), []);
  }
});

test("correct repeated words and phrases remain matched; an extra spoken repetition is an insertion", () => {
  for (const phrase of ["one one day a frog", "one day a frog one day a frog"]) {
    const metrics = calculateOralReadingMetrics(phrase, phrase);
    assert.equal(metrics.wordReadingScore, 100);
    assert.deepEqual(getDiagnosticPracticeWords(metrics), []);
  }
  const repeated = calculateOralReadingMetrics("one day a frog", "one one day a frog");
  assert.equal(repeated.insertions, 1);
  assert.deepEqual(getDiagnosticPracticeWords(repeated), []);
});

test("practice evidence distinguishes a missing occurrence from a word recognized elsewhere", () => {
  const metrics = calculateOralReadingMetrics("a frog a frog", "a frog");
  const audit = createDiagnosticScoreAudit("a frog a frog", "a frog", metrics);
  assert.deepEqual(audit.practiceWords, ["a", "frog"]);
  assert.equal(audit.omissions.length, 2);
  assert.deepEqual(audit.practiceEvidence[0].expectedPositions, [0, 2]);
  assert.deepEqual(audit.practiceEvidence[0].transcriptPositions, [0]);
  assert.equal(audit.practiceEvidence[0].mismatches.length, 1);
  assert.deepEqual(audit.practiceEvidence[0].unmatchedTranscriptPositions, []);
});

test("practice words are unique, limited to eight, and drawn only from final expected-word mismatches", () => {
  const metrics = calculateOralReadingMetrics("one one two three four five six seven eight nine ten", "");
  assert.deepEqual(getDiagnosticPracticeWords(metrics), ["one", "two", "three", "four", "five", "six", "seven", "eight"]);
  assert.deepEqual(getDiagnosticPracticeWords(), []);
});

test("partial passage scoring retains the spoken prefix, uses spoken WPM and scores the remaining omissions", () => {
  const metrics = calculateOralReadingMetrics(expectedText, expectedTokens.slice(0, 2).join(" "), 10);
  assert.equal(metrics.correctWords, 2);
  assert.equal(metrics.omissions, expectedTokens.length - 2);
  assert.equal(metrics.wordReadingScore, 2 / expectedTokens.length * 100);
  assert.equal(metrics.readingSpeedWpm, 12);
  assert.equal(getDiagnosticPracticeWords(metrics)[0], expectedTokens[2]);
});

test("audit indexes reconstruct the exact expected and final token sequences across all miscue types", () => {
  const expected = "one day a frog sat still";
  const spoken = "one night frog sat very still";
  const metrics = calculateOralReadingMetrics(expected, spoken);
  const audit = createDiagnosticScoreAudit(expected, spoken, metrics);
  assert.equal(audit.wordRecognition, (6 - 3) / 6 * 100);
  assert.equal(audit.omissions.length, 1);
  assert.equal(audit.substitutions.length, 1);
  assert.equal(audit.insertions.length, 1);
  const alignment = [...audit.matched, ...audit.omissions, ...audit.substitutions, ...audit.insertions];
  for (const item of alignment) {
    if (item.type !== "insertion") assert.equal(audit.normalizedExpectedTokens[item.expectedIndex!], item.expectedWord);
    if (item.type !== "omission") assert.equal(audit.normalizedTranscriptTokens[item.transcriptIndex!], item.spokenWord);
  }
  assert.deepEqual(audit.practiceWords, ["day", "a"]);
  assert.deepEqual(audit.practiceEvidence.map(item => item.transcriptPositions), [[], []]);
});

test("the audit exposes the supplied scoring output rather than recalculating and hiding an alignment defect", () => {
  const incorrect = calculateOralReadingMetrics("one day", "day");
  const audit = createDiagnosticScoreAudit("one day", "one day", incorrect);
  assert.deepEqual(audit.practiceWords, ["one"]);
  assert.deepEqual(audit.practiceEvidence[0].transcriptPositions, [0]);
  assert.equal(audit.practiceEvidence[0].mismatches[0].type, "omission");
});

test("audit diagnostics do not mutate the score or emit logs when development mode is absent", () => {
  const metrics = calculateOralReadingMetrics("one day", "one", 2);
  const before = structuredClone(metrics);
  createDiagnosticScoreAudit("one day", "one", metrics);
  const info = console.info;
  let calls = 0;
  console.info = () => { calls++; };
  try { logDiagnosticScoreAudit("one day", "one", metrics); }
  finally { console.info = info; }
  assert.equal(calls, 0);
  assert.deepEqual(metrics, before);
});

for (let correct = 0; correct <= 6; correct++) {
  test(`English comprehension ${correct}/6 is ${correct / 6 * 100}%`, () => {
    const answers = Object.fromEntries(assessment.questions.map((question, index) => [question.id,
      index < correct ? question.correctChoiceId : question.choices.find(choice => choice.id !== question.correctChoiceId)!.id]));
    assert.equal(calculateComprehensionScore(answers, assessment.questions), correct / 6 * 100);
    assert.equal(assessment.questions.length, 6);
    assert.equal(Math.round(calculateComprehensionScore(answers, assessment.questions)!), [0, 17, 33, 50, 67, 83, 100][correct]);
  });
}

test("worked example A: 101 words and 12 scored miscues with 5/7 comprehension", () => {
  const syntheticTokens = Array.from({ length: 101 }, (_, i) => `token${i}`);
  const spoken = [...syntheticTokens];
  spoken.splice(0, 12, ...Array<string>(12).fill("unrelatedtoken"));
  const metrics = calculateOralReadingMetrics(syntheticTokens.join(" "), spoken.join(" "), 60);
  assert.equal(metrics.totalExpectedWords, 101);
  assert.equal(metrics.detectableMiscues, 12);
  assert.equal(metrics.wordReadingScore, 89 / 101 * 100);
  assert.equal(metrics.wordReadingScore.toFixed(2), "88.12");
  assert.deepEqual(classifyDiagnosticPlacement(metrics.wordReadingScore, 5 / 7 * 100), {
    wordRecognitionLevel: "Frustration", comprehensionLevel: "Instructional", overallReadingLevel: "Frustration",
  });
});

test("worked examples B and C follow the Phil-IRI 2018 matrix", () => {
  assert.deepEqual(classifyDiagnosticPlacement(93, 6 / 7 * 100), {
    wordRecognitionLevel: "Instructional", comprehensionLevel: "Independent", overallReadingLevel: "Instructional",
  });
  assert.deepEqual(classifyDiagnosticPlacement(98, 4 / 7 * 100), {
    wordRecognitionLevel: "Independent", comprehensionLevel: "Frustration", overallReadingLevel: "Frustration",
  });
});

for (const [wr, wrLevel, outcomes] of [
  [98, "Independent", ["Independent", "Instructional", "Frustration"]],
  [93, "Instructional", ["Instructional", "Instructional", "Frustration"]],
  [80, "Frustration", ["Frustration", "Frustration", "Frustration"]],
] as const) {
  for (const [index, [comprehension, comprehensionLevel]] of ([[90, "Independent"], [70, "Instructional"], [40, "Frustration"]] as const).entries()) {
    test(`matrix ${wrLevel} WR + ${comprehensionLevel} comprehension = ${outcomes[index]}`, () => {
      assert.deepEqual(classifyDiagnosticPlacement(wr, comprehension), {
        wordRecognitionLevel: wrLevel, comprehensionLevel, overallReadingLevel: outcomes[index],
      });
    });
  }
}
