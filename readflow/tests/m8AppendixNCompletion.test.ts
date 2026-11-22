// M8 Appendix N completion: read-time reading streak, achievement presentation, honest level
// wording and consistent leaderboard ties. No network: Supabase is a read-only stub.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { philippineDate, readingStreaks } from "../src/modules/module8/readingStreak.ts";
import * as achievements from "../src/modules/module8/achievements.ts";
import * as learnerProgress from "../src/modules/module8/learnerProgress.ts";
import * as leaderboardRanking from "../src/modules/module8/leaderboardRanking.ts";
import * as readingStreak from "../src/modules/module8/readingStreak.ts";
import { loadComponentModule } from "./helpers/hookRuntime.ts";

const { achievementProgress, earnedDate, ACHIEVEMENT_GUIDE } = achievements;
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const streak = (dates: string[], today: string) => {
  const { current, longest, readToday, lastReadDate } = readingStreaks(dates, today);
  return { current, longest, readToday, lastReadDate };
};

// --- Function 5: reading streak ------------------------------------------------------------------

test("streak: today, yesterday, a missed day, several missed days and an empty history", () => {
  const run = ["2026-11-03", "2026-11-04", "2026-11-05"];
  assert.deepEqual(streak(run, "2026-11-05"), { current: 3, longest: 3, readToday: true, lastReadDate: "2026-11-05" });
  assert.deepEqual(streak(run, "2026-11-06"), { current: 3, longest: 3, readToday: false, lastReadDate: "2026-11-05" }, "yesterday keeps the streak");
  assert.deepEqual(streak(run, "2026-11-07"), { current: 0, longest: 3, readToday: false, lastReadDate: "2026-11-05" }, "one missed day ends it");
  assert.equal(streak(run, "2026-11-20").current, 0, "several missed days");
  assert.deepEqual(streak([], "2026-11-05"), { current: 0, longest: 0, readToday: false, lastReadDate: null });
});

test("streak: only the latest unbroken run counts as current; longest is kept", () => {
  const dates = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-11-04", "2026-11-05"];
  assert.deepEqual(streak(dates, "2026-11-05"), { current: 2, longest: 4, readToday: true, lastReadDate: "2026-11-05" });
});

test("streak: several readings on one date count once; future and invalid dates are ignored", () => {
  assert.deepEqual(streak(["2026-11-05", "2026-11-05", "2026-11-05"], "2026-11-05"), { current: 1, longest: 1, readToday: true, lastReadDate: "2026-11-05" });
  assert.equal(readingStreaks(["2026-11-05", "2026-11-05"], "2026-11-05").readingDays, 1);
  assert.deepEqual(streak(["2026-11-04", "2026-11-06", "2026-02-30", "not a date"], "2026-11-05"), { current: 1, longest: 1, readToday: false, lastReadDate: "2026-11-04" });
});

test("streak: month, year and leap-day boundaries", () => {
  assert.equal(streak(["2026-10-31", "2026-11-01"], "2026-11-01").current, 2, "month boundary");
  assert.equal(streak(["2026-12-31", "2027-01-01", "2027-01-02"], "2027-01-02").current, 3, "year boundary");
  assert.equal(streak(["2028-02-28", "2028-02-29", "2028-03-01"], "2028-03-01").current, 3, "leap day");
  assert.equal(streak(["2027-02-28", "2027-03-01"], "2027-03-01").current, 2, "no leap day in 2027");
  assert.equal(streak(["2026-11-30", "2026-12-02"], "2026-12-02").current, 1, "a gap across a month end breaks the run");
});

test("Philippine-time midnight decides 'today', not UTC", () => {
  assert.equal(philippineDate(new Date("2026-11-04T15:59:59Z")), "2026-11-04");
  assert.equal(philippineDate(new Date("2026-11-04T16:00:00Z")), "2026-11-05");
  assert.equal(philippineDate(new Date("2026-12-31T16:00:00Z")), "2027-01-01");
  // A learner who read on Nov 4 (PHT) still has a streak just after midnight on Nov 5 PHT, and none on Nov 6.
  assert.equal(streak(["2026-11-04"], philippineDate(new Date("2026-11-04T16:00:00Z"))).current, 1);
  assert.equal(streak(["2026-11-04"], philippineDate(new Date("2026-11-05T16:00:00Z"))).current, 0);
});

// --- The page's data: reads only, correct streak after a break --------------------------------

