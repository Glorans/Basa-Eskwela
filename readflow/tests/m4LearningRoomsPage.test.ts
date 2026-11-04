import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/modules/module4/pages/LearningRoomsPage.tsx", import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
function find(tree: any, predicate: (node: any) => boolean): any {
  if (!tree || typeof tree !== "object") return;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) {
    const result = find(child, predicate);
    if (result) return result;
  }
}
async function fixture(rooms: any[] = [], fail = false) {
  const slots: any[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const calls: any[] = [];
  const react = { ...require("react"),
    useState(initial: any) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], (v: any) => { slots[i] = typeof v === "function" ? v(slots[i]) : v; }];
    },
    useEffect(callback: () => void) {
      const i = cursor++;
      if (!slots[i]) { slots[i] = true; effects.push(callback); }
    },
  };
  const module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, {
    module, exports: module.exports, console: { error() {} },
    require: (id: string) => id === "react" ? react : id === "react-router-dom" ? { Link: "a" }
      : id.includes("supabaseClient") ? { supabase: { auth: { getUser: async () => ({ data: { user: { id: "teacher" } }, error: null }) } } }
      : id.includes("classroomService") ? {
        getTeacherClassrooms: async () => rooms,
        isRoomArchived: (room: any) => Boolean(room?.archived_at),
        createClassroom: async (input: any) => {
          calls.push(input);
          if (fail) throw new Error("Failed");
          return { id: "new-room", room_name: input.roomName, room_code: "ABC123" };
        },
      } : require(id),
  });
  function render() {
    cursor = 0;
    const tree = module.exports.default();
    const pending = effects; effects = []; pending.forEach(fn => fn());
    return tree;
  }
  const button = (label: string) => find(render(), n => n.type === "button" && n.props.children === label);
  const field = (id: string) => find(render(), n => n.props?.id === id);
  render(); await tick();
  return { render, button, field, calls,
    submit: () => find(render(), n => n.type === "form").props.onSubmit({ preventDefault() {} }),
  };
}

for (const rooms of [[], [{ id: "old", room_name: "Existing class", room_code: "OLD123" }]]) {
  test(`create and cancel replace then restore the ${rooms.length ? "populated" : "empty"} list without saving`, async () => {
    const f = await fixture(rooms);
    f.button("+ Create Learning Room").props.onClick();
    const tree = f.render();
    assert.equal(find(tree, n => n.type === "h1").props.children, "Create Learning Room");
    assert.doesNotMatch(JSON.stringify(tree), /Your Learning Rooms|No learning rooms yet|Existing class|\+ Create Learning Room/);
    f.field("roomName").props.onChange({ target: { value: "Unsaved" } });
    f.button("Cancel").props.onClick();
    assert.equal(find(f.render(), n => n.type === "form"), undefined);
    assert.match(JSON.stringify(f.render()), rooms.length ? /Existing class/ : /No learning rooms yet/);
    assert.deepEqual(f.calls, []);
    f.button("+ Create Learning Room").props.onClick();
    assert.equal(f.field("roomName").props.value, "");
  });
}

test("successful creation restores the updated list and prevents cancel during submission", async () => {
  const f = await fixture();
  f.button("+ Create Learning Room").props.onClick();
  f.field("roomName").props.onChange({ target: { value: "New class" } });
  f.field("subject").props.onChange({ target: { value: "en" } });
  const pending = f.submit();
  assert.equal(f.button("Cancel").props.disabled, true);
  await pending;
  assert.equal(find(f.render(), n => n.type === "form"), undefined);
  assert.match(JSON.stringify(f.render()), /Your Learning Rooms[\s\S]*New class/);
  assert.equal(f.calls.length, 1);
});

test("validation and failed creation retain the form and entered fields", async () => {
  const f = await fixture([], true);
  f.button("+ Create Learning Room").props.onClick();
  assert.equal(f.field("roomName").props.required, true);
  await f.submit();
  assert.match(JSON.stringify(f.render()), /Room name is required/);
  assert.equal(f.calls.length, 0);
  for (const [id, value] of [["roomName", "My class"], ["section", "Section A"], ["description", "Reading"], ["subject", "fil"]]) {
    f.field(id).props.onChange({ target: { value } });
  }
  await f.submit();
  assert.match(JSON.stringify(f.render()), /Unable to create learning room/);
  assert.equal(f.field("roomName").props.value, "My class");
  assert.equal(f.field("section").props.value, "Section A");
  assert.equal(f.field("description").props.value, "Reading");
  assert.doesNotMatch(JSON.stringify(f.render()), /Your Learning Rooms|No learning rooms yet/);
});

for (const subject of ["en", "fil"]) {
  test(`room creation requires and saves the ${subject} subject`, async () => {
    const f = await fixture();
    f.button("+ Create Learning Room").props.onClick();
    f.field("roomName").props.onChange({ target: { value: "New class" } });
    assert.equal(f.field("subject").props.required, true);
    await f.submit();
    assert.equal(f.calls.length, 0);
    assert.match(JSON.stringify(f.render()), /Please select English or Filipino/);
    f.field("subject").props.onChange({ target: { value: subject } });
    await f.submit();
    assert.equal(f.calls[0].subject, subject);
    f.button("+ Create Learning Room").props.onClick();
    assert.equal(f.field("subject").props.value, "");
  });
}

test("create form wording matches its validation: only room name and subject are required", async () => {
  const f = await fixture();
  f.button("+ Create Learning Room").props.onClick();
  const text = JSON.stringify(f.render());
  assert.equal(f.field("roomName").props.placeholder, "e.g., Grade 5 Reading Group A");
  assert.equal(f.field("section").props.placeholder, "e.g., Rizal");
  assert.equal(f.field("description").props.placeholder, "e.g., Reading activities for Grade 5 students");
  assert.match(text, /Section \(optional\)/);
  assert.match(text, /Description \(optional\)/);
  assert.equal(f.field("roomName").props.required, true);
  assert.equal(f.field("section").props.required, undefined);
  assert.equal(f.field("description").props.required, undefined);
  const subject = f.field("subject");
  assert.equal(subject.props.required, true);
  assert.equal(subject.props["aria-describedby"], "subjectHelp");
  assert.deepEqual([subject.props.children].flat().map((o: any) => [o.props.value, o.props.children]),
    [["", "Choose a subject"], ["en", "English"], ["fil", "Filipino"]]);
  assert.equal(f.field("subjectHelp").props.children, "Only reading materials matching this subject can be assigned to the room.");
});
