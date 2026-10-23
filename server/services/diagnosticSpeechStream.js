const { getSpeechLanguageCode } = require("./diagnosticLanguage");
const { createRecognitionStream } = require("./azureSpeechService");

const PCM_SAMPLE_RATE = 16000;
const MAX_FRAME_BYTES = 6400; // At most 200 ms of mono, signed LE 16-bit PCM.
const MAX_BUFFER_BYTES = PCM_SAMPLE_RATE * 2 * 5;
// Each Azure connection is drained and replaced after four minutes, so one
// connection never spans a whole five-minute reading.
const STREAM_ROTATION_MS = 240000;
const SAFE_STREAM_ERROR = "We had trouble listening to your reading. Your recording can still be processed.";

function buildStreamingRequest(language) {
  return {
    encoding: "LINEAR16",
    sampleRateHertz: PCM_SAMPLE_RATE,
    channels: 1,
    languageCode: getSpeechLanguageCode(language),
    interimResults: true,
  };
}

function developmentLog(event, details) {
  if (process.env.NODE_ENV === "development") {
    console.info(`[DiagnosticStreaming] ${event}`, details ?? "");
  }
}

/** One reading session. Rotation drains the old stream before opening the next,
 * buffering new PCM in order. No overlapping/replayed audio or recorder control. */
