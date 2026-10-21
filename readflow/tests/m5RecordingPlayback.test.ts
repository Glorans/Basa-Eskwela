import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createSegmentPlaybackQueue,
  nextSegmentIndex,
  type PlayableSegment,
} from "../src/modules/module5/services/recordingPlaybackQueue.ts";

// The shared M2 recorder rotates every 25 s (DIAGNOSTIC_SEGMENT_DURATION_SECONDS); this is unchanged.
const SEGMENT_SECONDS = 25;

class FakeAudio implements PlayableSegment {
  paused = true;
  currentTime = 0;
  preload: string;
  index: number;
  log: number[];
  blockAutoplay: boolean;
  constructor(index: number, log: number[], preload = "none", blockAutoplay = false) {
    this.index = index;
    this.log = log;
    this.preload = preload;
    this.blockAutoplay = blockAutoplay;
  }
  play() {
    if (this.blockAutoplay) return Promise.reject(new DOMException("blocked", "NotAllowedError"));
    this.paused = false;
    this.log.push(this.index);
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

function setup(count: number, options: { blockAutoplay?: number } = {}) {
  const log: number[] = [];
  const audio = Array.from({ length: count }, (_, index) =>
    new FakeAudio(index, log, index === 0 ? "metadata" : "none", options.blockAutoplay === index));
  const queue = createSegmentPlaybackQueue((index) => audio[index], () => audio.length);
  return { audio, log, queue };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("a recording longer than two minutes plays every part once, in saved order, without skips", async () => {
  const durationSeconds = 170; // 2 min 50 s => 7 recorder parts
  const count = Math.ceil(durationSeconds / SEGMENT_SECONDS);
  assert.equal(count, 7);
  const { audio, log, queue } = setup(count);

  await audio[0].play(); // the learner presses play on part 1
  queue.handlePlay(0);
  for (let index = 0; index < count; index++) {
    audio[index].paused = true; // the browser marks a finished part as paused
    const started = queue.handleEnded(index);
    await flush();
    if (started !== null) queue.handlePlay(started);
    assert.equal(started, index + 1 < count ? index + 1 : null);
  }
  assert.deepEqual(log, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(new Set(log).size, count);
  assert.ok(audio.every((part) => part.paused), "playback stops after the last part");
});

test("each automatic continuation restarts the next part from its beginning", async () => {
  const { audio, queue } = setup(3);
  audio[1].currentTime = 12; // left part-way through by an earlier manual listen
  assert.equal(queue.handleEnded(0), 1);
  await flush();
  assert.equal(audio[1].currentTime, 0);
  assert.equal(audio[1].paused, false);
});

test("manual playback is kept: starting any part pauses the others and preloads only the next part", () => {
  const { audio, queue } = setup(4);
  audio[0].paused = false;
  audio[3].paused = false;
  audio[2].paused = false; // the learner manually presses part 3
  queue.handlePlay(2);
  assert.deepEqual(audio.map((part) => part.paused), [true, true, false, true]);
  assert.equal(audio[3].preload, "auto");
  assert.equal(audio[1].preload, "none");
});

test("a blocked autoplay leaves the next part ready for a manual press", async () => {
  const { audio, log, queue } = setup(3, { blockAutoplay: 1 });
  assert.equal(queue.handleEnded(0), 1);
  await flush();
  assert.deepEqual(log, []);
  assert.equal(audio[1].paused, true);
  assert.equal(audio[1].currentTime, 0);
});

test("single-part and missing recordings never advance", () => {
  assert.equal(nextSegmentIndex(0, 1), null);
  assert.equal(nextSegmentIndex(0, 0), null);
  assert.equal(nextSegmentIndex(-1, 3), null);
  assert.equal(nextSegmentIndex(1.5, 3), null);
  const { queue } = setup(1);
  assert.equal(queue.handleEnded(0), null);
  assert.equal(createSegmentPlaybackQueue(() => undefined, () => 2).handleEnded(0), null);
});

test("RecordingPlayback wires continuation and keeps native controls on every part", async () => {
  const source = await readFile(new URL("../src/modules/module5/components/RecordingPlayback.tsx", import.meta.url), "utf8");
  assert.match(source, /onEnded=\{\(\) => queue\.handleEnded\(index\)\}/);
  assert.match(source, /onPlay=\{\(\) => queue\.handlePlay\(index\)\}/);
  assert.match(source, /<audio[\s\S]*?\bcontrols\b/);
});

test("the shared M2 recorder settings are untouched by M5 playback", async () => {
  const recording = await readFile(new URL("../src/modules/module2/services/diagnosticRecording.ts", import.meta.url), "utf8");
  assert.match(recording, /DIAGNOSTIC_SEGMENT_DURATION_SECONDS = 25;/);
  assert.match(recording, /DIAGNOSTIC_MAX_RECORDING_SECONDS = 5 \* 60;/);
});
