// Student personal Learning Room archive and the desktop sidebar toggle. Real page and service code with
// stubbed Supabase and services; no network. Database rules: supabase/tests/m4StudentRoomArchive.test.cjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";

const require = createRequire(import.meta.url);
const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const room = (id: string, room_name: string, archived_at: string | null = null) =>
  ({ id, room_name, section: null, room_code: `${id.toUpperCase()}123`, archived_at });
const A = room("a", "Grade 5 - Sampaguita");
const B = room("b", "Grade 5 - Narra");
const OLD = room("old", "Grade 4 - Kamonggay", "2026-11-08T00:00:00Z");
const isRoomArchived = (r: { archived_at?: string | null } | null) => Boolean(r?.archived_at);
const auth = { supabase: { auth: { getUser: async () => ({ data: { user: { id: "me" } }, error: null }) } } };

async function mount(path: string, stubs: (id: string) => unknown, renders = 5) {
  const runtime = createHookRuntime(require("react"));
  const page = loadComponentModule(new URL(`../src/${path}`, import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id === "react/jsx-runtime") return require(id);
    const stub = stubs(id);
    if (stub !== undefined) return stub;
    if (id.endsWith(".css")) return {};
    throw new Error(`Unexpected import ${id}`);
  }, { Error, Set, console: { error() {} } });
  const view = () => runtime.render(page.default, {});
  const settle = async () => { for (let i = 0; i < renders; i++) { view(); await tick(); } };
  await settle();
  return { view, settle, text: () => textOf(view()) };
}
const buttons = (tree: unknown, label: RegExp) => findAll(tree, (node) => node.type === "button" && label.test(textOf(node)));

function archiveService(initial: string[], supported = true) {
  const roomIds = new Set(initial);
  const calls: [string, boolean][] = [];
  return {
    calls,
    module: {
      getMyArchivedRooms: async () => ({ supported, roomIds: new Set(roomIds) }),
      setMyRoomArchived: async (roomId: string, archive: boolean) => {
        calls.push([roomId, archive]);
        if (archive) roomIds.add(roomId); else roomIds.delete(roomId);
        return true;
      },
    },
  };
}

function learningRoomsStubs(archive: ReturnType<typeof archiveService>, navigations: string[], confirms: boolean[] = []) {
  return (id: string) => id === "react-router-dom" ? { useNavigate: () => (to: string) => navigations.push(to) }
    : id.includes("supabaseClient") ? auth
    : id.includes("classroomService") ? { getStudentClassrooms: async () => [A, B, OLD], isRoomArchived, joinClassroomByCode: async () => ({}) }
    : id.includes("studentRoomTeachers") ? { getStudentRoomTeacherNames: async () => ({ a: "Rosa Mendoza", b: "Jose Rizal", old: "Rosa Mendoza" }) }
    : id.includes("studentRoomArchive") ? archive.module
    : id.includes("RoomActionsMenu") ? { default: "room-actions-menu" }
    : id.includes("ReadFlowDialog") ? { confirmReadFlow: async () => confirms.shift() ?? true }
    : undefined;
}

test("Learning Rooms hides the Student's personally archived rooms and offers Archive on each active card", async () => {
  const navigations: string[] = [];
  const archive = archiveService(["b"]);
  const page = await mount("modules/module4/pages/JoinClassroomPage.tsx", learningRoomsStubs(archive, navigations));
  const text = page.text();
  assert.match(text, /Grade 5 - Sampaguita/);
  assert.doesNotMatch(text, /Grade 5 - Narra/, "the personally archived room is not in the active list");
  assert.doesNotMatch(text, /Kamonggay/, "the Teacher-archived room is not in the active list either");
  assert.match(text, /You archived 1 learning room\./);
  assert.doesNotMatch(text, /archived by your teacher/, "no Teacher-archive notice on this page");
  const menus = findAll(page.view(), (node) => node.type === "room-actions-menu");
  assert.deepEqual(menus.map((m) => m.props.label), ["Actions for Grade 5 - Sampaguita"]);
  assert.equal(menus[0].props.archived, false);
  buttons(page.view(), /View Archived Rooms/)[0].props.onClick();
  assert.deepEqual(navigations, ["/dashboard/archived-learning-rooms"]);
});