function service(rows: Record<string, unknown>, writes: string[], myBadges?: unknown[]) {
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: "me" } }, error: null }) },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query: any = {
        select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; },
        maybeSingle: async () => ({ data: rows[table], error: null }),
        then(resolve: (value: unknown) => void) { resolve({ data: rows[table], error: null }); },
      };
      for (const write of ["insert", "update", "upsert", "delete"]) query[write] = () => { writes.push(`${table}.${write}`); throw new Error("no writes"); };
      return query;
    },
    // Only the read-only badge list may be called; before claiming is deployed it is missing.
    rpc(name: string) {
      if (name === "m8_my_badges") return Promise.resolve(myBadges ? { data: myBadges, error: null } : { data: null, error: { code: "PGRST202" } });
      writes.push(`rpc:${name}`); throw new Error("no rpc");
    },
  };
  return loadComponentModule(new URL("../src/modules/module8/gamificationService.ts", import.meta.url), (id) => {
    if (id.endsWith("/supabaseClient")) return { supabase: db };
    if (id.endsWith("/learnerProgress")) return learnerProgress;
    if (id.endsWith("/leaderboardRanking")) return leaderboardRanking;
    if (id.endsWith("/readingStreak")) return readingStreak;
    if (id.endsWith("/achievements")) return achievements;
    throw new Error(`Unexpected import ${id}`);
  });
}

test("opening the page only reads, and replaces an out-of-date stored streak", async () => {
  const writes: string[] = [];
  const today = philippineDate();
  const daysAgo = (n: number) => philippineDate(new Date(Date.now() - n * 86_400_000));
  const module = service({
    m8_learner_progress: { user_id: "me", total_xp: 60, current_streak: 1, longest_streak: 1, unlocked_difficulty: "Medium", read_aloud_count: 4, completed_modules: 0 },
    m8_earned_badges: [{ badge_id: "level_up", earned_at: "2026-10-26T15:04:00Z" }],
    m8_badges: [{ id: "level_up", name: "Level Up", description: "Unlock Medium level", icon: "ArrowUpCircle" }],
    m8_reading_days: [{ reading_date: daysAgo(5) }, { reading_date: daysAgo(4) }],
  }, writes);
  const result = await module.getMyGamification();
  assert.deepEqual(writes, []);
  assert.equal(result.progress.current_streak, 0, "the stored 1 is out of date: the last reading was 4 days ago");
  assert.equal(result.progress.longest_streak, 2, "longest never decreases");
  assert.equal(result.progress.difficulty, "Medium");
  assert.equal(JSON.stringify(result.stats), JSON.stringify({ totalXp: 60, readAloudCount: 4, completedModules: 0, readingDays: 2, longestStreak: 2 }));
  assert.equal(JSON.stringify(result.reading), JSON.stringify({ readingDays: 2, lastReadDate: daysAgo(4), readToday: false }));
  assert.notEqual(result.reading.lastReadDate, today);
  assert.equal(result.claiming, false, "claiming not deployed: the earlier display");
  assert.equal(result.badges[0].state, "claimed");
  assert.equal(result.badges[0].claimed_at, "2026-10-26T15:04:00Z");
});

test("with claiming deployed, the page shows the database's Locked / Ready / Claimed and still only reads", async () => {
  const writes: string[] = [];
  const module = service({ m8_learner_progress: null, m8_earned_badges: [], m8_badges: [], m8_reading_days: [] }, writes, [
    { badge_id: "first_read", name: "First Read", description: "d", icon: "Star", eligible: true, unlocked_at: "2026-11-01T00:00:00Z", claimed_at: null },
    { badge_id: "level_up", name: "Level Up", description: "d", icon: "ArrowUpCircle", eligible: true, unlocked_at: null, claimed_at: "2026-10-26T15:04:00Z" },
    { badge_id: "bookworm", name: "Bookworm", description: "d", icon: "BookOpenCheck", eligible: false, unlocked_at: null, claimed_at: null },
  ]);
  const result = await module.getMyGamification();
  assert.deepEqual(writes, []);
  assert.equal(result.claiming, true);
  assert.deepEqual(result.badges.map((b: { id: string; state: string }) => [b.id, b.state]), [["first_read", "ready"], ["level_up", "claimed"], ["bookworm", "locked"]]);
});

// --- Functions 2 and 3: achievements ----------------------------------------------------------

