import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";
import { diagnosticSessionKey } from "../src/modules/module2/services/diagnosticSession.ts";

// M2 F8 Complete Reassessment, frontend. Synthetic data only; no network, no Azure.
const require = createRequire(import.meta.url);
const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const real = (path: string) => require(new URL(`../src/${path}`, import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test("routes: the reassessment flow and lists are for Students and Independent Learners only; staff get neither", () => {
  const app = src("App.tsx");
  const flow = app.slice(app.indexOf("{/* M2 F8 - Complete Reassessment"), app.indexOf("{/* M2 F7 - Preview"));
  assert.match(flow, /<RequireRole allowedRoles=\{\[\.\.\.REASSESSMENT_LEARNER_ROLES\]\} \/>/);
  for (const step of ["reading", "questions", "result"]) {
    assert.match(flow, new RegExp(`path="/reassessments/:assignmentId/:language/${step}" element=\\{<ReassessmentStepRoute step="${step}" />\\}`));
  }
  assert.deepEqual([...real("modules/module2/utils/reassessmentPaths.ts").REASSESSMENT_LEARNER_ROLES], ["student", "general_user"]);
  const student = app.slice(app.indexOf('<RequireRole allowedRoles={["student"]} />'));
  assert.match(student.slice(0, student.indexOf("</Route>\n        </Route>")), /path="reassessments" element=\{<StudentReassessmentsPage \/>\}/);
  assert.equal((app.match(/<StudentReassessmentsPage \/>/g) ?? []).length, 1);
  const general = app.slice(app.indexOf('<RequireRole allowedRoles={["general_user"]} />'));
  assert.match(general, /path="reassessments" element=\{<StudentReassessmentsPage audience="independent" \/>\}/);
  assert.equal((app.match(/<StudentReassessmentsPage audience="independent" \/>/g) ?? []).length, 1);
  for (const staff of ['allowedRoles={["system_admin"]}', 'allowedRoles={["admin"]}', 'allowedRoles={["teacher"]}']) {
    const start = app.indexOf(staff);
    const end = start + app.slice(start).search(/<\/Route>\r?\n {8}<\/Route>/);
    assert.ok(end > start, staff);
    const block = app.slice(start, end);
    assert.doesNotMatch(block, /StudentReassessmentsPage|ReassessmentStepRoute/, staff);
  }
});

test("navigation: My Reassessments for Students (sidebar) and Independent Learners (workspace menu) only", () => {
  assert.match(src("components/basa/BasaSidebar.tsx"), /\{ label: "My Reassessments", to: "\/dashboard\/reassessments", icon: ClipboardList \}/);
  const layout = src("modules/module3/components/M3Layout.tsx");
  const general = layout.slice(layout.indexOf('if (role === "general_user")'));
  assert.match(general.slice(0, general.indexOf("return items")), /label: "My Reassessments", to: "\/m3\/general\/reassessments"/);
  assert.equal((layout.match(/My Reassessments/g) ?? []).length, 1, "no staff role gets the learner entry");
});

test("drafts: reassessment, initial and practice drafts can never mix", () => {
  const assessment = { id: "m2-package-version:v1", version: "assignment:a1", language: "en" } as never;
  const keys = (["m2", "m2-practice", "m2-reassessment", "m2-reassessment-independent"] as const).map((ns) => diagnosticSessionKey("u1", assessment, ns));
  assert.equal(new Set(keys).size, 4);
  const paths = real("modules/module2/utils/reassessmentPaths.ts");
  assert.deepEqual([paths.reassessmentDraftNamespace("student"), paths.reassessmentDraftNamespace("independent")], ["m2-reassessment", "m2-reassessment-independent"]);
  assert.equal(keys[2], "readflow:m2-reassessment:u1:en:m2-package-version%3Av1:assignment%3Aa1");
  const initial = { id: "grade5-en-passage-v3", version: "3.0", language: "en" } as never;
  assert.notEqual(diagnosticSessionKey("u1", initial, "m2"), keys[2]);
});

function loadClient(calls: [string, string, unknown][], respond: (method: string, url: string) => unknown) {
  const client = Object.fromEntries(["get", "post"].map((method) => [method, async (url: string, a?: unknown) => {
    calls.push([method, url, method === "post" ? a : null]);
    return respond(method, url);
  }]));
  return loadComponentModule(new URL("../src/modules/module2/services/studentReassessments.ts", import.meta.url), (id) => {
    if (id === "axios") return { default: { isAxiosError: (e: { isAxiosError?: boolean }) => Boolean(e?.isAxiosError) } };
    if (id.endsWith("/services/api")) return { default: client };
    if (id.endsWith("/services/authHeaders")) return { getSessionAuthHeaders: async () => ({ Authorization: "Bearer synthetic" }) };
    return require(id);
  }, { Intl });
}
const CONTENT = { assignment: { id: "a1", dueAt: null, title: "River check" }, assessment: { id: "m2-package-version:v1", version: "assignment:a1", language: "en",
  assessmentType: "reassessment", title: "Story", passage: { language: "en", title: "Story", paragraphs: ["Ana walked."] },
  questions: [{ id: "q1", prompt: "Who walked?", choices: ["a", "b", "c", "d"].map((id) => ({ id, label: id })) }] } };

test("client: content becomes a key-less DiagnosticAssessment; no learner id is ever sent; only receipts, answers and duration are posted", async () => {
  const calls: [string, string, unknown][] = [];
  const result = { assignmentId: "a1", assessmentType: "reassessment", language: "en", title: "River check" };
  const client = loadClient(calls, (method) => ({ data: method === "get" ? CONTENT : { success: true, result } }));
  const { assessment } = await client.getReassessmentContent("a1");
  assert.deepEqual([assessment.id, assessment.version, assessment.assessmentType], ["m2-package-version:v1", "assignment:a1", "reassessment"]);
  assert.equal(assessment.questions[0].correctChoiceId, "", "no answer key on the client");
  await client.submitReassessmentResult("a1", { language: "en", assessmentId: assessment.id, assessmentVersion: assessment.version,
    comprehensionAnswers: { q1: "a" }, transcriptReceipts: ["r1"], oralReadingMetrics: { recordingDurationSeconds: 30 },
    orvScore: 100, readingLevel: "Independent", comprehensionScore: 100 } as never);
  const [, url, body] = calls.find((c) => c[0] === "post")!;
  assert.equal(url, "/api/reassessments/me/a1/result");
  assert.deepEqual(Object.keys(body as object).sort(), ["answers", "assessmentId", "assessmentVersion", "language", "recordingDurationSeconds", "transcriptReceipts"]);
  assert.doesNotMatch(JSON.stringify(calls), /studentId|userId|orvScore|readingLevel/);
  const wrong = loadClient([], (method) => ({ data: method === "get" ? CONTENT : { success: true, result: { ...result, assignmentId: "other" } } }));
  await assert.rejects(wrong.submitReassessmentResult("a1", { language: "en", comprehensionAnswers: { q1: "a" }, transcriptReceipts: ["r"] } as never), /couldn't save/);
  await assert.rejects(client.submitReassessmentResult("a1", { language: "en", comprehensionAnswers: { q1: "a" }, transcriptReceipts: [] } as never), /not complete/);
});

function mountQuestions(submit: () => Promise<unknown>) {
  const runtime = createHookRuntime(require("react"));
  const calls: string[] = [];
  const navigations: [string, unknown][] = [];
  const assessment = { id: "m2-package-version:v1", title: "Story", gradeLevel: 5, language: "en", assessmentType: "reassessment", sourceLabel: "", sourceUrl: "",
    version: "assignment:a1", contentStatus: "active", passage: { language: "en", title: "Story", paragraphs: ["Ana walked."] },
    questions: [{ id: "q1", prompt: "Who walked?", choices: ["a", "b", "c", "d"].map((id) => ({ id, label: id })), correctChoiceId: "" }] };
  const session = { reading: { language: "en", transcription: { text: "Ana walked." }, oralReadingMetrics: {}, transcriptReceipts: ["r"] }, answers: { q1: "b" }, questionIndex: 0 };
  class StudentReassessmentError extends Error { code?: string; constructor(message: string, code?: string) { super(message); this.code = code; } }
  const mod = loadComponentModule(new URL("../src/modules/module2/pages/DiagnosticQuestionsPage.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id === "react-router-dom") return { Navigate: "Navigate", useNavigate: () => (to: string, opts: unknown) => navigations.push([to, opts]) };
    if (id.endsWith("/components/DiagnosticLayout")) return { default: "DiagnosticLayout" };
    if (id.endsWith("/components/PracticeModeBanner")) return { default: "PracticeModeBanner" };
    if (id.endsWith("/components/DiagnosticSessionProvider")) return { useDiagnosticSession: () => ({ get: () => session, save: () => {}, clear: () => calls.push("clear") }) };
    if (id.endsWith("/services/diagnosticPassage")) return { createPassageDiagnosticResult: () => ({ language: "en", assessmentId: assessment.id, assessmentVersion: assessment.version, comprehensionAnswers: { q1: "b" }, transcriptReceipts: ["r"] }) };
    if (id.endsWith("/services/diagnosticDatabase")) return { DiagnosticDatabaseError: class extends Error {}, saveInitialDiagnosticResult: async () => { calls.push("OFFICIAL INITIAL SAVE"); return {}; } };
    if (id.endsWith("/services/diagnosticPractice")) return { DiagnosticPracticeError: class extends Error {}, scoreDiagnosticPractice: async () => { calls.push("PRACTICE"); return {}; } };
    if (id.endsWith("/services/studentReassessments")) return { StudentReassessmentError, submitReassessmentResult: async () => { calls.push("reassessment save"); return submit(); } };
    if (id.endsWith("/services/diagnosticScoreAudit")) return { logDiagnosticScoreAudit: () => calls.push("audit") };
    if (id.endsWith("/services/diagnosticScoring")) return {};
    if (id.endsWith("/data/diagnosticData")) return { getDiagnosticPassageText: () => "Ana walked." };
    if (id.endsWith("/utils/diagnosticCopy")) return real("modules/module2/utils/diagnosticCopy.ts");
    return require(id);
  });
  const reassessment = { assignmentId: "a1", basePath: "/reassessments/a1", exitTo: "/dashboard/reassessments" };
  const render = () => runtime.render(mod.default, { assessment, reassessment });
  return { render, calls, navigations, StudentReassessmentError, settle: async () => { for (let i = 0; i < 6; i++) { await tick(); render(); } } };
}

test("questions page (reassessment): saved through the reassessment endpoint only, never the initial save or Practice Mode", async () => {
  const saved = { assignmentId: "a1", assessmentType: "reassessment", language: "en" };
  const page = mountQuestions(async () => saved);
  const tree = page.render();
  assert.equal(findAll(tree, (n) => n.type === "PracticeModeBanner").length, 0);
  const button = findAll(tree, (n) => n.props?.className === "diagnostic-primary-button")[0];
  assert.equal(textOf(button), "View Result");
  button.props.onClick();
  await page.settle();
  assert.deepEqual(page.calls, ["reassessment save", "clear"]);
  assert.deepEqual(plain(page.navigations), [["/reassessments/a1/en/result", { state: { reassessmentResult: saved } }]]);
});

test("questions page (reassessment): an already-finished assignment opens its saved result; an unverifiable reading is dropped", async () => {
  let page = mountQuestions(async () => { throw new page.StudentReassessmentError("You already finished this reassessment.", "ASSIGNMENT_COMPLETED"); });
  findAll(page.render(), (n) => n.props?.className === "diagnostic-primary-button")[0].props.onClick();
  await page.settle();
  assert.deepEqual(plain(page.navigations), [["/reassessments/a1/en/result", { replace: true }]]);
  page = mountQuestions(async () => { throw new page.StudentReassessmentError("We couldn't verify your reading.", "READING_NOT_VERIFIED"); });
  findAll(page.render(), (n) => n.props?.className === "diagnostic-primary-button")[0].props.onClick();
  await page.settle();
  assert.ok(page.calls.includes("clear"));
  assert.match(textOf(page.render()), /couldn't verify your reading/);
  assert.equal(page.calls.includes("OFFICIAL INITIAL SAVE"), false);
});

function mountList(reassessments: unknown[], { audience, extra = {}, start = async (v: string) => ({ assignment: { id: `new-${v}`, language: "en" }, resumed: false }) as unknown }:
  { audience?: string; extra?: Record<string, unknown>; start?: (v: string) => Promise<unknown> } = {}) {
  const runtime = createHookRuntime(require("react"));
  const navigations: string[] = [];
  const starts: string[] = [];
  const clientReal = loadClient([], () => ({ data: {} }));
  const mod = loadComponentModule(new URL("../src/modules/module2/pages/StudentReassessmentsPage.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id === "react-router-dom") return { Link: "Link", useNavigate: () => (to: string) => navigations.push(to) };
    if (id.endsWith("/services/studentReassessments")) return { ...clientReal, getMyReassessments: async () => ({ enabled: true, reassessments, ...extra }),
      startIndependentReassessment: async (versionId: string) => { starts.push(versionId); return start(versionId); } };
    if (id.endsWith("/utils/reassessmentPaths")) return real("modules/module2/utils/reassessmentPaths.ts");
    return require(id);
  }, { Intl });
  const render = () => runtime.render(mod.default, audience ? { audience } : {});
  return { render, navigations, starts, settle: async () => { for (let i = 0; i < 5; i++) { await tick(); render(); } return render(); } };
}

test("Student list: to-do items with Start only when available, a plain reason otherwise, and finished results", async () => {
  const base = { roomName: "Room A", assignedAt: "2026-11-19T02:00:00Z", dueAt: "2026-11-25T15:59:59Z", completedAt: null, result: null };
  const page = mountList([
    { ...base, id: "a1", status: "active", language: "en", title: "River check", available: true, unavailableReason: null },
    { ...base, id: "a2", status: "active", language: "fil", title: "Kuwento", available: false, unavailableReason: "Reassessments are not open yet. Please check again later." },
    { ...base, id: "a3", status: "completed", language: "en", title: "Garden check", available: false, unavailableReason: null, completedAt: "2026-11-18T03:00:00Z",
      result: { wordRecognitionScore: 96.7, comprehensionScore: 83.3, readingLevel: "Instructional", completedAt: "2026-11-18T03:00:00Z" } },
  ]);
  page.render();
  const tree = await page.settle();
  const text = textOf(tree);
  assert.match(text, /River checkEnglish · Room A · Given Nov 19, 2026 · Due Nov 25, 2026Start or Continue/);
  assert.match(text, /KuwentoFilipino .*Reassessments are not open yet/);
  const links = findAll(tree, (n) => n.type === "Link").map((l) => l.props.to);
  assert.ok(links.includes("/reassessments/a1/en/reading"));
  assert.equal(links.some((to: string) => to.startsWith("/reassessments/a2")), false, "an unavailable item has no Start link");
  assert.match(text, /Garden checkEnglishNov 18, 202696\.7%83\.3%Instructional/);
  assert.ok(links.includes("/dashboard/assessment-history"));
  assert.doesNotMatch(text, /correct answer|correctChoiceId/);
});

test("history table names the assessment (initial or reassessment title)", () => {
  const table = src("modules/module2/components/DiagnosticHistoryTables.tsx");
  assert.match(table, /assessmentTypeLabel\(entry\.assessmentType\)\}[\s\S]*entry\.assessmentTitle && <span className="diagnostic-history-note"> · \{entry\.assessmentTitle\}<\/span>/);
});

test("result page shows the saved, server-verified result read-only, with links back", async () => {
  const runtime = createHookRuntime(require("react"));
  const clientReal = loadClient([], () => ({ data: {} }));
  const fresh = { assignmentId: "a1", assessmentType: "reassessment", language: "en", title: "River check", completedAt: "2026-11-19T03:00:00Z",
    wordRecognitionScore: 100, comprehensionScore: 83.3333, wordRecognitionLevel: "Independent", comprehensionLevel: "Instructional", readingLevel: "Instructional",
    readingSpeedWpm: 90, reading: { totalExpectedWords: 30, correctWords: 30, substitutions: 0, omissions: 0, insertions: 0 }, comprehension: { correct: 5, total: 6 }, replayed: false };
  const mod = loadComponentModule(new URL("../src/modules/module2/pages/ReassessmentResultPage.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id === "react-router-dom") return { Link: "Link", useLocation: () => ({ state: { reassessmentResult: fresh } }) };
    if (id.endsWith("/components/DiagnosticLayout")) return { default: "DiagnosticLayout" };
    if (id.endsWith("/services/studentReassessments")) return { ...clientReal, getMyReassessments: async () => { throw new Error("not needed"); } };
    return require(id);
  }, { Intl });
  const tree = runtime.render(mod.default, { assignmentId: "a1", language: "en", exitTo: "/dashboard/reassessments" });
  const text = textOf(tree);
  assert.match(text, /Your Reassessment Result · English/);
  assert.match(text, /River check · Finished Nov 19, 2026/);
  assert.match(text, /Reading accuracy100%Independent/);
  assert.match(text, /Understanding the story83\.3%5 of 6 questions/);
  assert.match(text, /Reading levelInstructional/);
  assert.deepEqual(findAll(tree, (n) => n.type === "Link").map((l) => l.props.to), ["/dashboard/reassessments", "/dashboard/assessment-history"]);
  assert.equal(findAll(tree, (n) => n.type === "button").length, 0, "read-only");
});

test("Independent Learner list: start only eligible reassessments, plain reasons per language, no classroom details", async () => {
  const languages = {
    en: { canStart: true, reason: null, nextAvailableAt: null },
    fil: { canStart: false, reason: "Finish your first Filipino reading check before taking a reassessment.", nextAvailableAt: null },
  };
  const available = [
    { packageVersionId: "v-en", title: "Garden check", language: "en", canStart: true, reason: null },
    { packageVersionId: "v-done", title: "River check", language: "en", canStart: false, reason: "You already took this one." },
    { packageVersionId: "v-fil", title: "Kuwento", language: "fil", canStart: false, reason: "Finish your first Filipino reading check before taking a reassessment." },
  ];
  const done = { id: "a9", status: "completed", language: "en", title: "River check", assignedAt: "2026-10-01T02:00:00Z", dueAt: null,
    completedAt: "2026-10-01T03:00:00Z", available: false, unavailableReason: null,
    result: { wordRecognitionScore: 90, comprehensionScore: 66.7, readingLevel: "Instructional", completedAt: "2026-10-01T03:00:00Z" } };
  const page = mountList([done], { audience: "independent", extra: { languages, available } });
  page.render();
  let tree = await page.settle();
  const text = textOf(tree);
  assert.match(text, /Start a Reassessment/);
  assert.match(text, /Filipino: Finish your first Filipino reading check before taking a reassessment\./);
  assert.match(text, /River checkEnglishYou already took this one\./);
  assert.match(text, /When a new reading check opens/);
  assert.doesNotMatch(text, /teacher|Learning Room|Room A|Given/i, "no classroom information for Independent Learners");
  const startButtons = findAll(tree, (n) => n.type === "button" && /^Start$/.test(textOf(n)));
  assert.equal(startButtons.length, 1, "only the eligible reassessment can be started");
  startButtons[0].props.onClick();
  tree = await page.settle();
  assert.deepEqual(page.starts, ["v-en"]);
  assert.deepEqual(page.navigations, ["/reassessments/new-v-en/en/reading"]);
  const links = findAll(tree, (n) => n.type === "Link").map((l) => l.props.to);
  assert.ok(links.includes("/m3/general/assessment-history"), "Independent Learner history path");
  assert.ok(links.includes("/reassessments/a9/en/result"));
});

test("Independent Learner list: a refused start shows the server's reason and reloads", async () => {
  const page = mountList([], { audience: "independent", extra: { languages: { en: { canStart: true, reason: null, nextAvailableAt: null }, fil: { canStart: false, reason: "x", nextAvailableAt: null } },
    available: [{ packageVersionId: "v1", title: "Garden check", language: "en", canStart: true, reason: null }] },
    start: async () => { throw { message: "Your next English reassessment opens on December 1, 2026." }; } });
  page.render();
  let tree = await page.settle();
  findAll(tree, (n) => n.type === "button" && /^Start$/.test(textOf(n)))[0].props.onClick();
  tree = await page.settle();
  assert.match(textOf(tree), /Your next English reassessment opens on December 1, 2026\./);
  assert.deepEqual(page.navigations, []);
});

test("client: self-start posts only the package version (never a learner id)", async () => {
  const calls: [string, string, unknown][] = [];
  const client = loadClient(calls, () => ({ data: { assignment: { id: "a1", language: "en" }, resumed: false } }));
  await client.startIndependentReassessment("v1");
  assert.deepEqual(plain(calls), [["post", "/api/reassessments/me/independent/start", { packageVersionId: "v1" }]]);
});

test("result page for Independent Learners links to their own history and does not mention a teacher", async () => {
  const runtime = createHookRuntime(require("react"));
  const clientReal = loadClient([], () => ({ data: {} }));
  const fresh = { assignmentId: "a1", assessmentType: "reassessment", language: "fil", title: "Kuwento", completedAt: "2026-11-19T03:00:00Z",
    wordRecognitionScore: 95, comprehensionScore: 100, wordRecognitionLevel: "Independent", comprehensionLevel: "Independent", readingLevel: "Independent",
    readingSpeedWpm: null, reading: { totalExpectedWords: null, correctWords: null, substitutions: null, omissions: null, insertions: null }, comprehension: { correct: 6, total: 6 }, replayed: false };
  const mod = loadComponentModule(new URL("../src/modules/module2/pages/ReassessmentResultPage.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id === "react-router-dom") return { Link: "Link", useLocation: () => ({ state: { reassessmentResult: fresh } }) };
    if (id.endsWith("/components/DiagnosticLayout")) return { default: "DiagnosticLayout" };
    if (id.endsWith("/services/studentReassessments")) return clientReal;
    return require(id);
  }, { Intl });
  const tree = runtime.render(mod.default, { assignmentId: "a1", language: "fil", exitTo: "/m3/general/reassessments", historyPath: "/m3/general/assessment-history" });
  assert.match(textOf(tree), /Your Reassessment Result · Filipino/);
  assert.doesNotMatch(textOf(tree), /teacher/i);
  assert.deepEqual(findAll(tree, (n) => n.type === "Link").map((l) => l.props.to), ["/m3/general/reassessments", "/m3/general/assessment-history"]);
});
