import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRequire } from "node:module";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";

const require = createRequire(import.meta.url);
async function mountLearnerPage(name: string, services: Record<string, unknown>, user: { id: string } | null = { id: "reader" }) {
  const runtime = createHookRuntime(require("react"));
  const page = loadComponentModule(new URL(`../src/pages/${name}.tsx`, import.meta.url), id => {
    if (id === "react") return runtime.react;
    if (id.endsWith("/gamificationService") || id.endsWith("/classroomService")) return services;
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
  assert.match(sidebarSource, /\/dashboard\/leaderboard/);
  for (const scenario of ["no-classroom", "no-rankings", "ranked", "signed-out", "error"]) {
    const calls: string[] = [];
    const { initial, tree } = await mountLearnerPage("Leaderboard", {
      getStudentClassrooms: async (id: string) => {
        assert.equal(id, "reader"); calls.push("rooms");
        return scenario === "no-classroom" ? [] : [{ id: "room", room_name: "Reading class", section: null }];
      },
      getWeeklyLeaderboard: async () => {
        calls.push("rankings");
        if (scenario === "error") throw new Error("Service unavailable");
        return scenario === "no-rankings" ? [] : [
          { user_id: "reader", display_name: "Saved reader", xp: 37, rank: 2, difficulty: "Easy" },
          { user_id: "outsider", display_name: "Outside classroom", xp: 99, rank: 1, difficulty: "Easy" },
        ];
      },
      getRoomEnrollments: async (id: string) => {
        assert.equal(id, "room"); calls.push("enrollments");
        return [{ student_id: "reader", display_name: "Enrolled reader" }];
      },
    }, scenario === "signed-out" ? null : { id: "reader" });
    const text = textOf(tree);
    assert.match(initial, /Loading classroom rankings/);
    assert.doesNotMatch(text, MOCK_LEARNER_CONTENT);
    if (scenario === "no-classroom") {
      assert.match(text, /haven't joined a classroom/);
      assert.ok(!calls.includes("enrollments"));
    } else if (scenario === "no-rankings") {
      assert.match(text, /No leaderboard scores yet/);
    } else if (scenario === "ranked") {
      assert.match(text, /Enrolled reader/);
      assert.match(text, /37/);
      assert.doesNotMatch(text, /Outside classroom|No leaderboard scores/);
      assert.equal(findAll(tree, node => node.type === "li").length, 1);
    } else {
      assert.equal(findAll(tree, node => node.props?.role === "alert").length, 1);
      assert.doesNotMatch(text, /No leaderboard scores yet/);
      if (scenario === "signed-out") assert.deepEqual(calls, []);
    }
  }
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
  for (const state of ["empty", "locked", "earned", "error"]) {
    let calls = 0;
    const { initial, tree } = await mountLearnerPage("MyBadges", {
      getMyGamification: async () => {
        calls++;
        if (state === "error") throw new Error("Please log in first.");
        return { progress: null, badges: state === "empty" ? [] : [{
          id: "badge", name: "Saved achievement", description: "Saved description", icon: "Star",
          earned: state === "earned", earned_at: state === "earned" ? "2026-10-01T00:00:00Z" : null,
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
      assert.doesNotMatch(text, /No badges are available yet|Unlocked/);
    } else {
      const cards = findAll(tree, node => node.type === "article");
      assert.equal(cards.length, 1);
      assert.match(textOf(cards[0]), /Saved achievement.*Saved description/);
      assert.match(textOf(cards[0]), state === "earned" ? /Unlocked/ : /Locked/);
      assert.doesNotMatch(textOf(cards[0]), state === "earned" ? /Locked/ : /Unlocked/);
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
