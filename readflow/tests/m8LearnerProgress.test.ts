import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseUnlockedDifficulty, toLearnerProgress } from "../src/modules/module8/learnerProgress.ts";
import type { LearnerProgressRow } from "../src/modules/module8/learnerProgress.ts";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const row = (unlocked_difficulty: unknown): LearnerProgressRow => ({
  user_id: "00000000-0000-4000-8000-000000000001",
  total_xp: 130,
  current_streak: 2,
  longest_streak: 4,
  unlocked_difficulty,
});

test("unlocked_difficulty maps Easy, Medium and Hard unchanged", () => {
  for (const level of ["Easy", "Medium", "Hard"] as const) {
    assert.equal(toLearnerProgress(row(level)).difficulty, level);
  }
});

test("a Hard learner is shown as Hard, not the Easy fallback (regression)", () => {
  const progress = toLearnerProgress(row("Hard"));
  assert.deepEqual(progress, {
    user_id: "00000000-0000-4000-8000-000000000001",
    total_xp: 130,
    current_streak: 2,
    longest_streak: 4,
    difficulty: "Hard",
  });
});

test("the non-existent difficulty column is ignored", () => {
  const legacy = { user_id: "u1", difficulty: "Hard" } as LearnerProgressRow;
  assert.equal(toLearnerProgress(legacy).difficulty, null);
});

test("missing or malformed unlocked_difficulty is reported as null, never as Easy", () => {
  for (const value of [undefined, null, "", "easy", "HARD", " Medium", "Expert", 3, {}]) {
    assert.equal(parseUnlockedDifficulty(value), null, String(value));
  }
});

test("diagnostic reading levels are not accepted as unlocked difficulties", () => {
  for (const level of ["Frustration", "Instructional", "Independent"]) {
    assert.equal(parseUnlockedDifficulty(level), null, level);
  }
});

test("counters default to 0 when absent", () => {
  const progress = toLearnerProgress({ user_id: "u1", unlocked_difficulty: "Medium" });
  assert.equal(progress.total_xp, 0);
  assert.equal(progress.current_streak, 0);
  assert.equal(progress.longest_streak, 0);
});

test("the service and badges page use the unlocked_difficulty mapping", async () => {
  const [service, page] = await Promise.all([
    read("../src/modules/module8/gamificationService.ts"),
    read("../src/pages/MyBadges.tsx"),
  ]);
  assert.match(service, /toLearnerProgress\(rawProgress\)/);
  assert.doesNotMatch(service, /rawProgress\.difficulty/);
  // An unreadable level on an existing row is not presented as Easy.
  assert.match(page, /progress\.difficulty \?\? "Not available"/);
  assert.doesNotMatch(page, /progress\?\.difficulty \?\? "Easy"/);
});
