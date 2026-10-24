import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, beforeEach, test } from "node:test";
import { AxiosError } from "axios";

// M5 requests end with a clear, retryable message on a slow connection instead of
// waiting forever. Saves stay safe to retry because the server keeps the first copy.

type Call = { method: string; url: string; config: Record<string, unknown> };
let calls: Call[] = [];
let sessionToken = "token";
let sessionNumber = 0;
let reply: () => Promise<unknown>;
const fixture = {
  supabase: { auth: {
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    getSession: async () => ({ data: { session: { access_token: sessionToken, user: { id: "reader" } } }, error: null }),
  } },
  api: {
    get: (url: string, config: Record<string, unknown>) => { calls.push({ method: "get", url, config }); return reply(); },
    post: (url: string, _body: unknown, config: Record<string, unknown>) => { calls.push({ method: "post", url, config }); return reply(); },
  },
};
const globals = globalThis as typeof globalThis & { __m5SlowConnection?: typeof fixture };
globals.__m5SlowConnection = fixture;
const serviceUrl = new URL("../src/modules/module5/services/oralReadingService.ts", import.meta.url).href;
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL === serviceUrl) {
    if (specifier.endsWith("/supabaseClient")) {
      return { url: "data:text/javascript,export const supabase = globalThis.__m5SlowConnection.supabase", shortCircuit: true };
    }
    if (specifier.endsWith("/services/api")) {
      return { url: "data:text/javascript,export default globalThis.__m5SlowConnection.api", shortCircuit: true };
    }
    if (specifier.endsWith("/teacherComprehension")) {
      return { url: "data:text/javascript,export const parseTeacherComprehensionDetail = (value) => value; export const parseTeacherComprehensionSummary = (value) => value;", shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
} });
const service = await import(serviceUrl) as typeof import("../src/modules/module5/services/oralReadingService.ts");

beforeEach(() => {
  calls = [];
  sessionToken = `token-${++sessionNumber}`;
  reply = async () => ({ data: { attempt: { id: "oral" }, recording: { available: true, segments: ["u"] } } });
});
after(() => {
  hooks.deregister();
  delete globals.__m5SlowConnection;
});

const timedOut = () => Promise.reject(new AxiosError("timeout of 60000ms exceeded", "ECONNABORTED"));

test("saving, loading and recording requests all carry a time limit", async () => {
  await service.createOralReadingAttempt({ moduleId: "m", transcript: "t", durationSeconds: 1, wordMetrics: [], sttConfidence: null });
  await service.getOralReadingAttempt("oral");
  await service.getOralReadingRecording("oral", true);
  await service.uploadOralReadingRecording("oral", [new Blob(["a"], { type: "audio/webm" })]);
  const timeouts = Object.fromEntries(calls.map((call) => [`${call.method} ${call.url}`, call.config.timeout]));
  assert.deepEqual(timeouts, {
    "post /api/oral-reading/attempts": 60_000,
    "get /api/oral-reading/attempts/oral": 60_000,
    "get /api/oral-reading/teacher/attempts/oral/recording": 60_000,
    // A five-minute recording upload gets longer on a slow connection.
    "post /api/oral-reading/attempts/oral/recording": 180_000,
  });
});

test("a timed-out save or upload reports a slow connection, not a generic failure", async () => {
  reply = timedOut;
  await assert.rejects(
    service.createOralReadingAttempt({ moduleId: "m", transcript: "t", durationSeconds: 1, wordMetrics: [], sttConfidence: null }),
    { name: "OralReadingServiceError", message: service.SLOW_CONNECTION_MESSAGE },
  );
  await assert.rejects(service.uploadOralReadingRecording("oral", [new Blob(["a"])]), { message: service.SLOW_CONNECTION_MESSAGE });
  await assert.rejects(service.getOralReadingRecording("oral"), { message: service.SLOW_CONNECTION_MESSAGE });
});

test("other failures keep their existing messages", async () => {
  reply = () => Promise.reject(new AxiosError("Network Error", "ERR_NETWORK"));
  await assert.rejects(service.getOralReadingRecording("oral"), { message: "Unable to load recording. Please retry." });
});

test("withTimeout passes results through and rejects with the given error when work is too slow", async () => {
  assert.equal(await service.withTimeout(Promise.resolve("done"), 50, () => new Error("slow")), "done");
  await assert.rejects(service.withTimeout(new Promise(() => {}), 10, () => new Error("slow")), { message: "slow" });
});


test("a server-saved result seeds navigation without a duplicate result GET", async () => {
  const saved = { id: "saved", userId: "reader", wordMetrics: [], moduleTitle: "Seeds", pronunciationAccuracy: 90 };
  reply = async () => ({ data: { attempt: saved } });
  await service.createOralReadingAttempt({ moduleId: "m", transcript: "t", durationSeconds: 1, wordMetrics: [], sttConfidence: null });
  assert.equal(service.peekOralReadingAttempt("saved", "reader"), saved);
  assert.equal(service.peekOralReadingAttempt("saved", "another-reader"), undefined);
  assert.equal(await service.getOralReadingAttempt("saved"), saved);
  assert.equal(calls.length, 1);
  await service.getOralReadingAttempt("saved", true);
  assert.equal(calls.length, 2, "explicit retry/revalidation bypasses a fulfilled cache entry");
});

test("oral-only results are reused only after completion is confirmed", async () => {
  const saved = { id: "oral-only", userId: "reader", wordMetrics: [], readAloudOnly: true, readAloudCompleted: false,
    moduleId: "module", moduleTitle: "Seeds", language: "en" as const, transcript: "seed", durationSeconds: 1,
    readingSpeedWpm: 60, pronunciationAccuracy: 100, expectedWordCount: 1, detectedErrorCount: 0,
    sttConfidence: null, completedAt: "2026-10-25T00:00:00Z" };
  reply = async () => ({ data: { attempt: saved } });
  await service.createOralReadingAttempt({ moduleId: "m", transcript: "t", durationSeconds: 1, wordMetrics: [], sttConfidence: null });
  assert.equal(service.peekOralReadingAttempt("oral-only", "reader"), undefined);
  service.rememberOralReadingAttempt({ ...saved, readAloudCompleted: true });
  assert.equal((await service.getOralReadingAttempt("oral-only")).readAloudCompleted, true);
  assert.equal(calls.length, 1);
});

test("activity fetches share pending work and distinguish passage and assignment context", async () => {
  reply = async () => ({ data: { module: { id: "module", passage: "Seeds" } } });
  await Promise.all([service.getOralReadingModule("module", { passageId: "one" }), service.getOralReadingModule("module", { passageId: "one" })]);
  await service.getOralReadingModule("module", { passageId: "one" });
  assert.equal(calls.length, 1);
  await service.getOralReadingModule("module", { passageId: "two" });
  await service.getOralReadingModule("module", { passageId: "one", assignmentId: "new" });
  assert.equal(calls.length, 3);
});
