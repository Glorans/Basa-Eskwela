const assert = require("node:assert/strict");
const test = require("node:test");
const {
  getSpeechLanguageCode,
  UnsupportedDiagnosticLanguageError,
} = require("../services/diagnosticLanguage");
const { getAzureSpeechConfig, isAzureSpeechConfigured } = require("../services/azureSpeechConfig");
const {
  SpeechConfigurationError,
  SpeechTranscriptionError,
  getSpeechErrorResponse,
} = require("../services/speechErrors");
const {
  assessPronunciationWav,
  createRecognitionStream,
  synthesizeSpeech,
  transcribeWav,
} = require("../services/azureSpeechService");

// Shape-valid test values only; no real Azure resource or request is involved.
const ENV = Object.freeze({ AZURE_SPEECH_KEY: "a".repeat(84), AZURE_SPEECH_REGION: "southeastasia" });

function wav(seconds, rate = 16000) {
  const dataBytes = Math.round(seconds * rate) * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii"); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write("WAVEfmt ", 8, "ascii");
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii"); buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

function recognized(text, { offset = 0, duration = 10_000_000, confidence = 0.9, assessment } = {}) {
  return {
    reason: 3, text, offset, duration,
    properties: { getProperty: () => JSON.stringify({ NBest: [{ Confidence: confidence }] }) },
    assessment,
  };
}

/** Minimal stand-in for microsoft-cognitiveservices-speech-sdk 1.52. */
function fakeSdk(script = {}) {
  const calls = { telemetry: undefined, configs: [], recognizers: [], pushes: [], assessments: [], synthesizers: [], closed: 0, turnedOff: 0 };
  const sdk = {
    ResultReason: { NoMatch: 0, Canceled: 1, RecognizingSpeech: 2, RecognizedSpeech: 3, SynthesizingAudioCompleted: 8 },
    CancellationReason: { Error: 0, EndOfStream: 1 },
    CancellationErrorCode: { NoError: 0, AuthenticationFailure: 1, BadRequestParameters: 2, TooManyRequests: 3,
      ConnectionFailure: 4, ServiceTimeout: 5, ServiceError: 6, RuntimeError: 7, Forbidden: 8 },
    OutputFormat: { Simple: 0, Detailed: 1 },
    PropertyId: { SpeechServiceResponse_JsonResult: "json" },
    SpeechSynthesisOutputFormat: { Audio24Khz48KBitRateMonoMp3: "mp3" },
    PronunciationAssessmentGradingSystem: { HundredMark: 2 },
    PronunciationAssessmentGranularity: { Word: 2 },
    SpeechConfig: { fromSubscription(key, region) {
      const config = { key, region, properties: {}, setProperty(name, value) { this.properties[name] = value; } };
      calls.configs.push(config);
      return config;
    } },
    AudioStreamFormat: { getWaveFormatPCM: (rate, bits, channels) => ({ rate, bits, channels }) },
    AudioInputStream: { createPushStream(format) {
      const push = { format, bytes: 0, closed: false, write(data) { this.bytes += data.byteLength; }, close() { this.closed = true; script.onPushClosed?.(); } };
      calls.pushes.push(push);
      return push;
    } },
    AudioConfig: { fromStreamInput: (stream) => ({ stream, turnOff: async () => { calls.turnedOff++; } }) },
    SpeechRecognizer: class {
      static enableTelemetry(value) { calls.telemetry = value; }
      constructor(config, audio) { this.config = config; this.audio = audio; calls.recognizers.push(this); }
      startContinuousRecognitionAsync(ok, fail) {
        setImmediate(() => {
          if (script.startFails) { fail("no"); return; }
          ok();
          script.onStart?.(this);
        });
      }
      close(ok) { calls.closed++; ok(); }
    },
    PronunciationAssessmentConfig: class {
      constructor(reference, grading, granularity, miscue) { calls.assessments.push({ reference, grading, granularity, miscue }); }
      applyTo(recognizer) { recognizer.assessed = true; }
      close() {}
    },
    PronunciationAssessmentResult: { fromResult: (result) => result.assessment },
    SpeechSynthesizer: class {
      constructor(config, audio) { this.config = config; this.audio = audio; calls.synthesizers.push(this); }
      speakTextAsync(text, ok, fail) { setImmediate(() => script.synthesize(this, text, ok, fail)); }
      close(ok) { calls.closed++; ok(); }
    },
    CancellationDetails: { fromResult: (result) => ({ errorCode: result.errorCode }) },
  };
  return { sdk, calls, sdkFactory: () => sdk };
}

/** Delivers scripted final results after the audio is pushed, then ends the session. */
function batchScript(results, { cancel } = {}) {
  return {
    onStart(recognizer) {
      setImmediate(() => {
        for (const result of results) recognizer.recognized?.(recognizer, { result });
        if (cancel) recognizer.canceled?.(recognizer, { reason: 0, errorCode: cancel });
        else recognizer.sessionStopped?.(recognizer, {});
      });
    },
  };
}

const readFileOf = (buffer) => async () => buffer;

test("maps application languages to Azure Speech locales", () => {
  assert.equal(getSpeechLanguageCode("en"), "en-US");
  assert.equal(getSpeechLanguageCode("fil"), "fil-PH");
  for (const language of [undefined, "", "tl", "en-US", "fil-PH"]) {
    assert.throws(() => getSpeechLanguageCode(language), UnsupportedDiagnosticLanguageError);
  }
});

test("Azure configuration requires a key and region and never falls back", () => {
  for (const env of [{}, { AZURE_SPEECH_KEY: ENV.AZURE_SPEECH_KEY }, { AZURE_SPEECH_REGION: "eastus" },
    { AZURE_SPEECH_KEY: "<your key>", AZURE_SPEECH_REGION: "eastus" },
    { ...ENV, AZURE_SPEECH_REGION: "East US" },
    { ...ENV, AZURE_SPEECH_VOICE_EN: "en-US-Unknown" },
    { ...ENV, AZURE_SPEECH_TIMEOUT_MS: "999999" },
    { GOOGLE_APPLICATION_CREDENTIALS: "/tmp/key.json" }]) {
    assert.throws(() => getAzureSpeechConfig(env), SpeechConfigurationError);
    assert.equal(isAzureSpeechConfigured(env), false);
  }
  const config = getAzureSpeechConfig(ENV);
  assert.deepEqual(config.voices, { en: "en-US-JennyNeural", fil: "fil-PH-BlessicaNeural" });
  assert.equal(config.region, "southeastasia");
  assert.equal(config.timeoutMs, 60000);
  assert.deepEqual(getSpeechErrorResponse(new SpeechConfigurationError()), {
    code: "SPEECH_NOT_CONFIGURED", status: 503,
    message: "Speech services are not configured on the server. Please contact your administrator.",
  });
});

test("returns only stable safe client error details", () => {
  const response = getSpeechErrorResponse(Object.assign(new Error("private provider implementation detail"), { code: 13 }));
  assert.deepEqual(response, { code: "STT_PROVIDER_ERROR", status: 502, message: "Unable to process the recording. Please try again." });
  assert.equal(getSpeechErrorResponse(new SpeechTranscriptionError("NO_SPEECH")).status, 422);
});

for (const [language, locale] of [["en", "en-US"], ["fil", "fil-PH"]]) {
  test(`${language} upload part is recognized by Azure as ${locale} from its exact PCM data`, async () => {
    const audio = wav(2);
    const { sdkFactory, calls } = fakeSdk(batchScript([
      recognized("Tuwing Sabado ng umaga,", { confidence: 0.8 }),
      { reason: 0, text: "" },
      recognized("naglalakad si Lina.", { confidence: 0.6 }),
    ]));
    const result = await transcribeWav("part.wav", locale, { sdkFactory, env: ENV, readFile: readFileOf(audio), log() {} });
    assert.deepEqual(result, { text: "Tuwing Sabado ng umaga, naglalakad si Lina.", confidence: 0.7 });
    assert.equal(calls.telemetry, false);
    assert.equal(calls.configs[0].speechRecognitionLanguage, locale);
    assert.equal(calls.configs[0].properties["SPEECH-Error-MaxRetryCount"], "0");
    assert.equal(calls.configs[0].outputFormat, 1);
    assert.deepEqual(calls.pushes[0].format, { rate: 16000, bits: 16, channels: 1 });
    assert.equal(calls.pushes[0].bytes, audio.length - 44, "only the data chunk is sent");
    assert.equal(calls.pushes[0].closed, true);
    assert.equal(calls.closed, 1);
    assert.equal(calls.turnedOff, 1);
  });
}

test("missing Azure configuration fails before reading audio or loading the SDK", async () => {
  let loaded = false;
  let read = false;
  await assert.rejects(
    transcribeWav("part.wav", "en-US", { sdkFactory: () => { loaded = true; }, env: {}, readFile: async () => { read = true; } }),
    (error) => error.code === "SPEECH_NOT_CONFIGURED",
  );
  await assert.rejects(synthesizeSpeech("hello", "en-US", { sdkFactory: () => { loaded = true; }, env: {} }), SpeechConfigurationError);
  await assert.rejects(assessPronunciationWav(wav(1), "en", "hello", { sdkFactory: () => { loaded = true; }, env: {} }), SpeechConfigurationError);
  assert.throws(() => createRecognitionStream({ languageCode: "en-US", sampleRateHertz: 16000, channels: 1 },
    { sdkFactory: () => { loaded = true; }, env: {} }), SpeechConfigurationError);
  assert.equal(loaded, false);
  assert.equal(read, false);
});

test("non-WAV, wrong-rate and over-long parts are rejected before Azure is called", async () => {
  const cases = [
    [Buffer.from("\x1aE\xdf\xa3webm"), "STT_INVALID_AUDIO"],
    [wav(1, 48000), "STT_INVALID_AUDIO"],
    [wav(31), "AUDIO_TOO_LONG"],
  ];
  for (const [audio, code] of cases) {
    let loaded = false;
    await assert.rejects(transcribeWav("part", "en-US", { sdkFactory: () => { loaded = true; }, env: ENV, readFile: readFileOf(audio) }),
      (error) => error.code === code);
    assert.equal(loaded, false);
  }
});

test("Azure silence, cancellations and start failures map to safe codes and always clean up", async () => {
  const cases = [
    [batchScript([{ reason: 0, text: "" }]), "NO_SPEECH"],
    [batchScript([], { cancel: 1 }), "STT_PERMISSION"],
    [batchScript([], { cancel: 8 }), "STT_PERMISSION"],
    [batchScript([], { cancel: 3 }), "STT_QUOTA"],
    [batchScript([], { cancel: 5 }), "STT_DEADLINE"],
    [batchScript([], { cancel: 6 }), "STT_PROVIDER_ERROR"],
    [{ startFails: true }, "STT_PROVIDER_ERROR"],
  ];
  for (const [script, code] of cases) {
    const { sdkFactory, calls } = fakeSdk(script);
    const logs = [];
    await assert.rejects(
      transcribeWav("part", "fil-PH", { sdkFactory, env: ENV, readFile: readFileOf(wav(1)), log: (...args) => logs.push(args) }),
      (error) => error instanceof SpeechTranscriptionError && error.code === code,
    );
    assert.equal(calls.closed, 1);
    assert.doesNotMatch(JSON.stringify(logs), /aaaa|southeastasia/);
  }
});

test("a recognizer that never finishes times out with STT_DEADLINE", async () => {
  const { sdkFactory, calls } = fakeSdk({});
  await assert.rejects(
    transcribeWav("part", "en-US", { sdkFactory, env: { ...ENV, AZURE_SPEECH_TIMEOUT_MS: "5000" }, readFile: readFileOf(wav(1)), log() {} }),
    (error) => error.code === "STT_DEADLINE",
  );
  assert.equal(calls.closed, 1);
});

test("English pronunciation assessment returns Azure's own scores against the saved passage", async () => {
  const words = [
    { Word: "every", PronunciationAssessment: { AccuracyScore: 95, ErrorType: "None" } },
    { Word: "saturday", PronunciationAssessment: { AccuracyScore: 41, ErrorType: "Mispronunciation" } },
    { Word: "odd", PronunciationAssessment: { AccuracyScore: 140, ErrorType: "Unknown" } },
  ];
  const { sdkFactory, calls } = fakeSdk(batchScript([
    recognized("Every Saturday", { assessment: { accuracyScore: 68, fluencyScore: 80, detailResult: { Words: words } } }),
  ]));
  const result = await assessPronunciationWav(wav(2), "en", " Every Saturday morning. ", { sdkFactory, env: ENV, log() {} });
  assert.deepEqual(calls.assessments, [{ reference: "Every Saturday morning.", grading: 2, granularity: 2, miscue: false }]);
  assert.equal(calls.recognizers[0].assessed, true);
  assert.equal(calls.configs[0].speechRecognitionLanguage, "en-US");
  assert.ok(Number.isInteger(result.assessmentMs) && result.assessmentMs >= 0);
  assert.deepEqual(result, {
    provider: "azure", locale: "en-US", scale: "0-100",
    // The whole uploaded recording was assessed in one session.
    complete: true, durationSeconds: 2, assessmentMs: result.assessmentMs,
    utterances: [{
      text: "Every Saturday", accuracy: 68, fluency: 80,
      words: [
        { word: "every", accuracy: 95, errorType: "None" },
        { word: "saturday", accuracy: 41, errorType: "Mispronunciation" },
        { word: "odd", accuracy: null, errorType: null },
      ],
    }],
  });
  assert.equal("overall" in result, false, "no aggregate score is invented");
});

test("Filipino pronunciation assessment is refused before Azure is contacted", async () => {
  let loaded = false;
  await assert.rejects(
    assessPronunciationWav(wav(1), "fil", "Tuwing Sabado", { sdkFactory: () => { loaded = true; }, env: ENV }),
    (error) => error.code === "PRONUNCIATION_UNSUPPORTED",
  );
  assert.equal(loaded, false);
});

for (const [locale, voice] of [["en-US", "en-US-JennyNeural"], ["fil-PH", "fil-PH-BlessicaNeural"]]) {
  test(`TTS for ${locale} uses ${voice} and returns MP3 bytes`, async () => {
    const { sdkFactory, calls } = fakeSdk({
      synthesize: (_synth, text, ok) => ok({ reason: 8, audioData: Uint8Array.from([0xff, 0xf3, 1, 2]).buffer, text }),
    });
    const audio = await synthesizeSpeech("mangga", locale, { sdkFactory, env: ENV });
    assert.ok(Buffer.isBuffer(audio));
    assert.equal(audio.length, 4);
    assert.equal(calls.synthesizers[0].config.speechSynthesisVoiceName, voice);
    assert.equal(calls.synthesizers[0].config.speechSynthesisOutputFormat, "mp3");
    assert.equal(calls.synthesizers[0].audio, null, "audio is returned, not played on the server");
    assert.equal(calls.closed, 1);
  });
}

test("TTS cancellations and empty audio become safe errors", async () => {
  for (const [script, code] of [
    [(_s, _t, ok) => ok({ reason: 1, errorCode: 1 }), "STT_PERMISSION"],
    [(_s, _t, ok) => ok({ reason: 1, errorCode: 3 }), "STT_QUOTA"],
    [(_s, _t, ok) => ok({ reason: 8, audioData: new ArrayBuffer(0) }), "STT_PROVIDER_ERROR"],
    [(_s, _t, _ok, fail) => fail("socket"), "STT_PROVIDER_ERROR"],
  ]) {
    const { sdkFactory, calls } = fakeSdk({ synthesize: script });
    await assert.rejects(synthesizeSpeech("word", "en-US", { sdkFactory, env: ENV, log() {} }), (error) => error.code === code);
    assert.equal(calls.closed, 1);
  }
});

test("live recognition stream emits interim and ordered final results and half-closes on end()", async () => {
  const { sdkFactory, calls } = fakeSdk({});
  const stream = createRecognitionStream({ languageCode: "fil-PH", sampleRateHertz: 16000, channels: 1 }, { sdkFactory, env: ENV });
  const events = [];
  stream.on("data", (data) => events.push(["data", data]));
  stream.on("end", () => events.push(["end"]));
  stream.on("close", () => events.push(["close"]));
  await new Promise((resolve) => setImmediate(resolve));
  const recognizer = calls.recognizers[0];
  assert.equal(calls.configs[0].speechRecognitionLanguage, "fil-PH");
  const frame = Buffer.alloc(3200, 1);
  assert.equal(stream.write(frame), true);
  assert.equal(calls.pushes[0].bytes, 3200);
  recognizer.recognizing(recognizer, { result: { text: "Tuwing Sabado" } });
  recognizer.recognized(recognizer, { result: recognized("Tuwing Sabado ng umaga", { offset: 5, duration: 10, confidence: 0.75 }) });
  recognizer.recognized(recognizer, { result: { reason: 0, text: "" } });
  stream.end();
  assert.equal(calls.pushes[0].closed, true);
  assert.equal(stream.write(frame), true, "writes after end() are ignored");
  assert.equal(calls.pushes[0].bytes, 3200);
  recognizer.sessionStopped(recognizer, {});
  stream.destroy();
  stream.destroy();
  assert.deepEqual(events, [
    ["data", { results: [{ isFinal: false, text: "Tuwing Sabado" }] }],
    ["data", { results: [{ isFinal: true, text: "Tuwing Sabado ng umaga", endOffsetTicks: 15, confidence: 0.75 }] }],
    ["end"],
    ["close"],
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.closed, 1);
});

test("live recognition stream reports Azure cancellation as an error, but not end of stream", async () => {
  const { sdkFactory, calls } = fakeSdk({});
  const stream = createRecognitionStream({ languageCode: "en-US", sampleRateHertz: 16000, channels: 1 }, { sdkFactory, env: ENV });
  const events = [];
  stream.on("error", () => events.push("error"));
  stream.on("end", () => events.push("end"));
  const recognizer = calls.recognizers[0];
  recognizer.canceled(recognizer, { reason: 1 });
  assert.deepEqual(events, []);
  recognizer.canceled(recognizer, { reason: 0, errorCode: 1 });
  recognizer.sessionStopped(recognizer, {});
  assert.deepEqual(events, ["error"], "a failed session never looks like a clean end");
  stream.destroy();
});
