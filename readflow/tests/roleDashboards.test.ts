import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";

// Role dashboards: each role lands on a Dashboard built from existing, authorized sources.
// Page code runs in a separate VM context, so its arrays are spread into this realm before deepEqual.
const require = createRequire(import.meta.url);
const src = (path: string) => new URL(`../src/${path}`, import.meta.url);
const read = (path: string) => readFileSync(src(path), "utf8").replace(/\r\n/g, "\n");

type Stubs = Record<string, unknown>;
async function mount(page: string, stubs: Stubs, renders = 6) {
  const runtime = createHookRuntime(require("react"));
  const modules: Record<string, any> = {};
  const icon = () => null;
  const resolve = (id: string): unknown => {
    if (id === "react") return runtime.react;
    if (id === "react/jsx-runtime") return require(id);
    if (id === "react-router-dom") return { Link: "a" };
    if (id === "lucide-react") return new Proxy({}, { get: () => icon });
    if (id.endsWith(".css")) return {};
    for (const [suffix, stub] of Object.entries(stubs)) if (id.endsWith(suffix)) return stub;
    for (const local of ["./DashboardKit", "./LearnerSections", "./dashboard/DashboardKit", "./dashboard/LearnerSections"]) {
      if (id === local) {
        const file = `pages/dashboard/${local.split("/").pop()}.tsx`;
        modules[file] ??= loadComponentModule(src(file), resolve, { Error, console: { error() {} }, Intl });
        return modules[file];
      }
    }
    throw new Error(`Unexpected import ${id}`);
  };
  const mod = loadComponentModule(src(page), resolve, { Error, console: { error() {} }, Intl });
  const view = () => runtime.render(mod.default, {});
  for (let i = 0; i < renders; i++) { view(); await tick(); }
  const kit = modules["pages/dashboard/DashboardKit.tsx"];
  const stats = () => Object.fromEntries(findAll(view(), (n) => n.type === kit.StatCard).map((n) => [n.props.label, n.props.value]));
  const lists = () => findAll(view(), (n) => n.type === kit.LoadedList).map((n) => n.props);
  const element = (fn: unknown) => findAll(view(), (n) => n.type === fn);
  return { view, stats, lists, element, kit, modules, text: () => textOf(view()) };
}

const profile = (role: string, extra: Record<string, unknown> = {}) => ({ default: () => ({ profile: { id: `${role}-1`, role, nickname: "Ana", full_name: "Rosa Mendoza", ...extra }, loading: false }) });
const profileFields = { getProfileDisplayName: (p: { role: string; nickname?: string; full_name?: string }) => (p.role === "teacher" || p.role === "admin" ? p.full_name : p.nickname) ?? "" };
const fail = async () => { throw new Error("network down"); };

const users = [
  { id: "s1", role: "student", teacherStatus: null, fullName: "", createdAt: "2026-11-01" },
  { id: "s2", role: "student", teacherStatus: null, fullName: "", createdAt: "2026-11-02" },
  { id: "t1", role: "teacher", teacherStatus: "approved", fullName: "Rosa Mendoza", createdAt: "2026-10-01" },
  { id: "t2", role: "teacher", teacherStatus: "pending", fullName: "Jose Rizal", createdAt: "2026-11-03" },
  { id: "t3", role: "teacher", teacherStatus: "rejected", fullName: "No Thanks", createdAt: "2026-11-04" },
  { id: "g1", role: "general_user", teacherStatus: null, fullName: "", createdAt: "2026-11-05" },
  { id: "a1", role: "admin", teacherStatus: null, fullName: "Admin", createdAt: "2026-09-01" },
];
const modules = [{ status: "published" }, { status: "published" }, { status: "draft" }, { status: "archived" }];
const rooms = [{ id: "r1", archived_at: null }, { id: "r2", archived_at: null }, { id: "r3", archived_at: "2026-11-05" }];
const isRoomArchived = (r: { archived_at?: string | null }) => Boolean(r?.archived_at);

