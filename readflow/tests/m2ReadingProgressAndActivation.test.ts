import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";
import {
  INITIAL_LOAD_ERROR, INITIAL_OUTDATED_ERROR, assessmentFromDelivery, draftVersionToResume, resolveInitialDiagnostic,
} from "../src/modules/module2/utils/initialDelivery.ts";
import { diagnosticSessionKey } from "../src/modules/module2/services/diagnosticSession.ts";
import { diagnosticAssessmentRegistry } from "../src/modules/module2/data/diagnosticData.ts";

// M2 F5 (View Reading Progress) and F6 (controlled initial diagnostic activation), frontend. Synthetic data only.
const require = createRequire(import.meta.url);
const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
// The hook runtime renders one level; expand nested hook-free components (LanguageCard, PointRow) for text checks.
const expand = (tree: any): any => {
  if (Array.isArray(tree)) return tree.map(expand);
  if (!tree || typeof tree !== "object") return tree;
  if (typeof tree.type === "function") return expand(tree.type(tree.props));
  return { type: tree.type, props: { ...tree.props, children: expand(tree.props?.children) } };
};
const settle = async (render: () => unknown) => { for (let i = 0; i < 5; i++) { await tick(); render(); } };

const point = (id: string, type: string, level: string, completedAt: string) => ({
  id, assessmentType: type, title: type === "initial" ? "Garden" : "River", version: "3.0", completedAt, readingLevel: level,
  wordRecognitionScore: 92, comprehensionScore: 66.7,
});
const lang = (language: "en" | "fil", extra: Record<string, unknown> = {}) => ({
  language, current: null, initial: null, reassessments: [], change: { status: "none", message: "No official assessment yet." }, placementNote: null, ...extra,
});

