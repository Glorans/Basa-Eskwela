import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRequire } from "node:module";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";
import { rankByXp } from "../src/modules/module8/leaderboardRanking.ts";
import * as achievements from "../src/modules/module8/achievements.ts";

const require = createRequire(import.meta.url);
async function mountLearnerPage(name: string, services: Record<string, unknown>, user: { id: string } | null = { id: "reader" }) {
  const runtime = createHookRuntime(require("react"));
  const page = loadComponentModule(new URL(`../src/pages/${name}.tsx`, import.meta.url), id => {
    if (id === "react") return runtime.react;
    if (id.endsWith("/gamificationService") || id.endsWith("/classroomService")) return services;
    // Real M8 display helpers (badge explanations); they read nothing and award nothing.
    if (id.endsWith("/module8/achievements")) return achievements;
    if (id.endsWith("/supabaseClient")) return { supabase: { auth: { getUser: async () => ({ data: { user }, error: null }) } } };
    if (id.endsWith(".css")) return {};
    return require(id);
  }, { Error, console: { error() {} } });
  const view = () => runtime.render(page.default, {});
  const initial = textOf(view());
  // Flush initial loading and the dependent classroom-enrollment effect.
  for (let i = 0; i < 3; i++) { await tick(); view(); }
  return { initial, tree: view() };
}


async function readSource(relativePath: string) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

const MOCK_LEARNER_CONTENT =
  /You \(Demo\)|Demo Student|Ana Reyes|Carlos Tan|Maria Santos|Pedro Bautista|Juan dela Cruz|Liza Gomez|1,420|1,180|1,050|\b840\b|\b610\b|\b520\b|\b380\b/;
const MOCK_BADGE_CONTENT =
  /4\/8 earned|First Read|3-Day Streak|Bookworm|Level Up|Perfect Score|Brave Reader|Diamond|Graduate/;