function createDiagnosticSpeechSession({
  language,
  send,
  close,
  createStream = createRecognitionStream,
  timers = { setTimeout, clearTimeout },
  rotationMs = STREAM_ROTATION_MS,
  // Signs the completed transcript for M2 scoring (diagnosticTranscriptReceipts.js).
  issueReceipt,
  log = developmentLog,
}) {
  const request = buildStreamingRequest(language);
  let active;
  let generation = 0;
  let finalCount = 0;
  const finalTranscripts = [];
  const finalConfidences = [];
  let audioBytes = 0;
  let stopped = false;
  let disposed = false;
  let queue = [];
  let queuedBytes = 0;
  const timerIds = new Set();

  function later(callback, delay) {
    const id = timers.setTimeout(() => { timerIds.delete(id); callback(); }, delay);
    timerIds.add(id);
    id?.unref?.();
    return id;
  }

  function cancelTimer(id) {
    timers.clearTimeout(id);
    timerIds.delete(id);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    timerIds.forEach((id) => timers.clearTimeout(id));
    timerIds.clear();
    queue = [];
    queuedBytes = 0;
    if (active) {
      log("Azure stream closed", { generation: active.id });
      active.stream.destroy();
      active = undefined;
    }
  }

  function fail(reason) {
    if (disposed) return;
    log("stream failure", { reason });
    send({ type: "error", code: "STREAM_UNAVAILABLE", message: SAFE_STREAM_ERROR });
    dispose();
    close();
  }

  function complete() {
    if (disposed) return;
    const text = finalTranscripts.join(" ");
    log("complete final transcript", {
      languageCode: request.languageCode,
      finalCount,
      text,
    });
    let receipt;
    if (issueReceipt && text) {
      // Audio length is counted here from the PCM actually received, not reported by the browser.
      try {
        receipt = issueReceipt({
          text,
          confidence: finalConfidences.length
            ? finalConfidences.reduce((sum, value) => sum + value, 0) / finalConfidences.length
            : undefined,
          audioSeconds: audioBytes / (PCM_SAMPLE_RATE * 2),
        });
      } catch { fail("Transcript receipt could not be issued"); return; }
    }
    send({ type: "complete", finalCount, audioBytes, ...(receipt ? { receipt } : {}) });
    dispose();
    close();
  }

  function drain(reason) {
    if (!active || active.draining || disposed) return;
    active.draining = reason;
    cancelTimer(active.rotationTimer);
    // Azure finishes buffered audio after the half-close before ending the session.
    active.drainTimer = later(() => fail("Azure finalization timed out"), 15000);
    active.stream.end(); // Half-close: keep reading final responses until `end`.
  }

  function pump() {
    if (disposed || !active || active.draining || active.blocked) return;
    while (queue.length && !active.blocked) {
      const frame = queue.shift();
      queuedBytes -= frame.length;
      try {
        active.blocked = !active.stream.write(frame);
      } catch {
        fail("Azure audio write failed");
        return;
      }
    }
    if (stopped && queue.length === 0) drain("stop");
  }

  function openStream() {
    if (disposed) return;
    let stream;
    try { stream = createStream(request); } catch { fail("Azure stream setup failed"); return; }
    const context = {
      stream, id: ++generation, lastFinalEnd: -1, draining: null,
      blocked: false, ended: false, pendingInterim: false, rotationTimer: null, drainTimer: null,
    };
    active = context;
    log("Azure stream opened", { generation: context.id, language });
    stream.on("data", (data) => {
      if (disposed || active !== context) return;
      const interim = [];
      let advanced = false;
      let hasInterim = false;
      for (const result of data.results ?? []) {
        const text = typeof result.text === "string" ? result.text.trim() : "";
        if (!text) continue;
        if (!result.isFinal) { hasInterim = true; interim.push(text); continue; }
        // Azure utterance end (audio offset + duration, 100 ns ticks) orders and deduplicates finals.
        const end = Number(result.endOffsetTicks);
        if (!Number.isFinite(end)) { fail("Final result has no ordering timestamp"); return; }
        if (end <= context.lastFinalEnd) continue;
        context.lastFinalEnd = end;
        advanced = true;
        finalTranscripts.push(text);
        if (Number.isFinite(result.confidence)) finalConfidences.push(result.confidence);
        send({
          type: "final", segmentId: `${context.id}:${end}`, sequence: ++finalCount,
          text, ...(Number.isFinite(result.confidence) ? { confidence: result.confidence } : {}),
        });
        log("final transcript", { text, generation: context.id, sequence: finalCount });
      }
      if (advanced || hasInterim) {
        const text = interim.join(" ");
        context.pendingInterim = Boolean(text);
        send({ type: "interim", text });
        log("interim transcript", { text });
      }
    });
    stream.on("drain", () => { context.blocked = false; pump(); });
    stream.on("error", () => {
      if (active === context) fail("Azure stream error");
    });
    stream.on("end", () => {
      context.ended = true;
      if (disposed || active !== context) return;
      if (!context.draining) { fail("Azure stream ended unexpectedly"); return; }
      if (context.pendingInterim) { fail("Azure stream ended with unfinalized speech"); return; }
      cancelTimer(context.drainTimer);
      cancelTimer(context.rotationTimer);
      active = undefined;
      log("Azure stream closed", { generation: context.id });
      stream.destroy();
      send({ type: "interim", text: "" });
      if (stopped && queuedBytes === 0) complete();
      else openStream();
    });
    stream.on("close", () => {
      if (!disposed && !context.ended) fail("Azure stream closed before final results");
    });
    context.rotationTimer = later(() => drain("rotate"), rotationMs);
    pump();
  }

  let audioTimer;
  function acceptAudio(frame) {
    if (disposed || stopped) return;
    if (!Buffer.isBuffer(frame) || !frame.length || frame.length % 2 || frame.length > MAX_FRAME_BYTES) {
      fail("Invalid PCM frame"); return;
    }
    audioBytes += frame.length;
    if (audioBytes > PCM_SAMPLE_RATE * 2 * 301) { fail("Session audio limit exceeded"); return; }
    queuedBytes += frame.length;
    if (queuedBytes > MAX_BUFFER_BYTES) { fail("Audio backpressure limit exceeded"); return; }
    queue.push(frame);
    cancelTimer(audioTimer);
    audioTimer = later(() => fail("Audio transport interrupted"), 10000);
    pump();
  }

  function stop() {
    if (disposed || stopped) return;
    stopped = true;
    cancelTimer(audioTimer);
    log("recording stopped");
    pump();
  }

  openStream();
  if (!disposed) {
    send({ type: "ready", encoding: "LINEAR16", sampleRate: PCM_SAMPLE_RATE, channels: 1 });
    audioTimer = later(() => fail("No audio received"), 10000);
    later(() => fail("Session lifetime exceeded"), 315000);
  }
  return { acceptAudio, stop, dispose };
}

module.exports = {
  buildStreamingRequest, createDiagnosticSpeechSession, developmentLog,
  MAX_FRAME_BYTES, SAFE_STREAM_ERROR, STREAM_ROTATION_MS,
};