test("Archive asks first; Cancel changes nothing; Confirm archives that room for this Student only", async () => {
  const archive = archiveService([]);
  const page = await mount("modules/module4/pages/JoinClassroomPage.tsx", learningRoomsStubs(archive, [], [false, true]));
  const menu = () => findAll(page.view(), (node) => node.type === "room-actions-menu" && /Sampaguita/.test(node.props.label))[0];
  menu().props.onToggleArchive();
  await page.settle();
  assert.deepEqual(archive.calls, [], "cancelled: no request");
  assert.match(page.text(), /Grade 5 - Sampaguita/);
  menu().props.onToggleArchive();
  await page.settle();
  assert.deepEqual(archive.calls, [["a", true]]);
  assert.doesNotMatch(page.text().split("My Learning Rooms")[1] ?? "", /View ClassroomGrade 5 - Sampaguita|Sampaguita.*Teacher:/);
  assert.match(page.text(), /"Grade 5 - Sampaguita" was moved to Archived Rooms\./);
});

test("before the migration is installed the page is unchanged: no menu, nothing hidden", async () => {
  const archive = archiveService(["b"], false);
  const page = await mount("modules/module4/pages/JoinClassroomPage.tsx", learningRoomsStubs(archive, []));
  assert.match(page.text(), /Grade 5 - Narra/);
  assert.equal(findAll(page.view(), (node) => node.type === "room-actions-menu").length, 0);
  assert.doesNotMatch(page.text(), /You archived/);
});

test("Archived Rooms separates rooms archived by the Student and by the Teacher; only the Student's can be restored", async () => {
  const navigations: string[] = [];
  const archive = archiveService(["b", "old"]);
  const stubs = (id: string) => id === "react-router-dom" ? { useNavigate: () => (to: string) => navigations.push(to) }
    : id.includes("supabaseClient") ? auth
    : id.includes("classroomService") ? { getStudentClassrooms: async () => [A, B, OLD], isRoomArchived }
    : id.includes("studentRoomTeachers") ? { getStudentRoomTeacherNames: async () => ({ a: "Rosa Mendoza", b: "Jose Rizal", old: "Rosa Mendoza" }) }
    : id.includes("studentRoomArchive") ? archive.module
    : id.includes("ReadFlowDialog") ? { confirmReadFlow: async () => true }
    : undefined;
  const page = await mount("modules/module4/pages/StudentArchivedRoomsPage.tsx", stubs);
  const text = page.text();
  const [mine, teacher] = text.split("Archived by your teacherYour teacher archived");
  assert.match(mine, /Grade 5 - Narra/);
  assert.doesNotMatch(mine, /Sampaguita|Kamonggay/, "active and Teacher-archived rooms are not under 'Archived by you'");
  assert.match(teacher, /Grade 4 - Kamonggay/);
  assert.match(teacher, /You also archived this room for yourself\./);
  const restore = buttons(page.view(), /^Restore$/);
  assert.equal(restore.length, 1, "Restore only for the Student's own archive");
  assert.equal(restore[0].props["aria-label"], "Restore Grade 5 - Narra");
  assert.equal(buttons(page.view(), /Open read-only/).length, 1);
  restore[0].props.onClick();
  await page.settle();
  assert.deepEqual(archive.calls, [["b", false]]);
  assert.match(page.text(), /"Grade 5 - Narra" was restored and is back in your Learning Rooms\./);
  buttons(page.view(), /Open read-only/)[0].props.onClick();
  assert.deepEqual(navigations, ["/dashboard/learning-rooms/old"]);
});