function adminStubs(overrides: Stubs = {}) {
  return {
    "/hooks/useAuthenticatedProfile": profile("admin", { full_name: "Admin Reyes" }),
    "/lib/supabaseClient": { supabase: { from: () => ({ select: async () => ({ data: rooms, error: null }) }) } },
    "/services/adminUsers": { getManagedUsers: async () => users },
    "/utils/profileFields": profileFields,
    "/context/M3ContentContext": { useM3Content: () => ({ modules, modulesLoading: false, modulesError: "" }) },
    "/services/classroomService": { isRoomArchived },
    ...overrides,
  };
}

test("Admin dashboard counts real accounts, published modules and active rooms", async () => {
  const page = await mount("pages/dashboard/AdminDashboard.tsx", adminStubs());
  assert.deepEqual(page.stats(), {
    Students: "2", "Approved Teachers": "1", "Independent Learners": "1", "Pending Teacher approvals": "1",
    "Published reading modules": "2", "Active Learning Rooms": "2",
  });
  const pending = page.lists()[0];
  assert.equal(pending.load.status, "ready");
  assert.deepEqual([...pending.load.data].map((u: { id: string }) => u.id), ["t2"], "only pending Teachers, not rejected or approved");
  assert.match(textOf(pending.render(pending.load.data[0])), /Jose Rizal/);
  assert.doesNotMatch(page.text(), /XP|badge|streak/i, "no Admin rewards");
});

test("Admin dashboard: a failed account request shows an error, never invented totals, and the other cards still load", async () => {
  const page = await mount("pages/dashboard/AdminDashboard.tsx", adminStubs({ "/services/adminUsers": { getManagedUsers: fail } }));
  const stats = page.stats();
  for (const label of ["Students", "Approved Teachers", "Independent Learners", "Pending Teacher approvals"]) assert.equal(stats[label], "—", label);
  assert.equal(stats["Published reading modules"], "2");
  assert.equal(stats["Active Learning Rooms"], "2");
  assert.match(page.text(), /Account totals could not be loaded/);
});

const student = (id: string, classification: string) => ({ id, full_name: "", nickname: `Kid ${id}`, classification, quizzes: [] });
function teacherStubs(overrides: Stubs = {}) {
  return {
    "/hooks/useAuthenticatedProfile": profile("teacher", { teacher_status: "approved" }),
    "/utils/profileFields": profileFields,
    "/services/classroomService": { getTeacherClassrooms: async (id: string) => (id === "teacher-1" ? rooms : []), isRoomArchived },
    "/services/oralReadingService": { getTeacherOralReadingAttempts: async () => [
      { id: "o1", learnerName: "Kid a", moduleTitle: "Old", completedAt: "2026-11-01T00:00:00Z", pronunciationAccuracy: 80 },
      { id: "o2", learnerName: "Kid b", moduleTitle: "New", completedAt: "2026-11-09T00:00:00Z", pronunciationAccuracy: 91.4 },
    ] },
    "/services/m7Service": { m7Request: async (path: string) => {
      assert.equal(path, "/teacher");
      return { students: [student("a", "On Track"), student("b", "Early Warning"), student("c", "At Risk"), student("d", "Needs Support"), student("e", "No assessment data")], notifications: [] };
    } },
    "/services/scoreDisplay": { formatScore: (v: number) => `${v}%` },
    "/services/studentSupportClassification": require("../src/modules/module7/services/studentSupportClassification.ts"),
    ...overrides,
  };
}

test("Teacher dashboard uses only the Teacher's rooms and M7's existing support classifications", async () => {
  const page = await mount("pages/dashboard/TeacherDashboard.tsx", teacherStubs());
  assert.deepEqual(page.stats(), { "Active Learning Rooms": "2", "Enrolled Students": "5", "Students needing support": "3", "Saved oral readings": "2" });
  const [support, readings] = page.lists();
  assert.deepEqual([...support.load.data].map((s: { id: string }) => s.id), ["b", "c", "d"], "Early Warning, At Risk and Needs Support only");
  assert.deepEqual([...readings.load.data].map((r: { id: string }) => r.id), ["o2", "o1"], "most recent first");
  assert.match(textOf(readings.render(readings.load.data[0])), /Kid b.*New.*91%/s);
});

