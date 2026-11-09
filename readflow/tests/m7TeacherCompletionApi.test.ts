import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, beforeEach, test } from "node:test";
import { resolveApiUrl } from "../src/lib/apiUrl.ts";

let env: Parameters<typeof resolveApiUrl>[0];
let sessionReply: { data: { session: { access_token?: string } | null }; error: unknown };
const fixture = {
  supabase: { auth: { getSession: async () => sessionReply } },
  getApiUrl: () => resolveApiUrl(env),
};
const globals = globalThis as typeof globalThis & { __m7CompletionApi?: typeof fixture };
globals.__m7CompletionApi = fixture;
const serviceUrl = new URL("../src/modules/module7/services/teacherAnalyticsService.ts", import.meta.url).href;
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL === serviceUrl) {
    if (specifier.endsWith("/supabaseClient")) {
      return { url: "data:text/javascript,export const supabase = globalThis.__m7CompletionApi.supabase", shortCircuit: true };
    }
    if (specifier.endsWith("/apiUrl")) {
      return { url: "data:text/javascript,export const getApiUrl = globalThis.__m7CompletionApi.getApiUrl", shortCircuit: true };
    }
    if (specifier.endsWith("/teacherQuizService")) {
      return { url: "data:text/javascript,export const getTeacherQuizAttempts = () => { throw new Error('Unexpected quiz request'); }; export const quizMetrics = () => {};", shortCircuit: true };
    }
    if (specifier.endsWith("/classroomService")) {
      return { url: "data:text/javascript,export const getTeacherClassrooms = () => { throw new Error('Unexpected classroom request'); }; export const getRoomEnrollments = getTeacherClassrooms;", shortCircuit: true };
    }
    if (specifier.endsWith("/oralReadingService")) {
      return { url: "data:text/javascript,export const getTeacherOralReadingAttempts = () => { throw new Error('Unexpected reading request'); }", shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
} });
const { getTeacherCompletionAnalytics } = await import(serviceUrl) as typeof import("../src/modules/module7/services/teacherAnalyticsService.ts");
const originalFetch = globalThis.fetch;
let requests: { url: string; options?: RequestInit }[];
let status: number;
let body: unknown;
const analytics = {
  totalClassrooms: 1, totalAssignments: 4, completedAssignments: 3,
  incompleteAssignments: 1, completionRate: 75, classrooms: [], students: [],
};

beforeEach(() => {
  env = { VITE_API_URL: "https://backend.example.org", DEV: false };
  sessionReply = { data: { session: { access_token: "teacher-token" } }, error: null };
  requests = [];
  status = 200;
  body = { success: true, analytics };
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify(body), { status });
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  hooks.deregister();
  delete globals.__m7CompletionApi;
});

test("completion analytics uses configured hosts, normalizes trailing slashes, and preserves backend data and Bearer auth", async () => {
  for (const base of ["https://backend.example.org", "https://backend.example.org/prefix///", "http://localhost:7123/"]) {
    env = { VITE_API_URL: base, DEV: false };
    assert.deepEqual(await getTeacherCompletionAnalytics(), analytics);
    assert.deepEqual(requests.at(-1), {
      url: `${base.replace(/\/+$/, "")}/api/oral-reading/teacher/completion-analytics`,
      options: { method: "GET", headers: { Authorization: "Bearer teacher-token" } },
    });
  }
});

test("completion analytics uses the established development fallback and rejects missing production configuration", async () => {
  env = { DEV: true };
  await getTeacherCompletionAnalytics();
  assert.equal(requests[0].url, "http://localhost:5000/api/oral-reading/teacher/completion-analytics");
  env = { DEV: false };
  await assert.rejects(getTeacherCompletionAnalytics(), /VITE_API_URL is not set/);
  assert.equal(requests.length, 1);
});

test("invalid authentication prevents any completion request", async () => {
  for (const session of [null, {}, { access_token: "" }]) {
    sessionReply = { data: { session }, error: null };
    await assert.rejects(getTeacherCompletionAnalytics(), /Please sign in again to view completion analytics/);
  }
  sessionReply = { data: { session: { access_token: "expired" } }, error: new Error("Session failed") };
  await assert.rejects(getTeacherCompletionAnalytics(), /Please sign in again to view completion analytics/);
  assert.equal(requests.length, 0);
});

test("backend authorization and unsuccessful response messages remain errors", async () => {
  for (const responseStatus of [401, 403, 500, 200]) {
    status = responseStatus;
    body = { success: false, message: "Approved Teacher access is required." };
    await assert.rejects(getTeacherCompletionAnalytics(), { message: "Approved Teacher access is required." });
  }
  body = { success: false };
  await assert.rejects(getTeacherCompletionAnalytics(), { message: "Unable to load classroom completion analytics." });
});
