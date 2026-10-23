const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const { getAzureSpeechConfig } = require("./azureSpeechConfig");
const { SpeechTranscriptionError } = require("./speechErrors");
const { SPEECH_SAMPLE_RATE, readSpeechWav, wavPcmArrayBuffer } = require("./wavAudio");

// Azure Speech (microsoft-cognitiveservices-speech-sdk 1.52.0, pinned) for M2
// diagnostics and M5 read-alouds. SDK handling follows the tested Speech Lab
// adapter (experiments/speech-lab/adapters/azure.js): telemetry off, no SDK
// connection retries, a deadline per operation and cleanup on every path.
// The key and region stay in the backend environment; nothing here is sent to
// the browser.
const defaultSdkFactory = () => require("microsoft-cognitiveservices-speech-sdk");
const MAX_TTS_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_RESULT_CHARACTERS = 20000;
const CLEANUP_MS = 10000;

function createSpeechConfig(sdk, config, locale) {
  sdk.SpeechRecognizer.enableTelemetry(false);
  const speechConfig = sdk.SpeechConfig.fromSubscription(config.key, config.region);
  // Pinned SDK 1.52 reads this in RecognizerConfig; avoid its default four connection retries.
  speechConfig.setProperty("SPEECH-Error-MaxRetryCount", "0");
  if (locale) speechConfig.speechRecognitionLanguage = locale;
  speechConfig.outputFormat = sdk.OutputFormat.Detailed;
  return speechConfig;
}

function cancellationCode(sdk, errorCode) {
  const codes = sdk.CancellationErrorCode ?? {};
  if (errorCode === codes.AuthenticationFailure || errorCode === codes.Forbidden) return "STT_PERMISSION";
  if (errorCode === codes.TooManyRequests) return "STT_QUOTA";
  if (errorCode === codes.ServiceTimeout) return "STT_DEADLINE";
  if (errorCode === codes.BadRequestParameters) return "STT_INVALID_AUDIO";
  return "STT_PROVIDER_ERROR";
}

/** NBest[0].Confidence from the detailed JSON result, when Azure provides it. */
function readConfidence(sdk, result) {
  try {
    const json = JSON.parse(result.properties?.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult) || "{}");
    const confidence = json?.NBest?.[0]?.Confidence;
    return typeof confidence === "number" && confidence >= 0 && confidence <= 1 ? confidence : undefined;
  } catch {
    return undefined;
  }
}

function closeClient(client, cleanupMs = CLEANUP_MS) {
  return new Promise((resolve) => {
    const deadline = setTimeout(() => resolve(false), cleanupMs);
    deadline.unref?.();
    const done = (value) => { clearTimeout(deadline); resolve(value); };
    try { client.close(() => done(true), () => done(false)); } catch { done(false); }
  });
}

// SDK 1.52 AudioConfig.close() throws for push streams; turnOff() is what it would do.
async function releaseAudio(audioConfig) {
  try { await audioConfig?.turnOff(); } catch { /* best effort */ }
}

/**
 * Recognizes one complete PCM part with continuous recognition and resolves at
 * the end of the session. `onRecognized` receives each final utterance.
 */
async function recognizePcm({ sdk, config, locale, pcm, configure, onRecognized, cleanupMs = CLEANUP_MS }) {
  const speechConfig = createSpeechConfig(sdk, config, locale);
  const stream = sdk.AudioInputStream.createPushStream(sdk.AudioStreamFormat.getWaveFormatPCM(SPEECH_SAMPLE_RATE, 16, 1));
  const audioConfig = sdk.AudioConfig.fromStreamInput(stream);
  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
  let streamClosed = false;
  const closeStream = () => { if (!streamClosed) { streamClosed = true; stream.close(); } };
  let extra;
  let finished = false;
  let timer;
  try {
    extra = configure?.(recognizer);
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      const safe = (callback) => (...args) => {
        if (finished) return;
        try { callback(...args); } catch (error) {
          finish(error instanceof SpeechTranscriptionError ? error : new SpeechTranscriptionError("STT_PROVIDER_ERROR"));
        }
      };
      timer = setTimeout(() => finish(new SpeechTranscriptionError("STT_DEADLINE")), config.timeoutMs);
      recognizer.recognized = safe((_sender, event) => {
        if (event.result?.reason === sdk.ResultReason.RecognizedSpeech) onRecognized(event.result);
      });
      recognizer.canceled = safe((_sender, event) => {
        if (event.reason === sdk.CancellationReason.EndOfStream) finish();
        else finish(new SpeechTranscriptionError(cancellationCode(sdk, event.errorCode)));
      });
      recognizer.sessionStopped = safe(() => finish());
      recognizer.startContinuousRecognitionAsync(safe(() => {
        stream.write(pcm);
        closeStream();
      }), () => finish(new SpeechTranscriptionError("STT_PROVIDER_ERROR")));
    });
  } finally {
    finished = true;
    clearTimeout(timer);
    try { closeStream(); } catch { /* already closed */ }
    recognizer.recognized = recognizer.canceled = recognizer.sessionStopped = undefined;
    await closeClient(recognizer, cleanupMs);
    await releaseAudio(audioConfig);
    try { extra?.close?.(); } catch { /* best effort */ }
  }
}

