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
    // Mirrors SDK 1.52: close() on a push-stream AudioConfig throws; turnOff() is the working release path.
    AudioConfig: { fromStreamInput: () => ({ close: () => { throw new TypeError("Cannot read properties of undefined (reading 'then')"); }, turnOff: async () => { calls.audioClosed++; if (options.audioTurnOffFails) throw new Error(SECRET); } }) },
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
    close(done, fail) {
      calls.closed++;
      if (options.cleanupThrows) throw new Error(SECRET);
      if (options.cleanupHang) return;
      setTimeout(options.cleanupError ? () => fail(SECRET) : done, options.cleanupDelay || 0);
    }
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
  assert.match((await broken.adapter.transcribe(input())).warnings.join(" "), /cleanup did not confirm/);
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
// Fictional keys only. The 84-char value mirrors the current Azure key shape (alphanumeric, beyond hex).
const FICTIONAL_KEY_84 = "Fict10nalTestKeyNotReal".repeat(4).slice(0, 84);
const FICTIONAL_KEY_HEX = "0123456789abcdef0123456789ABCDEF";
const validEnv = (changes = {}) => ({ SPEECH_LAB_AZURE_ENABLED: "true", SPEECH_LAB_AZURE_LIVE_APPROVED: "true", SPEECH_LAB_AZURE_RESOURCE_TIER: "F0", SPEECH_LAB_AZURE_KEY: FICTIONAL_KEY_84, SPEECH_LAB_AZURE_REGION: "southeastasia", ...changes });
test("key validation accepts 84-char alphanumeric and legacy hex keys, rejects placeholders and malformed values", () => {
  assert.equal(FICTIONAL_KEY_84.length, 84); assert.match(FICTIONAL_KEY_84, /[g-z]/i);
  for (const key of [FICTIONAL_KEY_84, FICTIONAL_KEY_HEX]) {
    const c = parseAzureConfig(validEnv({ SPEECH_LAB_AZURE_KEY: key }));
    assert.equal(c.enabled, true); assert.equal(c.key, key); assert.equal(c.tier, "F0");
  }
  const rejected = [undefined, "", " ", FICTIONAL_KEY_84.slice(0, 31), "A".repeat(129) + "b", ` ${FICTIONAL_KEY_84}`, `${FICTIONAL_KEY_84} `, `"${FICTIONAL_KEY_84}"`, FICTIONAL_KEY_84.slice(0, 40) + " " + FICTIONAL_KEY_84.slice(41), FICTIONAL_KEY_84.slice(0, 83) + "\n", "<your-azure-speech-key-goes-here-please>", "YOUR_AZURE_SPEECH_KEY_PLACEHOLDER_VALUE", "your-key-here", "changeme", "<KEY>", "${SPEECH_LAB_AZURE_KEY}", FICTIONAL_KEY_84.slice(0, 42) + "-" + FICTIONAL_KEY_84.slice(43), FICTIONAL_KEY_84.slice(0, 83) + "="];
  for (const key of rejected) {
    const c = parseAzureConfig(validEnv({ SPEECH_LAB_AZURE_KEY: key }));
    assert.equal(c.enabled, false, `accepted ${JSON.stringify(key?.slice(0, 8))}`); assert.equal(c.key, undefined); assert.ok(!JSON.stringify(c).includes(FICTIONAL_KEY_84.slice(0, 31)));
  }
});
test("both enablement switches and the F0-only restriction still gate a valid 84-char key", () => {
  assert.equal(parseAzureConfig(validEnv()).enabled, true);
  for (const value of [undefined, "false", "TRUE", "1", "yes", " true"]) {
    assert.equal(parseAzureConfig(validEnv({ SPEECH_LAB_AZURE_ENABLED: value })).enabled, false);
    assert.equal(parseAzureConfig(validEnv({ SPEECH_LAB_AZURE_LIVE_APPROVED: value })).enabled, false);
  }
  for (const tier of [undefined, "", "S0", "s0", "f0", "F0 ", "S1"]) assert.equal(parseAzureConfig(validEnv({ SPEECH_LAB_AZURE_RESOURCE_TIER: tier })).enabled, false);
});
test("providers endpoint reports Azure ready with valid fictional config; mocks stay functional; no SDK loaded", async () => {
  const http = require("node:http");
  const { createApp } = require("../server");
  let sdkLoads = 0;
  const registry = createRegistry(parseAzureConfig(validEnv()), { sdkFactory: () => { sdkLoads++; throw new Error("SDK must not load in this test"); } });
  const server = createApp({ registry }).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const request = (route, body) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path: `/api/speech-lab/${route}`, method: body ? "POST" : "GET", headers: { Host: "127.0.0.1:5002", "X-Speech-Lab": "1", "Content-Type": "application/json" } }, res => {
      const chunks = []; res.on("data", chunk => chunks.push(chunk)); res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() }));
    }); req.on("error", reject); req.end(body ? JSON.stringify(body) : undefined);
  });
  try {
    const response = await request("providers"); assert.equal(response.status, 200);
    assert.ok(!response.text.includes(FICTIONAL_KEY_84)); assert.doesNotMatch(response.text, /"key"/i);
    const { providers } = JSON.parse(response.text);
    const azure = providers.find(p => p.id === "azure");
    assert.equal(azure.status, "real"); assert.equal(azure.reason, undefined);
    assert.deepEqual(azure.languages, ["en", "fil"]); assert.deepEqual(azure.operations, ["transcribe", "synthesize", "assess"]);
    assert.deepEqual(azure.capabilities, { en: ["transcribe", "synthesize", "assess"], fil: ["transcribe", "synthesize"] });
    for (const id of ["mock-full", "mock-stt-tts"]) assert.equal(providers.find(p => p.id === id).status, "simulated");
    for (const [provider, language] of [["mock-full", "en"], ["mock-stt-tts", "fil"]]) {
      const mock = await request("synthesize", { provider, language, text: "A bird rests.", scenario: "complete" });
      assert.equal(mock.status, 200); assert.equal(JSON.parse(mock.text).simulated, true);
    }
    assert.equal(sdkLoads, 0);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
// Regression: real SDK close() waits for the peer to tear down the WebSocket, which outlasted the old 2 s budget.
test("TTS close slower than the old 2 s budget completes cleanly with the default cleanup budget", async () => {
  const { sdk, calls } = fakeSDK({ cleanupDelay: 2100 });
  const adapter = createAzureAdapter(config, { sdkFactory: () => sdk });
  const result = await adapter.synthesize(input());
  assert.deepEqual(Buffer.from(result.audioBase64, "base64"), tone()); assert.equal(calls.closed, 1);
  assert.doesNotMatch(result.warnings.join(" "), /cleanup/);
  await adapter.synthesize(input()); assert.equal(calls.closed, 2); assert.equal(calls.starts, 2);
});
test("successful TTS is returned when cleanup is unconfirmed, and Azure then stays locked", async () => {
  for (const options of [{ cleanupHang: true }, { cleanupError: true }, { cleanupThrows: true }]) {
    const { adapter, calls } = setup(options);
    const result = await adapter.synthesize(input());
    assert.deepEqual(Buffer.from(result.audioBase64, "base64"), tone());
    assert.match(result.warnings.join(" "), /cleanup did not confirm.*restart the lab/i); assert.ok(!JSON.stringify(result).includes(SECRET));
    await assert.rejects(adapter.synthesize(input()), { code: "AZURE_CLEANUP_FAILED" });
    await assert.rejects(adapter.transcribe(input()), { code: "AZURE_CLEANUP_FAILED" });
    assert.equal(calls.starts, 1); assert.equal(calls.closed, 1);
  }
});
test("failed, timed-out or cancelled TTS with failed cleanup reports AZURE_CLEANUP_FAILED and locks Azure", async () => {
  const cases = [[{ startError: true, cleanupHang: true }, {}], [{ hang: true, cleanupError: true }, { timeoutMs: 10 }], [{ hang: true, cleanupThrows: true }, {}, true]];
  for (const [options, changes, cancel] of cases) {
    const { adapter, calls } = setup(options, changes); const controller = new AbortController();
    const pending = adapter.synthesize({ ...input(), signal: controller.signal }); if (cancel) controller.abort();
    await assert.rejects(pending, e => e.code === "AZURE_CLEANUP_FAILED" && !e.message.includes(SECRET));
    await assert.rejects(adapter.synthesize(input()), { code: "AZURE_CLEANUP_FAILED" }); assert.equal(calls.closed, 1);
  }
});
test("repeated TTS after successful cleanup closes every synthesizer and never leaks the lock", async () => {
  const { adapter, registry, calls } = setup({ cleanupDelay: 5 });
  for (let i = 1; i <= 5; i++) {
    const result = await adapter.synthesize(input(i % 2 ? "en" : "fil"));
    assert.equal(calls.closed, i); assert.equal(calls.starts, i); assert.doesNotMatch(result.warnings.join(" "), /cleanup/);
  }
  const pending = adapter.synthesize(input());
  await assert.rejects(adapter.synthesize(input()), { code: "LAB_BUSY" }); await pending; assert.equal(calls.closed, 6);
  const routed = await runExperiment("synthesize", { ...input(), provider: "azure" }, undefined, undefined, registry);
  assert.equal(routed.simulated, false); assert.equal(routed.label, "REAL AZURE — cloud speech result"); assert.ok(routed.audioBase64);
});
// Regression: SDK 1.52 AudioConfig.close() throws for push streams, which flagged every STT/assessment cleanup as failed.
test("real SDK push-stream AudioConfig: close() throws, turnOff() releases cleanly (offline)", async () => {
  const sdk = require("microsoft-cognitiveservices-speech-sdk");
  const stream = sdk.AudioInputStream.createPushStream(sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1));
  const audioConfig = sdk.AudioConfig.fromStreamInput(stream);
  assert.throws(() => audioConfig.close(), TypeError, "SDK fixed AudioConfig.close(); revisit the adapter's turnOff() workaround");
  await assert.doesNotReject(async () => audioConfig.turnOff()); stream.close();
});
test("STT and English assessment clean up fully, repeatedly, without warnings or a leaked lock", async () => {
  const { adapter, calls } = setup({ cleanupDelay: 5 });
  for (let i = 1; i <= 4; i++) {
    const result = i % 2 ? await adapter.transcribe(input(i === 3 ? "fil" : "en")) : await adapter.assessPronunciation(input());
    assert.equal(result.completeness, "complete"); assert.doesNotMatch(result.warnings.join(" "), /cleanup/);
    assert.equal(calls.closed, i); assert.equal(calls.streamClosed, i); assert.equal(calls.audioClosed, i); assert.equal(calls.starts, i);
  }
  for (const operation of ["transcribe", "assessPronunciation"]) {
    const pending = adapter[operation](input());
    await assert.rejects(adapter.transcribe(input()), { code: "LAB_BUSY" }); await assert.rejects(adapter.synthesize(input()), { code: "LAB_BUSY" }); await pending;
  }
  assert.equal(calls.starts, 6); assert.equal(calls.closed, 6);
});
test("STT recognizer close slower than the old 2 s budget completes with the default cleanup budget", async () => {
  const { sdk, calls } = fakeSDK({ cleanupDelay: 2100 });
  const result = await createAzureAdapter(config, { sdkFactory: () => sdk }).transcribe(input());
  assert.equal(result.transcript, "A bird rests."); assert.doesNotMatch(result.warnings.join(" "), /cleanup/); assert.equal(calls.audioClosed, 1);
});
test("STT/assessment timeout and cancellation with clean cleanup keep their own error and leave Azure usable", async () => {
  for (const operation of ["transcribe", "assessPronunciation"]) {
    const timed = setup({ hang: true }, { timeoutMs: 10 });
    await assert.rejects(timed.adapter[operation](input()), { code: "AZURE_TIMEOUT" });
    assert.equal(timed.calls.closed, 1); assert.equal(timed.calls.audioClosed, 1);
    const controller = new AbortController(); const cancelled = setup({ hang: true });
    const pending = cancelled.adapter[operation]({ ...input(), signal: controller.signal }); controller.abort();
    await assert.rejects(pending, { code: "CANCELLED" }); assert.equal(cancelled.calls.audioClosed, 1);
    // Not locked: the next request reaches the SDK again (this fixture still hangs, so it ends by its own timeout/cancel).
    await assert.rejects(timed.adapter[operation](input()), { code: "AZURE_TIMEOUT" }); assert.equal(timed.calls.starts, 2);
    const again = new AbortController(); const retry = cancelled.adapter[operation]({ ...input(), signal: again.signal });
    await new Promise(resolve => setImmediate(resolve)); again.abort();
    await assert.rejects(retry, { code: "CANCELLED" }); assert.equal(cancelled.calls.starts, 2);
  }
});
test("unconfirmed STT/assessment cleanup preserves the result, reports it separately and locks Azure", async () => {
  for (const operation of ["transcribe", "assessPronunciation"]) {
    for (const options of [{ cleanupHang: true }, { cleanupError: true }, { cleanupThrows: true }, { audioTurnOffFails: true }]) {
      const { adapter, calls } = setup(options);
      const result = await adapter[operation](input());
      assert.equal(result.transcript, "A bird rests."); assert.equal(result.completeness, "complete");
      if (operation === "assessPronunciation") assert.equal(result.pronunciation.kind, "azure");
      assert.match(result.warnings.join(" "), /cleanup did not confirm/); assert.ok(!JSON.stringify(result).includes(SECRET));
      for (const next of ["transcribe", "assessPronunciation", "synthesize"]) await assert.rejects(adapter[next](input()), { code: "AZURE_CLEANUP_FAILED" });
      assert.equal(calls.starts, 1); assert.equal(calls.streamClosed, 1);
    }
  }
  const timedOut = setup({ hang: true, cleanupHang: true }, { timeoutMs: 10 });
  await assert.rejects(timedOut.adapter.transcribe(input()), { code: "AZURE_CLEANUP_FAILED" });
  await assert.rejects(timedOut.adapter.transcribe(input()), { code: "AZURE_CLEANUP_FAILED" }); assert.equal(timedOut.calls.starts, 1);
});
