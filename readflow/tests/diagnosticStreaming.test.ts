import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DiagnosticPcmEncoder } from "../src/modules/module2/audio/diagnosticPcm.ts";
import { DiagnosticStreamingTranscript, getDiagnosticSpeechSocketUrl } from "../src/modules/module2/services/diagnosticStreamingTranscript.ts";
import { createDiagnosticStreamingSession } from "../src/modules/module2/services/diagnosticStreamingSession.ts";
import { processDiagnosticRecording } from "../src/modules/module2/services/diagnosticRecording.ts";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

for (const rate of [16000, 44100, 48000]) {
  test(`${rate} Hz capture becomes exactly 16k mono signed little-endian PCM in 100ms frames`, () => {
    const encoder = new DiagnosticPcmEncoder(rate);
    const input = Float32Array.from({ length: rate }, (_, i) => Math.sin(i * 2 * Math.PI * 440 / rate) * 0.5);
    const packets: ArrayBuffer[] = [];
    for (let i = 0; i < input.length; i += 128) encoder.push([input.subarray(i, i + 128)], (packet) => packets.push(packet));
    encoder.flush((packet) => packets.push(packet));
    assert.equal(packets.length, 10);
    assert.ok(packets.every((packet) => packet.byteLength === 3200));
    const samples = packets.flatMap((packet) => Array.from({ length: packet.byteLength / 2 }, (_, i) => new DataView(packet).getInt16(i * 2, true)));
    assert.ok(Math.max(...samples) > 15000 && Math.max(...samples) < 17000);
    assert.ok(Math.min(...samples) < -15000);
    const whole = new DiagnosticPcmEncoder(rate);
    const continuous: ArrayBuffer[] = [];
    whole.push([input], (packet) => continuous.push(packet));
    whole.flush((packet) => continuous.push(packet));
    assert.deepEqual(packets, continuous, "Render quantum boundaries must not change samples");
  });
}

test("stereo mixes to mono, clipping is bounded, and partial frame flush is exact", () => {
  const encoder = new DiagnosticPcmEncoder(48000);
  const packets: ArrayBuffer[] = [];
  encoder.push([new Float32Array(480).fill(1), new Float32Array(480).fill(-1)], (packet) => packets.push(packet));
  encoder.flush((packet) => packets.push(packet));
  encoder.flush(() => assert.fail("Duplicate flush"));
  assert.equal(packets[0].byteLength, 320);
  assert.ok(new Uint8Array(packets[0]).every((value) => value === 0));
  const clipped = new DiagnosticPcmEncoder(16000);
  clipped.push([new Float32Array(100).fill(2)], () => {});
  clipped.flush((packet) => assert.equal(new DataView(packet).getInt16(packet.byteLength - 2, true), 32767));
});

test("interims are replaced, finals deduplicated, and repeated spoken words preserved", () => {
  const transcript = new DiagnosticStreamingTranscript();
  transcript.receive({ type: "interim", text: "a duck" });
  transcript.receive({ type: "interim", text: "a frog" });
  assert.deepEqual(transcript.snapshot, { confirmedTranscript: "", interimTranscript: "a frog" });
  const first = { type: "final", sequence: 1, segmentId: "1:100", text: "frog", confidence: 0.8 };
  transcript.receive(first); transcript.receive(first);
  transcript.receive({ ...first, sequence: 2, segmentId: "2:100", confidence: 1 });
  assert.deepEqual(transcript.finish(2), { text: "frog frog", confidence: 0.9 });
  assert.equal(transcript.finish(3), null);
  assert.throws(() => transcript.receive({ ...first, sequence: 4, segmentId: "2:200" }), /Missing/);
  transcript.receive({ type: "interim", text: "unfinished" });
  assert.equal(transcript.finish(2), null, "Interims cannot become a scoring transcript");
});

test("WebSocket URL uses the API origin, keeps deployment prefix, and upgrades HTTPS to WSS", () => {
  assert.equal(getDiagnosticSpeechSocketUrl("http://localhost:5000", "http://localhost:5173"), "ws://localhost:5000/ws/diagnostic/speech");
  assert.equal(getDiagnosticSpeechSocketUrl("/backend", "https://readflow.example/diagnostic"), "wss://readflow.example/backend/ws/diagnostic/speech");
});

