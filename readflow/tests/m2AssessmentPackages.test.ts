import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";

// M2 F6 + F10 assessment packages, frontend. Synthetic data only; no network.
const require = createRequire(import.meta.url);
const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const real = (path: string) => require(new URL(`../src/${path}`, import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const { diagnosticAssessmentRegistry } = real("modules/module2/data/diagnosticData.ts");

// Values created inside the VM sandbox have their own prototypes: compare plain JSON copies.
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const roleBlock = (app: string, marker: string) => {
  const start = app.indexOf(marker);
  return app.slice(start, app.indexOf("</Route>\n        </Route>", start));
};

test("routes: packages live only inside the System Admin, School Admin and Teacher role blocks", () => {
  const app = src("App.tsx");
  const blocks = {
    system_admin: roleBlock(app, '<RequireRole allowedRoles={["system_admin"]} />'),
    admin: app.slice(app.indexOf('path="/admin"'), app.indexOf("{/* Teacher routes */}")),
    teacher: roleBlock(app, '<RequireRole allowedRoles={["teacher"]} />'),
  };
  for (const [role, block] of Object.entries(blocks)) {
    assert.match(block, new RegExp(`path="assessment-packages" element=\\{<AssessmentPackagesPage role="${role}" />\\}`), role);
    assert.match(block, new RegExp(`path="assessment-packages/:packageId" element=\\{<AssessmentPackageDetailPage role="${role}" />\\}`), role);
  }
  assert.equal((app.match(/<AssessmentPackagesPage role=/g) ?? []).length, 3, "no learner route");
  assert.equal((app.match(/<AssessmentPackageDetailPage role=/g) ?? []).length, 3);
  const general = app.slice(app.indexOf('<RequireRole allowedRoles={["general_user"]} />'));
  assert.doesNotMatch(general, /AssessmentPackage/);
});

test("navigation: one entry each for System Admin, School Admin and Teacher; none for learners", () => {
  const layout = src("modules/module3/components/M3Layout.tsx");
  assert.match(layout, /role === "system_admin" && <AssessmentNavigation/);
  assert.doesNotMatch(layout, /label: "Assessment Packages"/);
  assert.equal((layout.match(/label: "Reassessment Packages", to: "\/admin\/assessment-packages"/g) ?? []).length, 1);
  assert.equal((layout.match(/label: "Reassessment Packages", to: "\/m3\/teacher\/assessment-packages"/g) ?? []).length, 1);
  const general = layout.slice(layout.indexOf('if (role === "general_user")'));
  assert.doesNotMatch(general.slice(0, general.indexOf("return items")), /Packages/);
  assert.doesNotMatch(src("components/basa/BasaSidebar.tsx"), /assessment-packages|Packages/);
});

function loadService(calls: [string, string, unknown][], respond: (method: string, url: string) => unknown = () => ({ data: {} })) {
  const client = Object.fromEntries(["get", "post", "patch", "delete"].map((method) => [method, async (url: string, bodyOrConfig?: unknown) => {
    calls.push([method, url, bodyOrConfig]);
    return respond(method, url);
  }]));
  return loadComponentModule(new URL("../src/modules/module2/services/assessmentPackages.ts", import.meta.url), (id) => {
    if (id === "axios") return { default: { isAxiosError: (e: { isAxiosError?: boolean }) => Boolean(e?.isAxiosError) } };
    if (id.endsWith("/services/api")) return { default: client };
    if (id.endsWith("/services/authHeaders")) return { getSessionAuthHeaders: async () => ({ Authorization: "Bearer synthetic" }) };
    if (id.endsWith("/data/diagnosticData")) return real("modules/module2/data/diagnosticData.ts");
    return require(id);
  });
}

test("service: the initial import sends the exact code-defined 3.0 content; nothing else is changed", async () => {
  const calls: [string, string, unknown][] = [];
  const service = loadService(calls);
  await service.importInitialDiagnostic("fil");
  assert.equal(calls.length, 1);
  const [method, url, body] = calls[0] as [string, string, any];
  assert.deepEqual([method, url], ["post", "/api/assessment-packages/import-initial"]);
  const code = diagnosticAssessmentRegistry.fil;
  assert.equal(body.language, "fil");
  assert.deepEqual([body.assessment.id, body.assessment.version, body.assessment.title], [code.id, "3.0", code.title]);
  assert.deepEqual(plain(body.assessment.passage.paragraphs), plain(code.passage.paragraphs));
  assert.deepEqual(plain(body.assessment.questions.map((q: any) => [q.id, q.correctChoiceId, q.prompt])),
    plain(code.questions.map((q: any) => [q.id, q.correctChoiceId, q.prompt])));
  assert.equal(code.version, "3.0", "the delivered assessment is untouched");
});

test("service: paths are encoded; server messages and structural issues reach the page", async () => {
  const calls: [string, string, unknown][] = [];
  const service = loadService(calls, () => { throw { isAxiosError: true, response: { data: { message: "This version is not ready for review", issues: ["Add a passage title."] } } }; });
  await assert.rejects(service.changeVersionStatus("p/1", "v?1", "submit"), (error: any) => {
    assert.equal(error.message, "This version is not ready for review");
    assert.deepEqual(plain(error.issues), ["Add a passage title."]);
    return true;
  });
  assert.equal(calls[0][1], "/api/assessment-packages/p%2F1/versions/v%3F1/submit");
});

test("editor content keeps the saved question set (no padding) with choices a-d", () => {
  const { toEditableContent } = loadService([]);
  const content = toEditableContent({ passageTitle: "T", paragraphs: [], questions: [{ id: "q1", type: "literal", prompt: "P",
    correctChoiceId: "c", choices: [{ id: "c", label: "C" }] }] });
  assert.deepEqual(plain(content.paragraphs), [""]);
  assert.equal(content.questions.length, 1, "authors add question slots explicitly");
  assert.deepEqual(plain(content.questions[0].choices.map((c: any) => [c.id, c.label])), [["a", ""], ["b", ""], ["c", "C"], ["d", ""]]);
  assert.equal(content.questions[0].correctChoiceId, "c");
});

test("complete-story editor: untouched passages stay byte-identical; blank lines split paragraphs; 5–8 questions", () => {
  const { passageToText, textToPassage, assessmentRequirements } = real("modules/module2/services/assessmentEditor.ts");
  const legacy = ["  Ana walked.", "She ran.\nHome."];
  assert.deepEqual(plain(textToPassage(passageToText(legacy), legacy)), legacy, "an unedited legacy array is kept exactly");
  assert.deepEqual(plain(textToPassage("\n\nOne.\r\n\r\nTwo\nlines.\n\n")), ["One.", "Two\nlines."], "no empty paragraphs at the ends");
  assert.deepEqual(plain(textToPassage("A.\n\n\nB.")), ["A.\n\n\nB."], "longer blank-line runs stay inside one paragraph");
  const q = (type: string) => ({ id: type, type, prompt: "P", correctChoiceId: "a", choices: ["a", "b", "c", "d"].map((id) => ({ id, label: id })) });
  const words = Array.from({ length: 25 }, (_, i) => `w${i}`).join(" ");
  const base = { passageTitle: "T", paragraphs: [words] };
  const five = [q("literal"), q("inferential"), q("critical"), q("literal"), q("literal")];
  assert.deepEqual(plain(assessmentRequirements({ ...base, questions: five })), []);
  assert.deepEqual(plain(assessmentRequirements({ ...base, questions: [...five, ...five.slice(0, 3)] })), [], "8 is allowed");
  assert.ok(assessmentRequirements({ ...base, questions: five.slice(0, 4) }).includes("Include 5–8 comprehension questions."));
  assert.ok(assessmentRequirements({ ...base, questions: [...five, ...five] }).includes("Include 5–8 comprehension questions."));
  assert.ok(assessmentRequirements({ ...base, questions: [q("literal"), q("literal"), q("literal"), q("literal"), q("inferential")] })
    .includes("Include at least one critical question."));
});

const versionDetail = (overrides: Record<string, unknown> = {}) => ({
  id: "v1", versionNumber: 1, versionLabel: "1.0", status: "draft", source: "authored", createdAt: "2026-11-19T00:00:00Z",
  submittedAt: null, reviewedAt: null, publishedAt: null, retiredAt: null, basedOnVersionId: null,
  content: { passageTitle: "River", paragraphs: ["Ana walked."], questions: [{ id: "q1", type: "literal", prompt: "Who walked?",
    correctChoiceId: "a", choices: ["a", "b", "c", "d"].map((id) => ({ id, label: `Choice ${id}` })) }] },
  contentSha256: null, issues: ["Add exactly 6 comprehension questions."], reviewNote: null, educatorReviewAttestation: null,
  createdBy: "Teacher One", submittedBy: null, reviewedBy: null, publishedBy: null, retiredBy: null,
  stageLabel: "Draft", activeForLearners: false, activationNote: "Not active. Reassessment is not available to learners yet.",
  educatorEndorsed: false, educatorReviews: [], ...overrides,
});
const packageSummary = (permissions: Record<string, boolean>, overrides: Record<string, unknown> = {}) => ({
  id: "p1", category: "teacher", language: "en", title: "River", archived: false, createdAt: "", updatedAt: "",
  publishedVersion: null, activeVersion: null, latestVersion: null, versionCount: 1,
  permissions: { view: true, manage: false, review: false, publish: false, ...permissions }, ...overrides,
});

// Confirmations use the app dialog: each call records its message and takes the next queued answer (default: confirm).
type Dialog = { asked: string[]; answers: boolean[] };
function loadDetailModule(runtime: ReturnType<typeof createHookRuntime>, getPackage: () => Promise<unknown>, dialog: Dialog = { asked: [], answers: [] }) {
  return loadComponentModule(new URL("../src/modules/module2/pages/AssessmentPackageDetailPage.tsx", import.meta.url), (id) => {
    if (id.endsWith("/utils/initialDiagnosticLabels")) return require(new URL("../src/modules/module2/utils/initialDiagnosticLabels.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id.endsWith("/hooks/useAssessmentLeaveGuard")) return { useAssessmentLeaveGuard: () => {} };
    if (id === "react-router-dom") return { Link: "Link", useParams: () => ({ packageId: "p1" }) };
    if (id.includes("ReadFlowDialog")) return { confirmReadFlow: async (message: string) => { dialog.asked.push(message); return dialog.answers.shift() ?? true; } };
    if (id.endsWith("/hooks/useAssessmentLeaveGuard")) return { useAssessmentLeaveGuard: () => {} };
    if (id.endsWith("/services/assessmentEditor")) return real("modules/module2/services/assessmentEditor.ts");
    if (id === "lucide-react") return { ArrowLeft: "ArrowLeft" };
    // The System Admin's Initial Diagnostic editor is tested on its own (m2InitialDiagnosticEditor.test.ts).
    if (id.endsWith("/components/InitialDiagnosticEditor")) return { default: "InitialDiagnosticEditor", INITIAL_LIST_PATH: "/system-admin/assessment/initial" };
    if (id.endsWith("/services/assessmentPackages")) {
      const actual = loadService([]);
      return { ...actual, getAssessmentPackage: getPackage, listAssessmentPackages: async () => ({ packages: [], capabilities: { create: [], importInitial: [] } }) };
    }
    if (id.endsWith("./AssessmentPackagesPage")) return { ASSESSMENT_PACKAGE_PATHS: { system_admin: "/sa", admin: "/admin/assessment-packages", teacher: "/t" } };
    return require(id);
  });
}

function renderWorking(props: Record<string, unknown>, dialog: Dialog = { asked: [], answers: [] }) {
  const runtime = createHookRuntime(require("react"));
  const mod = loadDetailModule(runtime, async () => ({}), dialog);
  const actions: unknown[] = [];
  const all = {
    busy: false, confirming: "", setConfirming: () => {}, onSave: async () => true, onDelete: async () => true,
    onAction: async (...args: unknown[]) => { actions.push(args); return true; }, ...props,
  };
  return { render: () => runtime.render(mod.WorkingVersion, all), actions, dialog };
}
const buttons = (tree: any) => findAll(tree, (n) => n.type === "button");
const button = (tree: any, label: RegExp) => buttons(tree).find((b) => label.test(textOf(b)));

test("detail: the owner edits a draft; Submit is blocked by structural issues; the note explains it is not educational approval", () => {
  const view = renderWorking({ version: versionDetail(), detail: { package: packageSummary({ manage: true, publish: true }), versions: [] } });
  const tree = view.render();
  assert.ok(button(tree, /Save Draft/).props.disabled, "nothing to save yet");
  assert.ok(button(tree, /Submit for Review/).props.disabled, "issues block submission");
  assert.match(textOf(tree), /Add exactly 6 comprehension questions\./, "the database's own validation is shown");
  assert.match(textOf(tree), /structure only[\s\S]*educator review/);
  assert.equal(findAll(tree, (n) => n.type === "fieldset").length, 2, "passage + the one saved question (no padding)");
  assert.equal(findAll(tree, (n) => n.type === "input" && n.props.type === "radio").length, 4, "one correct answer per question");
  assert.equal(findAll(tree, (n) => n.type === "textarea").length, 2, "complete-story textarea + question text");
  button(tree, /Add Question/).props.onClick();
  const added = view.render();
  assert.equal(findAll(added, (n) => n.type === "input" && n.props.type === "radio").length, 8, "a slot is added explicitly");
  assert.equal(button(added, /Save Draft/).props.disabled, false, "the change can be saved");
});

test("detail: a School Admin sees a Teacher's draft read-only and cannot edit it", () => {
  const view = renderWorking({ version: versionDetail(), detail: { package: packageSummary({ review: true, publish: true }), versions: [] } });
  const tree = view.render();
  assert.equal(button(tree, /Save Draft/), undefined);
  assert.equal(button(tree, /Add Question|Remove Question|Delete Draft/), undefined);
  assert.equal(findAll(tree, (n) => n.type === "textarea" || n.type === "input").length, 0, "nothing is editable");
  assert.match(textOf(tree), /Ana walked\./);
  assert.match(textOf(tree), /still being written/);
});

test("detail: library approval needs a statement; return needs a note; Teachers only see 'waiting for review'", async () => {
  const inReview = versionDetail({ status: "in_review", issues: [], contentSha256: "a".repeat(64) });
  const reviewer = renderWorking({ version: inReview, detail: { package: packageSummary({ review: true, publish: true }), versions: [] } });
  let tree = reviewer.render();
  assert.ok(button(tree, /Approve for Library/).props.disabled);
  assert.ok(button(tree, /Return for Changes/).props.disabled);
  assert.match(textOf(tree), /Approving for the library is not educational validation/);
  const [attestation] = findAll(tree, (n) => n.type === "textarea");
  attestation.props.onChange({ target: { value: "Reviewed by the Grade 5 English coordinator." } });
  tree = reviewer.render();
  assert.equal(button(tree, /Approve for Library/).props.disabled, false);
  button(tree, /Approve for Library/).props.onClick();
  await tick();
  assert.deepEqual(plain(reviewer.actions), [["approve", { attestation: "Reviewed by the Grade 5 English coordinator.", note: "" }]]);

  const owner = renderWorking({ version: inReview, detail: { package: packageSummary({ manage: true, publish: true }), versions: [] } });
  tree = owner.render();
  assert.equal(button(tree, /Approve for Library/), undefined);
  assert.match(textOf(tree), /Waiting for review\. Your School Admin reviews Teacher packages\./);
});

test("detail: publishing needs a confirmation and explains that the previous version is kept", async () => {
  const approved = versionDetail({ status: "approved", issues: [], contentSha256: "b".repeat(64), educatorReviewAttestation: "Reviewed" });
  const view = renderWorking({ version: approved,
    detail: { package: packageSummary({ manage: true, publish: true }, { publishedVersion: "1.0", category: "initial" }), versions: [] } },
  { asked: [], answers: [false] });
  const tree = view.render();
  button(tree, /Publish Version 1\.0 in Library/).props.onClick(); // declined in the dialog
  await tick();
  assert.equal(view.dialog.asked.length, 1);
  assert.match(view.dialog.asked[0], /does not activate it for learners/);
  assert.equal(view.actions.length, 0, "nothing is published before confirmation");
  button(view.render(), /Publish Version 1\.0 in Library/).props.onClick(); // confirmed
  await tick();
  assert.deepEqual(plain(view.actions), [["publish", null]]);
  assert.match(textOf(tree), /replaces version 1\.0 there; it is kept unchanged as a retired version/);
  assert.match(textOf(tree), /Publishing does not change what learners take: the current initial diagnostic stays active/);
});

test("detail page: a System Admin's initial diagnostic opens the Initial Diagnostic editor at the same route", async () => {
  const runtime = createHookRuntime(require("react"));
  const imported = versionDetail({ id: "v3", versionLabel: "3.0", status: "published", source: "code_import", issues: [] });
  const detail = {
    package: packageSummary({ manage: true, review: true, publish: true }, { category: "initial", publishedVersion: "4.0", activeVersion: "3.0",
      delivery: { source: "code", assessmentId: "grade5-en-passage-v3", version: "3.0", activationAvailable: false } }),
    versions: [imported],
  };
  const mod = loadDetailModule(runtime, async () => detail);
  runtime.render(mod.default, { role: "system_admin" });
  for (let i = 0; i < 4; i++) { await tick(); runtime.render(mod.default, { role: "system_admin" }); }
  const tree = runtime.render(mod.default, { role: "system_admin" });
  assert.equal(tree.type, "InitialDiagnosticEditor");
  assert.equal(tree.props.detail.package.id, "p1");
  assert.equal(typeof tree.props.onDetail, "function");
});

test("detail page: other packages keep their editor; the System Admin back link uses the shared style", async () => {
  const runtime = createHookRuntime(require("react"));
  const mod = loadDetailModule(runtime, async () => ({
    package: packageSummary({ manage: true, review: true, publish: true }, { category: "independent" }), versions: [versionDetail()] }));
  runtime.render(mod.default, { role: "system_admin" });
  for (let i = 0; i < 4; i++) { await tick(); runtime.render(mod.default, { role: "system_admin" }); }
  const tree = runtime.render(mod.default, { role: "system_admin" });
  const back = findAll(tree, (n) => n.type === "Link" && n.props.className === "m3-back-link")[0];
  assert.equal(back.props.to, "/system-admin/assessment/reassessment");
  assert.match(textOf(back), /Back to Reassessment/);
  assert.equal(findAll(back, (n) => n.type === "ArrowLeft").length, 1, "one arrow icon");
  assert.ok(findAll(tree, (n) => n.props?.role === "tab").length >= 1, "the existing package editor still renders");
});

test("content view marks the correct answer (staff-only page)", () => {
  const runtime = createHookRuntime(require("react"));
  const mod = loadDetailModule(runtime, async () => ({}));
  const tree = runtime.render(mod.ContentView, { content: versionDetail().content });
  const correct = findAll(tree, (n) => n.type === "li" && n.props["data-correct"] === "true");
  assert.equal(correct.length, 1);
  assert.match(textOf(correct[0]), /A\. Choice a \(correct answer\)/);
});

test("list page: Teachers create only private packages; the notice says learners are not affected", async () => {
  const runtime = createHookRuntime(require("react"));
  const mod = loadComponentModule(new URL("../src/modules/module2/pages/AssessmentPackagesPage.tsx", import.meta.url), (id) => {
    if (id.endsWith("/utils/initialDiagnosticLabels")) return require(new URL("../src/modules/module2/utils/initialDiagnosticLabels.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id.endsWith("/hooks/useAssessmentLeaveGuard")) return { useAssessmentLeaveGuard: () => {} };
    if (id === "react-router-dom") return { Link: "Link", useNavigate: () => () => {} };
    if (id.endsWith("/services/assessmentPackages")) {
      return { ...loadService([]), listAssessmentPackages: async () => ({ packages: [], capabilities: { create: ["teacher"], importInitial: [] } }) };
    }
    return require(id);
  });
  runtime.render(mod.default, { role: "teacher" });
  for (let i = 0; i < 4; i++) { await tick(); runtime.render(mod.default, { role: "teacher" }); }
  const tree = runtime.render(mod.default, { role: "teacher" });
  const text = textOf(tree);
  assert.match(text, /Only you and your School Admin can see them/);
  assert.match(text, /"Published in library" is not the same as "Active for learner assessment"/);
  assert.match(text, /Official use will require a documented educator endorsement/);
  assert.doesNotMatch(text, /Reassessment delivery remains subject to its existing policy/);
  assert.match(text, /Package type: Teacher reassessment \(private\)/);
  assert.equal(findAll(tree, (n) => n.type === "select").length, 1, "language only; the package type is fixed");
  assert.equal(button(tree, /Import/), undefined);
});

function renderReviews(props: Record<string, unknown>) {
  const runtime = createHookRuntime(require("react"));
  const mod = loadDetailModule(runtime, async () => ({}));
  const saved: unknown[] = [];
  const all = { busy: false, canRecord: true, onReview: async (input: unknown) => { saved.push(input); return true; }, ...props };
  return { render: () => runtime.render(mod.EducatorReviews, all), saved };
}

test("A1 educator review panel: evidence notice, all four checks for an endorsement, append-only display", () => {
  const review = { id: "r1", reviewerName: "Ms. Santos", reviewerQualification: "Grade 5 Filipino teacher", reviewedOn: "2026-11-18",
    passageSuitable: true, questionsSound: false, answerKeysCorrect: true, languageAccurate: true, outcome: "changes_requested",
    notes: "Question 4 is ambiguous.", recordedBy: "School Admin", recordedAt: "2026-11-18T03:00:00Z" };
  const panel = renderReviews({ version: versionDetail({ status: "in_review", educatorReviews: [review] }) });
  let tree = panel.render();
  const text = textOf(tree);
  assert.match(text, /cannot verify a reviewer's professional qualification/);
  assert.match(text, /Library approval by a System Admin or School Admin is not educational validation/);
  assert.match(text, /Changes requested by Ms\. Santos \(Grade 5 Filipino teacher\), reviewed 2026-11-18/);
  assert.match(text, /No: The comprehension questions are sound/);
  assert.equal(findAll(tree, (n) => n.type === "button" && /Edit|Delete/.test(textOf(n))).length, 0, "reviews cannot be edited or deleted");
  button(tree, /Record Educator Review/).props.onClick();
  tree = panel.render();
  const inputs = findAll(tree, (n) => n.type === "input" && n.props.type !== "checkbox");
  inputs[0].props.onChange({ target: { value: "Mr. Cruz" } }); tree = panel.render();
  findAll(tree, (n) => n.type === "input" && n.props.type !== "checkbox")[1].props.onChange({ target: { value: "Reading coordinator" } }); tree = panel.render();
  findAll(tree, (n) => n.type === "input" && n.props.type === "date")[0].props.onChange({ target: { value: "2026-11-19" } }); tree = panel.render();
  assert.ok(button(tree, /Save Educator Review/).props.disabled, "an endorsement with unchecked checks cannot be saved");
  assert.match(textOf(tree), /An endorsement needs all four checks passed/);
  for (let i = 0; i < 4; i++) {
    findAll(tree, (n) => n.type === "input" && n.props.type === "checkbox")[i].props.onChange({ target: { checked: true } });
    tree = panel.render();
  }
  assert.equal(button(tree, /Save Educator Review/).props.disabled, false);
  findAll(tree, (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
  assert.deepEqual(plain(panel.saved), [{ reviewerName: "Mr. Cruz", reviewerQualification: "Reading coordinator", reviewedOn: "2026-11-19",
    passageSuitable: true, questionsSound: true, answerKeysCorrect: true, languageAccurate: true, outcome: "endorsed", notes: "" }]);
});

test("A1: non-reviewers (the owning Teacher) see the evidence but no recording form", () => {
  const panel = renderReviews({ canRecord: false, version: versionDetail({ status: "published", educatorEndorsed: true }) });
  const tree = panel.render();
  assert.equal(button(tree, /Record Educator Review/), undefined);
  assert.match(textOf(tree), /No educator review recorded/);
});

test("A2: every version shows library status, learner activity and endorsement separately", () => {
  const runtime = createHookRuntime(require("react"));
  const mod = loadDetailModule(runtime, async () => ({}));
  const text = textOf(runtime.render(mod.VersionRecord, { version: versionDetail({ status: "approved", stageLabel: "Approved for library", issues: [], contentSha256: "c".repeat(64) }) }));
  assert.match(text, /Library statusApproved for library/);
  assert.match(text, /Active for learner assessmentNo\. Not active\. Reassessment is not available to learners yet\./);
  assert.match(text, /Educator endorsementNot recorded/);
  const labels = loadService([]).STATUS_LABELS;
  assert.deepEqual(plain(labels), { draft: "Draft", in_review: "Submitted for review", approved: "Approved for library",
    published: "Published in library", retired: "Retired" });
});
