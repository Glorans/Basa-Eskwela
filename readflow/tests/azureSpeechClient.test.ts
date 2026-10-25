import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SPEECH_WAV_MAX_SECONDS,
  SPEECH_WAV_SAMPLE_RATE,
  SpeechWavConversionError,
  convertToSpeechWav,
  encodePcm16Wav,
  splitSpeechSamples,
} from "../src/modules/module2/services/speechWav.ts";
import {
  PronunciationIncompleteError,
  PronunciationUnavailableError,
  assessRecordingPronunciation,
  summarizePronunciation,
  type PronunciationPartResult,
} from "../src/modules/module5/services/pronunciationSummary.ts";

test("parts are encoded as the mono 16 kHz 16-bit PCM WAV the backend verifies", () => {
  const wav = new DataView(encodePcm16Wav(Float32Array.from([0, 1, -1, 2, -2, 0.5])));
  const ascii = (offset: number) => String.fromCharCode(...[0, 1, 2, 3].map((index) => wav.getUint8(offset + index)));
  assert.equal(ascii(0), "RIFF");
  assert.equal(wav.getUint32(4, true) + 8, wav.byteLength);
  assert.equal(ascii(8), "WAVE");
  assert.equal(ascii(12), "fmt ");
  assert.equal(wav.getUint16(20, true), 1, "PCM");
  assert.equal(wav.getUint16(22, true), 1, "mono");
  assert.equal(wav.getUint32(24, true), SPEECH_WAV_SAMPLE_RATE);
  assert.equal(wav.getUint32(28, true), SPEECH_WAV_SAMPLE_RATE * 2);
  assert.equal(wav.getUint16(34, true), 16);
  assert.equal(ascii(36), "data");
  assert.equal(wav.getUint32(40, true), 12);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((index) => wav.getInt16(44 + index * 2, true)), [0, 32767, -32768, 32767, -32768, 16383]);
});

test("conversion fails safely where the browser cannot decode audio", async () => {
  await assert.rejects(convertToSpeechWav(new Blob([])), SpeechWavConversionError);
  await assert.rejects(convertToSpeechWav(new Blob(["webm"])), SpeechWavConversionError);
});

const part = (utterances: PronunciationPartResult["utterances"]): PronunciationPartResult =>
  ({ provider: "azure", locale: "en-US", scale: "0-100", utterances });

test("pronunciation summary averages only Azure's own scores and lists words to practise", () => {
  const summary = summarizePronunciation([
    part([{ text: "Every Saturday", accuracy: 90, fluency: 80, words: [
      { word: "Every", accuracy: 95, errorType: "None" },
      { word: "Saturday,", accuracy: 70, errorType: "Mispronunciation" },
    ] }]),
    part([{ text: "Lina walks with her", accuracy: 60, fluency: null, words: [
      { word: "Lina", accuracy: 40, errorType: "None" },
      { word: "walks", accuracy: 99, errorType: "None" },
      { word: "with", accuracy: null, errorType: null },
      { word: "her", accuracy: 80, errorType: "None" },
    ] }]),
    part([]),
  ]);
  assert.deepEqual(summary, {
    parts: 3,
    utterances: 2,
    accuracy: 70, // (90 x 2 words + 60 x 4 words) / 6
    fluency: 80, // the utterance without a fluency score is left out, not counted as zero
    wordsToPractice: ["saturday", "lina"],
  });
});

test("no Azure scores means no invented numbers", () => {
  assert.deepEqual(summarizePronunciation([part([{ text: "hi", accuracy: null, fluency: null, words: [] }])]),
    { parts: 1, utterances: 1, accuracy: null, fluency: null, wordsToPractice: [] });
  assert.deepEqual(summarizePronunciation([part([])]),
    { parts: 1, utterances: 0, accuracy: null, fluency: null, wordsToPractice: [] });
});

test("every saved part is converted and assessed in recorder order", async () => {
  const calls: string[] = [];
  const summary = await assessRecordingPronunciation("attempt-1", {
    loadRecording: async (id) => { calls.push(`load:${id}`); return { available: true, segments: ["u1", "u2"] }; },
    fetchAudio: async (url) => { calls.push(`fetch:${url}`); return new Blob([url], { type: "audio/webm" }); },
    convert: async (audio) => { calls.push(`convert:${await audio.text()}`); return [new Blob(["RIFF"], { type: "audio/wav" })]; },
    assessPart: async (id, wav) => { calls.push(`assess:${id}:${wav.type}`); return part([{ text: "x", accuracy: 88, fluency: 77, words: [] }]); },
  });
  assert.deepEqual(calls, ["load:attempt-1", "fetch:u1", "convert:u1", "assess:attempt-1:audio/wav", "fetch:u2", "convert:u2", "assess:attempt-1:audio/wav"]);
  assert.equal(summary.accuracy, 88);
  assert.equal(summary.parts, 2);
});

test("one continuous saved recording is assessed part by part, in order", async () => {
  const assessed: string[] = [];
  const summary = await assessRecordingPronunciation("attempt-1", {
    loadRecording: async () => ({ available: true, segments: ["full"] }),
    fetchAudio: async () => new Blob(["full"], { type: "audio/webm" }),
    convert: async () => ["p1", "p2", "p3", "p4"].map((name) => new Blob([name], { type: "audio/wav" })),
    assessPart: async (_id, wav) => { assessed.push(await wav.text()); return part([{ text: "x", accuracy: 90, fluency: 80, words: [] }]); },
  });
  assert.deepEqual(assessed, ["p1", "p2", "p3", "p4"]);
  assert.equal(summary.parts, 4);
});