function logProviderFailure(log, operation, error) {
  // Only the safe code is logged: never audio, transcripts, keys or SDK payloads.
  log("Azure Speech operation failed", {
    operation,
    code: error instanceof SpeechTranscriptionError ? error.code : "STT_PROVIDER_ERROR",
  });
}

function toSafeError(error) {
  return error instanceof SpeechTranscriptionError ? error : new SpeechTranscriptionError("STT_PROVIDER_ERROR");
}

/** Speech-to-text for one uploaded part (16 kHz mono PCM WAV file). */
async function transcribeWav(filePath, languageCode, {
  sdkFactory = defaultSdkFactory, env = process.env, readFile = fs.readFile, log = console.error,
} = {}) {
  const config = getAzureSpeechConfig(env);
  const buffer = await readFile(filePath);
  const wav = readSpeechWav(buffer);
  const texts = [];
  const confidences = [];
  let characters = 0;
  try {
    const sdk = sdkFactory();
    await recognizePcm({
      sdk, config, locale: languageCode, pcm: wavPcmArrayBuffer(buffer, wav),
      onRecognized: (result) => {
        const text = typeof result.text === "string" ? result.text.trim() : "";
        if (!text) return;
        characters += text.length;
        if (characters > MAX_RESULT_CHARACTERS) throw new SpeechTranscriptionError("STT_PROVIDER_ERROR");
        texts.push(text);
        const confidence = readConfidence(sdk, result);
        if (confidence !== undefined) confidences.push(confidence);
      },
    });
  } catch (error) {
    logProviderFailure(log, "transcribe", error);
    throw toSafeError(error);
  }
  const text = texts.join(" ").replace(/\s+/g, " ").trim();
  if (!text) throw new SpeechTranscriptionError("NO_SPEECH");
  if (!confidences.length) return { text };
  const confidence = confidences.reduce((total, value) => total + value, 0) / confidences.length;
  return { text, confidence: Number(confidence.toFixed(4)) };
}

const score = (value) => (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null);
const WORD_ERROR_TYPES = ["None", "Mispronunciation", "Omission", "Insertion"];

function assessmentUtterance(sdk, result) {
  const assessment = sdk.PronunciationAssessmentResult.fromResult(result);
  const words = assessment.detailResult?.Words || [];
  if (!Array.isArray(words) || words.length > 5000) throw new SpeechTranscriptionError("STT_PROVIDER_ERROR");
  return {
    text: typeof result.text === "string" ? result.text.slice(0, 5000) : "",
    accuracy: score(assessment.accuracyScore),
    fluency: score(assessment.fluencyScore),
    words: words.map((word) => ({
      word: typeof word.Word === "string" ? word.Word.slice(0, 200) : "",
      accuracy: score(word.PronunciationAssessment?.AccuracyScore),
      errorType: WORD_ERROR_TYPES.includes(word.PronunciationAssessment?.ErrorType)
        ? word.PronunciationAssessment.ErrorType
        : null,
    })),
  };
}

/**
 * Azure Pronunciation Assessment (English only) of one recorded part against
 * the saved passage. Returns Azure's own 0-100 utterance and word scores; no
 * overall score is derived, and reading accuracy is computed separately from
 * the independent transcript.
 */
async function assessPronunciationWav(buffer, language, referenceText, {
  sdkFactory = defaultSdkFactory, env = process.env, log = console.error,
} = {}) {
  if (language !== "en") throw new SpeechTranscriptionError("PRONUNCIATION_UNSUPPORTED");
  if (typeof referenceText !== "string" || !referenceText.trim()) throw new SpeechTranscriptionError("STT_INVALID_AUDIO");
  const config = getAzureSpeechConfig(env);
  const wav = readSpeechWav(buffer);
  const utterances = [];
  try {
    const sdk = sdkFactory();
    await recognizePcm({
      sdk, config, locale: "en-US", pcm: wavPcmArrayBuffer(buffer, wav),
      configure: (recognizer) => {
        const assessment = new sdk.PronunciationAssessmentConfig(
          referenceText.trim(),
          sdk.PronunciationAssessmentGradingSystem.HundredMark,
          sdk.PronunciationAssessmentGranularity.Word,
          false,
        );
        assessment.applyTo(recognizer);
        return assessment;
      },
      onRecognized: (result) => {
        if (utterances.length >= 200) throw new SpeechTranscriptionError("STT_PROVIDER_ERROR");
        const utterance = assessmentUtterance(sdk, result);
        if (utterance.text.trim()) utterances.push(utterance);
      },
    });
  } catch (error) {
    logProviderFailure(log, "pronunciation", error);
    throw toSafeError(error);
  }
  if (!utterances.length) throw new SpeechTranscriptionError("NO_SPEECH");
  return { provider: "azure", locale: "en-US", scale: "0-100", utterances };
}