test("Teacher dashboard: an analytics failure leaves rooms and readings usable", async () => {
  const page = await mount("pages/dashboard/TeacherDashboard.tsx", teacherStubs({ "/services/m7Service": { m7Request: fail } }));
  const stats = page.stats();
  assert.equal(stats["Enrolled Students"], "—");
  assert.equal(stats["Students needing support"], "—");
  assert.equal(stats["Active Learning Rooms"], "2");
  assert.equal(page.lists()[0].load.status, "error");
});

const personalData = {
  summary: {}, readings: [{ id: "rd-old", completed_at: "2026-11-01T00:00:00Z", pronunciation_accuracy: 70 }, { id: "rd-new", completed_at: "2026-11-08T00:00:00Z", pronunciation_accuracy: 88 }],
  quizzes: [{ id: "q1", title: "Story A", completedAt: "2026-11-02T00:00:00Z", score: 60 }, { id: "q2", title: "Story B", completedAt: "2026-11-07T00:00:00Z", score: 89 }],
  activities: [{ id: "x1", status: "Completed", roomId: "r1", title: "Done" }, { id: "x2", status: "Not Started", roomId: "r1", title: "Kite" },
    { id: "x3", status: "Comprehension In Progress", roomId: "r2", title: "River" }, { id: "x4", status: "Not Started", roomId: "r3", title: "Archived room story" }],
};
const gamification = { progress: { total_xp: 340, current_streak: 3 }, badges: [{ state: "claimed" }, { state: "ready" }, { state: "locked" }, { state: "claimed" }] };
function learnerStubs(role: string, overrides: Stubs = {}) {
  return {
    "/hooks/useAuthenticatedProfile": profile(role),
    "/utils/profileFields": profileFields,
    "/services/m7Service": { m7Request: async (path: string) => { assert.equal(path, "/personal"); return personalData; } },
    "/services/scoreDisplay": { formatScore: (v: number | null) => (v === null ? "Evaluation unavailable" : `${v}%`) },
    "/gamificationService": { getMyGamification: async () => gamification },
    "/services/comprehensionNavigation": require("../src/modules/module5/services/comprehensionNavigation.ts"),
    "/state/useLearnerRecommendations": { useLearnerRecommendations: () => ({ selectedLanguage: "en", setSelectedLanguage() {}, selectedPlacement: null, recommendedModules: [], placements: { en: null, fil: null } }) },
    "/components/LearnerReading": { PlacementSummary: "placement", ReadingLanguageSelector: "selector", RecommendedStories: "stories" },
    "/context/M3ContentContext": { useM3Content: () => ({ modules, modulesLoading: false, modulesError: "", materials: [{ id: "m1" }, { id: "m2" }], materialsLoading: false, materialsError: "" }) },
    "/services/classroomService": { getStudentClassrooms: async (id: string) => (id === "student-1" ? rooms : []), isRoomArchived },
    // Student personal archive (M4): not installed by default, so these tests see the original counts.
    "/services/studentRoomArchive": { getMyArchivedRooms: async () => ({ supported: false, roomIds: new Set<string>() }) },
    "/services/comprehensionService": { getComprehensionForReading: async (readingId: string) => (readingId === "rd-new" ? { id: "att-9", status: "in_progress" } : null) },
    ...overrides,
  };
}

async function rewards(page: Awaited<ReturnType<typeof mount>>) {
  const learner = page.modules["pages/dashboard/LearnerSections.tsx"];
  const cards = page.element(learner.RewardCards)[0];
  return Object.fromEntries(findAll(learner.RewardCards(cards.props), (n) => n.type === page.kit.StatCard).map((n) => [n.props.label, n.props.value]));
}

