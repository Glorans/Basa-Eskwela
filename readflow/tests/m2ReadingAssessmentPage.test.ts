import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";
import {
  READING_ASSESSMENT_TABS, differingLatestReassessment, officialSource, progressTimeline, readViewMemory, saveViewMemory,
} from "../src/modules/module2/utils/readingAssessmentView.ts";

// M2 F3/F4/F5 learner page "My Reading Assessment" (Students and Independent Learners). Synthetic data only.
const require = createRequire(import.meta.url);
const srcPath = (path: string) => new URL(`../src/${path}`, import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
// The hook runtime renders one level; expand hook-free child components for text checks (stubs stay as they are).
const expand = (tree: any): any => {
  if (Array.isArray(tree)) return tree.map(expand);
  if (!tree || typeof tree !== "object") return tree;
  if (typeof tree.type === "function" && !tree.type.stub) return expand(tree.type(tree.props));
  return { type: tree.type, props: { ...tree.props, children: expand(tree.props?.children) } };
};

const point = (id: string, type: string, level: string, completedAt: string, title = type === "initial" ? "Garden" : "River") => ({
  id, assessmentType: type, title, version: "3.0", completedAt, readingLevel: level, wordRecognitionScore: 92, comprehensionScore: 66.7,
});
const lang = (language: "en" | "fil", extra: Record<string, unknown> = {}) => ({
  language, current: null, initial: null, reassessments: [], change: { status: "none", message: "No official assessment yet." }, placementNote: null, ...extra,
});
const NOTE = "Reassessment scores are shown as history. Reading placement still uses the initial diagnostic until a reassessment-based rule is approved.";
// English: initial Instructional, later reassessment Independent; the placement switch is OFF (rule "initial").
const EN = lang("en", {
  current: { readingLevel: "Instructional", source: "initial", completedAt: "2026-11-01T00:00:00Z", rule: "initial" },
  initial: point("i1", "initial", "Instructional", "2026-11-01T00:00:00Z"),
  reassessments: [point("r1", "reassessment", "Independent", "2026-11-20T00:00:00Z")],
  change: { status: "compared", direction: "higher", from: "Instructional", to: "Independent", basedOn: 2,
    message: "Higher than the initial diagnostic: Instructional to Independent, based on 2 official assessments." },
  placementNote: NOTE,
});
const FIL = lang("fil", {
  current: { readingLevel: "Independent", source: "initial", completedAt: "2026-11-02T00:00:00Z", rule: "initial" },
  initial: point("i2", "initial", "Independent", "2026-11-02T00:00:00Z", "Si Lito"),
  change: { status: "insufficient", message: "Only one official assessment so far, so there is no change to show yet." },
});
const entry = (id: string, language: string, type = "initial", verified = true) => ({
  id, assessmentType: type, language, completedAt: "2026-11-01T00:00:00Z", wordRecognitionScore: 90, comprehensionScore: 80,
  readingLevel: "Instructional", assessmentId: null, assessmentVersion: "3.0", verified,
});
const HISTORY = [entry("i1", "en"), entry("r1", "en", "reassessment"), entry("old", "en", "initial", false), entry("i2", "fil")];

function stub(name: string) {
  const fn = Object.assign(function () { return null; }, { stub: true });
  Object.defineProperty(fn, "name", { value: name });
  return fn;
}

function mountPage({ history = HISTORY, progress = { en: EN, fil: FIL }, fail = false, storage }: {
  history?: unknown[]; progress?: unknown; fail?: boolean; storage?: Storage;
} = {}) {
  const runtime = createHookRuntime(require("react"));
  const calls: string[] = [];
  const state = { fail };
  const tabsStub = stub("M7Tabs");
  const tablesStub = stub("DiagnosticHistoryTables");
  const mod = loadComponentModule(new URL("../src/modules/module2/pages/DiagnosticHistoryPage.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id.endsWith("/M7Tabs")) return { default: tabsStub };
    if (id.endsWith("/components/DiagnosticHistoryTables")) return { default: tablesStub };
    if (id.endsWith("/services/diagnosticHistory")) {
      return {
        getMyDiagnosticHistory: async () => { calls.push("history"); if (state.fail) throw new Error("Unable to load diagnostic results."); return history; },
        getDiagnosticHistoryError: (e: Error) => e.message,
      };
    }
    if (id.endsWith("/services/readingProgress")) return { getMyReadingProgress: async () => { calls.push("progress"); return progress; } };
    if (id === "../utils/diagnosticHistory") return require(srcPath("modules/module2/utils/diagnosticHistory.ts"));
    if (id === "../utils/readingAssessmentView") {
      if (storage) (globalThis as any).sessionStorage = storage;
      return require(srcPath("modules/module2/utils/readingAssessmentView.ts"));
    }
    return require(id);
  });
  const render = () => expand(runtime.render(mod.default, {}));
  const settle = async () => { for (let i = 0; i < 5; i++) { await tick(); render(); } return render(); };
  const tabs = (tree: unknown) => findAll(tree, (n) => n.type === tabsStub)[0].props;
  const panel = (tree: unknown, index: number) => findAll(tree, (n) => n.props?.id === `ra-panel-${index}`)[0];
  const radio = (tree: unknown, code: string) => findAll(tree, (n) => n.type === "input" && n.props.value === code)[0];
  return { render, settle, calls, state, tabs, panel, radio, tablesStub };
}

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() { return data.size; }, clear: () => data.clear(), key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, String(v)); }, removeItem: (k: string) => { data.delete(k); },
  };
}

