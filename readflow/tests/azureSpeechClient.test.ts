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
  type PronunciationCheckResult,
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


// Scores are summarized and saved by the server (server/tests/pronunciationCheckPersistence.test.js);
// the browser only prepares the saved recording's WAVs and sends them in one request.
const result = (accuracy = 88): PronunciationCheckResult => ({
  saved: true, checkedAt: "2026-11-05T08:00:00Z",
  summary: { parts: 1, utterances: 1, accuracy, fluency: 80, wordsToPractice: [], assessedSeconds: 36, complete: true, unassessedSeconds: 0 },
});

test("every saved file is converted in recorder order and sent in one request", async () => {
  const calls: string[] = [];
  const checked = await assessRecordingPronunciation("attempt-1", {
    loadRecording: async (id) => { calls.push(`load:${id}`); return { available: true, segments: ["u1", "u2"] }; },
    fetchAudio: async (url) => { calls.push(`fetch:${url}`); return new Blob([url], { type: "audio/webm" }); },
    convert: async (audio) => { calls.push(`convert:${await audio.text()}`); return new Blob([await audio.text()], { type: "audio/wav" }); },
    assess: async (id, wavs) => { calls.push(`assess:${id}:${(await Promise.all(wavs.map((wav) => wav.text()))).join("+")}`); return result(); },
  });
  assert.deepEqual(calls, ["load:attempt-1", "fetch:u1", "convert:u1", "fetch:u2", "convert:u2", "assess:attempt-1:u1+u2"]);
  assert.equal(checked.summary.accuracy, 88, "the server's saved summary is returned unchanged");
  assert.equal(checked.saved, true);
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


test("a reading without a saved recording is not sent for checking", async () => {
  let assessed = false;
  await assert.rejects(assessRecordingPronunciation("attempt-1", {
    loadRecording: async () => ({ available: false, segments: [] }),
    fetchAudio: async () => new Blob(),
    convert: async (audio) => audio,
    assess: async () => { assessed = true; return result(); },
  }), PronunciationUnavailableError);
  assert.equal(assessed, false);
});

test("a reading saved as one file is one request, with steps reported", async () => {
  const steps: string[] = [];
  let requests = 0;
  await assessRecordingPronunciation("attempt-1", {
    loadRecording: async () => ({ available: true, segments: ["https://storage/one-file"] }),
    fetchAudio: async () => new Blob(["webm"], { type: "audio/webm" }),
    convert: async () => new Blob([new Uint8Array(44 + 36 * 32000)], { type: "audio/wav" }),
    assess: async (_id, _wavs, { onAssessing }) => { requests++; onAssessing?.(); return result(); },
    onStep: (step) => steps.push(step),
  });
  assert.equal(requests, 1);
  assert.deepEqual(steps, ["loading", "preparing", "uploading", "assessing"]);
});

test("a failed or cancelled check never produces a summary", async () => {
  const base = {
    loadRecording: async () => ({ available: true, segments: ["a", "b"] }),
    fetchAudio: async () => new Blob(["webm"], { type: "audio/webm" }),
    convert: async () => new Blob(["wav"], { type: "audio/wav" }),
  };
  await assert.rejects(assessRecordingPronunciation("attempt-1", { ...base, assess: async () => {
    throw new Error("Speech services are busy.");
  } }), /busy/);
  const controller = new AbortController();
  let sent = 0;
  await assert.rejects(assessRecordingPronunciation("attempt-1", { ...base, signal: controller.signal,
    fetchAudio: async () => { controller.abort(); return new Blob(["webm"]); },
    assess: async () => { sent++; return result(); } }), PronunciationIncompleteError);
  assert.equal(sent, 0, "nothing is sent after cancelling");
});