test("Student dashboard: My Learning Rooms counts active rooms only (not Teacher-archived, not personally archived)", async () => {
  const own = (roomIds: string[], supported = true) => ({ "/services/studentRoomArchive": { getMyArchivedRooms: async () => ({ supported, roomIds: new Set(roomIds) }) } });
  let stats = (await mount("pages/StudentDashboard.tsx", learnerStubs("student", own(["r1"])))).stats();
  assert.equal(stats["My Learning Rooms"], "1", "r1 archived by the Student, r3 by the Teacher: only r2 is active");
  assert.equal(stats["Assigned activities to do"], "2", "personal archiving hides the room from the list, never its assigned work");
  stats = (await mount("pages/StudentDashboard.tsx", learnerStubs("student", own(["r3"])))).stats();
  assert.equal(stats["My Learning Rooms"], "2", "a room archived by both counts once as archived");
  stats = (await mount("pages/StudentDashboard.tsx", learnerStubs("student", own(["r1", "r2"], false)))).stats();
  assert.equal(stats["My Learning Rooms"], "2", "before the migration (not installed) nothing is hidden");
  const failing = { "/services/studentRoomArchive": { getMyArchivedRooms: async () => { throw new Error("network down"); } } };
  stats = (await mount("pages/StudentDashboard.tsx", learnerStubs("student", failing))).stats();
  assert.equal(stats["My Learning Rooms"], "2", "a failed lookup hides nothing and does not break the dashboard");
});

test("Student dashboard: rooms, activities to do, M8 rewards and latest results come from existing sources", async () => {
  const page = await mount("pages/StudentDashboard.tsx", learnerStubs("student"));
  const stats = page.stats();
  assert.equal(stats["My Learning Rooms"], "2", "archived room excluded");
  assert.equal(stats["Assigned activities to do"], "2", "completed activity and the archived room's activity excluded");
  assert.deepEqual(await rewards(page), { "Total XP": "340", "Reading streak": "3 days", "Badges earned": "2" });
  const learner = page.modules["pages/dashboard/LearnerSections.tsx"];
  const recent = textOf(learner.RecentResults(page.element(learner.RecentResults)[0].props));
  assert.match(recent, /Oral reading.*88% accuracy/s, "latest reading");
  assert.match(recent, /Comprehension.*Story B.*89%/s, "latest counted assessment");
  assert.ok(page.element("placement").length === 2, "verified reading levels kept");
});

test("Student without a Learning Room sees a Join Learning Room empty state", async () => {
  const page = await mount("pages/StudentDashboard.tsx", learnerStubs("student", { "/services/classroomService": { getStudentClassrooms: async () => [], isRoomArchived } }));
  const empty = findAll(page.view(), (n) => n.type === page.kit.EmptyState && /not joined a Learning Room/.test(textOf(n)));
  assert.equal(empty.length, 1);
  assert.deepEqual([...empty[0].props.actions].map((a: { to: string }) => a.to), ["/dashboard/join-classroom"]);
});

test("Independent Learner dashboard needs no classroom and shows catalog, own uploads and eligible rewards", async () => {
  const page = await mount("pages/dashboard/IndependentLearnerDashboard.tsx", learnerStubs("general_user"));
  const stats = page.stats();
  assert.equal(stats["Reading modules available"], "2", "published only");
  assert.equal(stats["My reading materials"], "2");
  assert.deepEqual(await rewards(page), { "Total XP": "340", "Reading streak": "3 days", "Badges earned": "2" });
  assert.doesNotMatch(read("pages/dashboard/IndependentLearnerDashboard.tsx"), /getStudentClassrooms|join-classroom|Learning Room/);
});

test("learner dashboards keep working when results or rewards fail to load", async () => {
  const page = await mount("pages/dashboard/IndependentLearnerDashboard.tsx", learnerStubs("general_user", {
    "/services/m7Service": { m7Request: fail }, "/gamificationService": { getMyGamification: fail } }));
  assert.equal(page.stats()["My reading materials"], "2");
  assert.deepEqual(await rewards(page), { "Total XP": "—", "Reading streak": "—", "Badges earned": "—" });
  const learner = page.modules["pages/dashboard/LearnerSections.tsx"];
  assert.match(textOf(learner.RecentResults(page.element(learner.RecentResults)[0].props)), /could not be loaded/);
});

