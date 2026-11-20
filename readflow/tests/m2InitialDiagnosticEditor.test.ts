import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";

// M2 F6 + F7: the System Admin's Initial Diagnostic editor (three tabs, one action bar, previews, Publish Version,
// activation, Try Assessment). Synthetic data only; services are stubbed, so nothing is sent anywhere.
const require = createRequire(import.meta.url);
const path = (p: string) => new URL(`../src/${p}`, import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

const question = (n: number, type: string) => ({ id: `q${n}`, type, prompt: `Question ${n}?`, correctChoiceId: "a",
  choices: ["a", "b", "c", "d"].map((id) => ({ id, label: `Choice ${id}${n}` })) });
const SIX = [question(1, "literal"), question(2, "literal"), question(3, "inferential"), question(4, "inferential"), question(5, "critical"), question(6, "critical")];
const STORY = { passageTitle: "The Lost Kite", paragraphs: [Array.from({ length: 30 }, (_, i) => `word${i}`).join(" "), "Second paragraph."], questions: SIX };
const version = (id: string, label: string, extra: Record<string, unknown> = {}) => ({
  id, versionNumber: Number(label[0]), versionLabel: label, status: "published", source: "authored", createdAt: "2026-11-20T00:00:00Z",
  submittedAt: null, reviewedAt: null, publishedAt: null, retiredAt: null, basedOnVersionId: null, content: STORY, contentSha256: null,
  issues: [], reviewNote: null, educatorReviewAttestation: null, createdBy: "Sam", submittedBy: null, reviewedBy: null, publishedBy: null,
  retiredBy: null, stageLabel: "", activeForLearners: false, activationNote: "", educatorEndorsed: false, educatorReviews: [], ...extra,
});
const pkg = (extra: Record<string, unknown> = {}) => ({
  id: "p1", category: "initial", language: "en", title: "Initial Diagnostic — English", archived: false, createdAt: "", updatedAt: "",
  publishedVersion: "4.0", activeVersion: "3.0", latestVersion: null, versionCount: 3,
  permissions: { view: true, manage: true, review: true, publish: true },
  activation: { available: true, canManage: true, activeVersionId: null }, ...extra,
});
// The local English set: active built-in 3.0 (retired in the library), published 4.0, draft 5.0.
const builtIn = (extra: Record<string, unknown> = {}) => version("v3", "3.0", { status: "retired", source: "code_import", activeForLearners: true, ...extra });
const v4 = (extra: Record<string, unknown> = {}) => version("v4", "4.0", extra);
const v5 = (extra: Record<string, unknown> = {}) => version("v5", "5.0", { status: "draft", ...extra });

function mount(detail: any, { answers = [] as boolean[] } = {}) {
  const runtime = createHookRuntime(require("react"));
  const calls: unknown[][] = [];
  const asked: string[] = [];
  let current = detail;
  const respond = (name: string) => async (...args: unknown[]) => { calls.push([name, ...args]); await tick(); return current; };
  const mod = loadComponentModule(new URL("../src/modules/module2/components/InitialDiagnosticEditor.tsx", import.meta.url), (id) => {
    if (id.endsWith("/utils/initialDiagnosticLabels")) return require(new URL("../src/modules/module2/utils/initialDiagnosticLabels.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id === "react-router-dom") return { Link: "Link" };
    if (id === "lucide-react") return { ArrowLeft: "ArrowLeft" };
    if (id.endsWith("/AssessmentPreviewDialog")) return { default: "AssessmentPreviewDialog" };
    if (id.includes("ReadFlowDialog")) return { confirmReadFlow: async (message: string) => { asked.push(message); return answers.shift() ?? true; } };
    if (id.endsWith("/hooks/useAssessmentLeaveGuard")) return { useAssessmentLeaveGuard: () => {} };
    if (id.endsWith("/services/assessmentEditor")) return require(path("modules/module2/services/assessmentEditor.ts"));
    if (id.endsWith("/services/assessmentPackages")) {
      const actual = loadComponentModule(new URL("../src/modules/module2/services/assessmentPackages.ts", import.meta.url), (inner) => {
        if (inner === "axios") return { default: { isAxiosError: () => false } };
        if (inner.endsWith("/services/api")) return { default: {} };
        if (inner.endsWith("/services/authHeaders")) return { getSessionAuthHeaders: async () => ({}) };
        return require(inner.endsWith("/data/diagnosticData") ? path("modules/module2/data/diagnosticData.ts") : inner);
      });
      return { ...actual, createPackageVersion: respond("create"), savePackageDraft: respond("save"), deletePackageDraft: respond("delete"),
        changeVersionStatus: respond("status"), activateInitialVersion: respond("activate"), returnToBuiltInInitial: respond("builtin") };
    }
    return require(id);
  });
  const render = () => runtime.render(mod.default, { detail: current, siblings: [{ id: "p1", language: "en", archived: false }, { id: "p2", language: "fil", archived: false }],
    onDetail: (next: any) => { current = next; } });
  return { render, calls, asked, mod, set: (next: any) => { current = next; } };
}
const buttons = (tree: any) => findAll(tree, (n) => n.type === "button");
const button = (tree: any, label: RegExp) => buttons(tree).find((b) => label.test(textOf(b)));
const bar = (tree: any) => findAll(tree, (n) => n.props?.className === "m2-id-bar")[0];
const settle = async (render: () => unknown) => { for (let i = 0; i < 5; i++) { await tick(); render(); } };
// Switching versions first checks for unsaved changes (async), so wait for the re-render.
const select = async (view: ReturnType<typeof mount>, id: string) => {
  findAll(view.render(), (n) => n.type === "select" && n.props.value !== undefined && n.props.onChange && n.props.disabled !== undefined)[0]
    .props.onChange({ target: { value: id } });
  await settle(view.render);
};
const describedBy = (tree: any, b: any) => textOf(findAll(tree, (n) => n.props?.id === b.props["aria-describedby"])[0] ?? "");

test("three tabs only; no educator-review, submit-for-review or policy text in the Initial Diagnostic editor", () => {
  const tree = mount({ package: pkg(), versions: [v4(), builtIn()] }).render();
  assert.deepEqual(findAll(tree, (n) => n.props?.role === "tab").map((t) => textOf(t)), ["Overview and Versions", "Reading Passage", "Comprehension Questions"]);
  assert.equal(findAll(tree, (n) => n.props?.role === "tabpanel").length, 3);
  for (const gone of [/Educator Review/, /Submit for Review/, /Preview and Publishing/, /Publish to Library/, /Reassessment delivery remains/, /review history/i, /Content fingerprint/]) {
    assert.doesNotMatch(textOf(tree), gone);
  }
  assert.doesNotMatch(src("modules/module2/components/InitialDiagnosticEditor.tsx"), /recordEducatorReview|EducatorReviews/, "no educator review form is offered here");
});

test("the action bar is outside the tab panels (visible on every tab) and separates the selected version from the learners' version", async () => {
  const view = mount({ package: pkg(), versions: [v5(), v4(), builtIn()] });
  const tree = view.render();
  const panels = findAll(tree, (n) => n.props?.role === "tabpanel");
  assert.equal(findAll(tree, (n) => n.props?.className === "m2-id-bar").length, 1);
  assert.ok(panels.every((p) => findAll(p, (n) => n.props?.className === "m2-id-bar").length === 0), "not inside any one tab");
  const text = textOf(bar(tree));
  assert.match(text, /Selected: Version 5\.0 · Draft/);
  assert.match(text, /Active: Version 3\.0/);
  await select(view, "v3");
  assert.match(textOf(bar(view.render())), /Selected: Version 3\.0 · Retired · Active.*Active Version/s);
});

test("one back link to the Initial Diagnostic list, with a single arrow icon; language switch opens the matching package", () => {
  const tree = mount({ package: pkg(), versions: [v4(), builtIn()] }).render();
  const back = findAll(tree, (n) => n.type === "Link" && n.props.className === "m3-back-link");
  assert.equal(back.length, 1);
  assert.equal(back[0].props.to, "/system-admin/assessment/initial");
  assert.equal(findAll(back[0], (n) => n.type === "ArrowLeft").length, 1);
  assert.doesNotMatch(textOf(back[0]), /←/, "no second, text arrow");
  const nav = findAll(tree, (n) => n.type === "nav" && n.props.className === "m2-language-tabs")[0];
  assert.deepEqual(findAll(nav, (n) => n.type === "Link").map((l) => [textOf(l), l.props.to, l.props["aria-current"] ?? null]),
    [["English", "/system-admin/assessment-packages/p1", "page"], ["Filipino", "/system-admin/assessment-packages/p2", null]]);
});

test("Draft 5.0: Edit/Save Draft, Preview and Publish Version in the bar; no Activate or functional Try Assessment", () => {
  const view = mount({ package: pkg(), versions: [v5(), v4(), builtIn()] });
  let actions = bar(view.render());
  assert.ok(button(actions, /^Edit Draft$/));
  assert.ok(button(actions, /^Preview$/));
  assert.equal(button(actions, /^Publish Version$/).props.disabled, false, "a complete, saved draft can be published");
  assert.equal(button(actions, /Activate for Learners/), undefined, "drafts are published first");
  assert.equal(button(actions, /Try Assessment/), undefined);
  assert.equal(findAll(actions, (n) => n.type === "Link").length, 0);
});

test("Published 4.0 (inactive): Activate for Learners for THIS version, real reason when blocked; Try Assessment opens 4.0 itself", async () => {
  // No educator endorsement is needed: a published 4.0 the server marks eligible is enabled, endorsed or not.
  let view = mount({ package: pkg(), versions: [v5(), v4({ canActivate: true, educatorEndorsed: false }), builtIn()] }, { answers: [false, true] });
  await select(view, "v4");
  let tree = view.render();
  let actions = bar(tree);
  assert.equal(button(actions, /^Activate for Learners$/).props.disabled, false);
  assert.doesNotMatch(textOf(tree), /endorsement/i, "no endorsement warning anywhere on the page");
  const link = findAll(actions, (n) => n.type === "Link" && textOf(n) === "Try Assessment")[0];
  assert.equal(link.props.to, "/practice/diagnostic/version/v4/en/reading", "practises 4.0, never the built-in 3.0");
  assert.deepEqual(plain(link.props.state), { practiceExitTo: "/system-admin/assessment-packages/p1" });
  assert.ok(button(actions, /^Edit Draft 5\.0$/), "edits go to the existing draft, never to 4.0");
  assert.equal(button(actions, /^Publish Version$/), undefined);
  assert.equal(button(actions, /Return Learners|Already Active/), undefined);
  button(actions, /^Activate for Learners$/).props.onClick();
  await settle(view.render);
  assert.equal(view.calls.length, 0, "declined in the confirmation dialog");
  assert.match(view.asked[0], /^Activate English version 4\.0 for new learners\? It replaces the active version 3\.0 for new English learners\./, "names the language and version");
  assert.match(view.asked[0], /not asked to retake it.*up to 24 hours/s);
  button(bar(view.render()), /^Activate for Learners$/).props.onClick();
  await settle(view.render);
  assert.deepEqual(plain(view.calls), [["activate", "p1", "v4", null]]);

  // When activation really is blocked, the actual reason is shown beside the visible, disabled button.
  view = mount({ package: pkg({ activation: { available: false, canManage: true, activeVersionId: null } }), versions: [v5(), v4({ canActivate: false }), builtIn()] });
  await select(view, "v4");
  tree = view.render();
  const blocked = button(bar(tree), /^Activate for Learners$/);
  assert.equal(blocked.props.disabled, true);
  assert.equal(describedBy(tree, blocked), "Activation is not installed in this database.");
});

test("built-in 3.0 that learners take: Already Active (not an activation or restore button); Try Assessment opens the built-in practice", async () => {
  const view = mount({ package: pkg(), versions: [v5(), v4(), builtIn()] });
  await select(view, "v3");
  const tree = view.render();
  const actions = bar(tree);
  const active = button(actions, /^Already Active$/);
  assert.equal(active.props.disabled, true);
  assert.equal(describedBy(tree, active), "This is the active version for new English learners.");
  assert.equal(button(actions, /Activate for Learners|Return Learners/), undefined);
  const link = findAll(actions, (n) => n.type === "Link" && textOf(n) === "Try Assessment")[0];
  assert.equal(link.props.to, "/practice/diagnostic/en/reading");
});

test("Filipino 4.0 active: selecting 3.0 offers Activate for Learners (restores the built-in, confirmed); selecting 4.0 shows Already Active", async () => {
  const filPkg = pkg({ language: "fil", activeVersion: "4.0", activation: { available: true, canManage: true, activeVersionId: "v4" } });
  const view = mount({ package: filPkg, versions: [v4({ activeForLearners: true }), builtIn({ activeForLearners: false })] }, { answers: [false, true] });
  let tree = view.render();
  let actions = bar(tree);
  assert.match(textOf(actions), /Selected: Version 4\.0 · Published · Active.*Active Version/s);
  assert.equal(button(actions, /^Already Active$/).props.disabled, true);
  assert.equal(button(actions, /Activate for Learners|Return Learners/), undefined, "no unrelated restore button on 4.0");
  await select(view, "v3");
  tree = view.render();
  actions = bar(tree);
  assert.match(textOf(actions), /Selected: Version 3\.0 · Retired(?! · Active).*Active: Version 4\.0/s);
  const activate = button(actions, /^Activate for Learners$/);
  assert.equal(activate.props.disabled, false, "3.0 is activated from 3.0 itself");
  activate.props.onClick();
  await settle(view.render);
  assert.equal(view.calls.length, 0, "declined");
  assert.match(view.asked[0], /^Activate Filipino version 3\.0 \(built-in\) for new learners\? It replaces the active version 4\.0 for new Filipino learners\./);
  button(bar(view.render()), /^Activate for Learners$/).props.onClick();
  await settle(view.render);
  assert.deepEqual(plain(view.calls), [["builtin", "p1", "v4"]], "the existing, authorised return-to-built-in action with the expected active version");
});

test("retired authored versions and drafts are never activatable; drafts and retired versions are not practised", async () => {
  const view = mount({ package: pkg(), versions: [v5(), version("v41", "4.1"), v4({ status: "retired" }), builtIn()] });
  await select(view, "v4");
  let tree = view.render();
  const retired = button(bar(tree), /^Activate for Learners$/);
  assert.equal(retired.props.disabled, true);
  assert.equal(describedBy(tree, retired), "Only the published version can be activated.");
  const tryRetired = button(bar(tree), /^Try Assessment$/);
  assert.equal(tryRetired.props.disabled, true);
  assert.equal(describedBy(tree, tryRetired), "Retired versions cannot be practised.");
  await select(view, "v5");
  tree = view.render();
  assert.equal(button(bar(tree), /Activate for Learners|Already Active/), undefined, "drafts cannot be activated");
  assert.equal(findAll(bar(tree), (n) => n.type === "Link").length, 0, "drafts are preview-only");
  const { tryAssessment } = view.mod;
  assert.deepEqual(plain(tryAssessment(pkg(), version("vr", "4.2", { status: "in_review" }))), { reason: "Publish this version to try it. Drafts can be previewed only." });
  assert.deepEqual(plain(tryAssessment(pkg(), version("va", "4.3", { status: "retired", activeForLearners: true }))), { to: "/practice/diagnostic/version/va/en/reading" },
    "the authored version learners take stays practisable");
});

test("missing requirements are listed, never a silent failure; unsaved changes cannot be published", async () => {
  const incomplete = v5({ issues: ["Add exactly 6 comprehension questions."], content: { ...STORY, questions: SIX.slice(0, 4) } });
  let view = mount({ package: pkg(), versions: [incomplete, v4(), builtIn()] });
  let tree = view.render();
  let publish = button(bar(tree), /^Publish Version$/);
  assert.equal(publish.props.disabled, true);
  assert.match(describedBy(tree, publish), /requirements missing/);
  assert.match(textOf(tree), /Before publishing version 5\.0:.*Add exactly 6 comprehension questions\./s, "the database's own rule is shown");
  button(bar(tree), /What's missing\?/).props.onClick();
  assert.match(textOf(bar(view.render())), /Before publishing version 5\.0:.*Include 5–8 comprehension questions\./s, "the list opens in the bar");

  view = mount({ package: pkg(), versions: [v5(), v4(), builtIn()] });
  button(bar(view.render()), /^Edit Draft$/).props.onClick();
  await settle(view.render);
  findAll(view.render(), (n) => n.type === "textarea")[0].props.onChange({ target: { value: `${STORY.paragraphs[0]}\n\nChanged.` } });
  tree = view.render();
  publish = button(bar(tree), /^Publish Version$/);
  assert.equal(publish.props.disabled, true);
  assert.equal(describedBy(tree, publish), "Save your changes before publishing.");
  assert.match(textOf(bar(tree)), /Unsaved changes/);
  assert.equal(button(bar(tree), /^Save Draft$/).props.disabled, false);
});

test("Publish Version: one confirmation for the whole version, the System Admin's own note, steps in order, no double submission", async () => {
  const view = mount({ package: pkg(), versions: [v5(), v4(), builtIn()] });
  button(bar(view.render()), /^Publish Version$/).props.onClick();
  let tree = view.render();
  let dialog = findAll(tree, (n) => n.type?.name === "PublishDialog")[0];
  assert.ok(dialog, "a confirmation dialog opens");
  assert.equal(dialog.props.questionCount, 6, "the passage and all its questions are published together");
  assert.equal(dialog.props.replaces, "4.0");
  dialog.props.onConfirm();
  await tick();
  assert.equal(view.calls.length, 0, "nothing happens without the System Admin's note");
  dialog.props.onStatement("Checked the passage, questions and answer keys.");
  dialog = findAll(view.render(), (n) => n.type?.name === "PublishDialog")[0];
  dialog.props.onConfirm();
  dialog.props.onConfirm(); // a double click
  await settle(view.render);
  assert.deepEqual(plain(view.calls), [
    ["status", "p1", "v5", "submit"],
    ["status", "p1", "v5", "approve", { attestation: "Checked the passage, questions and answer keys." }],
    ["status", "p1", "v5", "publish"],
  ]);
  assert.equal(view.calls.some((c) => c[0] === "activate"), false, "publishing never activates");
  assert.match(src("modules/module2/components/InitialDiagnosticEditor.tsx"), /Publish Version \{version\.versionLabel\}\?/);
});

test("published version: Create New Version copies the SELECTED version; nothing is edited in place", async () => {
  const view = mount({ package: pkg(), versions: [v4(), builtIn()] });
  const tree = view.render();
  assert.equal(button(tree, /^Edit Draft/), undefined, "a published version has no edit action");
  assert.equal(findAll(tree, (n) => n.type === "textarea" || n.type === "input").length, 0, "nothing is editable");
  button(bar(tree), /^Create New Version$/).props.onClick();
  await tick();
  assert.deepEqual(plain(view.calls[0]), ["create", "p1", { basedOnVersionId: "v4" }]);
});

test("draft: Edit Draft opens the passage and question editors; Save Draft sends the edited content", async () => {
  const view = mount({ package: pkg(), versions: [v5(), v4(), builtIn()] });
  let tree = view.render();
  assert.equal(findAll(tree, (n) => n.type === "textarea").length, 0, "read-only until Edit Draft");
  button(bar(tree), /^Edit Draft$/).props.onClick();
  await settle(view.render);
  tree = view.render();
  const story = findAll(tree, (n) => n.type === "textarea")[0];
  assert.equal(story.props.value, `${STORY.paragraphs[0]}\n\n${STORY.paragraphs[1]}`, "one box with the whole story, paragraphs kept");
  story.props.onChange({ target: { value: `${STORY.paragraphs[0]}\n\nA new ending.` } });
  tree = view.render();
  assert.equal(findAll(tree, (n) => n.type === "fieldset").length, 1 + SIX.length, "passage + one card per question");
  button(tree, /\+ Add Question/).props.onClick();
  tree = view.render();
  assert.equal(findAll(tree, (n) => n.type === "details").length, 7);
  button(bar(tree), /^Save Draft$/).props.onClick();
  await tick();
  const [name, packageId, versionId, content] = view.calls[0] as [string, string, string, any];
  assert.deepEqual([name, packageId, versionId], ["save", "p1", "v5"]);
  assert.deepEqual(plain(content.paragraphs), [STORY.paragraphs[0], "A new ending."]);
  assert.equal(content.questions.length, 7);
});

test("previews open in a dialog with the selected version's content; nothing is saved", () => {
  const view = mount({ package: pkg(), versions: [v4(), builtIn()] });
  button(view.render(), /^Preview Questions$/).props.onClick();
  let dialog = findAll(view.render(), (n) => n.type === "AssessmentPreviewDialog")[0];
  assert.equal(dialog.props.start, "questions");
  assert.equal(dialog.props.content.questions.length, 6);
  button(bar(view.render()), /^Preview$/).props.onClick();
  dialog = findAll(view.render(), (n) => n.type === "AssessmentPreviewDialog")[0];
  assert.equal(dialog.props.start, "passage");
  assert.equal(view.calls.length, 0);
});

test("preview dialog: the learner's screens, one question at a time with Previous / Next / Close", () => {
  const runtime = createHookRuntime(require("react"));
  const mod = loadComponentModule(new URL("../src/modules/module2/components/AssessmentPreviewDialog.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id === "lucide-react") return { X: "X" };
    if (id.endsWith("/utils/diagnosticCopy")) return require(path("modules/module2/utils/diagnosticCopy.ts"));
    return require(id);
  });
  let closed = 0;
  const props = { content: STORY, language: "fil", start: "passage", onClose: () => { closed += 1; } };
  let tree = runtime.render(mod.default, props);
  assert.equal(findAll(tree, (n) => n.type === "dialog").length, 1);
  assert.match(textOf(tree), /Basahin nang Malakas ang Kuwento/, "Filipino learner wording");
  assert.match(textOf(tree), /The Lost Kite/);
  assert.equal(findAll(tree, (n) => n.props?.className === "diagnostic-story-content").length, 1, "the learner's story styles");
  button(tree, /^Preview Questions$/).props.onClick();
  tree = runtime.render(mod.default, props);
  assert.match(textOf(tree), /Tanong 1 sa 6/);
  assert.equal(findAll(tree, (n) => n.props?.className === "diagnostic-question-card").length, 1, "one question at a time");
  findAll(tree, (n) => n.type === "input")[1].props.onChange();
  button(tree, /^Next$/).props.onClick();
  tree = runtime.render(mod.default, props);
  assert.match(textOf(tree), /Tanong 2 sa 6/);
  button(tree, /^Previous$/).props.onClick();
  tree = runtime.render(mod.default, props);
  assert.match(textOf(tree), /Tanong 1 sa 6/);
  assert.equal(findAll(tree, (n) => n.type === "input" && n.props.checked).length, 1, "the choice is kept while previewing");
  button(tree, /Close/).props.onClick();
  assert.equal(closed, 1);
  // Type-only imports are erased at build time; any runtime import of a service would be a request path.
  const source = src("modules/module2/components/AssessmentPreviewDialog.tsx").split("\n").filter((l) => !l.startsWith("import type")).join("\n");
  assert.doesNotMatch(source, /services\/(api|assessmentPackages|diagnosticDatabase|diagnosticPractice)|fetch\(|axios/, "the preview never sends anything");
});

test("System Admin Assessment pages: no policy notice, standard back link", () => {
  const page = src("modules/module2/pages/AssessmentPackagesPage.tsx");
  assert.doesNotMatch(page, /Reassessment delivery remains subject to its existing policy/);
  assert.match(page, /role !== "system_admin" && <p className="m2-packages-notice"/);
  assert.match(page, /<Link className="m3-back-link" to=\{basePath\}><ArrowLeft size=\{17\} aria-hidden="true" \/> Back to Assessment<\/Link>/);
});