test("achievement guide: one entry per badge, and its targets match the database rules", () => {
  assert.deepEqual(Object.keys(ACHIEVEMENT_GUIDE).sort(),
    ["bookworm", "brave_reader", "consistent_reader", "diamond", "first_read", "graduate", "level_up", "streak_3"]);
  const c2 = read("../supabase/staging/c2_m8_gamification_hardened.sql");
  const consistent = read("supabase/migrations/20261022000000_m8_consistent_reader.sql");
  assert.match(c2, /completed_modules from public\.m8_learner_progress where user_id=p_user\)>=5/);
  assert.match(c2, /total_xp from public\.m8_learner_progress where user_id=p_user\)>=2000/);
  assert.match(c2, /read_aloud_count from public\.m8_learner_progress where user_id=new\.user_id\)>=10/);
  assert.match(c2, /if n>=3 then insert into public\.m8_earned_badges\(user_id,badge_id\) values\(p_user,'streak_3'\)/);
  assert.match(consistent, /WHERE user_id=NEW\.user_id\) >= 7/);
  const stats = { totalXp: 0, readAloudCount: 0, completedModules: 0, readingDays: 0, longestStreak: 0 };
  assert.deepEqual(["first_read", "bookworm", "diamond", "streak_3", "consistent_reader", "brave_reader"].map((id) => achievementProgress(id, stats)?.target),
    [1, 3, 2000, 3, 7, 10]);
});

test("achievement progress is capped, and badges without a simple count show none", () => {
  const stats = { totalXp: 2600, readAloudCount: 4, completedModules: 0, readingDays: 2, longestStreak: 2 };
  assert.deepEqual(achievementProgress("brave_reader", stats), { current: 4, target: 10, unit: "verified readings" });
  assert.deepEqual(achievementProgress("diamond", stats), { current: 2000, target: 2000, unit: "XP" });
  for (const id of ["level_up", "graduate", "unknown_badge"]) assert.equal(achievementProgress(id, stats), null, id);
  assert.equal(earnedDate("2026-11-04T16:30:00Z"), "Nov 5, 2026", "earned dates are shown in Philippine time");
  assert.equal(earnedDate(null), null);
  assert.equal(earnedDate("bad"), null);
});

