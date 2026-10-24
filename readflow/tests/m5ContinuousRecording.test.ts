import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createHookRuntime, tick } from "./helpers/hookRuntime.ts";

// Drives the real useAudioRecorder with a fake MediaRecorder and clock. Module 5
// opts into one continuous recording for saving and replay, while ~25 s
// segments are still produced for speech-to-text. Module 2 does not opt in.

const require = createRequire(import.meta.url);
const hookUrl = new URL("../src/modules/module2/hooks/useAudioRecorder.ts", import.meta.url);
const SEGMENT_SECONDS = 25;
const MAX_SECONDS = 300;

type Listener = () => void;

function setup({ failFullRecorder = false, holdFullStop = false, denyMicrophone = false } = {}) {
  let now = 0;
  let nextTimer = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const recorders: FakeRecorder[] = [];
  const trackListeners = new Set<Listener>();
  const heldStops: (() => void)[] = [];

  const track = {
    kind: "audio", label: "mic", readyState: "live",
    addEventListener: (_: string, listener: Listener) => trackListeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => trackListeners.delete(listener),
    stop() { track.readyState = "ended"; },
  };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };

  class FakeRecorder {
    static isTypeSupported = () => true;
    mimeType = "audio/webm;codecs=opus";
    state = "inactive";
    startedAt = 0;
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((event: { type: string }) => void) | null = null;
    readonly continuous: boolean;
    constructor() {
      // With the option on, the hook creates the continuous recorder first.
      this.continuous = continuousExpected && constructed++ === 0;
      if (this.continuous && failFullRecorder) throw new Error("unsupported");
      recorders.push(this);
    }
    start() { this.state = "recording"; this.startedAt = now; }
    stop() {
      if (this.state === "inactive") throw new Error("already inactive");
      this.state = "inactive";
      const data = new Blob([`${this.startedAt}-${now}`], { type: this.mimeType });
      const finish = () => queueMicrotask(() => {
        this.ondataavailable?.({ data });
        this.onstop?.();
      });
      if (this.continuous && holdFullStop) heldStops.push(finish);
      else finish();
    }
  }
  let continuousExpected = false;
  let constructed = 0;

  const window = {
    setTimeout(run: () => void, ms: number) {
      const id = nextTimer++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimeout(id: number) { timers.delete(id); },
  };

  const source = readFileSync(hookUrl, "utf8").replace(/import\.meta\.env\?\.DEV/g, "false");
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const runtime = createHookRuntime(require("react"));
  const module = { exports: {} as any };
  let urls = 0;
  vm.runInNewContext(code, {
    module, exports: module.exports, console, Blob, Promise, Map, Math, Error, queueMicrotask,
    require: (id: string) => (id === "react" ? runtime.react : require(id)),
    window,
    performance: { now: () => now },
    navigator: {
      mediaDevices: {
        getUserMedia: async () => {
          if (denyMicrophone) throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
          return stream;
        },
      },
    },
    MediaRecorder: FakeRecorder,
    URL: { createObjectURL: () => `blob:${++urls}`, revokeObjectURL() {} },
  });

  let options: Record<string, unknown> = {};
  const render = () => runtime.render(module.exports.useAudioRecorder, options);

  /** Moves the clock forward, firing due timers in order and letting recorder events run. */
  async function advance(ms: number) {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].run();
      await settle();
    }
    now = end;
  }
  async function settle() {
    for (let index = 0; index < 5; index++) await tick();
    render();
  }

  return {
    recorders,
    render,
    advance,
    settle,
    endTrack: () => [...trackListeners].forEach((listener) => listener()),
    releaseFullStop: () => heldStops.splice(0).forEach((finish) => finish()),
    async start(recorderOptions: Record<string, unknown>) {
      options = { maxSegmentDurationSeconds: SEGMENT_SECONDS, maxTotalDurationSeconds: MAX_SECONDS, ...recorderOptions };
      continuousExpected = Boolean(recorderOptions.captureFullRecording);
      render();
      await render().startRecording();
      await settle();
    },
  };
}

const text = (blob: Blob | null) => blob?.text();