// ---------------- pure helpers ----------------
test("helpers: the official source is the saved result the server names; the timeline is initial first, then reassessments", () => {
  assert.equal(officialSource(EN as any)?.id, "i1");
  assert.deepEqual(progressTimeline(EN as any).map((s) => [s.label, s.point.id]), [["Initial diagnostic", "i1"], ["Reassessment 1", "r1"]]);
  assert.equal(officialSource(lang("en") as any), null);
  assert.deepEqual(progressTimeline(lang("en") as any), []);
});

test("helpers: a differing reassessment is shown only when it is not the official source", () => {
  assert.equal(differingLatestReassessment(EN as any)?.id, "r1", "switch OFF, different level");
  const same = { ...EN, reassessments: [point("r1", "reassessment", "Instructional", "2026-11-20T00:00:00Z")] };
  assert.equal(differingLatestReassessment(same as any), null, "same level: nothing extra");
  const switchOn = { ...EN, current: { readingLevel: "Independent", source: "reassessment", completedAt: "2026-11-20T00:00:00Z", rule: "latest-official" } };
  assert.equal(officialSource(switchOn as any)?.id, "r1");
  assert.equal(differingLatestReassessment(switchOn as any), null, "switch ON: the reassessment IS the official level");
  assert.equal(differingLatestReassessment(FIL as any), null, "no reassessment");
});

test("helpers: tab and language memory falls back safely", () => {
  const original = (globalThis as any).sessionStorage;
  try {
    (globalThis as any).sessionStorage = memoryStorage();
    assert.deepEqual(readViewMemory(), { tab: 0, language: "en" });
    saveViewMemory({ tab: 2, language: "fil" });
    assert.deepEqual(readViewMemory(), { tab: 2, language: "fil" });
    (globalThis as any).sessionStorage = memoryStorage({ "basa:m2-reading-assessment": '{"tab":9,"language":"xx"}' });
    assert.deepEqual(readViewMemory(), { tab: 0, language: "en" });
    (globalThis as any).sessionStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    assert.deepEqual(readViewMemory(), { tab: 0, language: "en" });
    assert.doesNotThrow(() => saveViewMemory({ tab: 1, language: "en" }));
  } finally {
    (globalThis as any).sessionStorage = original;
  }
});