test("a continuous recording splits into 25 s parts within the 30 s Azure limit", () => {
  const rate = 10;
  const sizes = (seconds: number) => splitSpeechSamples(new Float32Array(seconds * rate), rate).map((part) => part.length / rate);
  assert.deepEqual(sizes(15), [15]);
  assert.deepEqual(sizes(40), [25, 15]);
  assert.deepEqual(sizes(90), [25, 25, 25, 15]);
  // A sub-second tail joins the previous part instead of becoming its own part.
  assert.deepEqual(sizes(50.5), [25, 25.5]);
  const samples = Float32Array.from({ length: 60 * rate }, (_, index) => index);
  assert.deepEqual([...splitSpeechSamples(samples, rate).flatMap((part) => [...part])], [...samples]);
  for (const seconds of [15, 40, 90, 300]) {
    assert.ok(sizes(seconds).every((part) => part <= SPEECH_WAV_MAX_SECONDS));
  }
});

test("a reading without a saved recording is not sent to Azure", async () => {
  let assessed = false;
  await assert.rejects(assessRecordingPronunciation("attempt-1", {
    loadRecording: async () => ({ available: false, segments: [] }),
    fetchAudio: async () => new Blob(),
    convert: async (audio) => [audio],
    assessPart: async () => { assessed = true; return part([]); },
  }), PronunciationUnavailableError);
  assert.equal(assessed, false);
});

const wavOf = (seconds: number) => new Blob([new Uint8Array(44 + seconds * 32000)], { type: "audio/wav" });

test("a reading saved as one file is assessed whole, in one request, with its coverage reported", async () => {
  const steps: string[] = [];
  const requests: number[] = [];
  const summary = await assessRecordingPronunciation("attempt-1", {
    loadRecording: async () => ({ available: true, segments: ["https://storage/one-file"] }),
    fetchAudio: async () => new Blob(["webm"], { type: "audio/webm" }),
    convert: async () => [wavOf(36)],
    assessPart: async (_id, wav, { onAssessing }) => {
      requests.push(wav.size);
      onAssessing?.();
      return { ...part([{ text: "Every Saturday", accuracy: 90, fluency: 80, words: [] }]), complete: true, durationSeconds: 36 };
    },
    onStep: (step) => steps.push(step),
  });
  assert.equal(requests.length, 1, "one Azure session for the whole reading, not one per 25 s");
  assert.deepEqual(steps, ["loading", "preparing", "uploading", "assessing"]);
  assert.equal(summary.assessedSeconds, 36);
  assert.equal(summary.accuracy, 90);
});

test("speech Azure could not assess is reported, never summarized as the whole reading", async () => {
  const base = {
    loadRecording: async () => ({ available: true, segments: ["a", "b"] }),
    fetchAudio: async () => new Blob(["webm"], { type: "audio/webm" }),
    convert: async () => [wavOf(20)],
  };
  const scored = part([{ text: "Every Saturday", accuracy: 90, fluency: 80, words: [] }]);
  let partCalls = 0;
  const partial = await assessRecordingPronunciation("attempt-1", { ...base, assessPart: async (_id, _wav) =>
    partCalls++ === 0 ? { ...scored, complete: true } : { ...scored, complete: false, unassessedSegments: 1, unassessedSeconds: 2.4 } });
  assert.deepEqual([partial.complete, partial.unassessedSeconds, partial.accuracy], [false, 2, 90]);
  const whole = await assessRecordingPronunciation("attempt-1", { ...base, assessPart: async () => ({ ...scored, complete: true }) });
  assert.deepEqual([whole.complete, whole.unassessedSeconds], [true, 0]);
  const unmeasured = await assessRecordingPronunciation("attempt-1", { ...base,
    assessPart: async () => ({ ...scored, complete: false, unassessedSegments: 1, unassessedSeconds: null }) });
  assert.deepEqual([unmeasured.complete, unmeasured.unassessedSeconds], [false, null]);
});

test("a failed or cancelled check never produces a summary", async () => {
  const base = {
    loadRecording: async () => ({ available: true, segments: ["a", "b"] }),
    fetchAudio: async () => new Blob(["webm"], { type: "audio/webm" }),
    convert: async () => [wavOf(20)],
  };
  let calls = 0;
  await assert.rejects(assessRecordingPronunciation("attempt-1", { ...base, assessPart: async () => {
    calls++;
    if (calls === 2) throw new Error("Speech services are busy.");
    return { ...part([{ text: "x", accuracy: 90, fluency: 80, words: [] }]), complete: true };
  } }), /busy/);
  const controller = new AbortController();
  let afterCancel = 0;
  await assert.rejects(assessRecordingPronunciation("attempt-1", { ...base, signal: controller.signal, assessPart: async () => {
    afterCancel++;
    controller.abort();
    return { ...part([]), complete: true };
  } }), PronunciationIncompleteError);
  assert.equal(afterCancel, 1, "nothing more is sent after cancelling");
});