for (const [label, seconds, parts] of [
  ["short", 15, 1],
  ["medium", 40, 2],
  ["long", 90, 4],
] as const) {
  test(`a ${label} ${seconds} s read-aloud gives one continuous recording plus ${parts} STT segment(s)`, async () => {
    const recorder = setup();
    await recorder.start({ captureFullRecording: true });
    assert.equal(recorder.render().isRecording, true);
    await recorder.advance(seconds * 1000);
    // The student never restarts: the continuous recorder has run the whole time.
    assert.equal(recorder.recorders[0].state, "recording");
    recorder.render().stopRecording();
    await recorder.settle();

    const result = recorder.render();
    assert.equal(result.isRecording, false);
    assert.equal(result.isStopping, false);
    assert.equal(await text(result.fullRecording), `0-${seconds * 1000}`);
    assert.equal(result.fullRecording.type, "audio/webm;codecs=opus");
    assert.ok(result.fullRecordingURL);
    assert.equal(result.recordingDurationSeconds, seconds);
    // Internal segments are unchanged and cover the same span back to back.
    assert.equal(result.audioSegments.length, parts);
    const spans = await Promise.all(result.audioSegments.map(text));
    assert.equal(spans[0].split("-")[0], "0");
    assert.equal(spans.at(-1).split("-")[1], String(seconds * 1000));
    assert.deepEqual([...result.segmentDurationsSeconds].map(Math.round),
      Array.from({ length: parts }, (_, index) => Math.min(SEGMENT_SECONDS, seconds - index * SEGMENT_SECONDS)));
    assert.equal(recorder.recorders.filter((item) => item.state !== "inactive").length, 0);
  });
}

test("the five-minute limit still ends the session with one continuous recording", async () => {
  const recorder = setup();
  await recorder.start({ captureFullRecording: true });
  await recorder.advance(MAX_SECONDS * 1000 + 5000);
  const result = recorder.render();
  assert.equal(await text(result.fullRecording), `0-${MAX_SECONDS * 1000}`);
  assert.equal(result.audioSegments.length, MAX_SECONDS / SEGMENT_SECONDS);
  assert.match(result.message, /five-minute limit/);
});

test("nothing is published for processing until the continuous file is final", async () => {
  const recorder = setup({ holdFullStop: true });
  await recorder.start({ captureFullRecording: true });
  await recorder.advance(30_000);
  recorder.render().stopRecording();
  await recorder.settle();
  let result = recorder.render();
  assert.equal(result.isStopping, true);
  assert.equal(result.audioSegments.length, 0);
  assert.equal(result.fullRecording, null);

  recorder.releaseFullStop();
  await recorder.settle();
  result = recorder.render();
  assert.equal(result.isStopping, false);
  assert.equal(result.audioSegments.length, 2);
  assert.equal(await text(result.fullRecording), "0-30000");
});

test("an interrupted recording discards everything and asks the student to try again", async () => {
  const recorder = setup();
  await recorder.start({ captureFullRecording: true });
  await recorder.advance(20_000);
  recorder.endTrack();
  await recorder.settle();
  const result = recorder.render();
  assert.equal(result.isRecording, false);
  assert.equal(result.fullRecording, null);
  assert.equal(result.audioSegments.length, 0);
  assert.equal(result.message, "Recording failed. Please try again.");
  assert.equal(recorder.recorders.filter((item) => item.state !== "inactive").length, 0);
});

test("if the continuous recorder cannot start, the segments are still captured", async () => {
  const recorder = setup({ failFullRecorder: true });
  await recorder.start({ captureFullRecording: true });
  await recorder.advance(40_000);
  recorder.render().stopRecording();
  await recorder.settle();
  const result = recorder.render();
  assert.equal(result.fullRecording, null);
  assert.equal(result.audioSegments.length, 2);
  assert.match(result.message, /captured successfully/);
});

test("microphone denial is reported and records nothing", async () => {
  const recorder = setup({ denyMicrophone: true });
  await recorder.start({ captureFullRecording: true });
  const result = recorder.render();
  assert.equal(result.isRecording, false);
  assert.equal(recorder.recorders.length, 0);
  assert.match(result.message, /Microphone access was denied/);
});

test("Module 2 does not opt in: only rotating segments, no continuous recorder", async () => {
  const recorder = setup();
  await recorder.start({});
  await recorder.advance(40_000);
  recorder.render().stopRecording();
  await recorder.settle();
  const result = recorder.render();
  assert.equal(recorder.recorders.length, 2);
  assert.equal(result.fullRecording, null);
  assert.equal(result.fullRecordingURL, null);
  assert.equal(result.audioSegments.length, 2);
});

test("a saved WebM without a duration is measured once, then rewound to the start", async () => {
  const { resolveRecordingDuration } = await import("../src/modules/module5/services/recordingDuration.ts");
  const listeners = new Map<string, () => void>();
  const audio = {
    duration: Infinity,
    currentTime: 0,
    addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  resolveRecordingDuration(audio);
  assert.ok(audio.currentTime > 1e9, "seeks past the end so the browser reads the length");
  audio.duration = 90.2;
  listeners.get("durationchange")?.();
  assert.equal(audio.currentTime, 0);
  assert.equal(listeners.size, 0);

  const known = { ...audio, duration: 40, currentTime: 0 };
  resolveRecordingDuration(known);
  assert.equal(known.currentTime, 0, "files with a known duration are left alone");
});
