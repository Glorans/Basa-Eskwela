// M4 archived classrooms: Teacher sidebar and pages, Student read-only access. Real page code with stubbed
// services; no network. The server and database enforcement is tested in server/tests/m4ArchivedRoom*.test.js.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";
import { filterTeacherOralReadingAttempts } from "../src/modules/module5/services/teacherOralReadingFilters.ts";

const require = createRequire(import.meta.url);
const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const ACTIVE = { id: "active", room_name: "Grade 5 - Sampaguita", section: null, room_code: "ACT123", archived_at: null };
const ARCHIVED = { id: "old", room_name: "Grade 5", section: "Kamonggay", room_code: "OLD123", archived_at: "2026-11-08T00:00:00Z" };
const isRoomArchived = (room: { archived_at?: string | null } | null) => Boolean(room?.archived_at);

async function mount(path: string, stubs: (id: string) => unknown, renders = 4) {
  const runtime = createHookRuntime(require("react"));
  const page = loadComponentModule(new URL(`../src/${path}`, import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id === "react/jsx-runtime") return require(id);
    const stub = stubs(id);
    if (stub !== undefined) return stub;
    if (id.endsWith(".css")) return {};
    throw new Error(`Unexpected import ${id}`);
  }, { Error, console: { error() {} }, document: { getElementById: () => null } });
  const view = () => runtime.render(page.default, {});
  for (let i = 0; i < renders; i++) { view(); await tick(); }
  return { view, text: () => textOf(view()) };
}
const buttons = (tree: unknown, label: RegExp) => findAll(tree, (node) => node.type === "button" && label.test(textOf(node)));
const auth = { supabase: { auth: { getUser: async () => ({ data: { user: { id: "me" } }, error: null }) } } };