test("the achievements page explains badges, the streak and the reading level honestly", () => {
  const page = read("src/pages/MyBadges.tsx");
  assert.match(page, /Badges mark what you have done\. Achievements show how well you read and understand over time\./);
  assert.match(page, /Badges \{claimedWord\}/);
  assert.match(page, /const claimedWord = claiming \? "Claimed" : "Earned";/);
  assert.match(page, /getMyAchievements/);
  assert.match(page, /Best streak: \{progress\?\.longest_streak/);
  assert.match(page, /Read today to keep your streak going!/);
  assert.match(page, /Reading Level/);
  assert.match(page, /Earning XP does not change your level\./);
  assert.match(page, /progress\.difficulty \?\? "Not available"/);
  assert.doesNotMatch(page, /unlock(s|ed)? .*level by|XP unlocks/i, "never says XP unlocks levels");
  assert.match(page, /ACHIEVEMENT_GUIDE\[badge\.id\]\?\.howToEarn \?\? badge\.description/);
});

test("F3: Bronze, Silver and Gold come from the count, in one place, without repeating a badge", () => {
  const { milestoneProgress, MILESTONE_GUIDE } = achievements;
  // Capstone tiers (m8_final_corrections_v1): Bronze 1, Silver 2, Gold 3 qualifying stories.
  assert.deepEqual(milestoneProgress(0), { count: 0, reached: null, next: { tier: "Bronze", target: 1 } });
  assert.deepEqual(milestoneProgress(1), { count: 1, reached: "Bronze", next: { tier: "Silver", target: 2 } });
  assert.deepEqual(milestoneProgress(2), { count: 2, reached: "Silver", next: { tier: "Gold", target: 3 } });
  assert.deepEqual(milestoneProgress(5), { count: 5, reached: "Gold", next: null });
  assert.deepEqual(milestoneProgress(Number.NaN), { count: 0, reached: null, next: { tier: "Bronze", target: 1 } });
  assert.deepEqual(Object.keys(MILESTONE_GUIDE).sort(), ["accurate_reader", "comprehension_star"]);
  for (const id of Object.keys(MILESTONE_GUIDE)) assert.equal(id in ACHIEVEMENT_GUIDE, false, "not also a badge");
});

test("F2: First Read and Bookworm count activities when known, and old data still shows a number", () => {
  const stats = { totalXp: 0, readAloudCount: 0, completedModules: 1, readingDays: 0, longestStreak: 0 };
  assert.equal(achievementProgress("bookworm", stats)?.current, 1);
  assert.equal(achievementProgress("bookworm", { ...stats, completedActivities: 2 })?.current, 2);
  assert.deepEqual(achievementProgress("bookworm", { ...stats, completedActivities: 4 }), { current: 3, target: 3, unit: "different activities" }, "Bookworm: 3 activities");
  assert.match(ACHIEVEMENT_GUIDE.diamond.note ?? "", /Daily login XP does not count/);
});

test("F4: the pages prefer the private per-language rankings and keep working without them", () => {
  const service = read("src/modules/module8/gamificationService.ts");
  assert.match(service, /"m8_classroom_rankings", \{ p_room_id: roomId, p_language: language \}/);
  assert.match(service, /"m8_independent_rankings", \{ p_period: period, p_language: language \}/);
  for (const path of ["src/pages/Leaderboard.tsx", "src/pages/IndependentLeaderboard.tsx"]) {
    const page = read(path);
    assert.match(page, /English and Filipino activities earn XP differently for now/);
    assert.match(page, /aria-label="Ranking language"/);
    assert.match(page, /is_me \?\? /);
    assert.doesNotMatch(page, /difficulty \|\| "Easy"/, "a missing level is not shown as Easy");
  }
  // Adviser feedback 2026-11-17: your own row shows your nickname ("Ana (You)"); other learners stay "Reader XXXXXX".
  assert.match(read("src/pages/IndependentLeaderboard.tsx"), /isYou\s*\? ownLeaderboardLabel\(entry\.display_name, profile\?\.nickname\)/, "your own row shows your own nickname");
});

// --- Function 4: leaderboards -------------------------------------------------------------------

test("leaderboards share ranks for equal XP on both the Student and Independent Learner pages", () => {
  const ranked = leaderboardRanking.rankByXp([{ xp: 80, rank: 0 }, { xp: 60, rank: 0 }, { xp: 60, rank: 0 }, { xp: 30, rank: 0 }]);
  assert.deepEqual(ranked.map((entry) => entry.rank), [1, 2, 2, 4]);
  const independent = read("src/pages/IndependentLeaderboard.tsx");
  assert.match(independent, /rankByXp\(rows\.map\(\(row\) => \(\{ \.\.\.row, xp: Number\(row\.xp\), rank: 0 \}\)\)\)/);
  assert.match(independent, /const rank = entry\.rank;/);
  assert.doesNotMatch(independent, /const rank = index \+ 1;/);
  assert.match(read("src/pages/Leaderboard.tsx"), /rankByXp/);
});

test("M8 final corrections: badge counter counts active badges and keeps past (retired) claims separate", async () => {
  const { badgeCounts, RETIRED_BADGE_NOTE } = await import("../src/modules/module8/achievements.ts");
  const badges = [
    { state: "claimed" as const, retired: false }, { state: "ready" as const, retired: false }, { state: "locked" as const, retired: false },
    { state: "locked" as const, retired: false }, { state: "locked" as const, retired: false }, { state: "claimed" as const, retired: true },
  ];
  assert.deepEqual(badgeCounts(badges), { claimed: 1, total: 5, past: 1 });
  assert.match(RETIRED_BADGE_NOTE, /no longer awarded/);
  const page = read("src/pages/MyBadges.tsx");
  assert.doesNotMatch(page, /\/ 8|badges\.length\}/, "the counter is not hard-coded and does not count retired badges");
  assert.match(read("src/modules/module8/achievements.ts"), /best streak/);
});

test("M8: badge requirements and progress are shown in every state (Locked, Claim, Claimed), not only while locked", () => {
  const page = read("src/pages/MyBadges.tsx");
  assert.match(page, /REQUIREMENT PROGRESS: shown in every state/);
  assert.doesNotMatch(page, /badge\.state === "locked" && stats && \(\(\) => \{/, "progress is no longer limited to locked badges");
  const guide = read("src/modules/module8/achievements.ts");
  for (const unit of ['"reading activity"', '"different activities"', '"verified readings"', '"reading days"', '"consecutive days (best streak)"']) assert.ok(guide.includes(unit), unit);
});
