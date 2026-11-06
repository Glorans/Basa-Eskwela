import assert from "node:assert/strict";
import test from "node:test";
import { achievementProgress } from "../src/modules/module8/achievements.ts";

// Belongs with the uncommitted achievement guide (achievements.ts), not with the F1 commit.
test("Diamond progress leaves out daily login XP and still works without the new field", () => {
  const stats = { totalXp: 2020, readAloudCount: 0, completedModules: 0, readingDays: 0, longestStreak: 0 };
  assert.equal(achievementProgress("diamond", { ...stats, diamondXp: 1990 })?.current, 1990);
  assert.equal(achievementProgress("diamond", stats)?.current, 2000, "capped at the target");
  assert.equal(achievementProgress("streak_3", { ...stats, diamondXp: 1990, longestStreak: 2 })?.current, 2, "other badges are unaffected");
});
