"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAzureAdapter } = require("../adapters/azure");
const { createRegistry } = require("../providerRegistry");
const { parseAzureConfig } = require("../azureConfig");
const { createUsageLimits } = require("../usageLimits");
const { runExperiment } = require("../routes");
const { tone } = require("../adapters/mock");
const { validateAudio } = require("../audioValidation");
const { assessmentSegment } = require("../azureResults");
const SECRET = "a".repeat(32);
const config = parseAzureConfig({ SPEECH_LAB_AZURE_ENABLED: "true", SPEECH_LAB_AZURE_LIVE_APPROVED: "true", SPEECH_LAB_AZURE_RESOURCE_TIER: "F0", SPEECH_LAB_AZURE_KEY: SECRET, SPEECH_LAB_AZURE_REGION: "southeastasia" });
function fakeSDK(options = {}) {
  const calls = { closed: 0, streamClosed: 0, audioClosed: 0, writes: [], config: null, assessment: null, starts: 0 };
  const sdk = {
    SpeechConfig: { fromSubscription(key, region) { assert.equal(key, SECRET); assert.equal(region, "southeastasia"); calls.config = { setProperty: (key, value) => { assert.equal(key, "SPEECH-Error-MaxRetryCount"); assert.equal(value, "0"); } }; return calls.config; } },
    AudioStreamFormat: { getWaveFormatPCM: (...args) => { assert.deepEqual(args, [16000, 16, 1]); return {}; } },
    AudioInputStream: { createPushStream: () => ({ write: bytes => calls.writes.push(Buffer.from(bytes)), close: () => calls.streamClosed++ }) },
    AudioConfig: { fromStreamInput: () => ({ close: () => calls.audioClosed++ }) },
    ResultReason: { RecognizedSpeech: 3, NoMatch: 0, SynthesizingAudioCompleted: 9 },
    CancellationReason: { Error: 1, EndOfStream: 2 },
    CancellationErrorCode: { AuthenticationFailure: 1, TooManyRequests: 3, Forbidden: 4 },
    CancellationDetails: { fromResult: () => ({ errorCode: options.cancelCode, errorDetails: SECRET }) },
    PronunciationAssessmentGradingSystem: { HundredMark: 1 },
    PronunciationAssessmentGranularity: { Phoneme: 3 },
    SpeechSynthesisOutputFormat: { Riff16Khz16BitMonoPcm: 5 },
    PronunciationAssessmentResult: { fromResult: () => ({ accuracyScore: 81, fluencyScore: 72, detailResult: { Words: [{ Word: "bird", PronunciationAssessment: { AccuracyScore: 65, ErrorType: "Mispronunciation" }, Offset: 1000, Duration: 3000 }] } }) },
    PronunciationAssessmentConfig: class { constructor(...args) { calls.assessment = args; } applyTo() {} },
  };
  class Client {
    close(done) { calls.closed++; if (options.cleanupHang) return; setTimeout(done, options.cleanupDelay || 0); }
  }
  sdk.SpeechRecognizer = class extends Client {
    static enableTelemetry(value) { assert.equal(value, false); }
    startContinuousRecognitionAsync(done, error) {
      calls.starts++;
      if (options.startError) { error(SECRET); return; }
      done(); calls.client = this;
      if (options.hang) return;
      queueMicrotask(() => {
        if (options.cancelCode) { this.canceled?.(this, { reason: 1, errorCode: options.cancelCode, errorDetails: SECRET }); return; }
        for (const text of options.texts || ["A bird", "rests."]) this.recognized?.(this, { result: { text, reason: 3 } });
        if (options.noMatch) this.recognized?.(this, { result: { reason: 0 } });
        this.sessionStopped?.();
      });
    }
  };
  sdk.SpeechSynthesizer = class extends Client {
    speakTextAsync(text, done, error) {
      calls.text = text; calls.starts++;
      if (options.startError) { error(SECRET); return; }
      if (options.hang) return;
      queueMicrotask(() => done({ reason: options.cancelCode ? 1 : 9, audioData: options.output || tone() }));
    }
  };
  return { sdk, calls };
}
const input = (language = "en") => ({ language, text: "A bird rests.", audio: tone(), scenario: "complete" });
function setup(options = {}, changes = {}) {
  const { sdk, calls } = fakeSDK(options);
  const cfg = { ...config, ...changes };
  return { calls, adapter: createAzureAdapter(cfg, { sdkFactory: () => sdk, cleanupMs: 25 }), registry: createRegistry(cfg, { sdkFactory: () => sdk, cleanupMs: 25 }) };
}
test("Azure is disabled by default; paid, unapproved, invalid voice/config all fail closed", () => {
  assert.equal(parseAzureConfig().enabled, false);
  const env = { SPEECH_LAB_AZURE_ENABLED: "true", SPEECH_LAB_AZURE_LIVE_APPROVED: "true", SPEECH_LAB_AZURE_RESOURCE_TIER: "F0", SPEECH_LAB_AZURE_KEY: SECRET, SPEECH_LAB_AZURE_REGION: "southeastasia" };
  for (const change of [{ SPEECH_LAB_AZURE_LIVE_APPROVED: "false" }, { SPEECH_LAB_AZURE_RESOURCE_TIER: "S0" }, { SPEECH_LAB_AZURE_VOICE_FIL: "en-US-JennyNeural" }, { SPEECH_LAB_AZURE_TIMEOUT_MS: "Infinity" }, { SPEECH_LAB_AZURE_REGION: "https://evil.invalid" }]) {
    const c = parseAzureConfig({ ...env, ...change }); assert.equal(c.enabled, false); assert.ok(!JSON.stringify(c).includes(SECRET));
  }
  assert.equal(config.enabled, true);
});
test("continuous STT combines utterances for both locales without reference hints", async () => {
  for (const [language, locale] of [["en", "en-US"], ["fil", "fil-PH"]]) {
    const { adapter, calls } = setup();
    const result = await adapter.transcribe(input(language));
    assert.equal(result.transcript, "A bird rests."); assert.equal(result.locale, locale);
    assert.equal(calls.config.speechRecognitionLanguage, locale); assert.equal(calls.assessment, null);
    assert.deepEqual(calls.writes, [tone().subarray(44)]);
    assert.equal(calls.closed, 1); assert.equal(calls.streamClosed, 1); assert.equal(calls.audioClosed, 1);
  }
});
test("pronunciation preserves original segment and word scores, has no fabricated overall score", async () => {
  const { adapter, calls } = setup();
  const result = await adapter.assessPronunciation(input());
  assert.deepEqual(calls.assessment, ["A bird rests.", 1, 3, false]);
  assert.equal(result.pronunciation.kind, "azure"); assert.deepEqual(result.pronunciation.scores, {});
  assert.equal(result.pronunciation.segments.length, 2);
  assert.equal(result.pronunciation.segments[0].scores.accuracy, 81);
  assert.equal(result.pronunciation.segments[0].words[0].accuracy, 65);
});
test("Filipino pronunciation is rejected by registry and adapter before SDK start", async () => {
  const { adapter, registry, calls } = setup();
  assert.throws(() => registry.getAdapter("azure", "assess", "fil"), { code: "UNSUPPORTED_CAPABILITY" });
  await assert.rejects(adapter.assessPronunciation(input("fil")), { code: "UNSUPPORTED_CAPABILITY" });
  assert.equal(calls.starts, 0);
});
test("TTS selects allowlisted locale voice and RIFF output, closes SDK, enforces output/text limits", async () => {
  for (const language of ["en", "fil"]) {
    const { adapter, calls } = setup(); const result = await adapter.synthesize(input(language));
    assert.equal(result.voice, config.voices[language]); assert.equal(calls.config.speechSynthesisVoiceName, config.voices[language]);
    assert.equal(calls.config.speechSynthesisOutputFormat, 5); assert.equal(calls.closed, 1);
    assert.deepEqual(Buffer.from(result.audioBase64, "base64"), tone());
  }
  const { adapter } = setup(); await assert.rejects(adapter.synthesize({ ...input(), text: "x".repeat(1001) }), { code: "INVALID_TEXT" });
  await assert.rejects(setup({ output: Buffer.alloc(2 * 1024 * 1024 + 1) }).adapter.synthesize(input()), { code: "AZURE_RESULT" });
});
test("actual SDK can load and parse assessment JSON offline on this Node runtime", () => {
  const sdk = require("microsoft-cognitiveservices-speech-sdk");
  const properties = new sdk.PropertyCollection();
  properties.setProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult, JSON.stringify({ NBest: [{ PronunciationAssessment: { AccuracyScore: 0, FluencyScore: 91 }, Words: [{ Word: "bird", PronunciationAssessment: { AccuracyScore: 88, ErrorType: "None" } }] }] }));
  const segment = assessmentSegment(sdk, { properties, text: "bird" });
  assert.equal(segment.scores.accuracy, 0); assert.equal(segment.words[0].accuracy, 88);
});
test("strict WAV rejects other rates and extracts arbitrary data chunk offset", async () => {
  const wav = tone(); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  await assert.rejects(setup().adapter.transcribe({ ...input(), audio: wav }), { code: "INVALID_AUDIO" });
  const chunk = Buffer.alloc(12); chunk.write("JUNK"); chunk.writeUInt32LE(4, 4);
  const padded = Buffer.concat([tone().subarray(0, 36), chunk, tone().subarray(36)]); padded.writeUInt32LE(padded.length - 8, 4);
  assert.equal(validateAudio(padded, { azure: true }).dataOffset, 56);
  const { adapter, calls } = setup(); await adapter.transcribe({ ...input(), audio: padded }); assert.deepEqual(calls.writes[0], tone().subarray(44));
  const long = Buffer.concat([tone().subarray(0, 44), Buffer.alloc(16000 * 2 * 31)]); long.writeUInt32LE(long.length - 8, 4); long.writeUInt32LE(long.length - 44, 40);
  await assert.rejects(adapter.transcribe({ ...input(), audio: long }), { code: "AUDIO_TOO_LONG" });
});
test("empty and incomplete results suppress pronunciation and reading percentages", async () => {
  for (const options of [{ texts: [], noMatch: true }, { texts: ["A bird"], noMatch: true }]) {
    const { registry } = setup(options); const result = await runExperiment("assess", { ...input(), provider: "azure" }, tone(), undefined, registry);
    assert.equal(result.pronunciation, null); assert.equal(result.agreement.available, false);
  }
});
test("reading accuracy is independent STT only and provenance cannot be confused", async () => {
  const { registry } = setup({ texts: ["A cat rests extra."] });
  const result = await runExperiment("transcribe", { ...input(), provider: "azure" }, tone(), undefined, registry);
  assert.equal(result.simulated, false); assert.equal(result.agreement.accuracy, 100 * 2 / 3);
  assert.deepEqual(result.agreement.discrepancies.map(d => d.kind), ["substitution", "insertion"]);
  const assessed = await runExperiment("assess", { ...input(), provider: "azure" }, tone(), undefined, registry);
  assert.equal(assessed.agreement.available, false); assert.equal(assessed.agreement.accuracy, undefined);
  assert.ok(!JSON.stringify([result, assessed, registry.listProviders()]).includes(SECRET));
});
test("timeouts, aborts, start failures and quota errors close SDK and sanitize errors", async () => {
  for (const operation of ["transcribe", "synthesize", "assessPronunciation"]) {
    const timed = setup({ hang: true }, { timeoutMs: 10 });
    await assert.rejects(timed.adapter[operation](input()), { code: "AZURE_TIMEOUT" }); assert.equal(timed.calls.closed, 1);
    const cancelled = setup({ hang: true }); const controller = new AbortController();
    const pending = cancelled.adapter[operation]({ ...input(), signal: controller.signal }); controller.abort();
    await assert.rejects(pending, { code: "CANCELLED" }); assert.equal(cancelled.calls.closed, 1);
    const failed = setup({ startError: true });
    await assert.rejects(failed.adapter[operation](input()), e => e.code === "AZURE_SERVICE" && !e.message.includes(SECRET)); assert.equal(failed.calls.closed, 1);
  }
  await assert.rejects(setup({ cancelCode: 1 }).adapter.transcribe(input()), { code: "AZURE_AUTH" });
  await assert.rejects(setup({ cancelCode: 3 }).adapter.transcribe(input()), { code: "AZURE_QUOTA" });
  await assert.rejects(setup({ cancelCode: 3 }).adapter.synthesize(input()), { code: "AZURE_QUOTA" });
});
test("aborted-before-start consumes nothing; cleanup failure disables further work", async () => {
  const pre = setup(); const controller = new AbortController(); controller.abort();
  await assert.rejects(pre.adapter.transcribe({ ...input(), signal: controller.signal }), { code: "CANCELLED" }); assert.equal(pre.calls.starts, 0);
  const broken = setup({ cleanupHang: true });
  await assert.rejects(broken.adapter.transcribe(input()), { code: "AZURE_CLEANUP_FAILED" });
  await assert.rejects(broken.adapter.transcribe(input()), { code: "AZURE_CLEANUP_FAILED" }); assert.equal(broken.calls.starts, 1);
});
test("session reservations survive failures and concurrency stays locked through cleanup", async () => {
  const failed = setup({ startError: true }, { audioSeconds: 1 });
  await assert.rejects(failed.adapter.transcribe(input()), { code: "AZURE_SERVICE" });
  await assert.rejects(failed.adapter.transcribe(input()), { code: "AZURE_SESSION_LIMIT" });
  const delayed = setup({ cleanupDelay: 15 }); const pending = delayed.adapter.transcribe(input());
  await assert.rejects(delayed.adapter.transcribe(input()), { code: "LAB_BUSY" }); await pending;
});
test("TTS rate and character budgets are bounded with a rolling minute", () => {
  let now = 0; const limits = createUsageLimits({ ...config, ttsCharacters: 8, ttsPerMinute: 1 }, () => now);
  limits.reserve("synthesize", 4)(true);
  assert.throws(() => limits.reserve("synthesize", 1), { code: "AZURE_RATE_LIMIT" });
  now = 60001; limits.reserve("synthesize", 4)(true); now += 60001;
  assert.throws(() => limits.reserve("synthesize", 1), { code: "AZURE_SESSION_LIMIT" });
});
test("HTTP Azure responses and errors never serialize configuration, keys or raw SDK diagnostics", async () => {
  const http = require("node:http");
  const { createApp } = require("../server");
  const { registry } = setup({ startError: true });
  const server = createApp({ registry }).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const captured = [];
  const loggers = ["log", "warn", "error", "info"];
  const originals = loggers.map(name => console[name]);
  for (const name of loggers) console[name] = (...args) => captured.push(args.join(" "));
  const request = (route, body) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path: `/api/speech-lab/${route}`, method: body ? "POST" : "GET", headers: { Host: "127.0.0.1:5002", "X-Speech-Lab": "1", "Content-Type": "application/json" } }, res => {
      const chunks = []; res.on("data", chunk => chunks.push(chunk)); res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() }));
    }); req.on("error", reject); req.end(body ? JSON.stringify(body) : undefined);
  });
  try {
    const providers = await request("providers"); assert.equal(providers.status, 200); assert.ok(!providers.text.includes(SECRET));
    const error = await request("synthesize", { provider: "azure", language: "en", text: "Test" });
    assert.equal(error.status, 502); assert.ok(!error.text.includes(SECRET)); assert.match(error.text, /AZURE_SERVICE/);
    const unsupported = await request("assess", { provider: "azure", language: "fil", text: "Test" });
    assert.equal(unsupported.status, 422); assert.match(unsupported.text, /UNSUPPORTED_CAPABILITY/);
    assert.ok(!captured.join(" ").includes(SECRET));
  } finally { loggers.forEach((name, i) => { console[name] = originals[i]; }); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
