const assert = require("node:assert/strict");
const test = require("node:test");
const { once } = require("node:events");
const express = require("express");
const { createOralReadingRouter } = require("../routes/oralReading");
const { createRequestLimiter } = require("../services/speechAccess");
const { assessPronunciationWav, transcribeWav } = require("../services/azureSpeechService");
const { createPronunciationChecksTable } = require("./fixtures/pronunciationChecksTable");

// The pronunciation route assesses the whole saved recording against the story
// text the screen showed. No real Azure resource or request is involved.
const ATTEMPT = "11111111-1111-4111-8111-111111111111";
const PASSAGE = "A Helping Hand\nEvery Saturday, Ben visited Mrs. Santos.";

async function start(t, { assess, table = createPronunciationChecksTable() } = {}) {
  const calls = [];
  const timings = [];
  const app = express();
  app.use(createOralReadingRouter({
    authorizeOralReadingPracticeRequest: async () => ({ user: { id: "learner-1" }, profile: { role: "general_user" } }),
    getOralReadingAttempt: async () => ({ id: ATTEMPT, language: "en", passageTitle: "A Helping Hand", passageSnapshot: PASSAGE }),
    assessPronunciation: async (buffer, language, reference, options) => {
      calls.push({ bytes: buffer.length, language, reference, options });
      return assess ? assess(options) : { provider: "azure", locale: "en-US", scale: "0-100", complete: true, durationSeconds: 36,
        utterances: [{ text: "Every Saturday", accuracy: 90, fluency: 85, words: [{ word: "every", accuracy: 90, errorType: "None" }] }] };
    },
    pronunciationLimiter: createRequestLimiter({ limit: 60, windowMs: 60000 }),
    pronunciationTiming: (details) => timings.push(details),
    getSupabaseAdmin: () => table.client,
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/attempts/${ATTEMPT}/pronunciation`;
  const post = (signal) => {
    const form = new FormData();
    form.append("audio", new Blob([Buffer.alloc(64)], { type: "audio/wav" }), "part.wav");
    return fetch(url, { method: "POST", headers: { Authorization: "Bearer learner" }, body: form, signal });
  };
  return { calls, timings, post, table };
}

test("the whole recording is assessed once against the story shown, without the hidden title", async (t) => {
  const app = await start(t);
  const response = await app.post();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.pronunciation.complete, true);
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].reference, "Every Saturday, Ben visited Mrs. Santos.");
  assert.ok(app.calls[0].options.signal instanceof AbortSignal);
  assert.match(response.headers.get("server-timing"), /^checks;dur=\d+, assessment;dur=\d+$/);
  assert.deepEqual(Object.keys(app.timings[0]).sort(), ["abandoned", "assessmentMs", "audioBytes", "checksAndUploadMs"]);
  assert.doesNotMatch(JSON.stringify(app.timings), /Santos|Saturday|learner/);
});

test("without saved results, a browser that gives up stops the Azure assessment", async (t) => {
  let seen;
  const app = await start(t, { table: createPronunciationChecksTable({ installed: false }), assess: (options) => new Promise((_resolve, reject) => {
    seen = options.signal;
    options.signal.addEventListener("abort", () => reject(Object.assign(new Error("stopped"), { code: "STT_PROVIDER_ERROR" })));
  }) });
  const controller = new AbortController();
  const request = app.post(controller.signal).catch(() => "aborted");
  while (!seen) await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  assert.equal(await request, "aborted");
  for (let attempt = 0; attempt < 50 && !seen.aborted; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(seen.aborted, true);
  assert.equal(app.timings.at(-1)?.abandoned, true);
});

test("with saved results, a claimed check finishes and is saved even if the browser leaves", async (t) => {
  let seen;
  let finish;
  const app = await start(t, { assess: (options) => new Promise((resolve) => {
    seen = options.signal;
    finish = () => resolve({ provider: "azure", locale: "en-US", scale: "0-100", complete: true, durationSeconds: 36,
      utterances: [{ text: "Every Saturday", accuracy: 90, fluency: 85, words: [{ word: "every", accuracy: 90, errorType: "None" }] }] });
  }) });
  const controller = new AbortController();
  const request = app.post(controller.signal).catch(() => "aborted");
  while (!seen) await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  assert.equal(await request, "aborted");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(seen.aborted, false, "a refresh does not throw away a paid, claimed check");
  finish();
  for (let attempt = 0; attempt < 50 && app.table.rows.get(ATTEMPT)?.status !== "completed"; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(app.table.rows.get(ATTEMPT).status, "completed");
  // Reopening after the refresh reuses it: no second assessment.
  const again = await app.post();
  assert.equal(again.status, 200);
  const body = await again.json();
  assert.deepEqual([body.saved, body.reused, body.check.summary.accuracy], [true, true, 90]);
  assert.equal(app.calls.length, 1);
});

test("transcription diagnostics report phrase offsets and unrecognized segments, never text", async () => {
  const ENV = { AZURE_SPEECH_KEY: "a".repeat(84), AZURE_SPEECH_REGION: "southeastasia" };
  const wav = Buffer.alloc(44 + 32000 * 10);
  wav.write("RIFF", 0, "ascii"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36, "ascii");
  wav.writeUInt32LE(wav.length - 44, 40);
  const sdk = {
    ResultReason: { NoMatch: 0, RecognizedSpeech: 3 }, CancellationReason: { EndOfStream: 1 }, CancellationErrorCode: {},
    OutputFormat: { Detailed: 1 }, PropertyId: { SpeechServiceResponse_JsonResult: "json" },
    SpeechConfig: { fromSubscription: () => ({ setProperty() {} }) },
    AudioStreamFormat: { getWaveFormatPCM: () => ({}) },
    AudioInputStream: { createPushStream: () => ({ write() {}, close() {} }) },
    AudioConfig: { fromStreamInput: () => ({ turnOff: async () => {} }) },
    SpeechRecognizer: class {
      static enableTelemetry() {}
      startContinuousRecognitionAsync(ok) {
        setImmediate(() => {
          ok();
          // Azure heard something at 0.2 s it could not recognize, then the rest from 1.1 s.
          this.recognized(this, { result: { reason: 0, offset: 2_000_000 } });
          this.recognized(this, { result: { reason: 3, offset: 11_000_000, text: "Saturday, Ben visited", properties: { getProperty: () => "{}" } } });
          this.sessionStopped(this, {});
        });
      }
      close(ok) { ok(); }
    },
  };
  let diagnostics;
  const result = await transcribeWav("reading.wav", "en-US", {
    sdkFactory: () => sdk, env: ENV, readFile: async () => wav, log() {}, wholeRecording: true,
    onDiagnostics: (details) => { diagnostics = details; },
  });
  assert.equal(result.text, "Saturday, Ben visited");
  assert.deepEqual(diagnostics, { phrases: 1, unrecognized: 1, silence: 0, noise: 0, firstPhraseOffsetMs: 1100, firstUnrecognizedOffsetMs: 200 });
});

// SDK 1.52 shapes: NoMatch results carry a JSON RecognitionStatus that
// NoMatchDetails.fromResult maps to NotRecognized, InitialSilenceTimeout or
// InitialBabbleTimeout. The fake keeps that mapping.
function assessmentSdk(events) {
  const ENV_WAV = Buffer.alloc(44 + 32000 * 40);
  ENV_WAV.write("RIFF", 0, "ascii"); ENV_WAV.writeUInt32LE(ENV_WAV.length - 8, 4); ENV_WAV.write("WAVEfmt ", 8, "ascii");
  ENV_WAV.writeUInt32LE(16, 16); ENV_WAV.writeUInt16LE(1, 20); ENV_WAV.writeUInt16LE(1, 22); ENV_WAV.writeUInt32LE(16000, 24);
  ENV_WAV.writeUInt32LE(32000, 28); ENV_WAV.writeUInt16LE(2, 32); ENV_WAV.writeUInt16LE(16, 34); ENV_WAV.write("data", 36, "ascii");
  ENV_WAV.writeUInt32LE(ENV_WAV.length - 44, 40);
  const NoMatchReason = { NotRecognized: 0, InitialSilenceTimeout: 1, InitialBabbleTimeout: 2 };
  const sdk = {
    ResultReason: { NoMatch: 0, RecognizedSpeech: 3 }, CancellationReason: { EndOfStream: 1 }, CancellationErrorCode: {},
    OutputFormat: { Detailed: 1 }, PropertyId: { SpeechServiceResponse_JsonResult: "json" },
    NoMatchReason,
    NoMatchDetails: { fromResult: (result) => ({ reason: {
      InitialSilenceTimeout: NoMatchReason.InitialSilenceTimeout, BabbleTimeout: NoMatchReason.InitialBabbleTimeout,
    }[JSON.parse(result.json).RecognitionStatus] ?? NoMatchReason.NotRecognized }) },
    PronunciationAssessmentGradingSystem: { HundredMark: 2 }, PronunciationAssessmentGranularity: { Word: 2 },
    PronunciationAssessmentConfig: class { applyTo() {} close() {} },
    PronunciationAssessmentResult: { fromResult: (result) => result.assessment },
    SpeechConfig: { fromSubscription: () => ({ setProperty() {} }) },
    AudioStreamFormat: { getWaveFormatPCM: () => ({}) },
    AudioInputStream: { createPushStream: () => ({ write() {}, close() {} }) },
    AudioConfig: { fromStreamInput: () => ({ turnOff: async () => {} }) },
    SpeechRecognizer: class {
      static enableTelemetry() {}
      startContinuousRecognitionAsync(ok) {
        setImmediate(() => {
          ok();
          for (const event of events) this.recognized(this, { result: event });
          this.sessionStopped(this, {});
        });
      }
      close(ok) { ok(); }
    },
  };
  const ENV = { AZURE_SPEECH_KEY: "a".repeat(84), AZURE_SPEECH_REGION: "southeastasia" };
  return assessPronunciationWav(ENV_WAV, "en", "Every Saturday, Ben visited Mrs. Santos.", { sdkFactory: () => sdk, env: ENV, log() {} });
}
const noMatch = (status, seconds = 2) => ({ reason: 0, json: JSON.stringify({ RecognitionStatus: status }), offset: 0, duration: seconds * 10_000_000 });
const phrase = (text) => ({ reason: 3, text, offset: 0, duration: 30_000_000,
  assessment: { accuracyScore: 88, fluencyScore: 80, detailResult: { Words: [{ Word: "every", PronunciationAssessment: { AccuracyScore: 88, ErrorType: "None" } }] } } });

test("pauses and background noise do not fail or reduce coverage of the assessment", async () => {
  const result = await assessmentSdk([noMatch("InitialSilenceTimeout", 5), phrase("Every Saturday"), noMatch("BabbleTimeout", 3), phrase("Ben visited Mrs. Santos")]);
  assert.equal(result.complete, true);
  assert.equal(result.utterances.length, 2);
  assert.equal("unassessedSeconds" in result, false);
});

test("speech Azure could not assess is reported as incomplete coverage, not hidden or fatal", async () => {
  const result = await assessmentSdk([phrase("Every Saturday"), noMatch("NoMatch", 1.5), phrase("Ben visited"), noMatch("NoMatch", 2)]);
  assert.equal(result.complete, false);
  assert.equal(result.unassessedSegments, 2);
  assert.equal(result.unassessedSeconds, 3.5);
  assert.equal(result.utterances.length, 2, "the parts that were assessed keep their real scores");
  // A NoMatch without usable details is never assumed to be silence.
  const unknown = await assessmentSdk([phrase("Every Saturday"), { reason: 0, json: "{}", offset: 0 }]);
  assert.equal(unknown.complete, false);
  assert.equal(unknown.unassessedSeconds, null, "an unmeasured gap is not reported as zero");
});

test("silence alone is no speech; unassessable speech alone is an incomplete, empty result", async () => {
  await assert.rejects(assessmentSdk([noMatch("InitialSilenceTimeout", 40)]), (error) => error.code === "NO_SPEECH");
  const unclear = await assessmentSdk([noMatch("NoMatch", 6)]);
  assert.deepEqual([unclear.complete, unclear.utterances.length, unclear.unassessedSeconds], [false, 0, 6]);
});
