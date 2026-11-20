import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";

// M2 F10 reassessment editor (final workflow, 2026-11-21) for System Admin, School Admin and Teacher, in the F6 layout:
// Create New Version -> Edit Draft -> Preview -> Publish Version. No submission, approval or educator endorsement.
// Services stubbed; permissions come from the package, as from the server.
const require = createRequire(import.meta.url);
const path = (p: string) => new URL(`../src/${p}`, import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

const question = (n: number, type: string) => ({ id: `q${n}`, type, prompt: `Question ${n}?`, correctChoiceId: "a",
  choices: ["a", "b", "c", "d"].map((id) => ({ id, label: `Choice ${id}${n}` })) });
const SIX = [question(1, "literal"), question(2, "literal"), question(3, "inferential"), question(4, "inferential"), question(5, "critical"), question(6, "critical")];
const STORY = { passageTitle: "The Lost Kite", paragraphs: [Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ")], questions: SIX };
const version = (id: string, label: string, extra: Record<string, unknown> = {}) => ({
  id, versionNumber: Number(label[0]), versionLabel: label, status: "published", source: "authored", createdAt: "2026-11-19T00:00:00Z",
  submittedAt: null, reviewedAt: null, publishedAt: "2026-11-19T03:00:00Z", retiredAt: null, basedOnVersionId: null,
  content: STORY, contentSha256: "abcdef1234567890".repeat(4), issues: [], reviewNote: null, educatorReviewAttestation: null,
  createdBy: "Sam", submittedBy: null, reviewedBy: null, publishedBy: "Sam", retiredBy: null, stageLabel: "", activeForLearners: false,
  activationNote: "", educatorEndorsed: false, educatorReviews: [], ...extra,
});
const draftOf = (id: string, label: string, extra: Record<string, unknown> = {}) => version(id, label, { status: "draft", publishedAt: null, contentSha256: null, publishedBy: null, ...extra });
const CATEGORY = { system: "independent", school: "school", teacher: "teacher" } as const;
const pkg = (variant: keyof typeof CATEGORY, extra: Record<string, unknown> = {}) => ({
  id: "p1", category: CATEGORY[variant], language: "en", title: "Reassessment — EN", archived: false, createdAt: "", updatedAt: "",
  publishedVersion: "1.0", activeVersion: null, latestVersion: null, versionCount: 2, permissions: { view: true, manage: true, review: false, publish: true }, ...extra,
});

function mount(detail: any, variant: "system" | "school" | "teacher" = "system", { answers = [] as boolean[] } = {}) {
  const runtime = createHookRuntime(require("react"));
  const calls: unknown[][] = []; const asked: string[] = []; const navigations: unknown[][] = [];
  let current = detail;
  const respond = (name: string) => async (...args: unknown[]) => { calls.push([name, ...args]); await tick(); return current; };
  const mod = loadComponentModule(new URL("../src/modules/module2/components/ReassessmentPackageEditor.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id === "react-router-dom") return { Link: "Link", useNavigate: () => (to: unknown, options: unknown) => { navigations.push([to, options]); } };
    if (id === "lucide-react") return { ArrowLeft: "ArrowLeft" };
    if (id.endsWith("/AssessmentPreviewDialog")) return { default: "AssessmentPreviewDialog" };
    if (id.includes("ReadFlowDialog")) return { confirmReadFlow: async (m: string) => { asked.push(m); return answers.shift() ?? true; } };
    if (id.endsWith("/hooks/useAssessmentLeaveGuard")) return { useAssessmentLeaveGuard: () => {} };
    if (id.endsWith("/services/assessmentEditor")) return require(path("modules/module2/services/assessmentEditor.ts"));
    if (id.endsWith("/utils/initialDiagnosticLabels")) return require(path("modules/module2/utils/initialDiagnosticLabels.ts"));
    if (id.endsWith("/services/assessmentPackages")) {
      const actual = loadComponentModule(new URL("../src/modules/module2/services/assessmentPackages.ts", import.meta.url), (inner) => {
        if (inner === "axios") return { default: { isAxiosError: () => false } };
        if (inner.endsWith("/services/api")) return { default: {} };
        if (inner.endsWith("/services/authHeaders")) return { getSessionAuthHeaders: async () => ({}) };
        return require(inner.endsWith("/data/diagnosticData") ? path("modules/module2/data/diagnosticData.ts") : inner);
      });
      return { ...actual, createPackageVersion: respond("create"), savePackageDraft: respond("save"), deletePackageDraft: respond("delete"),
        changeVersionStatus: respond("status"), archiveAssessmentPackage: respond("archive"), renameAssessmentPackage: respond("rename"),
        recordEducatorReview: respond("review") };
    }
    return require(id);
  });
  const render = () => runtime.render(mod.default, { detail: current, onDetail: (next: any) => { current = next; }, variant });
  return { render, calls, asked, navigations };
}
const isOff = (b: any) => b.props["aria-disabled"] === true || b.props.disabled === true;
const bar = (tree: any) => findAll(tree, (n) => n.props?.className === "m2-id-bar")[0];
const zone = (tree: any) => findAll(tree, (n) => n.props?.className === "m2-id-danger-zone")[0];
const button = (tree: any, label: RegExp) => findAll(tree, (n) => n.type === "button").find((b) => label.test(textOf(b)));
const settle = async (render: () => unknown) => { for (let i = 0; i < 5; i++) { await tick(); render(); } };
const select = async (view: ReturnType<typeof mount>, id: string) => {
  findAll(view.render(), (n) => n.type === "select" && n.props.disabled !== undefined)[0].props.onChange({ target: { value: id } });
  await settle(view.render);
};
const slots = (tree: any) => Object.fromEntries(findAll(bar(tree), (n) => n.props?.className === "m2-id-slot").map((s: any) => {
  const c = findAll(s, (n) => n.type === "button")[0];
  return [s.props["data-slot"], [textOf(c), !isOff(c), textOf(findAll(s, (n) => n.props?.className === "m2-id-slot-reason")[0])]];
}));
const LABELS = ["Create New Version", "Edit Draft", "Preview", "Publish Version", "Try Assessment"];
const VARIANTS = ["system", "school", "teacher"] as const;

test("every role: three tabs, five fixed actions, no review, approval, endorsement or learner-readiness wording", () => {
  const back = { system: ["/system-admin/assessment/reassessment", "Back to Reassessment"], school: ["/admin/assessment-packages", "Back to Reassessment Packages"],
    teacher: ["/m3/teacher/assessment-packages", "Back to Reassessment Packages"] };
  for (const variant of VARIANTS) {
    const tree = mount({ package: pkg(variant), versions: [version("v1", "1.0")] }, variant).render();
    assert.deepEqual(findAll(tree, (n) => n.props?.role === "tab").map((t) => textOf(t)), ["Overview and Versions", "Reading Passage", "Comprehension Questions"]);
    assert.deepEqual(Object.values(slots(tree)).map((x: any) => x[0]), LABELS, variant);
    const link = findAll(tree, (n) => n.type === "Link")[0];
    assert.deepEqual([link.props.to, textOf(link).trim()], back[variant]);
    const main = textOf(tree).replace(textOf(findAll(tree, (n) => n.type === "details" && n.props.className === "m2-rp-details")[0]), "");
    for (const gone of [/Submit for Review/, /Approve for Library/, /Record Educator Review/, /Return for Changes/, /Review Submission/, /Endorse/i,
      /Ready for learners/, /Ready to assign/, /Preview and Publishing/, /Content fingerprint/]) assert.doesNotMatch(main, gone, `${variant}: ${gone}`);
    assert.match(textOf(tree), /LanguageEnglish.*Published versionVersion 1\.0.*Draft versionNone/s);
  }
  assert.match(textOf(mount({ package: pkg("school"), versions: [version("v1", "1.0")] }, "school").render()), /Assign it to Students separately/);
  assert.match(textOf(mount({ package: pkg("system"), versions: [version("v1", "1.0")] }).render()), /Eligible Independent Learners can start it only while reassessment is turned on/);
});

test("action states per status: publish straight from a complete draft; published and retired versions are read-only", async () => {
  const cases: [string, any][] = [
    ["draft", draftOf("v2", "2.0")],
    ["in_review", version("v2", "2.0", { status: "in_review", publishedAt: null, submittedAt: "2026-11-19T01:00:00Z" })],
    ["published", version("v2", "2.0")],
    ["retired", version("v2", "2.0", { status: "retired" })],
  ];
  const seen: Record<string, any> = {};
  for (const [status, v] of cases) {
    const view = mount({ package: pkg("teacher"), versions: [v, version("v1", "1.0", { status: status === "published" ? "retired" : "published" })] }, "teacher");
    await select(view, "v2");
    const s = slots(view.render());
    assert.deepEqual(Object.values(s).map((x: any) => x[0]), LABELS, `${status}: labels never change`);
    for (const [k, [, enabled, reason]] of Object.entries(s) as any) assert.ok(enabled || reason, `${status} ${k} has a reason`);
    seen[status] = Object.values(s).map((x: any) => (x[1] ? 1 : 0)).join("");
  }
  assert.deepEqual(seen, { draft: "01110", in_review: "00110", published: "10101", retired: "10100" }, "Try Assessment only for the published version");
  const s = slots(mount({ package: pkg("system"), versions: [version("v1", "1.0")] }).render());
  assert.deepEqual(s.publish, ["Publish Version", false, "Already published."]);
  assert.deepEqual(s.try, ["Try Assessment", true, ""]);
  const draftSlots = slots(mount({ package: pkg("system"), versions: [draftOf("v2", "2.0"), version("v1", "1.0")] }).render());
  assert.deepEqual(draftSlots.try, ["Try Assessment", false, "Publish this version to try it. Drafts can be previewed only."]);
});

test("incomplete drafts cannot be published: the reason and the missing items are shown", async () => {
  const view = mount({ package: pkg("school"), versions: [draftOf("v1", "1.0", { content: { ...STORY, questions: SIX.slice(0, 2) }, issues: ["Add at least 6 questions."] })] }, "school");
  let tree = view.render();
  const [, enabled, reason] = slots(tree).publish;
  assert.equal(enabled, false);
  assert.match(reason, /requirements? missing/);
  button(bar(tree), /^What's missing\?$/).props.onClick();
  tree = view.render();
  assert.match(textOf(bar(tree)), /Before publishing version 1\.0:.*Add at least 6 questions\./s);
  button(bar(tree), /^Publish Version$/).props.onClick();
  await settle(view.render);
  assert.deepEqual(view.calls, [], "nothing is sent");
});

test("publish: confirmed, sent once, no assignment; wording per role", async () => {
  for (const [variant, wording] of [["teacher", /not assigned to any Student until you assign it/], ["school", /not assigned to any Student until you assign it/],
    ["system", /Independent Learners can start it only while reassessment is turned on and they are eligible/]] as const) {
    const view = mount({ package: pkg(variant), versions: [draftOf("v2", "2.0"), version("v1", "1.0")] }, variant, { answers: [false, true] });
    button(bar(view.render()), /^Publish Version$/).props.onClick();
    await settle(view.render);
    assert.equal(view.calls.length, 0, "declined");
    assert.match(view.asked[0], /^Publish version 2\.0\? Version 1\.0 becomes Retired\. A published version cannot be edited\./);
    assert.match(view.asked[0], wording);
    button(bar(view.render()), /^Publish Version$/).props.onClick();
    await settle(view.render);
    assert.deepEqual(plain(view.calls), [["status", "p1", "v2", "publish"]], variant);
  }
});

test("versions from the earlier review workflow: publish it or Move Back to Draft; old records only in the history", async () => {
  const old = version("v2", "2.0", { status: "in_review", publishedAt: null, submittedAt: "2026-11-19T01:00:00Z", submittedBy: "Tess",
    educatorReviews: [{ id: "r1", reviewerName: "Ms. Santos", reviewerQualification: "Grade 5 teacher", reviewedOn: "2026-11-19", passageSuitable: true,
      questionsSound: true, answerKeysCorrect: true, languageAccurate: true, outcome: "endorsed", notes: null, recordedBy: "Sol", recordedAt: "2026-11-19T04:00:00Z" }] });
  const view = mount({ package: pkg("teacher"), versions: [old, version("v1", "1.0")] }, "teacher");
  const tree = view.render();
  assert.match(textOf(tree), /submitted under the earlier review workflow/);
  const history = findAll(tree, (n) => n.type?.name === "ReviewHistory")[0];
  assert.match(textOf(history.type(history.props)), /Submitted \(earlier workflow\)Tess.*Educator reviews \(earlier workflow, kept as history\).*Endorsed by Ms\. Santos/s);
  button(zone(tree), /^Move Back to Draft$/).props.onClick();
  await settle(view.render);
  assert.deepEqual(plain(view.calls), [["status", "p1", "v2", "reopen"]]);
});

test("clean-up area (outside the bar): Delete Draft, Retire, Rename, Archive; preview sends nothing", async () => {
  let view = mount({ package: pkg("school"), versions: [draftOf("v2", "2.0"), version("v1", "1.0")] }, "school");
  let tree = view.render();
  for (const label of [/^Delete Draft$/, /^Rename Package$/, /^Archive Package$/]) assert.ok(button(zone(tree), label), String(label));
  for (const label of [/Delete Draft/, /Archive Package/, /Retire/, /Rename/]) assert.equal(button(bar(tree), label), undefined);
  button(bar(tree), /^Preview$/).props.onClick();
  const d = findAll(view.render(), (n) => n.type === "AssessmentPreviewDialog")[0];
  assert.deepEqual([d.props.start, d.props.language], ["passage", "en"]);
  assert.deepEqual(view.calls, [], "preview records nothing");
  button(zone(view.render()), /^Rename Package$/).props.onClick();
  const rename = findAll(view.render(), (n) => n.type?.name === "RenameDialog")[0];
  rename.props.onSave("Reassessment — English");
  await settle(view.render);
  assert.deepEqual(plain(view.calls), [["rename", "p1", "Reassessment — English"]]);

  view = mount({ package: pkg("teacher"), versions: [version("v1", "1.0")] }, "teacher");
  button(zone(view.render()), /^Retire Version$/).props.onClick();
  await settle(view.render);
  assert.deepEqual(plain(view.calls), [["status", "p1", "v1", "retire"]]);
  assert.match(view.asked[0], /Retire version 1\.0\? It can no longer be assigned or started\./);
});

test("Open Existing Draft is navigation; archived or unmanaged packages are read-only", async () => {
  const view = mount({ package: pkg("system"), versions: [draftOf("v2", "2.0"), version("v1", "1.0")] });
  await select(view, "v1");
  assert.equal(isOff(button(bar(view.render()), /^Edit Draft$/)), true);
  button(view.render(), /^Open Existing Draft 2\.0$/).props.onClick();
  await settle(view.render);
  assert.match(textOf(bar(view.render())), /Selected: Version 2\.0 · Draft/);
  for (const extra of [{ archived: true }, { permissions: { view: true, manage: false, review: false, publish: false } }]) {
    const tree = mount({ package: pkg("school", extra), versions: [draftOf("v1", "1.0")] }, "school").render();
    const s = slots(tree);
    for (const key of ["create", "edit", "publish"]) assert.equal(s[key][1], false, `${JSON.stringify(extra)} ${key}`);
    assert.equal(s.preview[1], true);
    assert.equal(zone(tree), undefined);
  }
});

test("Try Assessment opens Practice Mode for the EXACT selected published version and returns to that package (every role)", async () => {
  const pages = { system: "/system-admin/assessment-packages", school: "/admin/assessment-packages", teacher: "/m3/teacher/assessment-packages" };
  for (const variant of VARIANTS) {
    const view = mount({ package: pkg(variant, { language: "fil" }), versions: [draftOf("v2", "2.0"), version("v1", "1.0")] }, variant);
    button(bar(view.render()), /^Try Assessment$/).props.onClick();
    assert.deepEqual(view.navigations, [], `${variant}: the selected draft is preview-only`);
    await select(view, "v1");
    button(bar(view.render()), /^Try Assessment$/).props.onClick();
    assert.deepEqual(plain(view.navigations), [["/practice/diagnostic/version/v1/fil/reading", { state: { practiceExitTo: `${pages[variant]}/p1` } }]], variant);
    assert.deepEqual(view.calls, [], "practice sends no package change");
  }
});