test("every role lands on its Dashboard, inside its existing role guard, with Dashboard first in the sidebar", () => {
  const app = read("App.tsx");
  for (const [root, component] of [["/m3/admin", "AdminDashboard"], ["/m3/teacher", "TeacherDashboard"], ["/m3/general", "IndependentLearnerDashboard"]]) {
    const block = app.slice(app.indexOf(`path="${root}"`), app.indexOf("</Route>", app.indexOf(`path="${root}"`)));
    assert.match(block, new RegExp(`<Route path="dashboard" element=\\{<${component} />\\} />`), `${root}/dashboard`);
  }
  assert.match(app, /<Route path="\/dashboard" element=\{<BasaLayout \/>\}>\s+<Route index element=\{<StudentDashboard \/>\} \/>/);
  const layout = read("modules/module3/components/M3Layout.tsx");
  assert.match(layout, /return \[\{ label: "Dashboard", to: getRoleHomePath\(role\), icon: House, end: true \}, \.\.\.getWorkspaceNavItems\(role\)\];/);
  assert.match(layout, /<Link className="m3-sidebar-home" to=\{getRoleHomePath\(role\)\}/);
  const sidebar = read("components/basa/BasaSidebar.tsx");
  assert.match(sidebar, /NAV_ITEMS = \[\s*\{ label: "Dashboard", to: "\/dashboard"/);
  assert.match(sidebar, /<Link className="basa-sidebar-brand" to="\/dashboard"/);
  for (const keep of ["Content Management", "Learning Rooms", "Reading Modules", "Reading Materials", "Reading Practice"]) assert.ok(layout.includes(`"${keep}"`), keep);
});

test("dashboards use theme tokens and existing patterns, not a new palette", () => {
  const css = read("pages/dashboard/dashboard.css");
  for (const token of ["var(--basa-bg)", "var(--basa-sidebar-item)", "var(--basa-btn-radius)", "var(--basa-yellow)", "#dce8e7", "#f7cf4a", "#173f3b"]) assert.ok(css.includes(token), token);
  assert.doesNotMatch(css, /gradient|prefers-color-scheme/);
  for (const page of ["pages/dashboard/AdminDashboard.tsx", "pages/dashboard/TeacherDashboard.tsx", "pages/dashboard/IndependentLearnerDashboard.tsx", "pages/StudentDashboard.tsx"]) {
    assert.doesNotMatch(read(page), /value="\d|value=\{"\d|value=\{\d/, `${page} has no hardcoded statistic`);
  }
});

const actionsOf = (page: Awaited<ReturnType<typeof mount>>) =>
  [...findAll(page.view(), (n) => n.type === page.kit.QuickActions)[0].props.actions].map((a: { label: string; to: string }) => [a.label, a.to]);

test("Student: activities in archived rooms are not to do, and a failed room lookup never shows an unfiltered count", async () => {
  const page = await mount("pages/StudentDashboard.tsx", learnerStubs("student", { "/services/classroomService": { getStudentClassrooms: fail, isRoomArchived } }));
  assert.equal(page.stats()["Assigned activities to do"], "—");
  assert.equal(page.stats()["My Learning Rooms"], "—");
});

test("Independent Learner Continue Comprehension opens the latest reading's unfinished activity only", async () => {
  const unfinished = await mount("pages/dashboard/IndependentLearnerDashboard.tsx", learnerStubs("general_user"));
  assert.deepEqual(actionsOf(unfinished).find(([label]) => label === "Continue Comprehension"), ["Continue Comprehension", "/m3/general/comprehension/att-9"]);
  assert.ok(!actionsOf(unfinished).some(([label, to]) => label === "Continue Comprehension" && to.includes("reading-history")));
  for (const linked of [{ id: "att-9", status: "completed" }, null]) {
    const page = await mount("pages/dashboard/IndependentLearnerDashboard.tsx", learnerStubs("general_user", {
      "/services/comprehensionService": { getComprehensionForReading: async () => linked } }));
    assert.ok(!actionsOf(page).some(([label]) => label === "Continue Comprehension"), `hidden when the activity is ${linked?.status ?? "absent"}`);
  }
  const failed = await mount("pages/dashboard/IndependentLearnerDashboard.tsx", learnerStubs("general_user", { "/services/comprehensionService": { getComprehensionForReading: fail } }));
  assert.ok(!actionsOf(failed).some(([label]) => label === "Continue Comprehension"), "hidden when the lookup fails");
  assert.deepEqual(actionsOf(failed).map(([label]) => label), ["Start Reading", "Upload Reading Material", "View Reading History", "View Progress and Results"]);
});
