import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";

// M4 adviser feedback: each Student Learning Room card shows the assigned Teacher's full name.
const require = createRequire(import.meta.url);
const pageUrl = new URL("../src/modules/module4/pages/JoinClassroomPage.tsx", import.meta.url);
const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const room = (id: string, name: string, code: string) => ({ id, room_name: name, section: null, room_code: code, archived_at: null, teacher_id: `t-${id}` });
const ROOMS = [room("a", "Grade 5 - Sampaguita", "AAA111"), room("b", "Grade 5 - Rosal", "BBB222"), room("c", "Grade 5 - Ilang-Ilang", "CCC333")];

async function mount(names: () => Promise<Record<string, string | null>>, rooms = ROOMS, { settle = true } = {}) {
  const runtime = createHookRuntime(require("react"));
  let nameCalls = 0;
  const joined: string[] = [];
  const page = loadComponentModule(pageUrl, (id) => {
    if (id === "react") return runtime.react;
    if (id === "react/jsx-runtime") return require(id);
    if (id === "react-router-dom") return { useNavigate: () => () => {} };
    if (id.includes("supabaseClient")) return { supabase: { auth: { getUser: async () => ({ data: { user: { id: "me" } }, error: null }) } } };
    if (id.includes("classroomService")) return {
      getStudentClassrooms: async () => [...rooms], isRoomArchived: (r: { archived_at?: string | null }) => Boolean(r?.archived_at),
      joinClassroomByCode: async (_: string, code: string) => { joined.push(code); },
    };
    if (id.includes("studentRoomTeachers")) return { getStudentRoomTeacherNames: () => { nameCalls++; return names(); } };
    // Student personal archive (proposed migration): not installed here, so these tests see the original page.
    if (id.includes("studentRoomArchive")) return { getMyArchivedRooms: async () => ({ supported: false, roomIds: new Set() }), setMyRoomArchived: async () => true };
    if (id.includes("RoomActionsMenu")) return { default: "room-actions-menu" };
    if (id.includes("ReadFlowDialog")) return { confirmReadFlow: async () => true };
    if (id.endsWith(".css")) return {};
    throw new Error(`Unexpected import ${id}`);
  }, { Error, console: { error() {} }, document: { getElementById: () => null } });
  const view = () => runtime.render(page.default, {});
  for (let i = 0; i < (settle ? 5 : 2); i++) { view(); await tick(); }
  const cards = () => findAll(view(), (n) => n.type === "article").map((card) => textOf(card));
  return { view, cards, text: () => textOf(view()), calls: () => nameCalls, joined };
}

test("each card shows its own assigned Teacher, including Admin-created rooms and long names", async () => {
  const LONG = "Maria Clara Concepcion de los Santos-Villanueva y Bautista Dela Cruz";
  const page = await mount(async () => ({ a: "Rosa Mendoza", b: LONG, c: "Jose Rizal" }));
  const [a, b, c] = page.cards();
  assert.match(a, /Grade 5 - Sampaguita.*Teacher: Rosa Mendoza.*AAA111/s);
  assert.match(b, /Grade 5 - Rosal.*Teacher: Maria Clara Concepcion de los Santos-Villanueva y Bautista Dela Cruz.*BBB222/s);
  assert.match(c, /Grade 5 - Ilang-Ilang.*Teacher: Jose Rizal.*CCC333/s);
  assert.doesNotMatch(a, /Jose Rizal|Maria Clara/, "no other room's Teacher on this card");
  assert.equal(page.calls(), 1);
});

test("missing or incomplete names show a neutral fallback, never an invented name", async () => {
  const page = await mount(async () => ({ a: "Rosa Mendoza", b: null }));
  const [a, b, c] = page.cards();
  assert.match(a, /Teacher: Rosa Mendoza/);
  assert.match(b, /Teacher name unavailable/);
  assert.match(c, /Teacher name unavailable/, "a room absent from the response");
  assert.doesNotMatch(b + c, /Teacher: /);
});

test("a failed name lookup keeps the rooms usable and shows the fallback, not an error", async () => {
  const page = await mount(async () => { throw new Error("network down"); });
  assert.equal(page.cards().length, 3);
  assert.ok(page.cards().every((card) => /Teacher name unavailable/.test(card)));
  assert.doesNotMatch(page.text(), /Unable to load your learning rooms/);
  assert.ok(page.cards().every((card) => /View Classroom/.test(card)), "View Classroom unchanged");
});

test("while names load the card says so; with no rooms no lookup is made", async () => {
  const pending = await mount(() => new Promise(() => {}), ROOMS, { settle: false });
  assert.ok(pending.cards().every((card) => /Teacher: Loading\.\.\./.test(card)));
  const empty = await mount(async () => ({}), []);
  assert.equal(empty.calls(), 0);
  assert.doesNotMatch(empty.text(), /Teacher/);
});

test("joining a room reloads the names so the new card shows its Teacher", async () => {
  let rooms = ROOMS.slice(0, 1);
  let names: Record<string, string | null> = { a: "Rosa Mendoza" };
  const page = await mount(async () => names, rooms);
  rooms.push(room("d", "Grade 5 - Waling-Waling", "DDD444"));
  names = { a: "Rosa Mendoza", d: "Andres Bonifacio" };
  const input = findAll(page.view(), (n) => n.props?.id === "roomCode")[0];
  input.props.onChange({ target: { value: "ddd444" } });
  page.view();
  const form = findAll(page.view(), (n) => n.type === "form")[0];
  await form.props.onSubmit({ preventDefault() {} });
  for (let i = 0; i < 4; i++) { page.view(); await tick(); }
  assert.equal(page.calls(), 2, "names requested again after joining");
  assert.match(page.cards().find((card) => /Waling-Waling/.test(card)) ?? "", /Teacher: Andres Bonifacio/);
});

test("placement, wrapping and data source", () => {
  const source = read("modules/module4/pages/JoinClassroomPage.tsx");
  const card = source.slice(source.indexOf("{room.room_name}"), source.indexOf("{room.room_code}"));
  assert.ok(card.indexOf("Teacher") < card.indexOf("Room Code"), "Teacher line sits between the room name and the room code");
  assert.match(card, /className="mt-1 min-w-0 text-sm font-semibold text-\[#2f5c57\] \[overflow-wrap:anywhere\]"/, "long names, even without spaces, wrap inside the card");
  const service = read("modules/module4/services/studentRoomTeachers.ts");
  assert.match(service, /api\.get<[^>]+>\("\/api\/classrooms\/teachers", \{ headers \}\)/);
  assert.match(service, /getSessionAuthHeaders\(/);
  const code = (service + card).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /email|teacher_id|created_by/i, "no e-mail, ids or creator in the card or the service (comments excluded)");
  assert.doesNotMatch(read("modules/module4/services/classroomService.ts"), /\/api\/classrooms\/teachers/, "the shared classroom service is unchanged");
});
