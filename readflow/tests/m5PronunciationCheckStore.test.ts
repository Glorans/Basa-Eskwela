import assert from "node:assert/strict";
import test from "node:test";
import {
  createPronunciationCheckStore,
  IDLE_CHECK,
  LOADING_CHECK,
  pronunciationCheckKey,
} from "../src/modules/module5/services/pronunciationCheckStore.ts";
import { PronunciationCheckInProgressError, type SavedPronunciationCheck } from "../src/modules/module5/services/pronunciationSummary.ts";

const scores = { parts: 1, utterances: 2, accuracy: 82, fluency: 74, wordsToPractice: ["orchard"], complete: true, assessedSeconds: 30 };
// What the server returns once the check is saved.
const summary = { summary: scores, saved: true, checkedAt: "2026-11-05T08:00:00Z" };
const doneState = { status: "done", step: "assessing", summary: scores, saved: true, checkedAt: "2026-11-05T08:00:00Z" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// A fake paid request: counts calls and finishes only when the test says so.
function runner() {
  const calls: string[] = [];
  const pending: ReturnType<typeof deferred<typeof summary>>[] = [];
  const run = (attemptId: string, { onStep }: { onStep: (step: any) => void }) => {
    calls.push(attemptId);
    onStep("uploading");
    const next = deferred<typeof summary>();
    pending.push(next);
    return next.promise;
  };
  return { calls, pending, run };
}

test("a check starts only when asked, and repeated presses share one request", async () => {
  const store = createPronunciationCheckStore();
  const fake = runner();
  const key = pronunciationCheckKey("ana", "reading-1");
  assert.equal(store.get(key), LOADING_CHECK, "nothing runs until the saved result is read or the learner presses the button");
  assert.equal(fake.calls.length, 0);

  const first = store.start(key, "reading-1", fake.run);
  const second = store.start(key, "reading-1", fake.run);
  store.start(key, "reading-1", fake.run);
  assert.equal(first, second, "the same pending request is returned");
  assert.deepEqual(fake.calls, ["reading-1"]);
  assert.deepEqual([store.get(key).status, store.get(key).step], ["checking", "uploading"]);

  fake.pending[0].resolve(summary);
  await first;
  assert.deepEqual(store.get(key), doneState);
  // A finished check is never restarted, however many panels ask.
  await store.start(key, "reading-1", fake.run);
  assert.deepEqual(fake.calls, ["reading-1"]);
});

test("the result outlives any panel: panels only read the store, they do not own it", async () => {
  const store = createPronunciationCheckStore();
  const fake = runner();
  const key = pronunciationCheckKey("ana", "reading-1");
  const seen: string[] = [];
  // F3 subscribes and starts, then closes (unsubscribes) while the check runs.
  const stopF3 = store.subscribe(() => seen.push(`f3:${store.get(key).status}`));
  const running = store.start(key, "reading-1", fake.run);
  stopF3();
  // F2 opens mid-check: it sees the same running check and cannot start another.
  const stopF2 = store.subscribe(() => seen.push(`f2:${store.get(key).status}`));
  assert.equal(store.get(key).status, "checking");
  store.start(key, "reading-1", fake.run);
  fake.pending[0].resolve(summary);
  await running;
  stopF2();
  // F4 opens later (or the whole page remounts): the result is still there.
  assert.equal(store.get(key).summary, scores);
  assert.deepEqual(fake.calls, ["reading-1"]);
  assert.ok(seen.includes("f2:done"));
  assert.ok(!seen.some((entry) => entry.startsWith("f3:done")), "a closed panel is not notified");
});

test("a failed check is never shown as a result and may be retried by the learner", async () => {
  const store = createPronunciationCheckStore();
  const fake = runner();
  const key = pronunciationCheckKey("ana", "reading-1");
  const failed = store.start(key, "reading-1", fake.run);
  fake.pending[0].reject(new Error("Speech processing is temporarily unavailable. Please try again later."));
  await failed;
  assert.deepEqual(store.get(key), { status: "error", step: "loading",
    error: "Speech processing is temporarily unavailable. Please try again later." });
  assert.equal(store.get(key).summary, undefined);
  // Unknown or very long errors use a plain message.
  const other = pronunciationCheckKey("ana", "reading-2");
  const odd = store.start(other, "reading-2", fake.run);
  fake.pending[1].reject("x".repeat(400));
  await odd;
  assert.equal(store.get(other).error, "The pronunciation check is unavailable right now. Please try again.");

  const retry = store.start(key, "reading-1", fake.run);
  assert.equal(store.get(key).status, "checking");
  fake.pending[2].resolve(summary);
  await retry;
  assert.equal(store.get(key).status, "done");
  assert.deepEqual(fake.calls, ["reading-1", "reading-2", "reading-1"]);
});

test("another reading or another account never shows this result", async () => {
  const store = createPronunciationCheckStore();
  const fake = runner();
  const done = store.start(pronunciationCheckKey("ana", "reading-1"), "reading-1", fake.run);
  fake.pending[0].resolve(summary);
  await done;
  assert.equal(store.get(pronunciationCheckKey("ana", "reading-2")).summary, undefined);
  assert.equal(store.get(pronunciationCheckKey("ben", "reading-1")).summary, undefined);
  // Without an account or a reading there is nothing to check or show.
  assert.equal(pronunciationCheckKey(undefined, "reading-1"), null);
  assert.equal(pronunciationCheckKey("ana", undefined), null);
  assert.equal(store.get(null), IDLE_CHECK);
  await store.start(null, "reading-1", fake.run);
  assert.deepEqual(fake.calls, ["reading-1"]);
});

// A fake saved-result read: never a paid check.
function savedLoader(result: SavedPronunciationCheck | Error) {
  const calls: string[] = [];
  const load = async (attemptId: string) => {
    calls.push(attemptId);
    if (result instanceof Error) throw result;
    return result;
  };
  return { calls, load };
}

test("after a refresh or new sign-in the saved result is shown without a new check", async () => {
  const store = createPronunciationCheckStore();
  const fake = runner();
  const key = pronunciationCheckKey("ana", "reading-1");
  const saved = savedLoader({ status: "completed", check: summary });
  await store.load(key, "reading-1", saved.load);
  // F2, F3 and F4 all read this one entry.
  assert.deepEqual(store.get(key), doneState);
  await store.start(key, "reading-1", fake.run);
  assert.deepEqual(fake.calls, [], "a saved result is never checked again");
  await store.load(key, "reading-1", saved.load);
  assert.deepEqual(saved.calls, ["reading-1"], "a shown result is not re-read");
});

test("with no saved result the learner sees the button; loading never runs a check", async () => {
  const store = createPronunciationCheckStore();
  const fake = runner();
  const key = pronunciationCheckKey("ana", "reading-1");
  const loading = store.load(key, "reading-1", savedLoader({ status: "none", check: null }).load);
  assert.equal(store.get(key).status, "loading");
  await loading;
  assert.deepEqual(store.get(key), IDLE_CHECK);
  assert.deepEqual(fake.calls, []);
});

test("a check running elsewhere is pending: re-read, never run twice", async () => {
  const store = createPronunciationCheckStore();
  const fake = runner();
  const key = pronunciationCheckKey("ana", "reading-1");
  await store.load(key, "reading-1", savedLoader({ status: "running", check: null }).load);
  assert.equal(store.get(key).status, "pending");
  await store.start(key, "reading-1", fake.run);
  assert.deepEqual(fake.calls, [], "pressing while pending does not start a paid check");
  await store.load(key, "reading-1", savedLoader({ status: "completed", check: summary }).load, { force: true });
  assert.deepEqual(store.get(key), doneState);
});

test("the server reporting a check already running makes this tab pending, not failed", async () => {
  const store = createPronunciationCheckStore();
  const key = pronunciationCheckKey("ana", "reading-1");
  await store.start(key, "reading-1", async () => { throw new PronunciationCheckInProgressError(); });
  assert.equal(store.get(key).status, "pending");
});

test("a result the server could not save is shown with a notice, never as saved", async () => {
  const store = createPronunciationCheckStore();
  const key = pronunciationCheckKey("ana", "reading-1");
  await store.start(key, "reading-1", async () => ({ summary: scores, saved: false, notice: "Your pronunciation check finished, but its result could not be saved." }));
  const state = store.get(key);
  assert.deepEqual([state.status, state.saved, state.summary], ["done", false, scores]);
  assert.match(state.notice ?? "", /could not be saved/);
});

test("if saved results cannot be read, the button stays available with a note", async () => {
  const store = createPronunciationCheckStore();
  const key = pronunciationCheckKey("ana", "reading-1");
  await store.load(key, "reading-1", savedLoader(new Error("offline")).load);
  assert.equal(store.get(key).status, "idle");
  assert.match(store.get(key).loadError ?? "", /could not be loaded/);
});

test("a saved result that arrives while a check runs never replaces it", async () => {
  const store = createPronunciationCheckStore();
  const fake = runner();
  const key = pronunciationCheckKey("ana", "reading-1");
  const running = store.start(key, "reading-1", fake.run);
  await store.load(key, "reading-1", savedLoader({ status: "none", check: null }).load);
  assert.equal(store.get(key).status, "checking");
  fake.pending[0].resolve(summary);
  await running;
  assert.equal(store.get(key).status, "done");
});

// F2 automatic check: once per account and attempt, only after the saved-result read found none.
const none = async (): Promise<SavedPronunciationCheck> => ({ status: "none", check: null });
function memoryMarker() {
  const keys = new Set<string>();
  return { keys, has: (key: string) => keys.has(key), add: (key: string) => { keys.add(key); } };
}

test("F2 auto-start runs one paid check, however often F2 is opened, rerendered or double-invoked", async () => {
  const store = createPronunciationCheckStore();
  const fake = runner();
  const key = pronunciationCheckKey("ana", "reading-1");
  // Before the saved result is read, nothing starts (the reading may already be checked).
  await store.autoStart(key, "reading-1", fake.run);
  assert.equal(fake.calls.length, 0);
  await store.load(key, "reading-1", none);
  const marker = memoryMarker();
  // Strict Mode runs effects twice; reopening F2 calls it again.
  void store.autoStart(key, "reading-1", fake.run, marker);
  void store.autoStart(key, "reading-1", fake.run, marker);
  void store.autoStart(key, "reading-1", fake.run, marker);
  assert.deepEqual(fake.calls, ["reading-1"]);
  assert.equal(store.wasAutoStarted(key, marker), true);
  assert.deepEqual([...marker.keys], [key]);
  fake.pending[0].resolve(summary);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(store.get(key).status, "done");
  await store.autoStart(key, "reading-1", fake.run, marker);
  assert.equal(fake.calls.length, 1, "a finished check is never restarted");
});

test("after a failed automatic check, only the explicit Try Again starts another", async () => {
  const store = createPronunciationCheckStore();
  const fake = runner();
  const key = pronunciationCheckKey("ana", "reading-2");
  await store.load(key, "reading-2", none);
  const first = store.autoStart(key, "reading-2", fake.run);
  fake.pending[0].reject(new Error("Pronunciation check failed. Please try again."));
  await first;
  assert.equal(store.get(key).status, "error");
  assert.equal(store.get(key).summary, undefined, "a failure never carries a result");
  await store.load(key, "reading-2", none, { force: true });
  await store.autoStart(key, "reading-2", fake.run);
  assert.equal(fake.calls.length, 1, "no automatic retry");
  const retry = store.start(key, "reading-2", fake.run);
  assert.equal(fake.calls.length, 2, "Try Again starts one new check");
  fake.pending[1].resolve(summary);
  await retry;
  assert.equal(store.get(key).status, "done");
});

test("a session marker stops a refreshed page from repeating an automatic check; saved, running and unreadable states never auto-start", async () => {
  const marker = memoryMarker();
  const key = pronunciationCheckKey("ana", "reading-3");
  marker.add(key!);
  const refreshed = createPronunciationCheckStore();
  const fake = runner();
  await refreshed.load(key, "reading-3", none);
  await refreshed.autoStart(key, "reading-3", fake.run, marker);
  assert.equal(fake.calls.length, 0);
  assert.equal(refreshed.wasAutoStarted(key, marker), true, "F2 then shows Try Again");
  for (const saved of [
    async () => ({ status: "completed", check: summary }) as SavedPronunciationCheck,
    async () => ({ status: "running", check: null }) as SavedPronunciationCheck,
    async () => { throw new Error("offline"); },
  ]) {
    const store = createPronunciationCheckStore();
    const other = pronunciationCheckKey("ana", "reading-4");
    await store.load(other, "reading-4", saved);
    await store.autoStart(other, "reading-4", fake.run, memoryMarker());
  }
  assert.equal(fake.calls.length, 0, "a saved, running or unreadable check is never auto-started");
  // A different reading is independent.
  const store = createPronunciationCheckStore();
  await store.load(pronunciationCheckKey("ana", "reading-5"), "reading-5", none);
  void store.autoStart(pronunciationCheckKey("ana", "reading-5"), "reading-5", fake.run, marker);
  assert.deepEqual(fake.calls, ["reading-5"]);
});
