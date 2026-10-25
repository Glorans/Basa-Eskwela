import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  SPEECH_WAV_SAMPLE_RATE,
  SpeechWavConversionError,
  SpeechWavTooLongError,
  convertToSpeechWav,
  convertToSpeechWavParts,
  convertToSpeechWavRecording,
} from "../src/modules/module2/services/speechWav.ts";
import { processOralReading } from "../src/modules/module5/services/oralReadingProcessing.ts";

// Stands in for the browser's Web Audio decoder: every recording "decodes" to
// the given number of seconds, and rendering returns exactly the requested length.
function fakeDecoder(seconds: number) {
  const globals = globalThis as Record<string, unknown>;
  globals.AudioContext = class {
    async decodeAudioData() { return { duration: seconds, length: Math.ceil(seconds * 48000) }; }
    async close() {}
  };
  globals.OfflineAudioContext = class {
    destination = {};
    length: number;
    constructor(_channels: number, length: number) { this.length = length; }
    createBufferSource() { return { buffer: null, connect() {}, start() {} }; }
    async startRendering() {
      const samples = Float32Array.from({ length: this.length }, (_, index) => (index % 100) / 100);
      return { getChannelData: () => samples };
    }
  };
}
afterEach(() => {
  delete (globalThis as Record<string, unknown>).AudioContext;
  delete (globalThis as Record<string, unknown>).OfflineAudioContext;
});

const webm = () => new Blob(["recorded"], { type: "audio/webm" });
const wavSeconds = (wav: Blob) => (wav.size - 44) / 2 / SPEECH_WAV_SAMPLE_RATE;

test("audio within the 30 s part limit converts whole, as before", async () => {
  for (const seconds of [5, 25, 27.4, 30]) {
    fakeDecoder(seconds);
    assert.equal(wavSeconds(await convertToSpeechWav(webm())), Math.ceil(seconds * SPEECH_WAV_SAMPLE_RATE) / SPEECH_WAV_SAMPLE_RATE);
  }
});

test("audio longer than 30 s is rejected explicitly instead of silently trimmed", async () => {
  for (const seconds of [30.01, 31, 45]) {
    fakeDecoder(seconds);
    await assert.rejects(convertToSpeechWav(webm()), SpeechWavTooLongError);
  }
  // Existing callers that handle any conversion failure still catch it.
  assert.ok(new SpeechWavTooLongError() instanceof SpeechWavConversionError);
  // The whole-recording conversion (pronunciation check) is bounded too, never trimmed.
  fakeDecoder(6 * 60 + 1);
  await assert.rejects(convertToSpeechWavParts(webm()), SpeechWavTooLongError);
});

// The marker samples make the WAV content position-checkable: sample i holds (i % 100) / 100.
const pcmAt = async (wav: Blob, sample: number) => new DataView(await wav.arrayBuffer()).getInt16(44 + sample * 2, true);

for (const seconds of [20, 40, 60, 300]) {
  test(`an M5 ${seconds} s recording becomes one WAV of all ${seconds} s, never split or trimmed`, async () => {
    fakeDecoder(seconds);
    const wav = await convertToSpeechWavRecording(webm());
    assert.equal(wav.type, "audio/wav");
    assert.equal(wavSeconds(wav), seconds);
    // Audio either side of the old 25 s and 50 s part boundaries is present and contiguous.
    for (const boundary of [25, 50].filter((value) => value < seconds)) {
      const sample = boundary * SPEECH_WAV_SAMPLE_RATE;
      assert.equal(await pcmAt(wav, sample - 1), Math.round(((sample - 1) % 100) / 100 * 32767));
      assert.equal(await pcmAt(wav, sample), Math.round((sample % 100) / 100 * 32767));
    }
  });
}

test("an M5 recording past the five-minute session limit fails instead of being trimmed", async () => {
  fakeDecoder(305);
  assert.equal(wavSeconds(await convertToSpeechWavRecording(webm())), 305);
  fakeDecoder(306);
  await assert.rejects(convertToSpeechWavRecording(webm()), SpeechWavTooLongError);
});

const base = { moduleId: "module", expectedText: "Every Saturday, Lia helps her lola sweep.", recordingDurationSeconds: 40 };

for (const language of ["en", "fil"] as const) {
  test(`one ${language} recording gives one transcript, scored once`, async () => {
    const recording = webm();
    const calls: unknown[][] = [];
    const saved = await processOralReading({ ...base, language, recording, transcribeRecording: async (...args) => {
      calls.push(args);
      return { text: "  Every Saturday Lia helps\n her lola sweep ", confidence: 0.82 };
    } });
    assert.deepEqual(calls, [[recording, language]]);
    assert.equal(saved.transcript, "Every Saturday Lia helps her lola sweep");
    assert.equal(saved.sttConfidence, 0.82);
    assert.equal(saved.durationSeconds, 40);
    assert.equal(saved.wordMetrics.every((word) => word.type === "match"), true);
  });
}

test("missing audio, silence and failures reject with no transcript", async () => {
  const never = async () => { throw new Error("must not be called"); };
  await assert.rejects(processOralReading({ ...base, language: "en", recording: undefined, transcribeRecording: never }));
  await assert.rejects(processOralReading({ ...base, language: "en", recording: new Blob([]), transcribeRecording: never }));
  await assert.rejects(processOralReading({ ...base, language: "en", recording: webm(), recordingDurationSeconds: 0, transcribeRecording: never }));
  await assert.rejects(processOralReading({ ...base, language: "en", recording: webm(), transcribeRecording: async () => ({ text: " ... " }) }),
    (error: Error & { code?: string }) => error.code === "NO_SPEECH");
  await assert.rejects(processOralReading({ ...base, language: "fil", recording: webm(), transcribeRecording: async () => {
    throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
  } }), (error: Error & { code?: string }) => error.code === "STT_PROVIDER_ERROR" && !/socket/.test(error.message));
});
