import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";

// M2 F3/F5 class view (Teacher and School Admin) with a synthetic roster of 35 Students, in memory only.
const require = createRequire(import.meta.url);
const LEVELS = ["Frustration", "Instructional", "Independent"] as const;
const point = (id: string, type: string, level: string, date: string, title: string | null = null) => ({
  id, assessmentType: type, title, version: type === "initial" ? "3.0" : "1.0", completedAt: `${date}T02:00:00.000Z`,
  readingLevel: level, wordRecognitionScore: 90, comprehensionScore: 66.7,
});
const lang = (language: "en" | "fil", initial: ReturnType<typeof point> | null, reassessments: ReturnType<typeof point>[] = []) => ({
  language, current: initial ? { readingLevel: initial.readingLevel, source: "initial", completedAt: initial.completedAt, rule: "initial" } : null,
  initial, reassessments, change: { status: "none", message: "" },
  placementNote: reassessments.length ? "Reassessment scores are shown as history. Reading placement still uses the initial diagnostic until a reassessment-based rule is approved." : null,
});
const ROOM_A = { id: "room-a", name: "Sampaguita" }, ROOM_B = { id: "room-b", name: "Narra" };
const ROSTER = Array.from({ length: 35 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  const en = i % 7 === 6 ? null : point(`en-${n}`, "initial", LEVELS[i % 3], `2026-10-${String((i % 28) + 1).padStart(2, "0")}`);
  const fil = i % 5 === 4 ? null : point(`fil-${n}`, "initial", LEVELS[(i + 1) % 3], "2026-10-15");
  const re = i === 0 ? [point("re-01", "reassessment", "Independent", "2026-11-18", "The Lost Kite")] : [];
  return { id: `s${n}`, name: `Student ${n}`, rooms: i < 30 ? [ROOM_A] : i < 34 ? [ROOM_B] : [], progress: { en: lang("en", en, re), fil: lang("fil", fil) } };
});

async function mount(props: Record<string, unknown> = {}) {
  const runtime = createHookRuntime(require("react"));
  const mod = loadComponentModule(new URL("../src/modules/module2/components/ClassReadingResults.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    return require(id);
  });
  let loads = 0;
  const allProps = { load: async () => { loads += 1; return ROSTER; }, idPrefix: "t", ...props };
  const render = () => runtime.render(mod.default, allProps);
  render(); for (let i = 0; i < 4; i++) { await tick(); render(); }
  // The runtime renders one level; expand the history child when it is shown.
  const tree = () => { const t = render(); return t?.type?.name === "StudentHistory" ? t.type(t.props) : t; };
  const field = (label: string) => findAll(tree(), (n) => n.type === "label" && textOf(n).startsWith(label))[0];
  const set = async (label: string, value: string) => { findAll(field(label), (n) => n.type === "select" || n.type === "input")[0].props.onChange({ target: { value } }); await tick(); };
  const button = (label: RegExp) => findAll(tree(), (n) => n.type === "button").find((b) => label.test(textOf(b)) || label.test(b.props["aria-label"] ?? ""));
  const click = async (label: RegExp) => { button(label)!.props.onClick(); await tick(); };
  const rows = () => findAll(findAll(tree(), (n) => n.type === "tbody")[0] ?? { props: {} }, (n) => n.type === "tr");
  return { tree, set, click, button, rows, field, loads: () => loads };
}

test("default: the whole class at once (25 per page), filters at the TOP, English and Filipino levels, latest date, View History", async () => {
  const v = await mount();
  const t = v.tree();
  const order = findAll(t, (n) => n.props?.className === "crr-filters" || n.type === "table").map((n) => n.type === "table" ? "table" : "filters");
  assert.deepEqual(order, ["filters", "table"], "filters come before the table");
  assert.match(textOf(t), /35 of 35 Students/);
  assert.equal(v.rows().length, 25);
  assert.deepEqual(findAll(findAll(t, (n) => n.type === "thead")[0], (n) => n.type === "th").map((h) => textOf(h).replace(/[▲▼]/g, "").trim()),
    ["Student", "Learning Room", "English", "Filipino", "Latest Assessment", "History"]);
  assert.match(textOf(v.rows()[0]), /Student 01SampaguitaFrustrationLatest reassessment: IndependentInstructional/);
  await v.click(/^Next$/);
  assert.equal(v.rows().length, 10);
  assert.match(textOf(v.tree()), /Page 2 of 2/);
  assert.equal(findAll(v.tree(), (n) => n.type === "option" && n.props.value === "none").length, 1, "Reading Level offers No Result");
  assert.equal(findAll(v.tree(), (n) => n.type === "option" && textOf(n) === "Not in a Learning Room").length, 0, "Teachers: only their rooms");
});

