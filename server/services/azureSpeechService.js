const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const { AMERICAN_EXAMPLE_VOICES, PHILIPPINE_FEEDBACK_VOICES, getAzureSpeechConfig } = require("./azureSpeechConfig");
const { SpeechTranscriptionError } = require("./speechErrors");
const { MAX_WHOLE_RECORDING_SECONDS, SPEECH_SAMPLE_RATE, readSpeechWav, wavPcmArrayBuffer } = require("./wavAudio");

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
async function recognizePcm({
  sdk, config, locale, pcm, configure, onRecognized, onNoMatch, cleanupMs = CLEANUP_MS, timeoutMs = config.timeoutMs, signal,
}) {
  if (signal?.aborted) throw new SpeechTranscriptionError("STT_PROVIDER_ERROR");
  const speechConfig = createSpeechConfig(sdk, config, locale);
  const stream = sdk.AudioInputStream.createPushStream(sdk.AudioStreamFormat.getWaveFormatPCM(SPEECH_SAMPLE_RATE, 16, 1));
  const audioConfig = sdk.AudioConfig.fromStreamInput(stream);
  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
  let streamClosed = false;
  const closeStream = () => { if (!streamClosed) { streamClosed = true; stream.close(); } };
  let extra;
  let finished = false;
  let timer;
  let abort;
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
      timer = setTimeout(() => finish(new SpeechTranscriptionError("STT_DEADLINE")), timeoutMs);
      // The caller gave up (the browser closed the request): end the session now
      // instead of letting Azure keep recognizing audio nobody will receive.
      if (signal?.aborted) finish(new SpeechTranscriptionError("STT_PROVIDER_ERROR"));
      abort = () => finish(new SpeechTranscriptionError("STT_PROVIDER_ERROR"));
      signal?.addEventListener("abort", abort, { once: true });
      recognizer.recognized = safe((_sender, event) => {
        if (event.result?.reason === sdk.ResultReason.RecognizedSpeech) onRecognized(event.result);
        else if (event.result?.reason === sdk.ResultReason.NoMatch) onNoMatch?.(event.result);
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
    if (abort) signal?.removeEventListener("abort", abort);
    try { closeStream(); } catch { /* already closed */ }
    recognizer.recognized = recognizer.canceled = recognizer.sessionStopped = undefined;
    await closeClient(recognizer, cleanupMs);
    await releaseAudio(audioConfig);
    try { extra?.close?.(); } catch { /* best effort */ }
  }
}

/**
 * SDK 1.52 reports three different things as ResultReason.NoMatch
 * (EnumTranslation.implTranslateRecognitionResult, NoMatchDetails.fromResult):
 * InitialSilenceTimeout (only silence), InitialBabbleTimeout (only noise) and
 * NotRecognized (audio Azure treated as speech but could not recognize). Only
 * the last is speech that went unassessed; pauses and background noise are not.
 */
function noMatchKind(sdk, result) {
  let reason;
  try { reason = sdk.NoMatchDetails?.fromResult(result)?.reason; } catch { reason = undefined; }
  const reasons = sdk.NoMatchReason ?? {};
  if (reason !== undefined && reason === reasons.InitialSilenceTimeout) return "silence";
  if (reason !== undefined && reason === reasons.InitialBabbleTimeout) return "noise";
  // Unknown details are treated as unassessed speech, never as silence.
  return "unrecognized";
}

const resultSeconds = (result) => (Number.isFinite(result?.duration) && result.duration >= 0 ? result.duration / 10_000_000 : null);

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

/**
 * The pinned SDK sends the first 5 s of pushed audio at once, then throttles to
 * twice real time (ServiceRecognizerBase "SPEECH-TransmitLengthBeforThrottleMs").
 * A whole recording therefore needs about half its length to be sent, on top of
 * the configured per-operation deadline.
 */
function wholeRecordingDeadlineMs(config, durationSeconds) {
  return config.timeoutMs + Math.ceil(durationSeconds * 1000 / 2);
}

/**
 * Speech-to-text for one uploaded 16 kHz mono PCM WAV file: an M2 part of at
 * most 30 s or, with wholeRecording, an entire M5 read-aloud. Either way one
 * continuous-recognition session hears the file start to finish, and the result
 * is returned only after that session ends; final phrases are joined in the
 * order Azure recognized them.
 */
// Phrase-list weight, range 0-2 (SDK PhraseListGrammar.setWeight). 1.0 is
// Microsoft's default: names are made recognizable without boosting them
// above normal recognition.
const PHRASE_LIST_WEIGHT = 1.0;

/**
 * M5 English only: a small list of story names (for example "Santos") added
 * as a phrase list, so an uncommon name is less likely to be heard as a common
 * word ("Sampson's"). It biases recognition only; it is not the reference text,
 * and nothing is accepted automatically.
 */
function phraseListConfigurer(sdk, locale, phrases) {
  if (locale !== "en-US" || !Array.isArray(phrases) || !phrases.length) return undefined;
  return (recognizer) => {
    const list = sdk.PhraseListGrammar.fromRecognizer(recognizer);
    list.addPhrases(phrases);
    list.setWeight(PHRASE_LIST_WEIGHT);
    return undefined;
  };
}

async function transcribeWav(filePath, languageCode, {
  sdkFactory = defaultSdkFactory, env = process.env, readFile = fs.readFile, log = console.error, wholeRecording = false,
  signal, onDiagnostics, phrases,
} = {}) {
  const config = getAzureSpeechConfig(env);
  const buffer = await readFile(filePath);
  // Offsets and counts only (never text or audio): shows whether Azure heard
  // speech at the start that it could not recognize.
  const diagnostics = { phrases: 0, unrecognized: 0, silence: 0, noise: 0, firstPhraseOffsetMs: null, firstUnrecognizedOffsetMs: null };
  const offsetMs = (result) => (Number.isFinite(result?.offset) ? Math.round(result.offset / 10_000) : null);
  const wav = wholeRecording ? readSpeechWav(buffer, { maxSeconds: MAX_WHOLE_RECORDING_SECONDS }) : readSpeechWav(buffer);
  const texts = [];
  const confidences = [];
  let characters = 0;
  try {
    const sdk = sdkFactory();
    await recognizePcm({
      sdk, config, locale: languageCode, pcm: wavPcmArrayBuffer(buffer, wav),
      ...(wholeRecording ? { timeoutMs: wholeRecordingDeadlineMs(config, wav.durationSeconds) } : {}),
      configure: phraseListConfigurer(sdk, languageCode, phrases),
      signal,
      onNoMatch: (result) => {
        const kind = noMatchKind(sdk, result);
        diagnostics[kind] += 1;
        if (kind === "unrecognized") diagnostics.firstUnrecognizedOffsetMs ??= offsetMs(result);
      },
      onRecognized: (result) => {
        const text = typeof result.text === "string" ? result.text.trim() : "";
        if (!text) return;
        diagnostics.phrases += 1;
        diagnostics.firstPhraseOffsetMs ??= offsetMs(result);
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
  } finally {
    try { onDiagnostics?.(diagnostics); } catch { /* diagnostics never affect the result */ }
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
  sdkFactory = defaultSdkFactory, env = process.env, log = console.error, signal,
} = {}) {
  if (language !== "en") throw new SpeechTranscriptionError("PRONUNCIATION_UNSUPPORTED");
  if (typeof referenceText !== "string" || !referenceText.trim()) throw new SpeechTranscriptionError("STT_INVALID_AUDIO");
  const config = getAzureSpeechConfig(env);
  const wav = readSpeechWav(buffer, { maxSeconds: MAX_WHOLE_RECORDING_SECONDS });
  const utterances = [];
  // Speech Azure could not assess. Silence and noise are expected and are not
  // counted; anything else means the result does not cover the whole reading.
  const unassessed = [];
  const startedAt = Date.now();
  try {
    const sdk = sdkFactory();
    await recognizePcm({
      sdk, config, locale: "en-US", pcm: wavPcmArrayBuffer(buffer, wav),
      signal, timeoutMs: wholeRecordingDeadlineMs(config, wav.durationSeconds),
      // Not a failure: the same audio would fail again on every retry. It is
      // reported, so the result is never shown as covering the whole reading.
      onNoMatch: (result) => {
        if (noMatchKind(sdk, result) === "unrecognized") unassessed.push(resultSeconds(result));
      },
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
        if (!utterance.text.trim() || !utterance.words.length || utterance.accuracy === null || utterance.fluency === null) {
          throw new SpeechTranscriptionError("STT_PROVIDER_ERROR");
        }
        utterances.push(utterance);
      },
    });
  } catch (error) {
    logProviderFailure(log, "pronunciation", error);
    throw toSafeError(error);
  }
  // Only silence or noise: nothing to assess.
  if (!utterances.length && !unassessed.length) throw new SpeechTranscriptionError("NO_SPEECH");
  const coverage = unassessed.length
    ? {
      complete: false,
      unassessedSegments: unassessed.length,
      // Null when Azure gave no duration for some segment: the gap is real but unmeasured.
      unassessedSeconds: unassessed.every((seconds) => seconds !== null)
        ? Math.round(unassessed.reduce((total, seconds) => total + seconds, 0) * 10) / 10
        : null,
    }
    : { complete: true };
  return { provider: "azure", locale: "en-US", scale: "0-100", utterances, ...coverage,
    durationSeconds: wav.durationSeconds, assessmentMs: Date.now() - startedAt };
}

// Slightly slower than the voice's default: calm and clear for Grade 5 learners.
const PHILIPPINE_FEEDBACK_RATE = "-10%";

function escapeXml(text) {
  return text.replace(/[<>&"']/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;",
  })[character]);
}

const PROFILE_VOICES = Object.freeze({ philippine: PHILIPPINE_FEEDBACK_VOICES, american: AMERICAN_EXAMPLE_VOICES });

/** SSML for M5 feedback: the profile's voice for the language, at a calm rate. */
function profileSsml(text, language, profile) {
  const voice = PROFILE_VOICES[profile][language];
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${voice.locale}">`
    + `<voice name="${voice.name}"><prosody rate="${PHILIPPINE_FEEDBACK_RATE}">${escapeXml(text)}</prosody></voice></speak>`;
}

/** SSML for M5 feedback: the Philippine voice for the language, at a calm rate. */
function philippineFeedbackSsml(text, language) {
  const voice = PHILIPPINE_FEEDBACK_VOICES[language];
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${voice.locale}">`
    + `<voice name="${voice.name}"><prosody rate="${PHILIPPINE_FEEDBACK_RATE}">${escapeXml(text)}</prosody></voice></speak>`;
}

/**
 * Neural text-to-speech; returns MP3 bytes (served as audio/mpeg). Without a
 * voice profile the configured default voice reads the plain text, as before.
 * voiceProfile "philippine" (M5 feedback only) uses en-PH-RosaNeural or
 * fil-PH-BlessicaNeural through SSML; "american" (M5 "Hear American English",
 * English only) uses en-US-JennyNeural.
 */
async function synthesizeSpeech(text, languageCode, {
  sdkFactory = defaultSdkFactory, env = process.env, log = console.error, voiceProfile,
} = {}) {
  const config = getAzureSpeechConfig(env);
  const language = languageCode === "fil-PH" ? "fil" : languageCode === "en-US" ? "en" : null;
  if (!language) throw new SpeechTranscriptionError("STT_INVALID_AUDIO");
  if (voiceProfile !== undefined && !PROFILE_VOICES[voiceProfile]?.[language]) throw new SpeechTranscriptionError("STT_INVALID_AUDIO");
  const profile = voiceProfile;
  let synthesizer;
  let timer;
  try {
    const sdk = sdkFactory();
    const speechConfig = createSpeechConfig(sdk, config);
    speechConfig.speechSynthesisVoiceName = profile ? PROFILE_VOICES[profile][language].name : config.voices[language];
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
      const speak = profile
        ? (ok, fail) => synthesizer.speakSsmlAsync(profileSsml(text, language, profile), ok, fail)
        : (ok, fail) => synthesizer.speakTextAsync(text, ok, fail);
      speak((result) => {
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
  PHRASE_LIST_WEIGHT,
  wholeRecordingDeadlineMs,
  assessPronunciationWav,
  createRecognitionStream,
  philippineFeedbackSsml,
  synthesizeSpeech,
  transcribeWav,
};