function fixture(overrides: { contextFails?: boolean; workletFails?: boolean; authFails?: boolean; startupTimeoutMs?: number; finishTimeoutMs?: number; onTranscript?: () => void; diagnostic?: { assessmentId: string; assessmentVersion: string } } = {}) {
  const track = new EventTarget() as EventTarget & { readyState: string; stopCalls: number; stop: () => void };
  track.readyState = "live"; track.stopCalls = 0; track.stop = () => { track.stopCalls++; };
  const stream = { getAudioTracks: () => [track] } as unknown as MediaStream;
  const port = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    closed: false,
    postMessage(data: { type: string }) {
      if (data.type === "stop") queueMicrotask(() => port.onmessage?.({ data: { type: "flushed" } }));
    },
    close() { port.closed = true; },
  };
  const worklet = { port, onprocessorerror: null as (() => void) | null, disconnected: false,
    connect() {}, disconnect() { worklet.disconnected = true; } };
  const source = { disconnected: false, connect() {}, disconnect() { source.disconnected = true; } };
  const context = {
    state: "running", closed: false, destination: {}, onstatechange: null as (() => void) | null,
    audioWorklet: { addModule: async () => { if (overrides.workletFails) throw new Error("worklet unavailable"); } },
    resume: async () => { if (overrides.contextFails) throw new Error("context unavailable"); },
    close: async () => { context.closed = true; }, createMediaStreamSource: () => source,
  };
  const socket = {
    readyState: 1, bufferedAmount: 0, closed: false,
    onopen: null as (() => void) | null,
    onmessage: null as ((event: { data: string }) => void) | null,
    onerror: null as (() => void) | null, onclose: null as (() => void) | null,
    sent: [] as (string | ArrayBuffer)[],
    send(data: string | ArrayBuffer) { socket.sent.push(data); },
    close() { socket.closed = true; },
  };
  let failures = 0;
  const updates: unknown[] = [];
  const session = createDiagnosticStreamingSession({
    language: "en", url: "ws://localhost/test", workletUrl: "/test-worklet.js",
    getAccessToken: async () => { if (overrides.authFails) throw new Error("auth failure"); return "test-token"; },
    onTranscript: (state) => updates.push(state), onFailure: () => { failures++; },
    createContext: () => context as unknown as AudioContext,
    createSocket: () => socket as unknown as WebSocket,
    createWorklet: () => worklet as unknown as AudioWorkletNode,
    ...overrides,
  });
  const receive = (message: object) => socket.onmessage?.({ data: JSON.stringify(message) });
  const ready = async () => {
    await session.start(stream); socket.onopen?.(); await tick();
    receive({ type: "ready", encoding: "LINEAR16", sampleRate: 16000, channels: 1 });
  };
  return { session, track, stream, socket, context, source, worklet, port, receive, ready, updates, get failures() { return failures; } };
}

test("successful streaming flushes PCM, waits for final completion, and releases borrowed resources", async () => {
  const f = fixture();
  await f.ready();
  assert.equal(JSON.parse(f.socket.sent[0] as string).sampleRate, 16000);
  await f.session.start(f.stream); // Start is idempotent.
  f.port.onmessage?.({ data: { type: "audio", audio: new ArrayBuffer(3200) } });
  f.receive({ type: "interim", text: "one day" });
  f.receive({ type: "final", segmentId: "1:100", sequence: 1, text: "one day" });
  const result = f.session.stop();
  await tick();
  assert.equal(JSON.parse(f.socket.sent[f.socket.sent.length - 1] as string).type, "stop");
  f.receive({ type: "final", segmentId: "1:200", sequence: 2, text: "a frog" });
  f.receive({ type: "complete", finalCount: 2, audioBytes: 3200 });
  assert.deepEqual(await result, { text: "one day a frog" });
  assert.equal(f.context.closed, true);
  assert.equal(f.worklet.disconnected, true);
  assert.equal(f.source.disconnected, true);
  assert.equal(f.port.closed, true);
  assert.equal(f.socket.closed, true);
  assert.equal(f.track.stopCalls, 0);
  assert.equal(f.failures, 0);
});

test("a highlighting observer failure cannot end speech or discard ordered final segments", async () => {
  const f = fixture({ onTranscript: () => { throw new Error("visual failure"); } });
  await f.ready();
  const phrases = ["one day a frog sat on a lily pad", "still as a rock a fish swam by", "hello mister frog what are you waiting for"];
  phrases.forEach((text, index) => {
    f.receive({ type: "final", segmentId: `1:${index}`, sequence: index + 1, text });
    assert.equal(f.socket.closed, false);
    assert.equal(f.context.closed, false);
  });
  const result = f.session.stop();
  assert.equal(f.session.stop(), result);
  await tick();
  f.receive({ type: "complete", finalCount: 3, audioBytes: 0 });
  assert.deepEqual(await result, { text: phrases.join(" ") });
  assert.equal(f.failures, 0);
  assert.equal(f.track.stopCalls, 0);
});