function renderPanel(props: Record<string, unknown>) {
  const runtime = createHookRuntime(require("react"));
  const mod = loadComponentModule(new URL("../src/modules/module2/components/ReadingProgressPanel.tsx", import.meta.url), (id) => {
    if (id.endsWith("/AssessmentBackButton")) return { default: "AssessmentBackButton" }; if (id.endsWith("/TryInitialDiagnosticLink")) return { default: "TryInitialDiagnosticLink" }; if (id.endsWith("module1/utils/authOnboarding")) return require(new URL("../src/modules/module1/utils/authOnboarding.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    return require(id.endsWith("/utils/diagnosticHistory") ? new URL("../src/modules/module2/utils/diagnosticHistory.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1") : id);
  });
  return expand(runtime.render(mod.default, props));
}

// ---------------- F5 ----------------
test("F5 panel: no official results -> clear empty state per language (self vs Student wording)", () => {
  const progress = { en: lang("en"), fil: lang("fil") };
  assert.match(textOf(renderPanel({ progress, idPrefix: "x", owner: "self" })), /You have no official English result yet\..*You have no official Filipino result yet\./s);
  assert.match(textOf(renderPanel({ progress, idPrefix: "x", owner: "student" })), /No official English result yet\./);
});

test("F5 panel: initial only and initial + reassessments; placement note shown; never a trend claim", () => {
  const en = lang("en", {
    current: { readingLevel: "Frustration", source: "initial", completedAt: "2026-10-01", rule: "initial" },
    initial: point("i", "initial", "Frustration", "2026-10-01T00:00:00Z"),
    reassessments: [point("r1", "reassessment", "Instructional", "2026-11-01T00:00:00Z")],
    change: { status: "compared", direction: "higher", from: "Frustration", to: "Instructional", basedOn: 2,
      message: "Higher than the initial diagnostic: Frustration to Instructional, based on 2 official assessments." },
    placementNote: "Reassessment scores are shown as history. Reading placement still uses the initial diagnostic until a reassessment-based rule is approved.",
  });
  const fil = lang("fil", {
    current: { readingLevel: "Independent", source: "initial", completedAt: "2026-10-01", rule: "initial" },
    initial: point("f", "initial", "Independent", "2026-10-01T00:00:00Z"),
    change: { status: "insufficient", message: "Only one official assessment so far, so there is no change to show yet." },
  });
  const text = textOf(renderPanel({ progress: { en, fil }, idPrefix: "x" }));
  assert.match(text, /English.*Current reading level:.*Frustration.*from the initial diagnostic/s);
  assert.match(text, /Higher than the initial diagnostic: Frustration to Instructional, based on 2 official assessments\./);
  assert.match(text, /Reading placement still uses the initial diagnostic/);
  assert.match(text, /Initial diagnostic.*Garden.*Reassessment.*River/s);
  assert.match(text, /Filipino.*Independent.*no change to show yet/s);
  assert.doesNotMatch(text, /trend|improving|declining/i);
});

function mountPage(url: string, stubs: Record<string, Record<string, unknown>>, props: Record<string, unknown> = {}) {
  const runtime = createHookRuntime(require("react"));
  const mod = loadComponentModule(new URL(url, import.meta.url), (id) => {
    if (id.endsWith("/AssessmentBackButton")) return { default: "AssessmentBackButton" }; if (id.endsWith("/TryInitialDiagnosticLink")) return { default: "TryInitialDiagnosticLink" }; if (id.endsWith("module1/utils/authOnboarding")) return require(new URL("../src/modules/module1/utils/authOnboarding.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    for (const [suffix, value] of Object.entries(stubs)) if (id.endsWith(suffix)) return value;
    if (id.endsWith("/components/DiagnosticHistoryTables")) return { default: () => null };
    if (id.endsWith("ReadingProgressPanel")) return { default: function ReadingProgressPanel() { return null; } };
    return require(id);
  });
  const render = () => runtime.render(mod.default, props);
  const panels = (tree: unknown) => findAll(tree, (n) => typeof n.type === "function" && n.type.name === "ReadingProgressPanel").map((n) => n.props);
  return { render, panels };
}

test("F5 learner page: own progress and history; link to Assessment History; no rooms or Teacher information", async () => {
  const progress = { en: lang("en"), fil: lang("fil") };
  const page = mountPage("../src/modules/module2/pages/DiagnosticHistoryPage.tsx", {
    "/services/diagnosticHistory": { getMyDiagnosticHistory: async () => [], getDiagnosticHistoryError: () => "x" },
    "/services/readingProgress": { getMyReadingProgress: async () => progress },
  });
  page.render();
  await settle(page.render);
  const tree = page.render();
  const text = textOf(tree);
  assert.match(text, /Reading Progress.*All Results/s);
  assert.ok(findAll(tree, (n) => n.type === "a" && n.props.href === "#assessment-history").length === 1);
  assert.ok(findAll(tree, (n) => n.props?.id === "assessment-history").length === 1);
  assert.deepEqual(plain(page.panels(tree)[0].progress), progress);
  assert.doesNotMatch(text, /Teacher|Learning Room|rank|compare/i);
});

test("F5 Teacher page: the shared class view with the Teacher's progress list (official results, active rooms)", () => {
  const page = src("modules/module2/pages/TeacherDiagnosticResultsPage.tsx");
  assert.match(page, /<ClassReadingResults load=\{getTeacherReadingProgress\}/);
  assert.match(page, /currently enrolled in your active Learning Rooms/);
  // Behaviour (filters, pagination, history, Back): m2ClassReadingResults.test.ts
});

test("F5 School Admin section: every Student listed with English and Filipino separately; searchable; never practice or XP", async () => {
  const students = [
    { id: "s1", name: "Ana", progress: { en: lang("en", { current: { readingLevel: "Instructional", source: "initial", completedAt: "", rule: "initial" } }), fil: lang("fil") } },
    { id: "s2", name: "Ben", progress: { en: lang("en"), fil: lang("fil") } },
  ];
  const calls: string[] = [];
  const page = mountPage("../src/modules/module2/components/SchoolReadingProgressSection.tsx", {
    "/services/diagnosticHistory": { getDiagnosticHistoryError: () => "x" },
    "/services/readingProgress": { getSchoolReadingProgress: async () => { calls.push("school"); return students; } },
    "./ReadingProgressPanel": { default: () => null },
  });
  page.render();
  await settle(page.render);
  let text = textOf(page.render());
  assert.deepEqual(calls, ["school"]);
  assert.match(text, /Ana.*English: Instructional.*Filipino: No official result.*Ben.*English: No official result/s);
  assert.match(text, /Practice, unverified results and XP are never included\./);
  findAll(page.render(), (n) => n.type === "input")[0].props.onChange({ target: { value: "ana" } });
  await settle(page.render);
  text = textOf(page.render());
  assert.match(text, /Showing 1 of 2 Students/);
  assert.doesNotMatch(text, /Ben/);
});

test("F5 wiring: School Admin page only (not System Admin); service calls the three server routes", () => {
  const adminPage = src("pages/admin/AdminDiagnosticResultsPage.tsx");
  assert.match(adminPage, /<ClassReadingResults load=\{getSchoolReadingProgress\}/);
  const app = src("App.tsx").replace(/\r\n/g, "\n");
  const sa = app.slice(app.indexOf('<RequireRole allowedRoles={["system_admin"]} />'));
  assert.doesNotMatch(sa.slice(0, sa.indexOf("</Route>\n        </Route>")), /AdminDiagnosticResultsPage|DiagnosticHistoryPage|TeacherDiagnosticResultsPage/);
  const service = src("modules/module2/services/readingProgress.ts");
  for (const path of ["/progress/me", "/progress/teacher", "/progress/school"]) assert.ok(service.includes(path), path);
});

// ---------------- F6 ----------------
const bundledEn = diagnosticAssessmentRegistry.en!;

test("F6 delivery: the built-in version uses the bundled 3.0; a package version arrives without answer keys", () => {
  assert.equal(assessmentFromDelivery("en", { source: "code", id: bundledEn.id, version: bundledEn.version }), bundledEn);
  assert.equal(assessmentFromDelivery("en", { source: "code", id: bundledEn.id, version: "9.9" }), null, "never a mismatched bundled version");
  const pkg = assessmentFromDelivery("en", { source: "package", id: bundledEn.id, version: "4.0", assessment: {
    id: bundledEn.id, version: "4.0", language: "en", title: "The Mango Seed",
    passage: { title: "The Mango Seed", paragraphs: ["Lito planted a seed."] },
    questions: [{ id: "q1", prompt: "Who?", choices: ["a", "b", "c", "d"].map((id) => ({ id, label: id })) }] } });
  assert.ok(pkg);
  assert.deepEqual([pkg.id, pkg.version, pkg.assessmentType, pkg.passage.paragraphs, pkg.questions[0].correctChoiceId], [bundledEn.id, "4.0", "initial", ["Lito planted a seed."], ""]);
  assert.equal(assessmentFromDelivery("fil", { source: "package", id: "x", version: "4.0", assessment: { id: "x", version: "4.0", language: "en", title: "", passage: { title: "", paragraphs: ["a"] }, questions: [] } }), null, "language must match");
});

test("F6 in-progress learners: a draft for a still-accepted version is resumed; otherwise the active version", () => {
  const delivery = { active: { source: "package" as const, id: bundledEn.id, version: "4.0" }, accepted: [{ id: bundledEn.id, version: "4.0" }, { id: bundledEn.id, version: "3.0" }], delivered: { source: "package" as const, id: bundledEn.id, version: "4.0" } };
  const draftKey = diagnosticSessionKey("u1", bundledEn);
  assert.equal(draftVersionToResume("u1", "en", delivery, (key) => key === draftKey), "3.0");
  assert.equal(draftVersionToResume("u1", "en", delivery, () => false), null);
  assert.equal(draftVersionToResume("u2", "en", delivery, (key) => key === draftKey), null, "another account's draft never counts");
  assert.equal(draftVersionToResume("u1", "en", { ...delivery, accepted: [{ id: bundledEn.id, version: "4.0" }] }, (key) => key === draftKey), null, "outside the grace window");
});

test("F6 wiring: learner routes ask the server; F7 Practice Mode keeps the built-in version", () => {
  const routes = src("modules/module2/components/DiagnosticRoutes.tsx");
  assert.match(routes, /loadInitialDiagnostic\(language, userId\)/);
  assert.doesNotMatch(routes, /getDiagnosticAssessment\(/);
  assert.match(src("modules/module2/components/PracticeDiagnosticRoutes.tsx"), /getDiagnosticAssessment\(language\)/);
  const service = src("modules/module2/services/initialDiagnosticDelivery.ts");
  assert.match(service, /\/api\/diagnostic\/initial\/\$\{language\}/);
  assert.doesNotMatch(service, /getDiagnosticAssessment/, "the service never substitutes the bundled version itself");
  assert.match(routes, /role="alert"[\s\S]*Try Again/, "a load failure is shown with Try Again");
});

// Confirmations use the app dialog: each call records its message and takes the next queued answer (default: confirm).
// M2 F6: the System Admin's Initial Diagnostic is managed in its own editor (same route as before).
function mountDetail(detail: unknown, calls: unknown[][], dialog: { asked: string[]; answers: boolean[] } = { asked: [], answers: [] }) {
  const runtime = createHookRuntime(require("react"));
  let current = detail as any;
  const mod = loadComponentModule(new URL("../src/modules/module2/components/InitialDiagnosticEditor.tsx", import.meta.url), (id) => {
    if (id.endsWith("/AssessmentBackButton")) return { default: "AssessmentBackButton" }; if (id.endsWith("/TryInitialDiagnosticLink")) return { default: "TryInitialDiagnosticLink" }; if (id.endsWith("module1/utils/authOnboarding")) return require(new URL("../src/modules/module1/utils/authOnboarding.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
    if (id.endsWith("/utils/initialDiagnosticLabels")) return require(new URL("../src/modules/module2/utils/initialDiagnosticLabels.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id === "react-router-dom") return { Link: "Link" };
    if (id === "lucide-react") return { ArrowLeft: "ArrowLeft" };
    if (id.endsWith("/AssessmentPreviewDialog")) return { default: "AssessmentPreviewDialog" };
    if (id.includes("ReadFlowDialog")) return { confirmReadFlow: async (message: string) => { dialog.asked.push(message); return dialog.answers.shift() ?? true; } };
    if (id.endsWith("/hooks/useAssessmentLeaveGuard")) return { useAssessmentLeaveGuard: () => {} };
    if (id.endsWith("/services/assessmentEditor")) return require(new URL("../src/modules/module2/services/assessmentEditor.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
    if (id.endsWith("/services/assessmentPackages")) {
      const actual = loadComponentModule(new URL("../src/modules/module2/services/assessmentPackages.ts", import.meta.url), (inner) => {
        if (inner === "axios") return { default: { isAxiosError: () => false } };
        if (inner.endsWith("/services/api")) return { default: {} };
        if (inner.endsWith("/services/authHeaders")) return { getSessionAuthHeaders: async () => ({}) };
        return require(inner.endsWith("/data/diagnosticData") ? new URL("../src/modules/module2/data/diagnosticData.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1") : inner);
      });
      return { ...actual, getAssessmentPackage: async () => detail,
        activateInitialVersion: async (...args: unknown[]) => { calls.push(["activate", ...args]); return detail; },
        returnToBuiltInInitial: async (...args: unknown[]) => { calls.push(["builtin", ...args]); return detail; } };
    }
    return require(id);
  });
  return () => runtime.render(mod.default, { detail: current, siblings: [], onDetail: (next: unknown) => { current = next; } });
}
const version = (id: string, label: string, extra: Record<string, unknown>) => ({
  id, versionNumber: Number(label[0]), versionLabel: label, status: "published", source: "authored", createdAt: "", submittedAt: null, reviewedAt: null,
  publishedAt: null, retiredAt: null, basedOnVersionId: null, content: { passageTitle: "T", paragraphs: ["p"], questions: [] }, contentSha256: null,
  issues: [], reviewNote: null, educatorReviewAttestation: null, createdBy: null, submittedBy: null, reviewedBy: null, publishedBy: null, retiredBy: null,
  stageLabel: "Published", activeForLearners: false, activationNote: "Not active.", educatorEndorsed: true, educatorReviews: [], ...extra,
});
const initialPkg = (activation: Record<string, unknown>, activeVersion: string) => ({
  id: "p1", category: "initial", language: "en", title: "Initial", archived: false, createdAt: "", updatedAt: "", publishedVersion: "4.0",
  activeVersion, latestVersion: null, versionCount: 2, permissions: { view: true, manage: true, review: true, publish: true }, activation,
});

test("F6 System Admin page: shows the active version; Activate needs a confirmation and sends the version it replaces", async () => {
  const calls: unknown[][] = [];
  const dialog = { asked: [] as string[], answers: [false] };
  const detail = { package: initialPkg({ available: true, canManage: true, activeVersionId: null }, "3.0"), versions: [
    version("v4", "4.0", { canActivate: true }), version("v3", "3.0", { source: "code_import", activeForLearners: true }) ] };
  const render = mountDetail(detail, calls, dialog);
  render();
  await settle(render);
  let tree = render();
  assert.match(textOf(tree), /Active versionVersion 3\.0/);
  assert.match(textOf(tree), /Version 3\.0 — Published · Active/, "published AND active, both shown");
  const label = (re: RegExp) => findAll(tree, (n) => n.type === "button" && re.test(textOf(n)))[0];
  assert.equal(findAll(tree, (n) => n.type === "button" && /Activate for Learners/.test(textOf(n))).length, 1, "only the eligible version");
  assert.equal(findAll(tree, (n) => n.type === "button" && /Return Learners to 3\.0/.test(textOf(n))).length, 0, "already on the built-in version");
  label(/Activate for Learners/).props.onClick(); // declined in the dialog
  await settle(render);
  assert.equal(calls.length, 0, "nothing happens without confirmation");
  assert.match(dialog.asked[0], /Learners who already completed the initial\s+diagnostic keep their result and are not asked to retake it/);
  assert.match(dialog.asked[0], /up to 24 hours/);
  tree = render();
  label(/Activate for Learners/).props.onClick(); // confirmed
  await settle(render);
  assert.deepEqual(calls, [["activate", "p1", "v4", null]]);
});

test("F6 page: after activation a System Admin can return to 3.0; without manage rights no controls are shown", async () => {
  const calls: unknown[][] = [];
  const active = { package: initialPkg({ available: true, canManage: true, activeVersionId: "v4" }, "4.0"), versions: [
    version("v4", "4.0", { activeForLearners: true, canActivate: false }), version("v3", "3.0", { source: "code_import" }) ] };
  let render = mountDetail(active, calls);
  render();
  await settle(render);
  let tree = render();
  assert.match(textOf(tree), /Active versionVersion 4\.0/);
  assert.equal(findAll(tree, (n) => n.type === "button" && /^Already Active$/.test(textOf(n))).length, 1, "the active 4.0 is not re-activated");
  // 3.0 is activated from 3.0 itself (the existing return-to-built-in action), confirmed in the dialog.
  findAll(tree, (n) => n.type === "select")[0].props.onChange({ target: { value: "v3" } });
  await settle(render);
  tree = render();
  findAll(tree, (n) => n.type === "button" && /^Activate for Learners$/.test(textOf(n)))[0].props.onClick();
  await settle(render);
  assert.deepEqual(calls, [["builtin", "p1", "v4"]]);
  const readOnly = { ...active, package: initialPkg({ available: true, canManage: false, activeVersionId: "v4" }, "4.0") };
  render = mountDetail(readOnly, calls);
  render();
  await settle(render);
  tree = render();
  // The activation slot keeps its place but nothing in it can be used without manage rights.
  const activationControls = findAll(tree, (n) => n.type === "button" && /Activate|Return Learners|Already Active/.test(textOf(n)));
  assert.ok(activationControls.every((b) => b.props["aria-disabled"] === true || b.props.disabled === true), "no usable activation control");
  for (const b of activationControls) b.props.onClick();
  await settle(render);
  assert.deepEqual(calls, [["builtin", "p1", "v4"]], "no further activation request");
});

// Phase 8 regression: a failed delivery must never silently substitute the bundled 3.0 (it may not be the active version).
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });
const pkgDelivery = (version: string, accepted = [version]) => ({
  active: { source: "package" as const, id: bundledEn.id, version },
  accepted: accepted.map((v) => ({ id: bundledEn.id, version: v })),
  delivered: { source: "package" as const, id: bundledEn.id, version, assessment: { id: bundledEn.id, version, language: "en" as const, title: "T",
    passage: { title: "T", paragraphs: ["p"] }, questions: [{ id: "q1", prompt: "?", choices: [{ id: "a", label: "A" }] }] } },
});

test("F6 load: network/server failure -> error with Try Again, never the bundled version", async () => {
  for (const failure of [new Error("Network Error"), httpError(500), httpError(503), httpError(401)]) {
    const load = await resolveInitialDiagnostic("en", "u1", async () => { throw failure; }, () => false);
    assert.deepEqual(plain(load), { status: "error", message: INITIAL_LOAD_ERROR }, failure.message);
  }
});

test("F6 load: only a backend without the endpoint (404, pre-F6, built-in only) uses the bundled version", async () => {
  const load = await resolveInitialDiagnostic("en", "u1", async () => { throw httpError(404); }, () => false);
  assert.equal(load.status === "ready" && load.assessment, bundledEn);
});

test("F6 load: the active version is used; a started version is resumed; an expired one falls back to the active one", async () => {
  const calls: (string | undefined)[] = [];
  const active = await resolveInitialDiagnostic("en", "u1", async (_l, v) => { calls.push(v); return pkgDelivery("4.0"); }, () => false);
  assert.equal(active.status === "ready" && active.assessment.version, "4.0");
  const draftKey = diagnosticSessionKey("u1", bundledEn);
  const resumed = await resolveInitialDiagnostic("en", "u1", async (_l, v) => (v === "3.0"
    ? { ...pkgDelivery("4.0", ["4.0", "3.0"]), delivered: { source: "code" as const, id: bundledEn.id, version: "3.0" } } : pkgDelivery("4.0", ["4.0", "3.0"])), (k) => k === draftKey);
  assert.equal(resumed.status === "ready" && resumed.assessment, bundledEn, "the learner keeps the 3.0 they started");
  const expired = await resolveInitialDiagnostic("en", "u1", async (_l, v) => { if (v) throw httpError(409); return pkgDelivery("4.0", ["4.0", "3.0"]); }, (k) => k === draftKey);
  assert.equal(expired.status === "ready" && expired.assessment.version, "4.0");
  const broken = await resolveInitialDiagnostic("en", "u1", async (_l, v) => { if (v) throw httpError(500); return pkgDelivery("4.0", ["4.0", "3.0"]); }, (k) => k === draftKey);
  assert.equal(broken.status, "error", "a failed resume never switches the learner silently");
});

test("F6 load: a built-in version this app does not bundle asks the learner to reload", async () => {
  const load = await resolveInitialDiagnostic("en", "u1", async () => ({ active: { source: "code" as const, id: bundledEn.id, version: "3.1" },
    accepted: [{ id: bundledEn.id, version: "3.1" }], delivered: { source: "code" as const, id: bundledEn.id, version: "3.1" } }), () => false);
  assert.deepEqual(plain(load), { status: "error", message: INITIAL_OUTDATED_ERROR });
});
