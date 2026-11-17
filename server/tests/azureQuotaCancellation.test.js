// Hotfix 2026-11-17: Azure refuses a session with "Quota exceeded" (WebSocket 1007), which the SDK reports as
// BadRequestParameters. That is the Speech resource's usage limit, not a bad recording: STT_QUOTA ("temporarily
// busy, try again later"), never STT_INVALID_AUDIO ("please record it again"). Fake SDK only: no Azure.
const assert = require("node:assert/strict");
const test = require("node:test");
const { transcribeWav, assessPronunciationWav, synthesizeSpeech } = require("../services/azureSpeechService");
const { getSpeechErrorResponse } = require("../services/speechErrors");
const { createReadAloudAudioHandler } = require("../routes/readAloudAudio");

const ENV = Object.freeze({ AZURE_SPEECH_KEY: "a".repeat(84), AZURE_SPEECH_REGION: "southeastasia" });
const QUOTA = "Quota exceeded. Cid: 0123456789abcdef websocket error code: 1007";
const BAD_AUDIO = "Invalid audio format. websocket error code: 1007";

function wav(seconds) {
  const dataBytes = seconds * 16000 * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii"); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write("WAVEfmt ", 8, "ascii");
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

/** A recognizer / synthesizer that Azure cancels with the given SDK error code and details. */
function cancellingSdk(errorCode, errorDetails) {
  const codes = { NoError: 0, AuthenticationFailure: 1, BadRequestParameters: 2, TooManyRequests: 3, ConnectionFailure: 4,
    ServiceTimeout: 5, ServiceError: 6, RuntimeError: 7, Forbidden: 8 };
  const names = Object.fromEntries(Object.entries(codes).map(([name, value]) => [value, name]));
  return {
    ResultReason: { NoMatch: 0, Canceled: 1, RecognizedSpeech: 3, SynthesizingAudioCompleted: 8 },
    CancellationReason: { Error: 0, EndOfStream: 1 },
    CancellationErrorCode: { ...codes, ...names },
    OutputFormat: { Detailed: 1 },
    PropertyId: { SpeechServiceResponse_JsonResult: "json" },
    SpeechSynthesisOutputFormat: { Audio24Khz48KBitRateMonoMp3: "mp3" },
    PronunciationAssessmentGradingSystem: { HundredMark: 2 },
    PronunciationAssessmentGranularity: { Word: 2 },
    SpeechConfig: { fromSubscription: () => ({ setProperty() {} }) },
    AudioStreamFormat: { getWaveFormatPCM: () => ({}) },
    AudioInputStream: { createPushStream: () => ({ write() {}, close() {} }) },
    AudioConfig: { fromStreamInput: () => ({ turnOff: async () => {} }) },
    SpeechRecognizer: class {
      static enableTelemetry() {}
      startContinuousRecognitionAsync(ok) {
        setImmediate(() => { ok(); setImmediate(() => this.canceled?.(this, { reason: 0, errorCode, errorDetails })); });
      }
      close(ok) { ok(); }
    },
    PronunciationAssessmentConfig: class { applyTo() {} close() {} },
    PronunciationAssessmentResult: { fromResult: () => ({}) },
    SpeechSynthesizer: class {
      speakTextAsync(_text, ok) { setImmediate(() => ok({ reason: 1, errorCode, errorDetails })); }
      close(ok) { ok?.(); }
    },
    CancellationDetails: { fromResult: (result) => ({ errorCode: result.errorCode, errorDetails: result.errorDetails }) },
  };
}

async function failure(promise) {
  try { await promise; } catch (error) { return error; }
  throw new Error("expected a failure");
}

test("Azure 'Quota exceeded' (1007, BadRequestParameters) is STT_QUOTA for read-aloud transcription, not invalid audio", async () => {
  const logs = [];
  const error = await failure(transcribeWav("reading.wav", "en-US", { sdkFactory: () => cancellingSdk(2, QUOTA), env: ENV,
    readFile: async () => wav(5), log: (...args) => logs.push(args), wholeRecording: true }));
  assert.equal(error.code, "STT_QUOTA");
  assert.deepEqual(getSpeechErrorResponse(error), { code: "STT_QUOTA", status: 503,
    message: "Speech processing is temporarily busy. Please try again later." });
  // The log names the SDK error code, never Azure's details (correlation id), audio or text.
  assert.deepEqual(logs, [["Azure Speech operation failed", { operation: "transcribe", code: "STT_QUOTA", azureErrorCode: "BadRequestParameters" }]]);
  assert.ok(!JSON.stringify(logs).includes("Cid"));
});

test("only explicit bad audio is invalid audio; unknown bad request details do not blame the recording", async () => {
  for (const details of [BAD_AUDIO, "", undefined]) {
    const error = await failure(transcribeWav("reading.wav", "fil-PH", { sdkFactory: () => cancellingSdk(2, details), env: ENV,
      readFile: async () => wav(5), log() {}, wholeRecording: true }));
    assert.equal(error.code, details === BAD_AUDIO ? "STT_INVALID_AUDIO" : "STT_BAD_REQUEST", String(details));
  }
});

test("other cancellations keep their existing codes", async () => {
  for (const [code, expected] of [[1, "STT_PERMISSION"], [8, "STT_QUOTA"], [3, "STT_QUOTA"], [5, "STT_DEADLINE"], [4, "STT_PROVIDER_ERROR"], [6, "STT_PROVIDER_ERROR"]]) {
    const error = await failure(transcribeWav("reading.wav", "en-US", { sdkFactory: () => cancellingSdk(code, QUOTA), env: ENV,
      readFile: async () => wav(5), log() {}, wholeRecording: true }));
    assert.equal(error.code, expected, `errorCode ${code}`);
  }
});

test("the pronunciation check and text-to-speech classify a quota refusal the same way", async () => {
  const assessed = await failure(assessPronunciationWav(wav(5), "en", "Every Saturday morning.", { sdkFactory: () => cancellingSdk(2, QUOTA), env: ENV, log() {} }));
  assert.equal(assessed.code, "STT_QUOTA");
  const spoken = await failure(synthesizeSpeech("Hello", "en-US", { sdkFactory: () => cancellingSdk(2, QUOTA), env: ENV, log() {} }));
  assert.equal(spoken.code, "STT_QUOTA");
  const badTts = await failure(synthesizeSpeech("Hello", "en-US", { sdkFactory: () => cancellingSdk(2, BAD_AUDIO), env: ENV, log() {} }));
  assert.equal(badTts.code, "STT_INVALID_AUDIO");
});

test("the read-aloud route answers a quota refusal with 503 'temporarily busy' and saves nothing", async () => {
  const handler = createReadAloudAudioHandler({
    transcribe: () => transcribeWav("reading.wav", "en-US", { sdkFactory: () => cancellingSdk(2, QUOTA), env: ENV,
      readFile: async () => wav(5), log() {}, wholeRecording: true }),
    remove: async () => {}, log: () => {}, timing: () => {}, recordReceipt: async () => { throw new Error("no receipt on failure"); },
    contextArchived: async () => false,
  });
  const res = { statusCode: 200, headers: {}, locals: {}, body: null, writableFinished: true, on() {},
    set(name, value) { this.headers[name] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ body: { language: "en" }, query: {}, file: { path: "reading.wav", mimetype: "audio/wav", size: 100 } }, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { success: false, code: "STT_QUOTA", message: "Speech processing is temporarily busy. Please try again later." });
});
