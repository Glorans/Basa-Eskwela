const assert = require("node:assert/strict");
const test = require("node:test");
const { mkdtemp, readdir, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const express = require("express");

const { createSpeechRouter } = require("../routes/speech");
const { transcribeWav, wholeRecordingDeadlineMs } = require("../services/azureSpeechService");
const { getAzureSpeechConfig } = require("../services/azureSpeechConfig");
const { SupabaseAuthenticationError } = require("../services/supabaseAdmin");
const { OralReadingAuthorizationError } = require("../services/oralReadingAttemptService");

// M5 sends one WAV of the whole read-aloud to /api/read-aloud/audio. No real
// Azure resource or request is involved: the SDK and the provider are fakes.
const ENV = Object.freeze({ AZURE_SPEECH_KEY: "a".repeat(84), AZURE_SPEECH_REGION: "southeastasia" });
const BYTES_PER_SECOND = 32000;

function wav(seconds, rate = 16000) {
  const dataBytes = Math.round(seconds * rate) * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii"); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write("WAVEfmt ", 8, "ascii");
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii"); buffer.writeUInt32LE(dataBytes, 40);
  // A marker per second of audio, so the fake recognizer can show none was dropped or reordered.
  for (let second = 0; second < Math.floor(seconds); second++) buffer.writeUInt16LE(second + 1, 44 + second * rate * 2);
  return buffer;
}

/**
 * Minimal stand-in for SDK 1.52 continuous recognition. Phrases are derived
 * from the PCM actually pushed, and the session ends only after the stream is
 * closed. A phrase spanning 25 s or 50 s (the old part boundaries) can only be
 * recognized whole if that audio arrived whole.
 */
function fakeSdk({ phrases, cancelAfter } = {}) {
  const calls = { recognizers: 0, pushes: [], sessions: 0 };
  const sdk = {
    ResultReason: { RecognizedSpeech: 3 },
    CancellationReason: { Error: 0, EndOfStream: 1 },
    CancellationErrorCode: { ConnectionFailure: 4, ServiceTimeout: 5 },
    OutputFormat: { Detailed: 1 },
    PropertyId: { SpeechServiceResponse_JsonResult: "json" },
    SpeechConfig: { fromSubscription: () => ({ setProperty() {} }) },
    AudioStreamFormat: { getWaveFormatPCM: () => ({}) },
    AudioInputStream: {
      createPushStream() {
        const push = { chunks: [], closed: false, write(data) { this.chunks.push(Buffer.from(data)); }, close() { this.closed = true; } };
        calls.pushes.push(push);
        return push;
      },
    },
    AudioConfig: { fromStreamInput: (stream) => ({ stream, turnOff: async () => {} }) },
    SpeechRecognizer: class {
      static enableTelemetry() {}
      constructor(_config, audio) { this.audio = audio; calls.recognizers++; }
      startContinuousRecognitionAsync(ok) {
        calls.sessions++;
        setImmediate(async () => {
          ok();
          const pcm = Buffer.concat(this.audio.stream.chunks);
          const texts = phrases(pcm.length / BYTES_PER_SECOND, pcm);
          for (const [index, text] of texts.entries()) {
            await new Promise((resolve) => setImmediate(resolve));
            if (cancelAfter !== undefined && index >= cancelAfter) break;
            this.recognized?.(this, { result: {
              reason: 3, text, properties: { getProperty: () => JSON.stringify({ NBest: [{ Confidence: 0.8 }] }) },
            } });
          }
          await new Promise((resolve) => setImmediate(resolve));
          if (cancelAfter !== undefined) this.canceled?.(this, { reason: 0, errorCode: 4 });
          else this.sessionStopped?.(this, {});
        });
      }
      close(ok) { ok(); }
    },
  };
  return { calls, sdkFactory: () => sdk };
}

// One phrase per 10 s of audio, naming the first and last second marker it heard.
const markerPhrases = (seconds, pcm) => Array.from({ length: Math.ceil(seconds / 10) }, (_, index) => {
  const markers = [];
  for (let second = index * 10; second < Math.min(seconds, index * 10 + 10); second++) {
    markers.push(pcm.readUInt16LE(second * BYTES_PER_SECOND));
  }
  return `words ${markers[0]} to ${markers.at(-1)}`;
});

for (const seconds of [20, 40, 60, 300]) {
  test(`a ${seconds} s read-aloud is recognized in one session with every second of audio, in order`, async () => {
    const audio = wav(seconds);
    const { calls, sdkFactory } = fakeSdk({ phrases: markerPhrases });
    const result = await transcribeWav("reading.wav", "en-US", {
      sdkFactory, env: ENV, readFile: async () => audio, log() {}, wholeRecording: true,
    });
    assert.equal(calls.recognizers, 1, "one recognizer for the whole reading");
    assert.equal(calls.sessions, 1, "one continuous-recognition session, never restarted");
    assert.equal(calls.pushes.length, 1);
    assert.equal(Buffer.concat(calls.pushes[0].chunks).length, audio.length - 44, "all PCM is pushed, none trimmed");
    assert.equal(calls.pushes[0].closed, true);
    // Phrases spanning the old 25 s boundaries (20-30 s, 50-60 s) arrive whole, once and in order.
    const expected = Array.from({ length: seconds / 10 }, (_, index) => `words ${index * 10 + 1} to ${index * 10 + 10}`).join(" ");
    assert.equal(result.text, expected);
    assert.equal(result.confidence, 0.8);
  });
}

test("English and Filipino use the same whole-recording path", async () => {
  for (const locale of ["en-US", "fil-PH"]) {
    const { sdkFactory } = fakeSdk({ phrases: () => ["Tuwing Sabado ng umaga,", "naglalakad si Lina."] });
    const result = await transcribeWav("reading.wav", locale, {
      sdkFactory, env: ENV, readFile: async () => wav(40), log() {}, wholeRecording: true,
    });
    assert.equal(result.text, "Tuwing Sabado ng umaga, naglalakad si Lina.");
  }
});

test("a session that fails part-way returns an error, never a partial transcript", async () => {
  const { sdkFactory } = fakeSdk({ phrases: markerPhrases, cancelAfter: 2 });
  await assert.rejects(transcribeWav("reading.wav", "en-US", {
    sdkFactory, env: ENV, readFile: async () => wav(60), log() {}, wholeRecording: true,
  }), (error) => error.code === "STT_PROVIDER_ERROR");
});

test("whole recordings keep the five-minute session limit; M2 parts keep the 30 s limit", async () => {
  const { sdkFactory, calls } = fakeSdk({ phrases: markerPhrases });
  const options = { sdkFactory, env: ENV, log() {} };
  await assert.rejects(transcribeWav("reading.wav", "en-US", { ...options, readFile: async () => wav(306), wholeRecording: true }),
    (error) => error.code === "AUDIO_TOO_LONG");
  await assert.rejects(transcribeWav("part.wav", "en-US", { ...options, readFile: async () => wav(40) }),
    (error) => error.code === "AUDIO_TOO_LONG");
  assert.equal(calls.recognizers, 0, "nothing over a limit reaches Azure");
  // The M2 path is unchanged: a 25 s part still transcribes as before.
  const part = await transcribeWav("part.wav", "fil-PH", { ...options, readFile: async () => wav(25) });
  assert.equal(part.text, "words 1 to 10 words 11 to 20 words 21 to 25");
});

test("the whole-recording deadline allows for the SDK's two-times-real-time sending", () => {
  const config = getAzureSpeechConfig(ENV);
  assert.equal(wholeRecordingDeadlineMs(config, 20), 70_000);
  assert.equal(wholeRecordingDeadlineMs(config, 60), 90_000);
  assert.equal(wholeRecordingDeadlineMs(config, 300), 210_000);
});

const ROLES = { student: "student", general: "general_user", admin: "admin", teacher: "teacher" };

async function startServer({ transcribe, rateLimits } = {}) {
  process.env.NODE_ENV = "test";
  const uploadDirectory = await mkdtemp(path.join(tmpdir(), "readflow-read-aloud-"));
  const calls = [];
  const router = createSpeechRouter({
    uploadDirectory,
    authorize: async (req) => {
      const role = ROLES[/^Bearer (.+)$/.exec(req.get("authorization") ?? "")?.[1]];
      if (!role) throw new SupabaseAuthenticationError();
      if (role === "teacher") throw new OralReadingAuthorizationError();
      return { user: { id: `${role}-1` }, profile: { role } };
    },
    rateLimits,
    transcribe: async (file, languageCode, options) => {
      calls.push({ file, languageCode, options });
      return transcribe ? transcribe() : { text: "Every Saturday Lia helps her lola", confidence: 0.9 };
    },
    log() {},
  });
  const app = express();
  app.use(router);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    calls,
    uploadDirectory,
    post(url, { token = "student", language = "en", type = "audio/wav", fields = {} } = {}) {
      const form = new FormData();
      form.append("audio", new Blob([wav(1)], { type }), "reading.wav");
      form.append("language", language);
      for (const [name, value] of Object.entries(fields)) form.append(name, value);
      return fetch(`${base}${url}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await rm(uploadDirectory, { recursive: true, force: true });
    },
  };
}

// Temporary uploads are removed in a finally block after the response.
async function emptied(directory) {
  for (let attempt = 0; attempt < 50 && (await readdir(directory)).length; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.deepEqual(await readdir(directory), []);
}

test("the read-aloud endpoint transcribes one whole recording in English and Filipino", async () => {
  const server = await startServer();
  try {
    for (const [token, language, locale] of [["student", "en", "en-US"], ["general", "fil", "fil-PH"], ["admin", "en", "en-US"]]) {
      const response = await server.post("/api/read-aloud/audio", { token, language });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const body = await response.json();
      assert.deepEqual(body.transcription, { text: "Every Saturday Lia helps her lola", confidence: 0.9 });
      assert.equal(server.calls.at(-1).languageCode, locale);
      assert.equal(server.calls.at(-1).options.wholeRecording, true);
      assert.ok(server.calls.at(-1).options.signal instanceof AbortSignal);
      assert.match(response.headers.get("server-timing"), /^upload;dur=\d+, recognition;dur=\d+$/);
      await emptied(server.uploadDirectory);
    }
    // M2 parts keep their own endpoint and its 30 s part handling.
    assert.equal((await server.post("/api/diagnostic/audio")).status, 200);
    assert.equal(server.calls.at(-1).options, undefined);
  } finally { await server.close(); }
});

test("the read-aloud endpoint keeps authentication, roles, format and field limits", async () => {
  const server = await startServer();
  try {
    assert.equal((await server.post("/api/read-aloud/audio", { token: "nobody" })).status, 401);
    assert.equal((await server.post("/api/read-aloud/audio", { token: "teacher" })).status, 403);
    assert.equal((await server.post("/api/read-aloud/audio", { type: "audio/webm" })).status, 415);
    assert.equal((await server.post("/api/read-aloud/audio", { language: "es" })).status, 400);
    // Module 2's receipt fields are refused, so this path never stands in for a diagnostic part.
    assert.equal((await server.post("/api/read-aloud/audio", { fields: { recordingId: "x", segmentIndex: "1" } })).status, 400);
    assert.equal(server.calls.length, 0);
    await emptied(server.uploadDirectory);
  } finally { await server.close(); }
});

test("provider failures and silence are safe errors; one reading is one throttled request", async () => {
  let reply = () => { throw Object.assign(new Error("private provider detail"), { code: 13 }); };
  const server = await startServer({ transcribe: () => reply(), rateLimits: { stt: { limit: 2, windowMs: 60_000 } } });
  try {
    const failed = await server.post("/api/read-aloud/audio");
    assert.equal(failed.status, 502);
    assert.doesNotMatch(await failed.text(), /private provider detail/);
    reply = () => ({ text: "" });
    const silent = await server.post("/api/read-aloud/audio");
    assert.equal(silent.status, 422);
    assert.equal((await silent.json()).code, "NO_SPEECH");
    assert.equal((await server.post("/api/read-aloud/audio")).status, 429);
    await emptied(server.uploadDirectory);
  } finally { await server.close(); }
});

test("a session is stopped as soon as its caller gives up", async () => {
  // Never-ending recognition: without the signal it would run until the deadline.
  const { calls, sdkFactory } = fakeSdk({ phrases: () => [] });
  const sdk = sdkFactory();
  const hanging = { ...sdk, SpeechRecognizer: class extends sdk.SpeechRecognizer {
    startContinuousRecognitionAsync(ok) { calls.sessions++; setImmediate(ok); }
  } };
  const controller = new AbortController();
  const started = Date.now();
  const work = transcribeWav("reading.wav", "en-US", {
    sdkFactory: () => hanging, env: ENV, readFile: async () => wav(60), log() {}, wholeRecording: true, signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(work, (error) => error.code === "STT_PROVIDER_ERROR");
  assert.ok(Date.now() - started < 5000, "ended at once, not at the 90 s deadline");
});

test("the endpoint aborts recognition when the browser disconnects and logs timing without content", async () => {
  const { createReadAloudAudioHandler } = require("../routes/readAloudAudio");
  const timings = [];
  let seenSignal;
  const handler = createReadAloudAudioHandler({
    transcribe: (_file, _code, { signal }) => new Promise((_resolve, reject) => {
      seenSignal = signal;
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { code: "STT_PROVIDER_ERROR" })));
    }),
    remove: async () => {},
    log() {},
    timing: (details) => timings.push(details),
  });
  const { EventEmitter } = require("node:events");
  const res = Object.assign(new EventEmitter(), {
    writableFinished: false, statusCode: 200, headers: {},
    status(code) { this.statusCode = code; return this; }, set(name, value) { this.headers[name] = value; return this; },
    json() { this.writableFinished = true; return this; },
  });
  const req = { file: { path: "x.wav", mimetype: "audio/wav", size: 1234 }, body: { language: "fil" }, readAloudReceivedAt: Date.now() - 5 };
  const pending = handler(req, res);
  await new Promise((resolve) => setImmediate(resolve));
  res.emit("close");
  await pending;
  assert.equal(seenSignal.aborted, true);
  assert.equal(timings.length, 1);
  assert.deepEqual(Object.keys(timings[0]).sort(), ["abandoned", "audioBytes", "recognitionMs", "status", "uploadMs"]);
  assert.equal(timings[0].abandoned, true);
  assert.equal(timings[0].audioBytes, 1234);
  assert.ok(timings[0].uploadMs >= 0 && timings[0].recognitionMs >= 0);
  assert.doesNotMatch(JSON.stringify(timings), /x\.wav|fil/);
});