for (const failure of ["socket", "google", "processor", "context", "track", "backpressure", "byte-mismatch", "partial-transcript"]) {
  test(`${failure} failure preserves microphone ownership and returns null for upload fallback`, async () => {
    const f = fixture(); await f.ready();
    if (failure === "socket") f.socket.onclose?.();
    else if (failure === "google") f.receive({ type: "error", message: "private Google error" });
    else if (failure === "processor") f.worklet.onprocessorerror?.();
    else if (failure === "context") { f.context.state = "suspended"; f.context.onstatechange?.(); }
    else if (failure === "track") f.track.dispatchEvent(new Event("ended"));
    else if (failure === "backpressure") {
      f.socket.bufferedAmount = 160001;
      f.port.onmessage?.({ data: { type: "audio", audio: new ArrayBuffer(3200) } });
    } else {
      f.receive({ type: "final", segmentId: "1:100", sequence: 1, text: "one day" });
      void f.session.stop(); await tick();
      if (failure === "partial-transcript") f.receive({ type: "interim", text: "unfinished" });
      f.receive({ type: "complete", finalCount: 1, audioBytes: failure === "byte-mismatch" ? 1234 : 0 });
    }
    assert.equal(await f.session.result, null);
    assert.equal(f.track.stopCalls, 0);
    assert.equal(f.context.closed, true);
    assert.equal(f.failures, 1);
  });
}

for (const option of ["contextFails", "workletFails", "authFails"] as const) {
  test(`${option} closes partial setup without stopping MediaRecorder's stream`, async () => {
    const f = fixture({ [option]: true });
    await f.session.start(f.stream); await tick();
    assert.equal(await f.session.result, null);
    assert.equal(f.context.closed, true);
    assert.equal(f.track.stopCalls, 0);
  });
}

test("setup/finalization timeouts and unmount cancel cannot leak or publish late state", async () => {
  const setup = fixture({ startupTimeoutMs: 5 });
  await setup.session.start(setup.stream);
  assert.equal(await setup.session.result, null);
  const finish = fixture({ finishTimeoutMs: 5 }); await finish.ready();
  assert.equal(await finish.session.stop(), null);
  const unmounted = fixture(); const starting = unmounted.session.start(unmounted.stream);
  unmounted.session.cancel(); await starting;
  unmounted.receive({ type: "interim", text: "late" });
  assert.deepEqual(unmounted.updates, []);
  assert.equal(unmounted.failures, 0);
  assert.equal(unmounted.context.closed, true);
});

test("streaming completion bypasses synchronous STT; failure retains the existing upload and scoring path", async () => {
  let uploads = 0;
  const input = {
    audioSegments: [new Blob(["recording"], { type: "audio/webm" })],
    language: "en" as const, expectedText: "one day a frog", recordingDurationSeconds: 30,
    uploadSegment: async () => { uploads++; return { success: true, message: "ok", transcription: { text: "one day a frog" } }; },
  };
  const streaming = await processDiagnosticRecording({ ...input, streamingTranscription: { text: "one day a frog" } });
  assert.equal(uploads, 0);
  const fallback = await processDiagnosticRecording({ ...input, streamingTranscription: null });
  assert.equal(uploads, 1);
  assert.deepEqual(streaming, fallback, "Identical Google transcripts use identical existing scoring formulas");
});

test("DT1: a completed stream carries the server's opaque transcript receipt", async () => {
  const f = fixture();
  await f.ready();
  f.receive({ type: "final", segmentId: "1:100", sequence: 1, text: "one day" });
  const result = f.session.stop();
  await tick();
  f.receive({ type: "complete", finalCount: 1, audioBytes: 0, receipt: "signed.receipt" });
  assert.deepEqual(await result, { text: "one day", receipt: "signed.receipt" });
  assert.equal(f.failures, 0);
});

test("DT1: Module 2 names its diagnostic when configuring; M5 voice-follow sends no diagnostic", async () => {
  const m2 = fixture({ diagnostic: { assessmentId: "grade5-en-passage-v3", assessmentVersion: "3.0" } });
  await m2.ready();
  assert.deepEqual(JSON.parse(m2.socket.sent[0] as string).diagnostic, { assessmentId: "grade5-en-passage-v3", assessmentVersion: "3.0" });
  const m5 = fixture();
  await m5.ready();
  assert.equal("diagnostic" in JSON.parse(m5.socket.sent[0] as string), false);
});

test("DT1: M5 voice-follow passes no diagnostic to the shared streaming hook", async () => {
  const source = await readFile(new URL("../src/pages/reading-activity/useVoiceFollowStoryScroll.ts", import.meta.url), "utf8");
  assert.match(source, /useDiagnosticStreamingSpeech\(language\)/);
});
