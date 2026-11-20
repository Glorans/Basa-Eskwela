import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";

// M2 F10 System Admin editor (central Independent Learner reassessment packages) in the F6 layout. Services stubbed.
const require = createRequire(import.meta.url);
const path = (p: string) => new URL(`../src/${p}`, import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

const question = (n: number, type: string) => ({ id: `q${n}`, type, prompt: `Question ${n}?`, correctChoiceId: "a",
  choices: ["a", "b", "c", "d"].map((id) => ({ id, label: `Choice ${id}${n}` })) });
const SIX = [question(1, "literal"), question(2, "literal"), question(3, "inferential"), question(4, "inferential"), question(5, "critical"), question(6, "critical")];
const STORY = { passageTitle: "The Lost Kite (IL EN 1.0)", paragraphs: [Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ")], questions: SIX };
const version = (id: string, label: string, extra: Record<string, unknown> = {}) => ({
  id, versionNumber: Number(label[0]), versionLabel: label, status: "published", source: "authored", createdAt: "2026-11-19T00:00:00Z",
  submittedAt: "2026-11-19T01:00:00Z", reviewedAt: "2026-11-19T02:00:00Z", publishedAt: "2026-11-19T03:00:00Z", retiredAt: null, basedOnVersionId: null,
  content: STORY, contentSha256: "abcdef1234567890".repeat(4), issues: [], reviewNote: null, educatorReviewAttestation: "Checked the passage and keys.",
  createdBy: "Sam", submittedBy: "Sam", reviewedBy: "Sam", publishedBy: "Sam", retiredBy: null, stageLabel: "", activeForLearners: false,
  activationNote: "Not active. Reassessment is not available to learners yet.", educatorEndorsed: true,
  educatorReviews: [{ id: "r1", reviewerName: "Ms. Santos", reviewerQualification: "Grade 5 teacher", reviewedOn: "2026-11-19", passageSuitable: true,
    questionsSound: true, answerKeysCorrect: true, languageAccurate: true, outcome: "endorsed", notes: null, recordedBy: "Sam", recordedAt: "2026-11-19T04:00:00Z" }],
  ...extra,
});
const fresh = { submittedAt: null, reviewedAt: null, publishedAt: null, contentSha256: null, educatorReviewAttestation: null, educatorEndorsed: false, educatorReviews: [] };
const pkg = (extra: Record<string, unknown> = {}) => ({
  id: "p1", category: "independent", language: "en", title: "Central IL Reassessment — EN", archived: false, createdAt: "", updatedAt: "",
  publishedVersion: "1.0", activeVersion: null, latestVersion: null, versionCount: 2, permissions: { view: true, manage: true, review: true, publish: true }, ...extra,
});

function mount(detail: any, { answers = [] as boolean[] } = {}) {
  const runtime = createHookRuntime(require("react"));
  const calls: unknown[][] = []; const asked: string[] = [];
  let current = detail;
  const respond = (name: string) => async (...args: unknown[]) => { calls.push([name, ...args]); await tick(); return current; };
  const mod = loadComponentModule(new URL("../src/modules/module2/components/ReassessmentPackageEditor.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id === "react-router-dom") return { Link: "Link" };
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
        changeVersionStatus: respond("status"), recordEducatorReview: respond("review"), archiveAssessmentPackage: respond("archive") };
    }
    return require(id);
  });
  const render = () => runtime.render(mod.default, { detail: current, onDetail: (next: any) => { current = next; } });
  return { render, calls, asked, mod };
}
const isOff = (b: any) => b.props["aria-disabled"] === true || b.props.disabled === true;
const bar = (tree: any) => findAll(tree, (n) => n.props?.className === "m2-id-bar")[0];
const buttons = (tree: any) => findAll(tree, (n) => n.type === "button");
const button = (tree: any, label: RegExp) => buttons(tree).find((b) => label.test(textOf(b)));
const settle = async (render: () => unknown) => { for (let i = 0; i < 5; i++) { await tick(); render(); } };
const select = async (view: ReturnType<typeof mount>, id: string) => {
  findAll(view.render(), (n) => n.type === "select" && n.props.disabled !== undefined)[0].props.onChange({ target: { value: id } });
  await settle(view.render);
};
const ORDER = ["create", "edit", "preview", "submit", "approve", "publish", "review", "try"];
const slots = (tree: any) => Object.fromEntries(findAll(bar(tree), (n) => n.props?.className === "m2-id-slot").map((s: any) => {
  const c = findAll(s, (n) => n.type === "button")[0];
  return [s.props["data-slot"], [textOf(c), !isOff(c), textOf(findAll(s, (n) => n.props?.className === "m2-id-slot-reason")[0])]];
}));
const LABELS = ["Create New Version", "Edit Draft", "Preview", "Submit for Review", "Approve for Library", "Publish Version", "Record Educator Review", "Try Assessment"];

test("same three tabs as F6; no workflow banner, fourth tab or technical records in the main view", () => {
  const tree = mount({ package: pkg(), versions: [version("v1", "1.0")] }).render();
  assert.deepEqual(findAll(tree, (n) => n.props?.role === "tab").map((t) => textOf(t)), ["Overview and Versions", "Reading Passage", "Comprehension Questions"]);
  const main = textOf(tree).replace(textOf(findAll(tree, (n) => n.type === "details" && n.props.className === "m2-rp-details")[0]), "");
  for (const gone of [/Create \/ Edit → Save Draft/, /Preview and Publishing/, /Publish to Library/, /Content fingerprint/, /Library approval statement/, /Reassessment delivery remains/]) {
    assert.doesNotMatch(main, gone);
  }
  const details = findAll(tree, (n) => n.type === "details" && n.props.className === "m2-rp-details")[0];
  assert.match(textOf(details), /Review history and details — Version 1\.0/);
  // The runtime renders one level: expand the (hook-free) history component inside the expandable area.
  const history = findAll(details, (n) => n.type?.name === "ReviewHistory")[0];
  assert.match(textOf(history.type(history.props)), /Library approval statementChecked the passage and keys\..*Content fingerprintabcdef123456.*Endorsed by Ms\. Santos/s,
    "audit details and educator reviews are kept, in an expandable area");
  assert.match(textOf(tree), /LanguageEnglish.*Ready for learnersVersion 1\.0.*Published versionVersion 1\.0.*Draft versionNone/s);
});

test("eight fixed actions in the same order for every status; unavailable ones greyed out with a reason", async () => {
  const cases: [string, any][] = [
    ["draft", version("v2", "2.0", { status: "draft", ...fresh })],
    ["in_review", version("v2", "2.0", { status: "in_review", ...fresh, submittedAt: "x" })],
    ["approved", version("v2", "2.0", { status: "approved", ...fresh, reviewedAt: "x", educatorReviewAttestation: "ok" })],
    ["published", version("v2", "2.0", { status: "published" })],
    ["retired", version("v2", "2.0", { status: "retired" })],
  ];
  const seen: Record<string, any> = {};
  for (const [status, v] of cases) {
    const view = mount({ package: pkg(), versions: [v, version("v1", "1.0", { status: status === "published" ? "retired" : "published" })] });
    await select(view, "v2");
    const s = slots(view.render());
    assert.deepEqual(Object.keys(s), ORDER, status);
    assert.deepEqual(Object.values(s).map((x: any) => x[0]), LABELS, `${status}: labels never change`);
    for (const [k, [, enabled, reason]] of Object.entries(s) as any) assert.ok(enabled || reason, `${status} ${k} has a reason`);
    seen[status] = Object.fromEntries(Object.entries(s).map(([k, x]: any) => [k, x[1]]));
  }
  assert.deepEqual(seen.draft, { create: false, edit: true, preview: true, submit: true, approve: false, publish: false, review: false, try: false });
  assert.deepEqual(seen.in_review, { create: false, edit: false, preview: true, submit: false, approve: true, publish: false, review: true, try: false });
  assert.deepEqual(seen.approved, { create: false, edit: false, preview: true, submit: false, approve: false, publish: true, review: true, try: false });
  assert.deepEqual(seen.published, { create: true, edit: false, preview: true, submit: false, approve: false, publish: false, review: true, try: false });
  // No draft or version in review exists here, so a new version can be started from the retired one.
  assert.deepEqual(seen.retired, { create: true, edit: false, preview: true, submit: false, approve: false, publish: false, review: true, try: false });
  const s = slots(mount({ package: pkg(), versions: [version("v1", "1.0")] }).render());
  assert.deepEqual(s.try, ["Try Assessment", false, "Try Assessment is available for the Initial Diagnostic only."]);
  assert.deepEqual(s.publish, ["Publish Version", false, "Already published."]);
});

test("review workflow: Submit, Approve (statement required), Publish — each confirmed, F10 steps kept separate", async () => {
  let view = mount({ package: pkg(), versions: [version("v2", "2.0", { status: "draft", ...fresh }), version("v1", "1.0")] });
  button(bar(view.render()), /^Submit for Review$/).props.onClick();
  await settle(view.render);
  assert.match(view.asked[0], /Submit version 2\.0 for review\? It becomes read-only\./);
  assert.deepEqual(plain(view.calls), [["status", "p1", "v2", "submit", null]]);

  view = mount({ package: pkg(), versions: [version("v2", "2.0", { status: "in_review", ...fresh }), version("v1", "1.0")] });
  button(bar(view.render()), /^Approve for Library$/).props.onClick();
  let dialog = findAll(view.render(), (n) => n.type?.name === "NoteDialog")[0];
  assert.equal(dialog.props.fields[0].required, true, "the library approval statement is required");
  dialog.props.onConfirm({ attestation: "Checked passage and keys.", note: "" });
  await settle(view.render);
  assert.deepEqual(plain(view.calls), [["status", "p1", "v2", "approve", { attestation: "Checked passage and keys.", note: "" }]]);

  view = mount({ package: pkg(), versions: [version("v2", "2.0", { status: "approved", ...fresh }), version("v1", "1.0")] }, { answers: [false, true] });
  button(bar(view.render()), /^Publish Version$/).props.onClick();
  await settle(view.render);
  assert.equal(view.calls.length, 0, "declined");
  assert.match(view.asked[0], /Publish version 2\.0 in the library\? Version 1\.0 becomes Retired\. Learners can take it only when it also has a recorded educator endorsement/);
  button(bar(view.render()), /^Publish Version$/).props.onClick();
  await settle(view.render);
  assert.deepEqual(plain(view.calls), [["status", "p1", "v2", "publish", null]]);
});

test("educator review: endorsement needs all four checks and reviewer details; recorded through the existing API", async () => {
  const view = mount({ package: pkg(), versions: [version("v1", "1.0", { educatorEndorsed: false, educatorReviews: [] })] });
  let tree = view.render();
  assert.match(textOf(tree), /Not offered to learners yet: needs a recorded educator endorsement/);
  button(bar(tree), /^Record Educator Review$/).props.onClick();
  tree = view.render();
  const dialog = findAll(tree, (n) => n.type?.name === "EducatorReviewDialog")[0];
  assert.ok(dialog);
  dialog.props.onSave({ reviewerName: "Mr. Cruz", reviewerQualification: "Reading coordinator", reviewedOn: "2026-11-20", passageSuitable: true,
    questionsSound: true, answerKeysCorrect: true, languageAccurate: true, outcome: "endorsed", notes: "" });
  await settle(view.render);
  assert.equal(view.calls[0][0], "review");
  assert.equal(view.calls[0][2], "v1");
  assert.match(src("modules/module2/components/ReassessmentPackageEditor.tsx"), /form\.outcome === "changes_requested" \|\| allChecks/, "an endorsement needs all four checks");
});

test("preview: the exact selected version, drafts included, passage first then one question at a time; nothing is sent", async () => {
  const view = mount({ package: pkg(), versions: [version("v2", "2.0", { status: "draft", ...fresh, content: { ...STORY, passageTitle: "Draft story" } }), version("v1", "1.0")] });
  button(bar(view.render()), /^Preview$/).props.onClick();
  let d = findAll(view.render(), (n) => n.type === "AssessmentPreviewDialog")[0];
  assert.deepEqual([d.props.start, d.props.content.passageTitle, d.props.language], ["passage", "Draft story", "en"]);
  button(view.render(), /^Preview Questions$/).props.onClick();
  d = findAll(view.render(), (n) => n.type === "AssessmentPreviewDialog")[0];
  assert.equal(d.props.start, "questions");
  await select(view, "v1");
  button(bar(view.render()), /^Preview$/).props.onClick();
  assert.equal(findAll(view.render(), (n) => n.type === "AssessmentPreviewDialog")[0].props.content.passageTitle, "The Lost Kite (IL EN 1.0)");
  assert.deepEqual(view.calls, []);
});

test("Open Existing Draft is navigation; clean-up actions (Return for Changes, Retire, Archive, Delete Draft) are outside the bar", async () => {
  let view = mount({ package: pkg(), versions: [version("v2", "2.0", { status: "draft", ...fresh }), version("v1", "1.0")] });
  await select(view, "v1");
  let tree = view.render();
  assert.equal(isOff(button(bar(tree), /^Edit Draft$/)), true);
  button(tree, /^Open Existing Draft 2\.0$/).props.onClick();
  await settle(view.render);
  assert.match(textOf(bar(view.render())), /Selected: Version 2\.0 · Draft/);
  const zone = findAll(view.render(), (n) => n.props?.className === "m2-id-danger-zone")[0];
  assert.ok(button(zone, /^Delete Draft$/) && button(zone, /^Archive Package$/));
  for (const label of [/Delete Draft/, /Archive Package/, /Retire/, /Return for Changes/]) assert.equal(button(bar(view.render()), label), undefined);

  view = mount({ package: pkg(), versions: [version("v2", "2.0", { status: "in_review", ...fresh }), version("v1", "1.0")] });
  button(view.render(), /^Return for Changes$/).props.onClick();
  const dialog = findAll(view.render(), (n) => n.type?.name === "NoteDialog")[0];
  assert.equal(dialog.props.fields[0].required, true, "a note is required");
  dialog.props.onConfirm({ note: "Fix question 3." });
  await settle(view.render);
  assert.deepEqual(plain(view.calls), [["status", "p1", "v2", "return", { note: "Fix question 3." }]]);
});

test("archived packages are read-only: every changing action is greyed out; preview still works", () => {
  const tree = mount({ package: pkg({ archived: true }), versions: [version("v1", "1.0")] }).render();
  const s = slots(tree);
  for (const key of ["create", "edit", "submit", "approve", "publish", "review"]) assert.equal(s[key][1], false, key);
  assert.equal(s.preview[1], true);
  assert.equal(findAll(tree, (n) => n.props?.className === "m2-id-danger-zone").length, 0);
});
