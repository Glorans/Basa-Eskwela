import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";
import {
  assessmentTypeLabel, formatScore, groupHistoryByLanguage, sortNewestFirst, versionLabel,
} from "../src/modules/module2/utils/diagnosticHistory.ts";

// M2 F3: View Assessment Results and History (frontend). Synthetic data only.
const require = createRequire(import.meta.url);
const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const entry = (id: string, language: string, completedAt: string, extra: Record<string, unknown> = {}) => ({
  id, assessmentType: "initial", language, completedAt, wordRecognitionScore: 91.6667, comprehensionScore: 83.3333,
  readingLevel: "Instructional", assessmentId: `grade5-${language}-passage-v3`, assessmentVersion: "3.0", verified: true, ...extra,
});

test("history is grouped English then Filipino, each newest first; unknown languages are not shown", () => {
  const groups = groupHistoryByLanguage([
    entry("a", "fil", "2026-11-01T00:00:00Z"), entry("b", "en", "2026-11-03T00:00:00Z"),
    entry("c", "en", "2026-11-05T00:00:00Z"), entry("d", "xx", "2026-11-06T00:00:00Z"),
  ]);
  assert.deepEqual(groups.map((g) => [g.label, g.entries.map((e) => e.id)]), [["English", ["c", "b"]], ["Filipino", ["a"]]]);
  assert.deepEqual(sortNewestFirst([entry("x", "en", "2026-11-01T00:00:00Z"), entry("y", "en", "2026-11-01T00:00:00Z")]).map((e) => e.id), ["y", "x"], "stable tie order");
});

test("labels: assessment type, scores and version are shown as recorded, never invented", () => {
  assert.equal(assessmentTypeLabel("initial"), "Initial");
  assert.equal(assessmentTypeLabel("reassessment"), "Reassessment");
  assert.equal(formatScore(91.6667), "91.7%");
  assert.equal(formatScore(null), "—");
  assert.equal(versionLabel("3.0"), "Version 3.0");
  assert.equal(versionLabel(null), "Not recorded");
});

test("routes: Students and Independent Learners get Assessment History; approved Teachers get Diagnostic Results; System Admin gets neither", () => {
  const app = src("App.tsx");
  const block = (start: string, end: string) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));
  const student = block('allowedRoles={["student"]}', "</Route>\n        </Route>");
  assert.match(student, /path="assessment-history" element=\{<DiagnosticHistoryPage \/>\}/);
  const general = app.slice(app.indexOf('allowedRoles={["general_user"]}'));
  assert.match(general, /path="assessment-history" element=\{<DiagnosticHistoryPage \/>\}/);
  const teacher = app.slice(app.indexOf('allowedRoles={["teacher"]}'), app.indexOf('allowedRoles={["general_user"]}'));
  assert.match(teacher, /path="diagnostic-results" element=\{<TeacherDiagnosticResultsPage \/>\}/);
  const system = app.slice(app.indexOf('allowedRoles={["system_admin"]}'), app.indexOf("{/* Admin (School Admin) routes */}"));
  assert.doesNotMatch(system, /DiagnosticHistoryPage|TeacherDiagnosticResultsPage|diagnostic-results/);
  assert.equal((app.match(/<DiagnosticHistoryPage \/>/g) ?? []).length, 2, "only the two learner layouts");
  assert.equal((app.match(/<TeacherDiagnosticResultsPage \/>/g) ?? []).length, 1, "only the Teacher layout");
});