/** Neural text-to-speech; returns MP3 bytes (served as audio/mpeg). */
async function synthesizeSpeech(text, languageCode, {
  sdkFactory = defaultSdkFactory, env = process.env, log = console.error,
} = {}) {
  const config = getAzureSpeechConfig(env);
  const language = languageCode === "fil-PH" ? "fil" : languageCode === "en-US" ? "en" : null;
  if (!language) throw new SpeechTranscriptionError("STT_INVALID_AUDIO");
  let synthesizer;
  let timer;
  try {
    const sdk = sdkFactory();
    const speechConfig = createSpeechConfig(sdk, config);
    speechConfig.speechSynthesisVoiceName = config.voices[language];
    speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;
    // A null audio config returns the bytes instead of playing them on the server.
    synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      };
      timer = setTimeout(() => finish(new SpeechTranscriptionError("STT_DEADLINE")), config.timeoutMs);
      synthesizer.speakTextAsync(text, (result) => {
        if (result.reason !== sdk.ResultReason.SynthesizingAudioCompleted) {
          const details = sdk.CancellationDetails?.fromResult?.(result);
          finish(new SpeechTranscriptionError(cancellationCode(sdk, details?.errorCode)));
          return;
        }
        const audio = Buffer.from(result.audioData || new ArrayBuffer(0));
        if (!audio.length || audio.length > MAX_TTS_AUDIO_BYTES) {
          finish(new SpeechTranscriptionError("STT_PROVIDER_ERROR"));
          return;
        }
        finish(null, audio);
      }, () => finish(new SpeechTranscriptionError("STT_PROVIDER_ERROR")));
    });
  } catch (error) {
    logProviderFailure(log, "synthesize", error);
    throw toSafeError(error);
  } finally {
    clearTimeout(timer);
    if (synthesizer) await closeClient(synthesizer);
  }
}

/**
 * Live recognition stream for /ws/diagnostic/speech. Exposes the small stream
 * interface diagnosticSpeechStream.js drives: write(frame), end() (half-close:
 * Azure still delivers final results), destroy(); and emits
 *   "data"  { results: [{ isFinal, text, confidence?, endOffsetTicks? }] }
 *   "end"   after the session stops following end()
 *   "error" on cancellation; "close" after destroy().
 */
function createRecognitionStream(request, { sdkFactory = defaultSdkFactory, env = process.env } = {}) {
  const config = getAzureSpeechConfig(env);
  const sdk = sdkFactory();
  const emitter = new EventEmitter();
  const speechConfig = createSpeechConfig(sdk, config, request.languageCode);
  const push = sdk.AudioInputStream.createPushStream(
    sdk.AudioStreamFormat.getWaveFormatPCM(request.sampleRateHertz, 16, request.channels),
  );
  const audioConfig = sdk.AudioConfig.fromStreamInput(push);
  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
  let pushClosed = false;
  let destroyed = false;
  let failed = false;
  const closePush = () => {
    if (pushClosed) return;
    pushClosed = true;
    try { push.close(); } catch { /* already closed */ }
  };
  const emit = (...args) => { if (!destroyed) emitter.emit(...args); };
  const fail = () => {
    if (failed || destroyed) return;
    failed = true;
    emit("error", new SpeechTranscriptionError("STT_PROVIDER_ERROR"));
  };

  recognizer.recognizing = (_sender, event) => {
    const text = typeof event.result?.text === "string" ? event.result.text.trim() : "";
    if (text) emit("data", { results: [{ isFinal: false, text }] });
  };
  recognizer.recognized = (_sender, event) => {
    const result = event.result;
    if (result?.reason !== sdk.ResultReason.RecognizedSpeech) return;
    const text = typeof result.text === "string" ? result.text.trim() : "";
    if (!text) return;
    const end = Number(result.offset) + Number(result.duration);
    const confidence = readConfidence(sdk, result);
    emit("data", {
      results: [{
        isFinal: true, text,
        ...(Number.isFinite(end) ? { endOffsetTicks: end } : {}),
        ...(confidence !== undefined ? { confidence } : {}),
      }],
    });
  };
  recognizer.canceled = (_sender, event) => {
    if (event.reason !== sdk.CancellationReason.EndOfStream) fail();
  };
  recognizer.sessionStopped = () => { if (!failed) emit("end"); };
  recognizer.startContinuousRecognitionAsync(() => {}, fail);

  emitter.write = (frame) => {
    if (destroyed || pushClosed) return true;
    // Copy exactly this frame's bytes (ws Buffers may share a pooled ArrayBuffer).
    push.write(Uint8Array.from(frame).buffer);
    return true; // The push stream buffers internally; no backpressure signal.
  };
  emitter.end = () => closePush();
  emitter.destroy = () => {
    if (destroyed) return;
    closePush();
    destroyed = true;
    recognizer.recognizing = recognizer.recognized = recognizer.canceled = recognizer.sessionStopped = undefined;
    void closeClient(recognizer).then(() => releaseAudio(audioConfig));
    emitter.emit("close");
  };
  return emitter;
}

module.exports = {
  assessPronunciationWav,
  createRecognitionStream,
  synthesizeSpeech,
  transcribeWav,
};
