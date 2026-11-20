import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";
import { diagnosticSessionKey } from "../src/modules/module2/services/diagnosticSession.ts";

// M2 F7 Preview / Try Assessment (staff Practice Mode), frontend. Synthetic data only; no network, no Azure.
const require = createRequire(import.meta.url);
const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const real = (path: string) => require(new URL(`../src/${path}`, import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const { diagnosticAssessmentRegistry } = real("modules/module2/data/diagnosticData.ts");

test("routes: Practice Mode is for System Admin, School Admin and Teacher only; the official diagnostic stays learner-only", () => {
  const app = src("App.tsx");
  const practice = app.slice(app.indexOf("{/* M2 F7"), app.indexOf("</Route>\n      </Route>", app.indexOf("{/* M2 F7")));
  assert.match(practice, /<RequireRole allowedRoles=\{\[\.\.\.PRACTICE_STAFF_ROLES\]\} \/>/);
  for (const step of ["reading", "questions", "result"]) {
    assert.match(practice, new RegExp(`path="/practice/diagnostic/:language/${step}" element=\\{<PracticeDiagnosticLanguageRoute step="${step}" />\\}`));
  }
  assert.match(practice, /path="\/practice\/diagnostic" element=\{<PracticeStartPage \/>\}/);
  assert.match(src("modules/module2/utils/practiceMode.ts"), /export const PRACTICE_STAFF_ROLES = \["system_admin", "admin", "teacher"\] as const;/);
  // The official flow is untouched: still learner roles, still the original paths.
  assert.match(app, /<RequireRole allowedRoles=\{DIAGNOSTIC_LEARNER_ROLES\} \/>[\s\S]*path="\/diagnostic\/:language\/reading"/);
  assert.deepEqual([...real("modules/module1/utils/authOnboarding.ts").DIAGNOSTIC_LEARNER_ROLES], ["student", "general_user"]);
});

test("navigation: standalone Try Assessment remains for School Admin and Teacher; System Admin uses eligible versions", () => {
  const layout = src("modules/module3/components/M3Layout.tsx");
  assert.equal((layout.match(/label: "Try Assessment", to: "\/practice\/diagnostic"/g) ?? []).length, 2);
  const general = layout.slice(layout.indexOf('if (role === "general_user")'));
  assert.doesNotMatch(general.slice(0, general.indexOf("return items")), /Try Assessment/);
  assert.doesNotMatch(src("components/basa/BasaSidebar.tsx"), /Try Assessment|practice\/diagnostic/);
});

test("practice drafts use their own session namespace; the official key is unchanged", () => {
  const assessment = diagnosticAssessmentRegistry.en;
  const official = diagnosticSessionKey("user-1", assessment);
  assert.equal(official, `readflow:m2:user-1:en:${assessment.id}:${assessment.version}`);
  assert.equal(diagnosticSessionKey("user-1", assessment, "m2-practice"), `readflow:m2-practice:user-1:en:${assessment.id}:${assessment.version}`);
  assert.notEqual(diagnosticSessionKey("user-1", assessment, "m2-practice"), official);
});

function loadPracticeService(post: (url: string, body: unknown) => Promise<unknown>) {
  return loadComponentModule(new URL("../src/modules/module2/services/diagnosticPractice.ts", import.meta.url), (id) => {
    if (id === "axios") return { default: { isAxiosError: (e: { isAxiosError?: boolean }) => Boolean(e?.isAxiosError) } };
    if (id.endsWith("/services/api")) return { default: { post: (url: string, body: unknown) => post(url, body) } };
    if (id.endsWith("/services/authHeaders")) return { getSessionAuthHeaders: async () => ({ Authorization: "Bearer synthetic" }) };
    return require(id);
  });
}
const localResult = (language = "en") => ({
  language, assessmentId: diagnosticAssessmentRegistry[language].id, assessmentVersion: diagnosticAssessmentRegistry[language].version,
  comprehensionAnswers: { q1: "a" }, transcriptReceipts: ["receipt-1"], oralReadingMetrics: { recordingDurationSeconds: 41 },
  orvScore: 12, readingLevel: "Frustration", // local previews: must never be sent
});
const serverResult = (language = "en") => ({ practice: true, saved: false, language, wordRecognitionScore: 96.7, comprehensionScore: 83.3 });

test("practice service: posts receipts and answers to /api/diagnostic/practice only (never the official endpoint, never local scores)", async () => {
  const calls: [string, Record<string, unknown>][] = [];
  const service = loadPracticeService(async (url, body) => { calls.push([url, body as Record<string, unknown>]); return { data: { success: true, result: serverResult() } }; });
  const result = await service.scoreDiagnosticPractice(localResult());
  assert.equal(result.saved, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/api/diagnostic/practice");
  assert.deepEqual(Object.keys(calls[0][1]).sort(), ["answers", "assessmentId", "assessmentVersion", "language", "recordingDurationSeconds", "transcriptReceipts"]);
  assert.equal(src("modules/module2/services/diagnosticPractice.ts").includes("/api/diagnostic/results"), false);
});

test("practice service: refuses incomplete readings and any response that is not an unsaved practice result", async () => {
  const service = loadPracticeService(async () => ({ data: { success: true, result: { ...serverResult(), saved: true } } }));
  await assert.rejects(service.scoreDiagnosticPractice({ ...localResult(), transcriptReceipts: [] }), /incomplete/);
  await assert.rejects(service.scoreDiagnosticPractice(localResult()), /couldn't score/);
  const forbidden = loadPracticeService(async () => { throw { isAxiosError: true, response: { data: { code: "PRACTICE_FORBIDDEN", message: "Practice Mode is available to staff accounts only." } } }; });
  await assert.rejects(forbidden.scoreDiagnosticPractice(localResult()), (e: { code?: string }) => e.code === "PRACTICE_FORBIDDEN");
});

function mountQuestions(practice: unknown) {
  const runtime = createHookRuntime(require("react"));
  const calls: string[] = [];
  const navigations: [string, unknown][] = [];
  const assessment = diagnosticAssessmentRegistry.en;
  const answers = Object.fromEntries(assessment.questions.map((q: { id: string }) => [q.id, "a"]));
  const session = { reading: { language: "en", transcription: { text: "synthetic" }, oralReadingMetrics: {}, transcriptReceipts: ["r"] },
    answers, questionIndex: assessment.questions.length - 1 };
  const mod = loadComponentModule(new URL("../src/modules/module2/pages/DiagnosticQuestionsPage.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id === "react-router-dom") return { Navigate: "Navigate", useNavigate: () => (to: string, opts: unknown) => navigations.push([to, opts]) };
    if (id.endsWith("/components/DiagnosticLayout")) return { default: "DiagnosticLayout" };
    if (id.endsWith("/components/PracticeModeBanner")) return { default: "PracticeModeBanner" };
    if (id.endsWith("/components/DiagnosticSessionProvider")) return { useDiagnosticSession: () => ({ get: () => session, save: () => {}, clear: () => calls.push("clear") }) };
    if (id.endsWith("/services/diagnosticPassage")) return { createPassageDiagnosticResult: () => localResult() };
    if (id.endsWith("/services/diagnosticDatabase")) return { DiagnosticDatabaseError: class extends Error {}, saveInitialDiagnosticResult: async () => { calls.push("OFFICIAL SAVE"); return { result: { language: "en" } }; } };
    if (id.endsWith("/services/diagnosticPractice")) return { DiagnosticPracticeError: class extends Error {}, scoreDiagnosticPractice: async () => { calls.push("practice score"); return serverResult(); } };
    if (id.endsWith("/services/studentReassessments")) return { StudentReassessmentError: class extends Error {}, submitReassessmentResult: async () => { calls.push("REASSESSMENT SAVE"); return {}; } };
    if (id.endsWith("/services/diagnosticScoreAudit")) return { logDiagnosticScoreAudit: () => calls.push("audit") };
    if (id.endsWith("/services/diagnosticScoring")) return {};
    if (id.endsWith("/data/diagnosticData")) return { getDiagnosticPassageText: () => "synthetic passage" };
    if (id.endsWith("/utils/diagnosticCopy")) return real("modules/module2/utils/diagnosticCopy.ts");
    return require(id);
  });
  const render = () => runtime.render(mod.default, { assessment, practice });
  return { render, calls, navigations, settle: async () => { for (let i = 0; i < 6; i++) { await tick(); render(); } } };
}

test("questions page in Practice Mode: scored by the practice endpoint, NEVER the official save; result shown in navigation state only", async () => {
  const page = mountQuestions({ basePath: "/practice/diagnostic", exitTo: "/m3/teacher/dashboard" });
  let tree = page.render();
  assert.equal(findAll(tree, (n) => n.type === "PracticeModeBanner").length, 1, "Practice Mode banner");
  const button = findAll(tree, (n) => n.props?.className === "diagnostic-primary-button")[0];
  assert.equal(textOf(button), "View Practice Result");
  button.props.onClick();
  await page.settle();
  assert.deepEqual(page.calls, ["practice score", "clear"]);
  assert.equal(page.navigations.length, 1);
  assert.equal(page.navigations[0][0], "/practice/diagnostic/en/result");
  assert.deepEqual((page.navigations[0][1] as { state: { practiceResult: unknown } }).state.practiceResult, serverResult());
  tree = page.render();
  assert.equal(findAll(tree, (n) => n.type === "button" && /Back to the story/.test(textOf(n)))[0].props.onClick !== undefined, true);
});

test("questions page without Practice Mode is the unchanged official flow (official save, no banner, no practice call)", async () => {
  const page = mountQuestions(undefined);
  const tree = page.render();
  assert.equal(findAll(tree, (n) => n.type === "PracticeModeBanner").length, 0);
  findAll(tree, (n) => n.props?.className === "diagnostic-primary-button")[0].props.onClick();
  await page.settle();
  assert.ok(page.calls.includes("OFFICIAL SAVE"));
  assert.equal(page.calls.includes("practice score"), false);
  assert.equal(page.navigations[0][0], "/diagnostic/en/result");
});

test("reading page: Practice Mode banner and practice paths; official paths unchanged without it", () => {
  const reading = src("modules/module2/pages/DiagnosticReadingPage.tsx");
  assert.match(reading, /const basePath = practice\?\.basePath \?\? reassessment\?\.basePath \?\? "\/diagnostic";/);
  assert.match(reading, /navigate\(`\$\{basePath\}\/\$\{assessment\.language\}\/questions`,/);
  assert.match(reading, /<PracticeModeBanner exitTo=\{practice\.exitTo\} \/>/);
  assert.doesNotMatch(reading, /navigate\(`\/diagnostic\//, "no hard-coded official path left in the shared reading page");
});

function mountResult(state: unknown) {
  const runtime = createHookRuntime(require("react"));
  const mod = loadComponentModule(new URL("../src/modules/module2/pages/PracticeResultPage.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id === "react-router-dom") return { Link: "Link", useLocation: () => ({ state }) };
    if (id.endsWith("/components/DiagnosticLayout")) return { default: "DiagnosticLayout" };
    if (id.endsWith("/components/PracticeModeBanner")) return { default: "PracticeModeBanner" };
    if (id.endsWith("/utils/practiceMode")) return { PRACTICE_BASE_PATH: "/practice/diagnostic" };
    return require(id);
  });
  return runtime.render(mod.default, { language: "fil", practice: { basePath: "/practice/diagnostic", exitTo: "/system-admin/users" } });
}

test("practice result: labelled practice, not saved and not official; refreshing shows no result; practise again is offered", () => {
  const result = {
    practice: true, saved: false, language: "fil", assessmentId: "grade5-fil-passage-v3", assessmentVersion: "3.0", scoringRule: "title-optional-v1",
    wordRecognitionScore: 91.6667, comprehensionScore: 83.3333, wordRecognitionLevel: "Instructional", comprehensionLevel: "Independent",
    readingLevel: "Instructional", readingSpeedWpm: 101.4,
    reading: { totalExpectedWords: 60, correctWords: 56, substitutions: 3, omissions: 1, insertions: 1, titleWordsExcluded: 5 },
    comprehension: { correct: 5, total: 6, questions: Array.from({ length: 6 }, (_, i) => ({ id: `q${i}`, correct: i !== 2 })) },
  };
  const tree = mountResult({ practiceResult: result });
  const text = textOf(tree);
  assert.equal(findAll(tree, (n) => n.type === "PracticeModeBanner").length, 1);
  assert.match(text, /Practice Result · Filipino/);
  assert.match(text, /It was not saved and is not an official reading level\./);
  assert.match(text, /91\.7%.*Instructional/s);
  assert.match(text, /5 of 6 correct/);
  assert.match(text, /Not official · not saved/);
  assert.match(text, /The story title was read aloud and not counted/);
  assert.match(text, /Question 3: Not correct/);
  assert.match(text, /Version 3\.0|version 3\.0/);
  const links = findAll(tree, (n) => n.type === "Link").map((n) => n.props.to);
  assert.ok(links.includes("/practice/diagnostic/fil/reading"), "practise again");
  assert.match(textOf(mountResult(null)), /Practice results are not saved, so there is nothing to show here\./);
  assert.match(textOf(mountResult({ practiceResult: { ...result, saved: true } })), /nothing to show here/, "a non-practice payload is never shown as a result");
});

test("practice start page: both languages, current version, Practice Mode banner and the not-saved explanation", () => {
  const runtime = createHookRuntime(require("react"));
  const mod = loadComponentModule(new URL("../src/modules/module2/pages/PracticeStartPage.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id === "react-router-dom") return { Link: "Link" };
    if (id.endsWith("/components/DiagnosticLayout")) return { default: "DiagnosticLayout" };
    if (id.endsWith("/components/PracticeModeBanner")) return { default: "PracticeModeBanner" };
    if (id.endsWith("/utils/practiceMode")) return { PRACTICE_BASE_PATH: "/practice/diagnostic", usePracticeOptions: () => ({ basePath: "/practice/diagnostic", exitTo: "/m3/admin/dashboard" }) };
    if (id.endsWith("/data/diagnosticData")) return { diagnosticAssessmentRegistry };
    return require(id);
  });
  const tree = runtime.render(mod.default, {});
  const text = textOf(tree);
  assert.equal(findAll(tree, (n) => n.type === "PracticeModeBanner").length, 1);
  assert.deepEqual(findAll(tree, (n) => n.type === "Link").map((n) => n.props.to), ["/practice/diagnostic/en/reading", "/practice/diagnostic/fil/reading"]);
  assert.match(text, /Nothing is saved/);
  assert.match(text, /Version 3\.0/);
});
