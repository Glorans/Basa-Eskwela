import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";

// M2 F7 Try Assessment for a SPECIFIC authored Initial Diagnostic version, frontend. Synthetic data; no network.
const require = createRequire(import.meta.url);
const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const path = (p: string) => new URL(`../src/${p}`, import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const VID = "0000a2a2-0000-4000-8000-000000000102";
// practiceMode.ts imports the auth hook; its two path helpers are mirrored here and checked against the source below.
const PRACTICE_MODE = { PRACTICE_BASE_PATH: "/practice/diagnostic", practiceVersionBasePath: (id: string) => `/practice/diagnostic/version/${encodeURIComponent(id)}` };
const SERVER = {
  packageId: "pkg-en", versionId: VID, activeForLearners: false,
  assessment: { id: `m2-practice-version:${VID}`, version: "4.0", language: "en", title: "The Lost Kite",
    passage: { language: "en", title: "The Lost Kite", paragraphs: ["Ana flew a kite.", "It flew away."] },
    questions: [{ id: "q1", prompt: "Who flew the kite?", choices: ["a", "b", "c", "d"].map((id) => ({ id, label: id.toUpperCase() })) }] },
};

function loadService(respond: (url: string) => unknown) {
  const calls: string[] = [];
  const mod = loadComponentModule(new URL("../src/modules/module2/services/practiceVersions.ts", import.meta.url), (id) => {
    if (id === "axios") return { default: { isAxiosError: (e: any) => Boolean(e?.isAxiosError) } };
    if (id.endsWith("/services/api")) return { default: { get: async (url: string) => { calls.push(url); return { data: { success: true, data: respond(url) } }; } } };
    if (id.endsWith("/services/authHeaders")) return { getSessionAuthHeaders: async () => ({ Authorization: "Bearer x" }) };
    return require(id);
  });
  return { mod, calls };
}

test("service: loads the selected version's own content as the learner screens' assessment, with no answer keys", async () => {
  const { mod, calls } = loadService(() => SERVER);
  const v = await mod.getPracticeVersion(VID);
  assert.deepEqual(calls, [`/api/diagnostic/practice/versions/${VID}`]);
  assert.equal(v.assessment.id, `m2-practice-version:${VID}`, "a practice id, never the built-in diagnostic id");
  assert.deepEqual([v.assessment.language, v.assessment.version, v.assessment.title], ["en", "4.0", "The Lost Kite"]);
  assert.deepEqual(plain(v.assessment.passage.paragraphs), ["Ana flew a kite.", "It flew away."]);
  assert.equal(v.assessment.questions[0].correctChoiceId, "", "the server scores with its own keys");
  const { mod: wrong } = loadService(() => ({ ...SERVER, assessment: { ...SERVER.assessment, id: "grade5-en-passage-v3" } }));
  await assert.rejects(wrong.getPracticeVersion(VID), /could not be loaded/, "a response for another assessment is refused");
});

function mountRoute(step: string, language: string, load: () => Promise<unknown>) {
  const runtime = createHookRuntime(require("react"));
  const mod = loadComponentModule(new URL("../src/modules/module2/components/PracticeDiagnosticRoutes.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id === "react-router-dom") return { Link: "Link", Navigate: "Navigate", Outlet: "Outlet", useParams: () => ({ versionId: VID, language }) };
    if (id.endsWith("/data/diagnosticData")) return require(path("modules/module2/data/diagnosticData.ts"));
    if (id.endsWith("/pages/DiagnosticReadingPage")) return { default: "DiagnosticReadingPage" };
    if (id.endsWith("/pages/DiagnosticQuestionsPage")) return { default: "DiagnosticQuestionsPage" };
    if (id.endsWith("/pages/PracticeResultPage")) return { default: "PracticeResultPage" };
    if (id.endsWith("/utils/practiceMode")) return { ...PRACTICE_MODE, usePracticeOptions: (o: any = {}) => ({ basePath: o.basePath ?? "/practice/diagnostic", exitTo: o.fallbackExitTo ?? "/system-admin" }) };
    if (id.endsWith("/services/practiceVersions")) return { getPracticeVersion: load };
    if (id.endsWith("/DiagnosticSessionProvider")) return { DiagnosticSessionProvider: "DiagnosticSessionProvider" };
    if (id.endsWith("/DiagnosticLayout")) return { default: "DiagnosticLayout" };
    if (id.endsWith("/PracticeModeBanner")) return { default: "PracticeModeBanner" };
    return require(id);
  });
  return () => runtime.render(mod.PracticeVersionRoute, { step });
}
const assessmentOf = () => {
  const { mod } = loadService(() => SERVER);
  return mod.getPracticeVersion(VID);
};

test("route: the reading and question screens receive EXACTLY the selected version; Back returns to its package", async () => {
  const version = await assessmentOf();
  for (const [step, screen] of [["reading", "DiagnosticReadingPage"], ["questions", "DiagnosticQuestionsPage"]]) {
    const render = mountRoute(step, "en", async () => version);
    assert.match(textOf(render()), /Loading this version/);
    for (let i = 0; i < 3; i++) { await tick(); render(); }
    const tree = render();
    assert.equal(tree.type, screen);
    assert.equal(tree.props.assessment.id, `m2-practice-version:${VID}`);
    assert.equal(tree.props.assessment.version, "4.0");
    assert.deepEqual(plain(tree.props.practice), { basePath: `/practice/diagnostic/version/${VID}`, exitTo: "/system-admin/assessment-packages/pkg-en" });
  }
});

test("route: a refused version shows the server's reason (never falls back to 3.0); a wrong language path is corrected", async () => {
  let render = mountRoute("reading", "en", async () => { throw new Error("Publish this version to practise it. Drafts can be previewed only."); });
  render();
  for (let i = 0; i < 3; i++) { await tick(); render(); }
  const tree = render();
  assert.match(textOf(tree), /Drafts can be previewed only/);
  assert.equal(findAll(tree, (n) => n.type === "DiagnosticReadingPage").length, 0);
  const version = await assessmentOf();
  render = mountRoute("reading", "fil", async () => version);
  render();
  for (let i = 0; i < 3; i++) { await tick(); render(); }
  const nav = render();
  assert.equal(nav.type, "Navigate");
  assert.equal(nav.props.to, `/practice/diagnostic/version/${VID}/en/reading`, "English content is never shown as Filipino");
});

test("result page: Practise again repeats the same version; Back to Initial Diagnostic; the version and title are shown", async () => {
  const runtime = createHookRuntime(require("react"));
  const result = { practice: true, saved: false, language: "en", assessmentId: `m2-practice-version:${VID}`, assessmentVersion: "4.0", passageTitle: "The Lost Kite",
    scoringRule: "x", wordRecognitionScore: 90, comprehensionScore: 100, wordRecognitionLevel: "Independent", comprehensionLevel: "Independent", readingLevel: "Independent",
    readingSpeedWpm: 80, reading: { totalExpectedWords: 7, correctWords: 7, substitutions: 0, omissions: 0, insertions: 0, titleWordsExcluded: 0 },
    comprehension: { correct: 1, total: 1, questions: [{ id: "q1", correct: true }] } };
  const mod = loadComponentModule(new URL("../src/modules/module2/pages/PracticeResultPage.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id === "react-router-dom") return { Link: "Link", useLocation: () => ({ state: { practiceResult: result } }) };
    if (id.endsWith("/components/DiagnosticLayout")) return { default: "DiagnosticLayout" };
    if (id.endsWith("/components/PracticeModeBanner")) return { default: "PracticeModeBanner" };
    if (id.endsWith("/utils/practiceMode")) return PRACTICE_MODE;
    return require(id);
  });
  const tree = runtime.render(mod.default, { language: "en", practice: { basePath: `/practice/diagnostic/version/${VID}`, exitTo: "/system-admin/assessment-packages/pkg-en" } });
  const links = findAll(tree, (n) => n.type === "Link").map((l) => [textOf(l), l.props.to]);
  assert.deepEqual(links, [["Practise again", `/practice/diagnostic/version/${VID}/en/reading`], ["Back to Initial Diagnostic", "/system-admin/assessment-packages/pkg-en"]]);
  assert.match(textOf(tree), /English · Version 4\.0 · The Lost Kite/);
  assert.match(textOf(tree), /not saved/);
});

test("banner and routes: Back to Initial Diagnostic from a System Admin package; version routes sit inside staff-only Practice Mode", () => {
  const runtime = createHookRuntime(require("react"));
  const banner = loadComponentModule(new URL("../src/modules/module2/components/PracticeModeBanner.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id === "react-router-dom") return { Link: "Link" };
    return require(id);
  });
  const label = (exitTo: string) => textOf(findAll(runtime.render(banner.default, { exitTo }), (n) => n.type === "Link")[0]);
  assert.equal(label("/system-admin/assessment-packages/pkg-en"), "Back to Initial Diagnostic");
  assert.equal(label("/admin/assessment-packages/x"), "Back to Assessment");
  assert.equal(label("/m3/teacher/dashboard"), "Exit practice");
  const modeSource = src("modules/module2/utils/practiceMode.ts");
  assert.ok(modeSource.includes('export const PRACTICE_BASE_PATH = "/practice/diagnostic";'));
  assert.ok(modeSource.includes("export const practiceVersionBasePath = (versionId: string) => `${PRACTICE_BASE_PATH}/version/${encodeURIComponent(versionId)}`;"));
  const app = src("App.tsx");
  const practice = app.slice(app.indexOf("{/* M2 F7"), app.indexOf("</Route>\n      </Route>", app.indexOf("{/* M2 F7")));
  assert.match(practice, /<RequireRole allowedRoles=\{\[\.\.\.PRACTICE_STAFF_ROLES\]\} \/>/);
  for (const step of ["reading", "questions", "result"]) {
    assert.match(practice, new RegExp(`path="/practice/diagnostic/version/:versionId/:language/${step}" element=\\{<PracticeVersionRoute step="${step}" />\\}`));
  }
});