test("Student leaderboard uses saved rankings and distinguishes empty classrooms and rankings", async () => {
  const pageSource = await readSource("../src/pages/Leaderboard.tsx");
  const sidebarSource = await readSource("../src/components/basa/BasaSidebar.tsx");
  // M8 replaced the placeholder with database-backed rankings; it must still show an
  // honest empty state and never fall back to sample rankings.
  assert.match(pageSource, /getWeeklyLeaderboard\(\)/);
  assert.match(pageSource, /No leaderboard scores yet\./);
  assert.doesNotMatch(pageSource, /fullLeaderboard|classRanking/);
  assert.doesNotMatch(pageSource, MOCK_LEARNER_CONTENT);
  // Students cannot read classmates' enrollments under RLS, so the page must not filter
  // the classmate-scoped RPC through getRoomEnrollments (that hid every classmate).
  assert.doesNotMatch(pageSource, /getRoomEnrollments/);
  assert.match(sidebarSource, /\/dashboard\/leaderboard/);
  const you = { user_id: "reader", display_name: "You", xp: 37, rank: 0, difficulty: "Easy" };
  const classmate = { user_id: "classmate", display_name: "Reader 1A2B3C", xp: 99, rank: 0, difficulty: "Medium" };
  const otherRoommate = { user_id: "other", display_name: "Reader 9F8E7D", xp: 55, rank: 0, difficulty: "Easy" };
  for (const scenario of ["no-classroom", "no-rankings", "ranked", "two-rooms", "tie", "fallback-two-rooms", "signed-out", "error"]) {
    const calls: string[] = [];
    const { initial, tree } = await mountLearnerPage("Leaderboard", {
      rankByXp,
      getStudentClassrooms: async (id: string) => {
        assert.equal(id, "reader"); calls.push("rooms");
        if (scenario === "no-classroom") return [];
        const rooms = [{ id: "room", room_name: "Reading class", section: null }];
        return scenario.includes("two-rooms") ? [...rooms, { id: "room-2", room_name: "Filipino class", section: null }] : rooms;
      },
      // m8_classroom_leaderboard: only the caller ("You") and classmates of THIS room (pseudonyms).
      getClassroomRankings: async () => null, // per-language rankings not deployed in these scenarios
      getClassroomLeaderboard: async (roomId: string) => {
        calls.push(`room:${roomId}`);
        if (scenario === "error") throw new Error("Service unavailable");
        if (scenario === "fallback-two-rooms") return null; // function not deployed yet
        if (scenario === "no-rankings") return [];
        if (scenario === "tie") return rankByXp([you, { ...classmate, xp: 37 }, { ...otherRoommate, xp: 12 }]);
        return rankByXp(roomId === "room" ? [you, classmate] : [you, otherRoommate]);
      },
      // m8_weekly_leaderboard: classmates from every joined room, combined.
      getWeeklyLeaderboard: async () => {
        calls.push("weekly");
        return [you, classmate, otherRoommate];
      },
    }, scenario === "signed-out" ? null : { id: "reader" });
    const text = textOf(tree);
    const rows = findAll(tree, node => node.type === "li").map(textOf);
    assert.match(initial, /Loading classroom rankings/);
    assert.doesNotMatch(text, MOCK_LEARNER_CONTENT);
    if (scenario === "no-classroom") {
      assert.match(text, /haven't joined a classroom/);
      assert.deepEqual(calls, ["rooms"]);
    } else if (scenario === "no-rankings") {
      assert.match(text, /No leaderboard scores yet/);
    } else if (scenario === "ranked" || scenario === "two-rooms") {
      // Only the selected room's classmates; no other room is mixed in.
      assert.deepEqual(calls, ["rooms", "room:room"]);
      assert.equal(rows.length, 2);
      assert.match(rows[0], /^1.*Reader 1A2B3C.*99/);
      assert.match(rows[1], /^2.*You.*37/);
      assert.doesNotMatch(text, /Reader 9F8E7D|classmates from all/);
      assert.match(text, /XP this week/);
      assert.match(text, /Showing rankings for.*Reading class/);
      const select = findAll(tree, node => node.type === "select")[0];
      assert.equal(select.props.disabled, false, "students in several rooms can switch rooms");
    } else if (scenario === "tie") {
      assert.deepEqual(rows.map(row => row.match(/^\d+/)?.[0]), ["1", "1", "3"]);
    } else if (scenario === "fallback-two-rooms") {
      assert.deepEqual(calls, ["rooms", "room:room", "weekly"]);
      assert.equal(rows.length, 3);
      assert.match(text, /classmates from all 2 classrooms/);
      assert.equal(findAll(tree, node => node.type === "select")[0].props.disabled, true);
    } else {
      assert.equal(findAll(tree, node => node.props?.role === "alert").length, 1);
      assert.doesNotMatch(text, /No leaderboard scores yet/);
      if (scenario === "signed-out") assert.deepEqual(calls, []);
    }
  }
});

test("equal weekly XP shares a rank without changing XP values", () => {
  const ranked = rankByXp([
    { id: "a", xp: 30, rank: 0 }, { id: "b", xp: 80, rank: 0 }, { id: "c", xp: 30, rank: 0 }, { id: "d", xp: 0, rank: 0 },
  ]);
  assert.deepEqual(ranked.map(entry => [entry.id, entry.xp, entry.rank]), [["b", 80, 1], ["a", 30, 2], ["c", 30, 2], ["d", 0, 4]]);
  assert.deepEqual(rankByXp([]), []);
});

test("Student badges distinguish empty catalogs, locked badges and earned badges", async () => {
  const pageSource = await readSource("../src/pages/MyBadges.tsx");
  const sidebarSource = await readSource("../src/components/basa/BasaSidebar.tsx");
  // M8 replaced the placeholder with database-backed badges; it must still show an
  // honest empty state and never fall back to sample badges.
  assert.match(pageSource, /getMyGamification\(\)/);
  assert.match(pageSource, /No badges are available yet\./);
  assert.doesNotMatch(pageSource, /student\.badgesEarned|student\.badgesTotal/);
  assert.doesNotMatch(pageSource, MOCK_BADGE_CONTENT);
  assert.match(sidebarSource, /\/dashboard\/badges/);
  // "earned": before claiming is deployed. "ready" and "claimed": with claiming (m8_my_badges).
  for (const state of ["empty", "locked", "earned", "ready", "claimed", "error"]) {
    let calls = 0;
    const { initial, tree } = await mountLearnerPage("MyBadges", {
      getMyAchievements: async () => null,
      getMyAchievementClaims: async () => [],
      getMyGamification: async () => {
        calls++;
        if (state === "error") throw new Error("Please log in first.");
        const badgeState = state === "earned" ? "claimed" : state;
        return { progress: null, claiming: state === "ready" || state === "claimed", badges: state === "empty" ? [] : [{
          id: "badge", name: "Saved achievement", description: "Saved description", icon: "Star",
          state: badgeState, claimed_at: badgeState === "claimed" ? "2026-10-01T00:00:00Z" : null,
        }] };
      },
    });
    assert.equal(calls, 1);
    assert.match(initial, /Loading/i);
    const text = textOf(tree);
    assert.doesNotMatch(text, MOCK_BADGE_CONTENT);
    if (state === "empty") {
      assert.match(text, /No badges are available yet/);
      assert.equal(findAll(tree, node => node.type === "article").length, 0);
    } else if (state === "error") {
      assert.match(text, /Please log in first/);
      assert.doesNotMatch(text, /No badges are available yet|Earned:|Claimed/);
    } else {
      const cards = findAll(tree, node => node.type === "article");
      assert.equal(cards.length, 1);
      assert.match(textOf(cards[0]), /Saved achievement.*Saved description/);
      const card = textOf(cards[0]);
      const expected = { locked: /Locked/, earned: /Earned.*Earned: Oct 1, 2026/, ready: /Claim$/, claimed: /Claimed.*Claimed: Oct 1, 2026/ }[state];
      assert.match(card, expected as RegExp, state);
      if (state !== "locked") assert.doesNotMatch(card, /Locked/, state);
      if (state !== "ready") assert.equal(findAll(cards[0], node => node.type === "button").length, 0, `${state}: no Claim button`);
      else assert.equal(findAll(cards[0], node => node.type === "button").length, 1, "one Claim button");
    }
  }
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

test("Independent Learner leaderboard and badges remain within authenticated role-protected routes", async () => {
  // Inspect the actual JSX route tree instead of matching source formatting.
  const app = loadComponentModule(new URL("../src/App.tsx", import.meta.url), id => {
    if (id === "react/jsx-runtime") return require(id);
    if (id === "react-router-dom") return { Routes: "Routes", Route: "Route", Navigate: "Navigate", Outlet: "Outlet" };
    const name = id.split("/").at(-1)!;
    return new Proxy({ __esModule: true, default: name } as Record<string, unknown>, {
      get(target, key: string) { return key in target ? target[key] : key; },
    });
  });
  const tree = app.default();
  const found: string[] = [];
  function visit(node: any, ancestors: any[] = []) {
    if (Array.isArray(node)) { node.forEach(child => visit(child, ancestors)); return; }
    if (!node || typeof node !== "object") return;
    const next = node.type === "Route" ? [...ancestors, node] : ancestors;
    if (["leaderboard", "badges"].includes(node.props?.path) && ancestors.some(a => a.props?.path === "/m3/general")) {
      const guard = ancestors.find(a => a.props?.element?.type === "RequireRole");
      assert.deepEqual(Array.from(guard?.props.element.props.allowedRoles ?? []), ["general_user"]);
      assert.equal(node.props.element.type, node.props.path === "leaderboard" ? "IndependentLeaderboard" : "MyBadges");
      found.push(node.props.path);
    }
    visit(node.props?.children, next);
  }
  visit(tree);
  assert.deepEqual(found.sort(), ["badges", "leaderboard"]);
  // RequireRole delegates authentication and role rejection to the real guard.
  for (const role of [null, "general_user", "student", "teacher", "admin"]) {
    const guard = loadComponentModule(new URL("../src/components/auth/RequireAuth.tsx", import.meta.url), id => {
      if (id === "react-router-dom") return { Navigate: "Navigate", Outlet: "Outlet", useLocation: () => ({ pathname: "/m3/general/leaderboard" }) };
      if (id.endsWith("/useAuth")) return { useAuth: () => ({
        loading: false, profileError: null, user: role ? { id: "reader" } : null,
        profile: role ? { role, nickname: "Reader", full_name: "Reader", teacher_status: "approved" } : null,
      }) };
      if (id.endsWith("/authOnboarding")) return loadComponentModule(new URL("../src/modules/module1/utils/authOnboarding.ts", import.meta.url), createRequire(new URL("../src/modules/module1/utils/authOnboarding.ts", import.meta.url)));
      if (id.endsWith(".css")) return {};
      return require(id);
    });
    const wrapped = guard.RequireRole({ allowedRoles: ["general_user"] });
    const result = wrapped.type(wrapped.props);
    assert.equal(result.type, role === "general_user" ? "Outlet" : "Navigate");
    if (!role) assert.equal(result.props.to, "/login");
  }
  const layoutSource = await readSource("../src/modules/module3/components/M3Layout.tsx");
  assert.match(layoutSource, /\/m3\/general\/leaderboard/);
  assert.match(layoutSource, /\/m3\/general\/badges/);
  const independentSource = await readSource("../src/pages/IndependentLeaderboard.tsx");
  assert.match(independentSource, /"m8_independent_leaderboard"/);
  assert.doesNotMatch(independentSource, MOCK_LEARNER_CONTENT);
  assert.match(await readSource("../src/components/basa/ProfileDropdown.tsx"), /useAuthenticatedProfile/);
  assert.match(await readSource("../src/components/basa/ProfileDropdown.tsx"), /ROLE_LABELS\[profile\.role\]/);
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
