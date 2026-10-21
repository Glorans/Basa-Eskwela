"use strict";
const { LabError } = require("../contracts");
const { validateAudio } = require("../audioValidation");
const { createUsageLimits } = require("../usageLimits");
const { azureError, assessmentSegment } = require("../azureResults");
const LOCALES = Object.freeze({ en: "en-US", fil: "fil-PH" });
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
// SDK close() reports success only after the peer has torn down the WebSocket's TCP connection, which can take
// seconds after a completed result. Keep timeoutMs (max 60 s) + cleanupMs below the frontend's 75 s deadline.
function createAzureAdapter(config, { sdkFactory = () => require("microsoft-cognitiveservices-speech-sdk"), cleanupMs = 10000 } = {}) {
  const usage = createUsageLimits(config);
  async function execute(operation, input) {
    if (!config.enabled) throw new LabError("PROVIDER_DISABLED", "Azure is disabled.", 422);
    if (!LOCALES[input.language] || (operation === "assess" && input.language !== "en")) throw new LabError("UNSUPPORTED_CAPABILITY", "Azure acoustic pronunciation assessment is unavailable for Filipino.", 422);
    if (input.signal?.aborted) throw new LabError("CANCELLED", "Experiment cancelled.", 408);
    if (operation === "synthesize" && [...input.text].length > 1000) throw new LabError("INVALID_TEXT", "Azure TTS is limited to 1,000 characters per request.");
    const metadata = operation === "synthesize" ? null : validateAudio(input.audio, { azure: true });
    const release = usage.reserve(operation, metadata ? Math.ceil(metadata.durationSeconds) : [...input.text].length);
    let sdk, client, audioConfig, stream, assessmentConfig, timer, abort, result, finished = false, streamClosed = false;
    const closeStream = () => { if (stream && !streamClosed) { streamClosed = true; stream.close(); } };
    try {
      sdk = sdkFactory();
      sdk.SpeechRecognizer.enableTelemetry(false);
      const speechConfig = sdk.SpeechConfig.fromSubscription(config.key, config.region);
      // Pinned SDK 1.52 reads this property in RecognizerConfig. Avoid its default four connection retries.
      speechConfig.setProperty("SPEECH-Error-MaxRetryCount", "0");
      speechConfig.speechRecognitionLanguage = LOCALES[input.language];
      const output = await new Promise((resolve, reject) => {
        const finish = (error, result) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          if (error) reject(error); else resolve(result);
        };
        const safe = callback => (...args) => {
          if (finished) return;
          try { callback(...args); } catch { finish(new LabError("AZURE_RESULT", "Azure returned an invalid result.", 502)); }
        };
        abort = () => finish(new LabError("CANCELLED", "Experiment cancelled. Submitted usage may still count.", 408));
        input.signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => finish(new LabError("AZURE_TIMEOUT", "Azure operation timed out. No automatic retry was made.", 504)), config.timeoutMs);
        if (input.signal?.aborted) { abort(); return; }
        if (operation === "synthesize") {
          speechConfig.speechSynthesisVoiceName = config.voices[input.language];
          speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff16Khz16BitMonoPcm;
          client = new sdk.SpeechSynthesizer(speechConfig, null);
          let received = 0;
          client.synthesizing = safe((_sender, event) => {
            received += event.result?.audioData?.byteLength || 0;
            if (received > MAX_OUTPUT_BYTES) finish(new LabError("AZURE_OUTPUT_LIMIT", "Synthesized audio exceeded the lab output limit.", 413));
          });
          client.speakTextAsync(input.text, safe(result => {
            if (result.reason !== sdk.ResultReason.SynthesizingAudioCompleted) { finish(azureError(sdk, sdk.CancellationDetails.fromResult(result))); return; }
            const bytes = Buffer.from(result.audioData || new ArrayBuffer(0));
            if (bytes.length < 44 || bytes.length > MAX_OUTPUT_BYTES || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") { finish(new LabError("AZURE_RESULT", "Azure returned invalid or oversized audio.", 502)); return; }
            validateAudio(bytes, { azure: true, maxDurationSeconds: MAX_OUTPUT_BYTES / 32000 });
            finish(null, { audioBase64: bytes.toString("base64"), mimeType: "audio/wav", voice: config.voices[input.language] });
          }), () => finish(azureError(sdk)));
        } else {
          stream = sdk.AudioInputStream.createPushStream(sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1));
          audioConfig = sdk.AudioConfig.fromStreamInput(stream);
          client = new sdk.SpeechRecognizer(speechConfig, audioConfig);
          if (operation === "assess") {
            assessmentConfig = new sdk.PronunciationAssessmentConfig(input.text, sdk.PronunciationAssessmentGradingSystem.HundredMark, sdk.PronunciationAssessmentGranularity.Phoneme, false);
            assessmentConfig.applyTo(client);
          }
          const transcripts = [], segments = [];
          let noMatch = false, characters = 0;
          client.recognized = safe((_sender, event) => {
            const result = event.result;
            if (result.reason === sdk.ResultReason.NoMatch) { noMatch = true; return; }
            if (result.reason !== sdk.ResultReason.RecognizedSpeech) return;
            const text = typeof result.text === "string" ? result.text.trim() : "";
            characters += text.length;
            if (characters > 20000 || transcripts.length >= 200) { finish(new LabError("AZURE_RESULT", "Azure recognition exceeded the lab result limit.", 502)); return; }
            if (text) { transcripts.push(text); if (operation === "assess") segments.push(assessmentSegment(sdk, result)); }
          });
          const complete = () => {
            const completeness = !transcripts.length ? "empty" : noMatch ? "incomplete" : "complete";
            finish(null, { transcript: transcripts.join(" "), completeness,
              pronunciation: operation === "assess" && completeness === "complete" ? { kind: "azure", label: "REAL AZURE pronunciation — segment scores", scale: "0–100 (Azure HundredMark)", scores: {}, segments } : null,
              warnings: operation === "assess" ? ["Reference-conditioned assessment transcript; run STT separately for independent reading accuracy. Continuous mode has no Azure omission/insertion assessment; no overall score is fabricated."] : [],
            });
          };
          client.canceled = safe((_sender, event) => { if (event.reason === sdk.CancellationReason.EndOfStream) complete(); else finish(azureError(sdk, event)); });
          client.sessionStopped = safe(complete);
          client.startContinuousRecognitionAsync(safe(() => {
            // Copy precisely the validated data chunk, without RIFF headers or Buffer pool padding.
            const pcm = input.audio.subarray(metadata.dataOffset, metadata.dataOffset + metadata.dataBytes);
            stream.write(Uint8Array.from(pcm).buffer);
            closeStream();
          }), () => finish(azureError(sdk)));
        }
      });
      result = { ...output, locale: LOCALES[input.language], sdkVersion: "1.52.0", region: config.region, warnings: [...(output.warnings || []), "Real Azure result. Session usage is an estimate, not a billing guarantee."] };
    } catch (error) {
      if (error instanceof LabError) throw error;
      throw new LabError("AZURE_SERVICE", "Azure operation failed. Check the lab configuration; diagnostic details are withheld.", 502);
    } finally {
      finished = true;
      clearTimeout(timer);
      if (abort) input.signal?.removeEventListener("abort", abort);
      let cleanupOK = true;
      try { closeStream(); } catch { cleanupOK = false; }
      if (client) {
        client.recognized = client.canceled = client.sessionStopped = client.synthesizing = undefined;
        // close() disposes/stops recognition or synthesis, including pending network activity.
        cleanupOK = (await new Promise(resolve => {
          const deadline = setTimeout(() => resolve(false), cleanupMs);
          const done = value => { clearTimeout(deadline); resolve(value); };
          try { client.close(() => done(true), () => done(false)); } catch { done(false); }
        })) && cleanupOK;
      }
      // SDK 1.52 AudioConfig.close() always throws for push streams (it calls .then() on the push stream's
      // undefined turnOff() result). turnOff() is the whole of what close() does, so await it directly.
      try { await audioConfig?.turnOff(); assessmentConfig?.close?.(); } catch { cleanupOK = false; }
      release(cleanupOK);
      // A completed result stays valid; unconfirmed cleanup still locks Azure until the lab restarts.
      if (!cleanupOK && !result) throw new LabError("AZURE_CLEANUP_FAILED", "Azure cleanup failed. Restart the lab before further Azure testing.", 503);
      if (!cleanupOK) result.warnings.push("Azure cleanup did not confirm completion. This result is valid, but restart the lab before further Azure testing.");
    }
    return result;
  }
  return { transcribe: input => execute("transcribe", input), assessPronunciation: input => execute("assess", input), synthesize: input => execute("synthesize", input) };
}
module.exports = { createAzureAdapter };
