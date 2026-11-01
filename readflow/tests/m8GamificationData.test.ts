import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("XP, badges and leaderboards are read only from M8 tables and RPCs", async () => {
  const service = await read("../src/modules/module8/gamificationService.ts");
  for (const source of ['.from("m8_learner_progress")', '.from("m8_earned_badges")', '.from("m8_badges")', '"m8_weekly_leaderboard"']) {
    assert.ok(service.includes(source), source);
  }
  // Read failures surface as errors; nothing substitutes sample progress.
  assert.equal(service.match(/if \((progressResult|earnedResult|badgesResult)\.error\)/g)?.length, 3);
  const independent = await read("../src/pages/IndependentLeaderboard.tsx");
  assert.match(independent, /"m8_independent_leaderboard"/);
});

test("M8 pages contain no fabricated rankings, scores or badge awards", async () => {
  const pages = await Promise.all(["../src/pages/Leaderboard.tsx", "../src/pages/MyBadges.tsx", "../src/pages/IndependentLeaderboard.tsx"].map(read));
  for (const page of pages) {
    assert.doesNotMatch(page, /Math\.random/);
    assert.doesNotMatch(page, /\b(xp|total_xp|rank|points)\s*:\s*\d{2,}/i, "no literal XP/rank values");
    assert.doesNotMatch(page, /xpForModule|difficultyFromDiagnostic/, "XP is computed by the database, not the page");
  }
});

test("the classroom leaderboard reuses the M4 classroom service", async () => {
  const leaderboard = await read("../src/pages/Leaderboard.tsx");
  assert.match(leaderboard, /getStudentClassrooms\(user\.id\)/);
  // Classmates come from the classmate-scoped RPC; students cannot read others' enrollments.
  assert.doesNotMatch(leaderboard, /getRoomEnrollments/);
});

test("student and independent learner navigation both reach M8", async () => {
  const [sidebar, app] = await Promise.all([read("../src/components/basa/BasaSidebar.tsx"), read("../src/App.tsx")]);
  assert.match(sidebar, /to: "\/dashboard\/leaderboard"/);
  assert.match(sidebar, /to: "\/dashboard\/badges"/);
  assert.match(sidebar, /to: "\/dashboard\/progress"/);
  assert.match(app, /path="leaderboard"\s+element=\{<IndependentLeaderboard \/>\}/);
});