test("navigation: learner and Teacher entries; the services call only the F3 endpoints", () => {
  assert.match(src("components/basa/BasaSidebar.tsx"), /\{ label: "Assessment History", to: "\/dashboard\/assessment-history", icon: ClipboardList \}/);
  const layout = src("modules/module3/components/M3Layout.tsx");
  assert.match(layout, /label: "Assessment History", to: "\/m3\/general\/assessment-history"/);
  assert.match(layout, /label: "Diagnostic Results", to: "\/m3\/teacher\/diagnostic-results"/);
  // Code only (comments removed): the browser asks the server; it never reads tables, keys or transcripts itself.
  const service = src("modules/module2/services/diagnosticHistory.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.match(service, /"\/api\/diagnostic-history\/me"/);
  assert.match(service, /"\/api\/diagnostic-history\/teacher"/);
  assert.doesNotMatch(service, /supabase|correctChoiceId|transcript/i, "no direct table reads, answer keys or transcripts");
});

function mountTables(results: unknown[], owner = "self") {
  const runtime = createHookRuntime(require("react"));
  const mod = loadComponentModule(new URL("../src/modules/module2/components/DiagnosticHistoryTables.tsx", import.meta.url), (id) => {
    if (id.endsWith("/AssessmentBackButton")) return { default: "AssessmentBackButton" }; if (id.endsWith("/TryInitialDiagnosticLink")) return { default: "TryInitialDiagnosticLink" }; if (id.endsWith("module1/utils/authOnboarding")) return require(new URL("../src/modules/module1/utils/authOnboarding.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id.endsWith("/utils/diagnosticHistory")) return require(new URL("../src/modules/module2/utils/diagnosticHistory.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
    return require(id);
  });
  return runtime.render(mod.default, { results, owner, idPrefix: "t" });
}

test("tables: English and Filipino sections with type, date, both scores, level and version; unverified rows are labelled", () => {
  const tree = mountTables([
    entry("e1", "en", "2026-11-10T00:00:00Z"),
    entry("e2", "en", "2026-11-12T00:00:00Z", { assessmentType: "reassessment", readingLevel: "Independent", wordRecognitionScore: 98.3 }),
    entry("f1", "fil", "2026-11-11T00:00:00Z", { verified: false }),
  ]);
  const sections = findAll(tree, (n) => n.type === "section");
  assert.deepEqual(sections.map((s) => textOf(findAll(s, (n) => n.type === "h3")[0])), ["English", "Filipino"]);
  const englishRows = findAll(sections[0], (n) => n.type === "tr").slice(1).map((row) => findAll(row, (n) => n.type === "td").map(textOf));
  assert.equal(englishRows[0][0], "Reassessment", "newest first");
  assert.equal(englishRows[0][2], "98.3%");
  assert.equal(englishRows[1][0], "Initial");
  assert.equal(englishRows[1][5], "Version 3.0");
  assert.match(textOf(sections[1]), /not verified/);
  assert.deepEqual(findAll(tree, (n) => n.type === "th").slice(0, 6).map(textOf),
    ["Assessment", "Date Completed", "Word Recognition", "Comprehension", "Reading Level", "Version"]);
});

test("tables: empty languages say so, and nothing is invented", () => {
  const self = textOf(mountTables([entry("e1", "en", "2026-11-10T00:00:00Z")]));
  assert.match(self, /You have not completed the Filipino diagnostic yet\./);
  assert.doesNotMatch(self, /Reassessment/);
  assert.match(textOf(mountTables([], "student")), /No English diagnostic completed yet\..*No Filipino diagnostic completed yet\./s);
});

const NO_PROGRESS = { en: { language: "en", current: null }, fil: { language: "fil", current: null } };
const PROGRESS_STUB = {
  getMyReadingProgress: async () => NO_PROGRESS,
  getTeacherReadingProgress: async () => [],
};
function mountPage(path: string, service: Record<string, unknown>, progressService: Record<string, unknown> = PROGRESS_STUB) {
  const runtime = createHookRuntime(require("react"));
  const mod = loadComponentModule(new URL(`../src/modules/module2/pages/${path}`, import.meta.url), (id) => {
    if (id.endsWith("/AssessmentBackButton")) return { default: "AssessmentBackButton" }; if (id.endsWith("/TryInitialDiagnosticLink")) return { default: "TryInitialDiagnosticLink" }; if (id.endsWith("module1/utils/authOnboarding")) return require(new URL("../src/modules/module1/utils/authOnboarding.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id.endsWith("/services/diagnosticHistory")) return service;
    if (id.endsWith("/services/readingProgress")) return progressService;
    if (id.endsWith("/components/DiagnosticHistoryTables")) return { default: () => null };
    if (id.endsWith("/components/ReadingProgressPanel")) return { default: () => null };
    return require(id);
  });
  const render = () => runtime.render(mod.default, {});
  return { render, settle: async () => { for (let i = 0; i < 5; i++) { await tick(); render(); } } };
}

test("learner page: loads own history; a failure shows a retry", async () => {
  let fail = true;
  const page = mountPage("DiagnosticHistoryPage.tsx", {
    getMyDiagnosticHistory: async () => { if (fail) throw new Error("Unable to load diagnostic results."); return [entry("e1", "en", "2026-11-10T00:00:00Z")]; },
    getDiagnosticHistoryError: (e: Error) => e.message,
  });
  page.render();
  await page.settle();
  assert.match(textOf(page.render()), /Unable to load diagnostic results\./);
  fail = false;
  findAll(page.render(), (n) => n.type === "button")[0].props.onClick();
  await page.settle();
  const tables = findAll(page.render(), (n) => Array.isArray(n.props?.results));
  assert.equal(tables.length, 1);
  assert.equal(tables[0].props.results.length, 1);
  assert.equal(tables[0].props.owner, "self");
  assert.match(textOf(page.render()), /Assessment History/);
});

test("Teacher page: the shared class view; empty state explained; no Initial Diagnostic practice link", () => {
  const page = readFileSync(new URL("../src/modules/module2/pages/TeacherDiagnosticResultsPage.tsx", import.meta.url), "utf8");
  assert.match(page, /emptyMessage="No Students are currently enrolled in your active Learning Rooms\."/);
  assert.doesNotMatch(page, /TryInitialDiagnosticLink/);
  // Rooms, search and history behaviour: m2ClassReadingResults.test.ts
});