// ---------------- page ----------------
test("page: heading, subtitle, one language selector and three tabs", async () => {
  const page = mountPage();
  page.render();
  const tree = await page.settle();
  const text = textOf(tree);
  assert.match(text, /My Reading Assessment/);
  assert.match(text, /See your reading level, track your progress, and review completed assessments\./);
  assert.deepEqual(JSON.parse(JSON.stringify(page.tabs(tree).tabs)), ["Reading Level", "Reading Progress", "Assessment History"]);
  assert.deepEqual([...READING_ASSESSMENT_TABS], ["Reading Level", "Reading Progress", "Assessment History"]);
  assert.equal(findAll(tree, (n) => n.type === "input" && n.props.type === "radio").length, 2);
  assert.equal(page.radio(tree, "en").props.checked, true);
  assert.equal(findAll(tree, (n) => n.props?.role === "tabpanel").length, 3);
  assert.deepEqual(findAll(tree, (n) => n.props?.role === "tabpanel").map((p) => p.props.hidden), [false, true, true]);
  assert.deepEqual(page.calls.sort(), ["history", "progress"]);
  assert.doesNotMatch(text, /Teacher|Learning Room|rank|compare/i);
});

test("F4 Reading Level: the official level from the initial diagnostic; a differing reassessment is shown separately", async () => {
  const page = mountPage();
  page.render();
  const tree = await page.settle();
  const text = textOf(page.panel(tree, 0));
  assert.match(text, /Official Reading Level.*Instructional.*Instructional Reader/s);
  assert.match(text, /You can read the story with a little help and practice\./);
  assert.match(text, /LanguageEnglish/);
  assert.match(text, /Based onInitial diagnostic · Garden · Version 3\.0/);
  assert.match(text, /Latest Reassessment Result.*Independent.*River/s);
  assert.match(text, /Your official reading level is still Instructional, from your initial diagnostic\./);
  assert.doesNotMatch(text, /official reading level (is now|changed)|now Independent/i);
});

test("F4 Reading Level: no differing reassessment -> no extra block; no official result -> clear empty state", async () => {
  const page = mountPage();
  page.render();
  let tree = await page.settle();
  page.radio(tree, "fil").props.onChange();
  tree = page.render();
  const fil = textOf(page.panel(tree, 0));
  assert.match(fil, /Independent Reader/);
  assert.match(fil, /LanguageFilipino/);
  assert.doesNotMatch(fil, /Latest Reassessment Result/);
  const empty = mountPage({ history: [], progress: { en: lang("en"), fil: lang("fil") } });
  empty.render();
  assert.match(textOf(empty.panel(await empty.settle(), 0)), /You have no official English reading level yet\./);
});

test("F5 Reading Progress: initial then reassessments with dates and levels; the server's message and note", async () => {
  const page = mountPage();
  page.render();
  let tree = await page.settle();
  page.tabs(tree).onChange(1);
  tree = page.render();
  assert.equal(page.tabs(tree).value, 1);
  assert.equal(page.panel(tree, 1).props.hidden, false);
  const text = textOf(page.panel(tree, 1));
  assert.match(text, /English Reading Progress/);
  assert.match(text, /Higher than the initial diagnostic: Instructional to Independent, based on 2 official assessments\./);
  assert.match(text, /Initial diagnostic.*Nov 1, 2026.*Instructional.*Garden.*Reassessment 1.*Nov 20, 2026.*Independent.*River/s);
  assert.match(text, /Reading placement still uses the initial diagnostic/);
  assert.doesNotMatch(text, /trend|improving|declining/i);
  assert.equal(findAll(page.panel(tree, 1), (n) => n.type === "svg" || n.type === "canvas").length, 0, "no charts");
  page.radio(tree, "fil").props.onChange();
  const fil = textOf(page.panel(page.render(), 1));
  assert.match(fil, /Filipino Reading Progress.*no change to show yet/s);
  assert.doesNotMatch(fil, /Reassessment 1|placement still uses/);
});