test("Teacher sidebar: Archived Classrooms sits directly below Reports and above Profile Settings", () => {
  const layout = read("modules/module3/components/M3Layout.tsx");
  const teacher = layout.slice(layout.indexOf('if (role === "teacher")'), layout.indexOf('if (role === "general_user")'));
  assert.ok(teacher.indexOf('"Reports"') < teacher.indexOf('"Archived Classrooms"'), "below Reports");
  assert.match(teacher, /label: "Reports".*\r?\n\s*items\.push\(\{ label: "Archived Classrooms", to: "\/m3\/teacher\/archived-classrooms", icon: Archive/);
  const afterTeacher = layout.slice(layout.indexOf('if (role === "general_user")'));
  assert.match(afterTeacher, /label: "Profile Settings"/, "Profile Settings is added after the teacher items");
  assert.match(read("App.tsx"), /path="archived-classrooms"\s+element=\{<ArchivedClassroomsPage \/>\}/);
});

test("Teacher Learning Rooms lists active rooms only without an archived classroom notice", async () => {
  const page = await mount("modules/module4/pages/LearningRoomsPage.tsx", (id) => id.includes("supabaseClient") ? auth
    : id.endsWith("/components/RoomCard") ? { default: "room-card" }
    : id.endsWith("/components/LearningRoomForm") ? { default: "learning-room-form" }
    : id.includes("classroomService") ? { getTeacherClassrooms: async () => [ACTIVE, ARCHIVED], isRoomArchived, createClassroom: async () => ({}) }
    : undefined);
  const cards = findAll(page.view(), (node) => node.type === "room-card");
  assert.deepEqual(cards.map((card) => card.props.room.id), ["active"]);
  assert.doesNotMatch(page.text(), /archived classrooms? (?:is|are) kept in/);
  assert.equal(findAll(page.view(), (node) => node.props.to === "/m3/teacher/archived-classrooms").length, 0);
});

test("Archived Classrooms shows only archived rooms; Restore returns one to Learning Rooms with feedback", async () => {
  const restored: [string, boolean][] = [];
  let fail = false;
  const page = await mount("modules/module4/pages/ArchivedClassroomsPage.tsx", (id) => id === "react-router-dom" ? { Link: "a" }
    : id.includes("supabaseClient") ? auth
    : id.includes("ReadFlowDialog") ? { confirmReadFlow: async () => true }
    : id.endsWith("/components/RoomCard") ? { default: "room-card" }
    : id.includes("classroomService") ? {
      getTeacherClassrooms: async () => [ACTIVE, ARCHIVED], isRoomArchived,
      setClassroomArchived: async (roomId: string, archive: boolean) => { if (fail) throw new Error("Only the room's Teacher can restore it."); restored.push([roomId, archive]); return true; },
    } : undefined);
  let cards = findAll(page.view(), (node) => node.type === "room-card");
  assert.deepEqual(cards.map((card) => card.props.room.id), ["old"], "only the archived room");
  assert.deepEqual(findAll(page.view(), (node) => node.type === "h1").map(textOf), ["Archived Classrooms"]);
  assert.doesNotMatch(page.text(), /Archived classrooms are read-only|Open one to review its students|Nothing was deleted|Restore a classroom to use it again/);
  fail = true;
  await buttons(page.view(), /Restore Classroom/)[0].props.onClick(); await tick();
  assert.match(page.text(), /Only the room's Teacher can restore it/, "a failure is explained");
  assert.equal(findAll(page.view(), (node) => node.type === "room-card").length, 1, "still listed");
  fail = false;
  await buttons(page.view(), /Restore Classroom/)[0].props.onClick(); await tick();
  assert.deepEqual(restored, [["old", false]]);
  cards = findAll(page.view(), (node) => node.type === "room-card");
  assert.equal(cards.length, 0, "removed from the archive without a reload");
  assert.match(page.text(), /restored and is back in Learning Rooms/);
});

test("Archived classroom details are read-only for the Teacher, except Restore, and link to its results", () => {
  const details = read("modules/module4/pages/ClassroomDetailsPage.tsx");
  assert.match(details, /\{removalSupported && !archived && \(/, "no module Remove/Restore");
  // (Admin mode, M4 Admin management, adds its own conditions; the archived condition is unchanged.)
  assert.match(details, /\{activityRemovalSupported && canChangeActivities && !isRoomArchived\(classroom\) && \(/, "no activity Remove/Restore");
  assert.match(details, /onRemoveStudent=\{isRoomArchived\(classroom\) \|\| !canRemoveStudents \? undefined : handleRemoveStudent\}/, "no student removal");
  assert.match(details, /\{legacySubject && !classroom\.subject && !isRoomArchived\(classroom\) && \(/);
  assert.match(details, /disabled=\{assigningModule \|\| \(archived && !showModuleForm\)\}/, "Assign Module stays disabled (existing)");
  assert.match(details, /\/m3\/teacher\/oral-reading\?roomId=\$\{encodeURIComponent\(classroom\.id\)\}/);
  assert.match(details, /"← Back to Archived Classrooms"/);
  const menu = read("modules/module4/components/RoomActionsMenu.tsx");
  assert.match(menu, /\{!archived && onEdit && <button[^>]*role="menuitem"[\s\S]*?Edit Learning Room/, "Edit is hidden; Restore remains");
  assert.match(menu, /archived \? "Restore Learning Room" : "Archive Learning Room"/);
});

test("Teacher results can be limited to one classroom", () => {
  const attempt = (id: string, roomId: string | null) => ({ id, roomId, learnerId: "l", learnerName: "Ana", moduleId: "m", moduleTitle: "Story",
    comprehension: { status: "completed" } }) as never;
  const all = [attempt("a", "old"), attempt("b", "active"), attempt("c", null)];
  assert.deepEqual(filterTeacherOralReadingAttempts(all, { searchQuery: "", learnerId: "", moduleId: "", roomId: "old" }).map((a: { id: string }) => a.id), ["a"]);
  assert.equal(filterTeacherOralReadingAttempts(all, { searchQuery: "", learnerId: "", moduleId: "" }).length, 3, "no room filter: all results");
});

test("Student Learning Rooms lists active rooms only and points to Archived Readings", async () => {
  const navigations: string[] = [];
  const page = await mount("modules/module4/pages/JoinClassroomPage.tsx", (id) => id === "react-router-dom" ? { useNavigate: () => (to: string) => navigations.push(to) }
    : id.includes("supabaseClient") ? auth
    : id.includes("classroomService") ? { getStudentClassrooms: async () => [ACTIVE, ARCHIVED], isRoomArchived, joinClassroomByCode: async () => ({}) }
    : undefined);
  const text = page.text();
  assert.match(text, /Grade 5 - Sampaguita/);
  assert.doesNotMatch(text, /Kamonggay|OLD123/, "the archived room is not an active Learning Room");
  assert.match(text, /1 classroom was archived by your teacher/);
  buttons(page.view(), /Archived Readings/)[0].props.onClick();
  assert.deepEqual(navigations, ["/dashboard/reading-history#archived-readings"]);
});

test("Reading History: Archived Readings lists archived classrooms and opens them read-only", async () => {
  const navigations: string[] = [];
  const stubs = (rooms: unknown[]) => (id: string) => id === "react-router-dom" ? { useNavigate: () => (to: string) => navigations.push(to), useLocation: () => ({ hash: "" }) }
    : id.includes("supabaseClient") ? auth
    : id.includes("classroomService") ? { getStudentClassrooms: async () => rooms, isRoomArchived } : undefined;
  const page = await mount("modules/module4/components/ArchivedReadingsSection.tsx", stubs([ACTIVE, ARCHIVED]));
  assert.match(page.text(), /Archived Readings/);
  assert.match(page.text(), /Grade 5 - Kamonggay \(Archived\)/);
  assert.doesNotMatch(page.text(), /Sampaguita/);
  buttons(page.view(), /Open read-only/)[0].props.onClick();
  assert.deepEqual(navigations, ["/dashboard/learning-rooms/old"]);
  const none = await mount("modules/module4/components/ArchivedReadingsSection.tsx", stubs([ACTIVE]));
  assert.equal(none.view(), null, "nothing shown without an archived classroom");
  assert.match(read("App.tsx"), /path="reading-history"\s+element=\{<><ReadingHistoryPage role="student" \/><ArchivedReadingsSection \/><\/>\}/);
});

test("Student archived classroom: read the story, see saved results, never start a new reading or answer", async () => {
  const navigations: { to: string; state?: unknown }[] = [];
  let storyRequests = 0;
  const progress = [
    { activityAssignmentId: "new", materialId: "m1", roomId: "old", status: "Not Started", oralReadingAttemptId: null, comprehensionAttemptId: null },
    { activityAssignmentId: "pending", materialId: "m2", roomId: "old", status: "Comprehension In Progress", oralReadingAttemptId: "oral-2", comprehensionAttemptId: "quiz-2" },
    { activityAssignmentId: "done", materialId: "m3", roomId: "old", status: "Completed", oralReadingAttemptId: "oral-3", comprehensionAttemptId: "quiz-3" },
  ];
  const activity = (id: string, material: string) => ({ assignment_id: id, material_id: material, title: `Story ${id}`, assigned_at: "2026-11-01", status: "assigned", has_questions: true, language: "en" });
  const page = await mount("modules/module4/pages/StudentClassroomPage.tsx", (id) => id === "react-router-dom"
    ? { useNavigate: () => (to: string, options?: { state?: unknown }) => navigations.push({ to, state: options?.state }), useParams: () => ({ roomId: "old" }) }
    : id.endsWith("/activityLanguage") ? { activityLanguageState: () => ({}), getActivityText: () => ({ language: "en", t: (s: string) => s }) }
    : id.endsWith("/assignedReadingNavigation") ? { assignedReadingTarget: (a: { comprehensionAttemptId?: string }) => `/dashboard/comprehension/${a.comprehensionAttemptId}` }
    : id.endsWith("/oralReadingService") ? {
      getAssignedReadingProgress: async () => progress,
      getOralReadingModule: async () => { storyRequests++; return { passage: "The river runs past the village." }; },
    }
    : id.includes("classroomService") ? {
      getClassroomById: async () => ARCHIVED, isRoomArchived, formatDueDateTime: () => "",
      getAssignedModules: async () => [{ assignment_id: "rm", module_id: "mod", title: "Module", assigned_at: "2026-11-01" }],
      getStudentReadingActivities: async () => [activity("new", "m1"), activity("pending", "m2"), activity("done", "m3")],
    } : undefined, 6);
  const text = page.text();
  assert.match(text, /You can still read its stories and see your saved results/);
  assert.doesNotMatch(text, /Open Reading Activity/, "no entry into a new reading");
  assert.equal(buttons(page.view(), /^Read Story$/).length, 1);
  assert.equal(buttons(page.view(), /^View Saved Results$/).length, 2);

  await buttons(page.view(), /^Read Story$/)[0].props.onClick(); await tick();
  assert.equal(storyRequests, 1);
  assert.match(page.text(), /Read-only · archived classroom.*The river runs past the village\./);
  assert.equal(navigations.length, 0, "the story opens in place; no recorder");

  await buttons(page.view(), /^View Saved Results$/)[0].props.onClick(); await tick();
  assert.equal(navigations[0].to, "/dashboard/read-aloud/results/oral-2", "an unfinished assessment opens its saved reading, not the questions");
  await buttons(page.view(), /^View Saved Results$/)[1].props.onClick(); await tick();
  assert.equal(navigations[1].to, "/dashboard/comprehension/quiz-3", "a completed assessment opens its saved result");

  buttons(page.view(), /Read Module/)[0].props.onClick();
  assert.match(navigations[2].to, /archived=1/);
  assert.equal((navigations[2].state as { archivedRoom?: boolean }).archivedRoom, true);
});

test("an archived room's module opens for silent reading without the recorder", () => {
  const view = read("pages/StudentModuleViewPage.tsx");
  assert.match(view, /archivedRoom \? \(\s*<p className="basa-reading-module-actions" role="note">/);
  assert.match(view, /query\.get\("archived"\) === "1"/);
  const startLink = view.indexOf("Start Read-Aloud");
  assert.ok(startLink > view.indexOf(") : (", view.indexOf("archivedRoom ?")), "Start Read-Aloud only in the non-archived branch");
});

test("direct read-aloud URL of an archived classroom: read-only story, no recorder (server flag)", () => {
  const page = read("pages/reading-activity/ReadAloudPage.tsx");
  const archivedBranch = page.indexOf("{module.roomArchived === true ? <div className=\"read-aloud-archived\" role=\"note\">");
  assert.ok(archivedBranch > 0, "archived branch rendered first");
  const recordButton = page.indexOf('className={`read-aloud-record-button');
  const elseBranch = page.indexOf("</div> : continueTarget ? <>", archivedBranch);
  assert.ok(elseBranch > archivedBranch && recordButton > elseBranch, "the record button (microphone, speech-to-text) exists only outside the archived branch");
  assert.match(page, /This classroom is archived\. You can read the story, but new recordings and answers cannot be submitted\./);
  assert.match(page, /storyTokens\.map\(/, "the story text is still shown");
  assert.match(read("modules/module5/types/oralReading.ts"), /roomArchived\?: boolean;/);
});

test("an unfinished assessment of an archived classroom opens read-only (server flag)", () => {
  const page = read("modules/module6/pages/ComprehensionPage.tsx");
  assert.match(page, /const archivedOpen = \(attempt\?\.roomArchived === true \|\| attempt\?\.materialDeleted === true\) && attempt\.status !== "completed";/);
  assert.match(page, /const question = archivedOpen \? undefined : attempt\?\.questions\[index\];/, "no question, so no answer buttons");
  assert.match(page, /This classroom is archived\. Your saved answers are kept, but new answers cannot be submitted\./);
});
