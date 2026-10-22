import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath: string) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

const MOCK_LEARNER_CONTENT =
  /You \(Demo\)|Demo Student|Ana Reyes|Carlos Tan|Maria Santos|Pedro Bautista|Juan dela Cruz|Liza Gomez|1,420|1,180|1,050|\b840\b|\b610\b|\b520\b|\b380\b/;
const MOCK_BADGE_CONTENT =
  /4\/8 earned|First Read|3-Day Streak|Bookworm|Level Up|Perfect Score|Brave Reader|Diamond|Graduate/;

test("Student leaderboard keeps its route and renders an honest empty state", async () => {
  const [pageSource, sidebarSource] = await Promise.all([
    readSource("../src/pages/Leaderboard.tsx"),
    readSource("../src/components/basa/BasaSidebar.tsx"),
  ]);

  // M8 replaced the placeholder with database-backed rankings; it must still show an
  // honest empty state and never fall back to sample rankings.
  assert.match(pageSource, /getWeeklyLeaderboard\(\)/);
  assert.match(pageSource, /No leaderboard scores yet\./);
  assert.doesNotMatch(pageSource, /fullLeaderboard|classRanking/);
  assert.doesNotMatch(pageSource, MOCK_LEARNER_CONTENT);
  assert.match(sidebarSource, /to: "\/dashboard\/leaderboard"/);
});

test("Student badges keep their route and render an honest empty state", async () => {
  const [pageSource, sidebarSource] = await Promise.all([
    readSource("../src/pages/MyBadges.tsx"),
    readSource("../src/components/basa/BasaSidebar.tsx"),
  ]);

  // M8 replaced the placeholder with database-backed badges; it must still show an
  // honest empty state and never fall back to sample badges.
  assert.match(pageSource, /getMyGamification\(\)/);
  assert.match(pageSource, /No badges are available yet\./);
  assert.doesNotMatch(pageSource, /student\.badgesEarned|student\.badgesTotal/);
  assert.doesNotMatch(pageSource, MOCK_BADGE_CONTENT);
  assert.match(sidebarSource, /to: "\/dashboard\/badges"/);
});

test("learner headers no longer consume fake XP or mock identity", async () => {
  const [
    activityHeaderSource,
    readingResultSource,
    dashboardDataSource,
  ] = await Promise.all([
    readSource("../src/pages/reading-activity/ActivityHeader.tsx"),
    readSource("../src/pages/reading-activity/ReadingResultPage.tsx"),
    readSource("../src/data/dashboardData.ts"),
  ]);

  assert.doesNotMatch(activityHeaderSource, /dashboardData|student\.totalXp|activity-xp-pill/);
  assert.doesNotMatch(readingResultSource, /xpReward|\bXP\b|Collect \{/);
  assert.doesNotMatch(dashboardDataSource, /export const student|classRanking|fullLeaderboard|xpEarningRules|export const badges/);
  assert.doesNotMatch(dashboardDataSource, MOCK_LEARNER_CONTENT);
  assert.doesNotMatch(dashboardDataSource, MOCK_BADGE_CONTENT);
  assert.match(dashboardDataSource, /export type Difficulty/);
  assert.doesNotMatch(dashboardDataSource, /VALID_CLASS_CODES/);
});

test("Independent Learner keeps existing M3 navigation and gains only the real M8 pages", async () => {
  const [appSource, layoutSource, independentSource] = await Promise.all([
    readSource("../src/App.tsx"),
    readSource("../src/modules/module3/components/M3Layout.tsx"),
    readSource("../src/pages/IndependentLeaderboard.tsx"),
  ]);
  const generalRouteStart = appSource.search(
    /<Route\s+element=\{<RequireRole allowedRoles=\{\["general_user"\]\} \/>\}\s*>/,
  );

  assert.notEqual(generalRouteStart, -1);
  const generalRoutes = appSource.slice(generalRouteStart);
  assert.match(generalRoutes, /path="\/m3\/general"/);
  // The only learner pages added are M8's database-backed leaderboard and badges.
  assert.deepEqual(generalRoutes.match(/path="(leaderboard|badges)"/g), ['path="leaderboard"', 'path="badges"']);
  assert.match(generalRoutes, /path="leaderboard"\s+element=\{<IndependentLeaderboard \/>\}/);
  assert.match(generalRoutes, /path="badges"\s+element=\{<MyBadges \/>\}/);
  assert.match(independentSource, /"m8_independent_leaderboard"/);
  assert.doesNotMatch(independentSource, MOCK_LEARNER_CONTENT);
  assert.match(layoutSource, /useAuthenticatedProfile/);
  assert.match(layoutSource, /ROLE_LABELS\[profile\.role\]/);
  assert.doesNotMatch(layoutSource, MOCK_LEARNER_CONTENT);
});

test("real saved diagnostic placement remains on the Student dashboard", async () => {
  const [dashboardSource, recommendations, placementService, placementView] = await Promise.all([
    readSource("../src/pages/StudentDashboard.tsx"),
    readSource("../src/modules/module3/state/useLearnerRecommendations.ts"),
    readSource("../src/modules/module3/services/learnerPlacement.ts"),
    readSource("../src/modules/module3/components/LearnerReading.tsx"),
  ]);

  assert.match(dashboardSource, /useLearnerRecommendations\(\)/);
  for (const language of ["en", "fil"]) {
    assert.ok(dashboardSource.includes(`<PlacementSummary placement={placements.${language}} />`));
  }
  assert.match(recommendations, /getLearnerPlacement\(language\)/);
  assert.match(placementService, /diagnostics\.getInitialDiagnosticResult\(language\)/);
  assert.match(placementView, /placement\.readingLevel/);
  assert.match(placementView, /placement\.difficultyTier/);
  assert.match(dashboardSource, /useAuthenticatedProfile/);
});
