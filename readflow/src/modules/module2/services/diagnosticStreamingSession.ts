import type { DiagnosticLanguage, DiagnosticTranscription } from "../types/diagnostic";
import {
  DiagnosticStreamingTranscript,
  type StreamingTranscriptState,
} from "./diagnosticStreamingTranscript.ts";

interface StreamingSessionOptions {
  language: DiagnosticLanguage;
  url: string;
  workletUrl: string;
  getAccessToken: () => Promise<string>;
  onTranscript: (state: StreamingTranscriptState) => void;
  onFailure: () => void;
  log?: (event: string, details?: unknown) => void;
  createSocket?: (url: string) => WebSocket;
  createContext?: () => AudioContext;
  createWorklet?: (context: AudioContext) => AudioWorkletNode;
  startupTimeoutMs?: number;
  finishTimeoutMs?: number;
}

/** Owns only the streaming side. The microphone tracks are borrowed and are
 * never stopped here, including on provider/transport/capture failure. */
export function createDiagnosticStreamingSession(options: StreamingSessionOptions) {
  const transcript = new DiagnosticStreamingTranscript();
  const log = options.log ?? (() => undefined);
  let socket: WebSocket | undefined;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let worklet: AudioWorkletNode | undefined;
  let started = false;
  let finished = false;
  let ready = false;
  let stopping = false;
  let flushed = false;
  let stopSent = false;
  let sentBytes = 0;
  let queuedBytes = 0;
  let queuedAudio: ArrayBuffer[] = [];
  const tracks = new Map<MediaStreamTrack, () => void>();
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveResult: (value: DiagnosticTranscription | null) => void = () => undefined;
  const result = new Promise<DiagnosticTranscription | null>((resolve) => { resolveResult = resolve; });

  function releaseCapture() {
    tracks.forEach((handler, track) => track.removeEventListener("ended", handler));
    tracks.clear();
    if (worklet) {
      worklet.port.onmessage = null;
      worklet.onprocessorerror = null;
      worklet.disconnect();
      worklet.port.close();
      worklet = undefined;
    }
    source?.disconnect();
    source = undefined;
    if (context) {
      context.onstatechange = null;
      void context.close().catch(() => undefined);
      context = undefined;
    }
  }

  function settle(value: DiagnosticTranscription | null) {
    if (finished) return;
    finished = true;
    clearTimeout(startupTimer);
    clearTimeout(finishTimer);
    releaseCapture();
    queuedAudio = [];
    queuedBytes = 0;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
      socket = undefined;
      log("WebSocket closed");
    }
    resolveResult(value);
  }

  function fail(reason: string) {
    if (finished) return;
    log("fallback triggered", { reason });
    settle(null);
    options.onFailure();
  }

  function sendQueuedAudio() {
    if (!ready || !socket || finished) return;
    try {
      for (const audio of queuedAudio) {
        if (socket.readyState !== 1 || socket.bufferedAmount + audio.byteLength > 160000) {
          fail("WebSocket backpressure or disconnect"); return;
        }
        socket.send(audio);
        sentBytes += audio.byteLength;
      }
      queuedAudio = [];
      queuedBytes = 0;
      if (flushed && !stopSent) {
        stopSent = true;
        socket.send(JSON.stringify({ type: "stop" }));
      }
    } catch { fail("WebSocket audio send failed"); }
  }

  function receiveAudio(audio: ArrayBuffer) {
    if (finished || flushed) return;
    queuedAudio.push(audio);
    queuedBytes += audio.byteLength;
    if (queuedBytes > 160000) { fail("Audio startup buffer exceeded"); return; }
    sendQueuedAudio();
  }

  async function start(stream: MediaStream) {
    if (started || finished) return;
    started = true;
    startupTimer = setTimeout(() => fail("Streaming setup timed out"), options.startupTimeoutMs ?? 8000);
    try {
      const audioContext = (options.createContext ?? (() => new AudioContext()))();
      context = audioContext;
      for (const track of stream.getAudioTracks()) {
        if (track.readyState !== "live") throw new Error("Microphone track ended");
        const onEnded = () => { if (!stopping) fail("Microphone track ended"); };
        tracks.set(track, onEnded);
        track.addEventListener("ended", onEnded);
      }
      if (!tracks.size) throw new Error("No microphone track");
      const tokenPromise = options.getAccessToken();
      // Attach a rejection handler immediately while the worklet loads.
      void tokenPromise.catch(() => fail("Authentication unavailable"));
      socket = (options.createSocket ?? ((url) => new WebSocket(url)))(options.url);
      socket.onopen = () => {
        log("WebSocket connected");
        void tokenPromise.then((accessToken) => {
          if (finished || socket?.readyState !== 1) return;
          socket.send(JSON.stringify({
            type: "configure", language: options.language, accessToken,
            encoding: "LINEAR16", sampleRate: 16000, channels: 1,
          }));
        }).catch(() => fail("Session configuration failed"));
      };
      socket.onerror = () => fail("WebSocket connection failed");
      socket.onclose = () => fail("WebSocket disconnected before completion");
      socket.onmessage = (event) => {
        if (finished) return;
        try {
          const message = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (message.type === "ready") {
            if (ready || message.encoding !== "LINEAR16" || message.sampleRate !== 16000 || message.channels !== 1) {
              fail("Invalid ready response"); return;
            }
            ready = true;
            if (worklet) clearTimeout(startupTimer);
            sendQueuedAudio();
          } else if (message.type === "interim" || message.type === "final") {
            transcript.receive(message);
            log(`${message.type} transcript`, { text: message.text });
            // Presentation failures must not invalidate captured speech.
            try { options.onTranscript(transcript.snapshot); }
            catch { log("Transcript observer failed"); }
          } else if (message.type === "complete") {
            const completedTranscript = transcript.finish(message.finalCount);
            if (!stopSent || message.audioBytes !== sentBytes || !completedTranscript) {
              fail("Incomplete streaming transcript"); return;
            }
            settle(completedTranscript);
          } else {
            fail("Streaming service unavailable");
          }
        } catch { fail("Invalid streaming response"); }
      };
      await Promise.all([
        audioContext.resume(),
        audioContext.audioWorklet.addModule(options.workletUrl),
      ]);
      if (finished) return;
      if (audioContext.state !== "running") throw new Error("AudioContext did not start");
      audioContext.onstatechange = () => {
        if (!finished && !flushed && audioContext.state !== "running") fail("AudioContext interrupted");
      };
      worklet = (options.createWorklet ?? ((ctx) => new AudioWorkletNode(ctx, "diagnostic-pcm")))(audioContext);
      worklet.onprocessorerror = () => fail("AudioWorklet failed");
      worklet.port.onmessage = (event) => {
        if (event.data?.type === "audio" && event.data.audio instanceof ArrayBuffer) {
          receiveAudio(event.data.audio);
        } else if (event.data?.type === "flushed" && stopping) {
          flushed = true;
          releaseCapture();
          sendQueuedAudio();
        }
      };
      source = audioContext.createMediaStreamSource(stream);
      source.connect(worklet);
      worklet.connect(audioContext.destination);
      if (ready) clearTimeout(startupTimer);
      if (stopping) worklet.port.postMessage({ type: "stop" });
    } catch { fail("Audio capture setup failed"); }
  }

  function stop() {
    if (finished || stopping) return result;
    if (!started) { settle(null); return result; }
    stopping = true;
    log("recording stopped");
    finishTimer = setTimeout(() => fail("Final transcript timed out"), options.finishTimeoutMs ?? 12000);
    worklet?.port.postMessage({ type: "stop" });
    return result;
  }

  return { start, stop, result, cancel: () => settle(null) };
}