test("F3 Assessment History: the complete saved history, filtered by the selected language only", async () => {
  const page = mountPage();
  page.render();
  let tree = await page.settle();
  page.tabs(tree).onChange(2);
  tree = page.render();
  const tables = findAll(page.panel(tree, 2), (n) => n.type === page.tablesStub);
  assert.equal(tables.length, 1, "one table, not duplicated across tabs");
  assert.equal(tables[0].props.results, HISTORY, "every saved result is passed on, unverified included");
  assert.equal(tables[0].props.language, "en");
  assert.equal(tables[0].props.owner, "self");
  assert.match(textOf(page.panel(tree, 2)), /English Assessment History/);
  page.radio(tree, "fil").props.onChange();
  tree = page.render();
  assert.equal(findAll(page.panel(tree, 2), (n) => n.type === page.tablesStub)[0].props.language, "fil");
});

test("page: loading, error with retry, and remembered tab + language", async () => {
  const storage = memoryStorage({ "basa:m2-reading-assessment": '{"tab":2,"language":"fil"}' });
  const original = (globalThis as any).sessionStorage;
  try {
    const page = mountPage({ fail: true, storage });
    assert.match(textOf(page.render()), /Loading your reading assessment\.\.\./);
    let tree = await page.settle();
    assert.equal(page.tabs(tree).value, 2, "remembered tab");
    assert.equal(page.radio(tree, "fil").props.checked, true, "remembered language");
    assert.match(textOf(tree), /Unable to load diagnostic results\./);
    page.state.fail = false;
    findAll(tree, (n) => n.type === "button" && textOf(n) === "Try Again")[0].props.onClick();
    tree = await page.settle();
    assert.doesNotMatch(textOf(tree), /Unable to load/);
    page.tabs(tree).onChange(0);
    assert.equal(storage.getItem("basa:m2-reading-assessment"), '{"tab":0,"language":"fil"}');
  } finally {
    (globalThis as any).sessionStorage = original;
  }
});

test("navigation: Students and Independent Learners see 'Reading Assessment'; URLs and M7 'Progress & Result' unchanged", () => {
  const sidebar = src("components/basa/BasaSidebar.tsx");
  assert.match(sidebar, /\{ label: "Reading Assessment", to: "\/dashboard\/assessment-history", icon: ClipboardList \}/);
  assert.match(sidebar, /\{ label: "Progress & Result", to: "\/dashboard\/progress"/);
  const layout = src("modules/module3/components/M3Layout.tsx");
  assert.match(layout, /label: "Reading Assessment", to: "\/m3\/general\/assessment-history"/);
  assert.match(layout, /label: "Progress & Result", to: "\/m3\/general\/progress"/);
  assert.doesNotMatch(sidebar + layout, /label: "Assessment History"/);
});

test("history tables: one language on request, with a Status column; both languages by default", () => {
  const runtime = createHookRuntime(require("react"));
  const mod = loadComponentModule(new URL("../src/modules/module2/components/DiagnosticHistoryTables.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id === "../utils/diagnosticHistory") return require(srcPath("modules/module2/utils/diagnosticHistory.ts"));
    return require(id);
  });
  const one = runtime.render(mod.default, { results: HISTORY, owner: "self", idPrefix: "t", language: "en" });
  assert.equal(findAll(one, (n) => n.type === "h3").length, 0, "the page supplies the heading");
  assert.equal(findAll(one, (n) => n.type === "tr").length - 1, 3, "all three English rows, unverified kept");
  const text = textOf(one);
  assert.match(text, /Status/);
  assert.match(text, /Verified/);
  assert.match(text, /Not verified/);
  assert.doesNotMatch(text, /Filipino/);
  const both = runtime.render(mod.default, { results: HISTORY, owner: "self", idPrefix: "t" });
  assert.deepEqual(findAll(both, (n) => n.type === "h3").map(textOf), ["English", "Filipino"]);
});