test("the service reads only through RLS, maps errors, and reports 'not installed' without failing", async () => {
  const calls: unknown[] = [];
  let tableError: { code: string } | null = null;
  let rpcError: { code: string } | null = null;
  const service = loadComponentModule(new URL("../src/modules/module4/services/studentRoomArchive.ts", import.meta.url), (id) => {
    if (id.includes("supabaseClient")) return { supabase: {
      from: (table: string) => ({ select: async (columns: string) => { calls.push(["from", table, columns]); return tableError ? { data: null, error: tableError } : { data: [{ room_id: "b" }], error: null }; } }),
      rpc: async (fn: string, args: unknown) => { calls.push(["rpc", fn, args]); return rpcError ? { data: null, error: rpcError } : { data: true, error: null }; },
    } };
    throw new Error(`Unexpected import ${id}`);
  }, { Set, Error, console: { error() {} } });
  assert.deepEqual([...(await service.getMyArchivedRooms()).roomIds], ["b"]);
  assert.deepEqual(calls[0], ["from", "m4_student_room_archives", "room_id"], "no student_id filter needed: RLS returns own rows only");
  tableError = { code: "PGRST205" };
  const missing = await service.getMyArchivedRooms();
  assert.equal(missing.supported, false);
  assert.equal(missing.roomIds.size, 0);
  tableError = { code: "42501" };
  await assert.rejects(service.getMyArchivedRooms());
  assert.equal(await service.setMyRoomArchived("b", true), true);
  assert.equal(JSON.stringify(calls.at(-1)), JSON.stringify(["rpc", "m4_set_my_room_archived", { p_room_id: "b", p_archive: true }]));
  for (const [code, message] of [["55000", /teacher archived this Learning Room/], ["42501", /only Learning Rooms you have joined/], ["PGRST202", /isn't available yet/], ["XX000", /Nothing was changed/]] as const) {
    rpcError = { code };
    await assert.rejects(service.setMyRoomArchived("b", false), message);
  }
});

test("Student sidebar order: Archived Rooms follows Reading History; Settings lives in the account menu; the route is unchanged", () => {
  const sidebar = read("components/basa/BasaSidebar.tsx");
  const labels = [...sidebar.slice(sidebar.indexOf("NAV_ITEMS"), sidebar.indexOf("];")).matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(labels, ["Dashboard", "Learning Rooms", "Reading Materials", "Leaderboard", "Badges", "Progress & Result",
    "Assessment History", "My Reassessments", "Reading History", "Archived Rooms"]);
  assert.match(sidebar, /\{ label: "Archived Rooms", to: "\/dashboard\/archived-learning-rooms", icon: Archive \},/);
  assert.doesNotMatch(sidebar, /Archived Learning Rooms/);
  assert.match(read("App.tsx"), /path="archived-learning-rooms"\s+element=\{<StudentArchivedRoomsPage \/>\}/);
  assert.match(read("modules/module4/pages/StudentArchivedRoomsPage.tsx"), />Archived Rooms<\/h1>/);
  // Teacher navigation keeps its own label and place.
  assert.match(read("modules/module3/components/M3Layout.tsx"), /label: "Archived Classrooms", to: "\/m3\/teacher\/archived-classrooms"/);
});

test("desktop sidebar toggle: one per layout, inside the yellow sidebar; the header button stays for phones and tablets", () => {
  for (const [path, controls] of [["components/basa/BasaSidebar.tsx", "basa-navigation"], ["modules/module3/components/M3Layout.tsx", "m3-navigation"]] as const) {
    const source = read(path);
    assert.equal(source.match(/className="rf-rail-toggle"/g)?.length, 1, path);
    const toggle = source.slice(source.indexOf('className="rf-rail-toggle"') - 200, source.indexOf('className="rf-rail-toggle"') + 400);
    assert.match(toggle, new RegExp(`aria-controls="${controls}"`));
    assert.match(toggle, /aria-expanded=\{(controller|sidebar)\.expanded\}/);
    assert.match(toggle, /aria-label=\{(controller|sidebar)\.toggleLabel\}/);
    assert.match(toggle, /onClick=\{(controller|sidebar)\.toggle\}/);
    const aside = source.slice(source.indexOf("<aside"), source.indexOf("</aside>"));
    assert.ok(aside.includes('className="rf-rail-toggle"'), `${path}: the toggle is inside the sidebar`);
  }
  // The header buttons remain (mobile drawer and focus return), wired as before.
  assert.match(read("components/basa/BasaLayout.tsx"), /onMenuClick=\{sidebar.toggle\}/);
  assert.match(read("modules/module3/components/M3Layout.tsx"), /className="m3-menu-button"[\s\S]{0,300}ref=\{sidebar.triggerRef\}/);
  const css = read("styles/responsive-shell.css");
  const desktop = css.slice(css.indexOf("@media (min-width: 1000px)"), css.indexOf("@media (max-width: 999px)"));
  assert.match(css.slice(0, css.indexOf("@media")), /\.rf-shell \.rf-rail-toggle \{ display: none; \}/, "hidden outside desktop");
  assert.match(desktop, /\.rf-shell :is\(\.basa-menu-button,\.m3-menu-button\) \{ display: none; \}/, "header button hidden on desktop");
  assert.match(desktop, /\.rf-shell \.rf-rail-toggle \{\s*display: inline-flex;/);
  assert.match(desktop, /\.rf-shell--collapsed :is\(\.basa-sidebar-head,\.m3-sidebar-brand\) \{ flex-direction: column;/, "collapsed rail keeps the toggle");
  assert.doesNotMatch(css.slice(css.indexOf("@media (max-width: 999px)")), /rf-rail-toggle/, "mobile rules unchanged");
});

test("RoomActionsMenu keeps its original label for Teachers unless a label is given", () => {
  const source = read("modules/module4/components/RoomActionsMenu.tsx");
  assert.match(source, /label = "Learning Room actions"/);
  assert.match(source, /aria-label=\{label\}/);
  assert.doesNotMatch(read("modules/module4/pages/ClassroomDetailsPage.tsx"), /<RoomActionsMenu[^>]*label=/);
});
