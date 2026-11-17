import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { after, beforeEach, test } from "node:test";
import { ownLeaderboardLabel } from "../src/modules/module8/leaderboardRanking.ts";

// Independent Learner feedback (2026-11-17): the learner's own leaderboard row shows their nickname; other learners stay
// anonymous. Opening Pronunciation Feedback asks for the learner's own recording links once (player + check).

test("own leaderboard row: 'Nickname (You)'; no nickname keeps 'You'; other learners are untouched", () => {
  assert.equal(ownLeaderboardLabel("You", "Ana"), "Ana (You)");
  assert.equal(ownLeaderboardLabel("You", "  Ana Cruz  "), "Ana Cruz (You)");
  assert.equal(ownLeaderboardLabel("You", ""), "You");
  assert.equal(ownLeaderboardLabel("You", null), "You");
  assert.equal(ownLeaderboardLabel("You", undefined), "You");
  // An older ranking that already sends the learner's name.
  assert.equal(ownLeaderboardLabel("Ana", null), "Ana (You)");
});

test("the page labels only the viewer's own row and still shows other learners' database names as sent", async () => {
  const page = await readFile(new URL("../src/pages/IndependentLeaderboard.tsx", import.meta.url), "utf8");
  assert.match(page, /\{isYou\s*\? ownLeaderboardLabel\(entry\.display_name, profile\?\.nickname\)\s*: entry\.display_name\}/);
  assert.match(page, /const \{ profile \} = useAuthenticatedProfile\(\);/);
  // The ranking request itself is unchanged (same function, period and language).
  assert.match(page, /"m8_independent_rankings" as never/);
  // The Student classroom leaderboard is a different page and is not touched.
  const classroom = await readFile(new URL("../src/pages/Leaderboard.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(classroom, /ownLeaderboardLabel/);
});

type Call = { url: string };
let calls: Call[] = [];
let token = "token";
let reply: (url: string) => Promise<unknown>;
const fixture = {
  supabase: { auth: {
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    getSession: async () => ({ data: { session: { access_token: token, user: { id: `user-${token}` } } }, error: null }),
  } },
  api: { get: (url: string) => { calls.push({ url }); return reply(url); } },
};
const globals = globalThis as typeof globalThis & { __ilRecording?: typeof fixture };
globals.__ilRecording = fixture;
const serviceUrl = new URL("../src/modules/module5/services/oralReadingService.ts", import.meta.url).href;
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL === serviceUrl) {
    if (specifier.endsWith("/supabaseClient")) return { url: "data:text/javascript,export const supabase = globalThis.__ilRecording.supabase", shortCircuit: true };
    if (specifier.endsWith("/services/api")) return { url: "data:text/javascript,export default globalThis.__ilRecording.api", shortCircuit: true };
    if (specifier.endsWith("/teacherComprehension")) {
      return { url: "data:text/javascript,export const parseTeacherComprehensionDetail = (value) => value; export const parseTeacherComprehensionSummary = (value) => value;", shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
} });
const service = await import(serviceUrl) as typeof import("../src/modules/module5/services/oralReadingService.ts");
after(() => { hooks.deregister(); delete globals.__ilRecording; });
let session = 0;
beforeEach(() => { calls = []; token = `token-${++session}`; });
const saved = { recording: { available: true, segments: ["https://storage.example/signed-1"] } };

test("the player and the pronunciation check share one request for the learner's own recording", async () => {
  reply = async () => { await new Promise((resolve) => setTimeout(resolve, 20)); return { data: saved }; };
  const [player, check] = await Promise.all([service.getOralReadingRecording("reading-1"), service.getOralReadingRecording("reading-1")]);
  assert.deepEqual(player, saved.recording);
  assert.deepEqual(check, saved.recording);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/oral-reading/attempts/reading-1/recording");
  // Reopened shortly after: still the same links (valid 300 s, kept 60 s).
  await service.getOralReadingRecording("reading-1");
  assert.equal(calls.length, 1);
  // Another reading is its own request.
  await service.getOralReadingRecording("reading-2");
  assert.equal(calls.length, 2);
});

test("a recording that is not saved yet is never kept: the next request asks again", async () => {
  reply = async () => ({ data: { recording: { available: false, segments: [] } } });
  assert.equal((await service.getOralReadingRecording("reading-3")).available, false);
  reply = async () => ({ data: saved });
  assert.equal((await service.getOralReadingRecording("reading-3")).available, true);
  assert.equal(calls.length, 2);
});

test("another session never reuses the links, and Teacher/Admin review always asks the server", async () => {
  reply = async () => ({ data: saved });
  await service.getOralReadingRecording("reading-4");
  token = "someone-else";
  await service.getOralReadingRecording("reading-4");
  assert.equal(calls.length, 2, "a new session asks again");
  await service.getOralReadingRecording("reading-4", true);
  await service.getOralReadingRecording("reading-4", true);
  await service.getOralReadingRecording("reading-4", "admin");
  assert.deepEqual(calls.slice(2).map((call) => call.url), [
    "/api/oral-reading/teacher/attempts/reading-4/recording",
    "/api/oral-reading/teacher/attempts/reading-4/recording",
    "/api/oral-reading/admin/attempts/reading-4/recording",
  ]);
});

test("a failed request is not kept", async () => {
  reply = async () => { throw new Error("network"); };
  await assert.rejects(service.getOralReadingRecording("reading-5"));
  reply = async () => ({ data: saved });
  assert.equal((await service.getOralReadingRecording("reading-5")).available, true);
  assert.equal(calls.length, 2);
});

test("phones give learners' names room: the generic avatar hides and names wrap between words", async () => {
  const page = await readFile(new URL("../src/pages/IndependentLeaderboard.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/pages/IndependentLeaderboard.css", import.meta.url), "utf8");
  assert.match(page, /import "\.\/IndependentLeaderboard\.css";/);
  assert.match(page, /className="il-leaderboard-row"/);
  assert.match(page, /className="il-leaderboard-avatar"\s*aria-hidden="true"/);
  assert.match(page, /overflowWrap: "break-word",\s*wordBreak: "normal",/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /\.il-leaderboard-avatar \{\s*display: none !important;/);
});