test("search, Learning Room, language and reading level work together; Clear Filters resets them", async () => {
  const v = await mount({ showNoRoom: true });
  await v.set("Learning Room", "room-b");
  assert.match(textOf(v.tree()), /4 of 35 Students · Narra/);
  await v.set("Learning Room", "");
  await v.set("Search Student", "student 1");
  assert.match(textOf(v.tree()), /10 of 35 Students/);
  await v.set("Language", "fil");
  await v.set("Reading Level", "Independent");
  const names = v.rows().map((r) => textOf(findAll(r, (n) => n.type === "td")[0]));
  assert.ok(names.length > 0 && names.every((n) => /^Student 1/.test(n)));
  for (const r of v.rows()) assert.match(textOf(findAll(r, (n) => n.type === "td")[3]), /^Independent/, "Filipino level matches");
  await v.set("Reading Level", "none");
  await v.set("Search Student", "");
  assert.match(textOf(v.tree()), /7 of 35 Students/, "Filipino 'No Result' Students");
  await v.set("Learning Room", "none");
  assert.match(textOf(v.tree()), /0 of 35 Students|1 of 35 Students/);
  await v.click(/^Clear Filters$/);
  assert.match(textOf(v.tree()), /35 of 35 Students/);
});

test("sorting by Latest Assessment; View History is newest first per language; Back keeps the room, search and page", async () => {
  const v = await mount();
  await v.click(/^Latest Assessment/);
  await v.click(/^Latest Assessment/);
  assert.match(textOf(v.rows()[0]), /^Student 01/, "most recent assessment first (the reassessment)");
  await v.set("Search Student", "student 0");
  await v.click(/^View history for Student 01$/);
  const history = textOf(v.tree());
  assert.match(history, /Back to Student List/);
  assert.match(history, /English.*Current reading level: Frustration \(from the initial diagnostic\).*placement still uses the initial diagnostic/s);
  assert.match(history, /Reassessment: The Lost Kite.*Independent.*Higher \(from Frustration\).*Initial Diagnostic.*Frustration/s, "newest first, change from the previous result");
  assert.match(history, /Filipino/);
  await v.click(/Back to Student List/);
  assert.match(textOf(v.tree()), /9 of 35 Students/, "search kept after Back");
  assert.equal(v.field("Search Student") && findAll(v.field("Search Student"), (n) => n.type === "input")[0].props.value, "student 0");
});

test("All Results: one row per official assessment, filterable by assessment type and date; every row has View History", async () => {
  const v = await mount();
  await v.click(/^All Results$/);
  assert.match(textOf(v.tree()), /59 official results/);
  await v.set("Assessment", "reassessment");
  assert.equal(v.rows().length, 1);
  assert.match(textOf(v.rows()[0]), /Student 01Reassessment: The Lost KiteEnglish90%66\.7%Independent/);
  await v.set("Assessment", "");
  await v.set("From", "2026-11-01");
  assert.equal(v.rows().length, 1, "date range");
  await v.set("From", "");
  await v.set("Language", "fil");
  assert.match(textOf(v.tree()), /28 official results/);
  assert.equal(findAll(v.tree(), (n) => n.type === "button" && /^View History$/.test(textOf(n))).length, 25);
});

test("pages use the shared view: Teacher (no F7 practice link) and School Admin (room filter incl. Students in no room)", () => {
  const fs = require("node:fs");
  const src = (p: string) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  const teacher = src("modules/module2/pages/TeacherDiagnosticResultsPage.tsx");
  assert.match(teacher, /<ClassReadingResults load=\{getTeacherReadingProgress\}/);
  assert.doesNotMatch(teacher, /TryInitialDiagnosticLink|Try the Initial Diagnostic/);
  const admin = src("pages/admin/AdminDiagnosticResultsPage.tsx");
  assert.match(admin, /<ClassReadingResults load=\{getSchoolReadingProgress\} idPrefix="school-results" showNoRoom \/>/);
});
