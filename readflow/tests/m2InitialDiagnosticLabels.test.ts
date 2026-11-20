import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";

// M2 F6: assessment names, Published / Active wording and reading-passage limits (System Admin Initial Diagnostic).
const require = createRequire(import.meta.url);
const path = (p: string) => new URL(`../src/${p}`, import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const { passageStats, textToPassage, assessmentRequirements, PASSAGE_LIMITS } = require(path("modules/module2/services/assessmentEditor.ts"));
const labels = require(path("modules/module2/utils/initialDiagnosticLabels.ts"));
const words = (n: number, prefix = "w") => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");

test("limits are the existing ones (20–600 words, 10 paragraphs, 3,000 characters per paragraph)", () => {
  assert.deepEqual(plain(PASSAGE_LIMITS), { minWords: 20, maxWords: 600, maxParagraphs: 10, maxParagraphChars: 3000 });
});

test("word counter: short, valid and over-limit passages, with plain messages", () => {
  const short = passageStats([words(5)]);
  assert.deepEqual([short.words, short.wordState], [5, "below"]);
  assert.ok(short.issues.includes("The reading passage must contain at least 20 words."));
  const valid = passageStats([words(20), words(47)]);
  assert.deepEqual([valid.words, valid.paragraphs, valid.wordState, valid.issues], [67, 2, "ok", []]);
  const over = passageStats([words(601)]);
  assert.deepEqual([over.words, over.wordState], [601, "over"]);
  assert.ok(over.issues.includes("The reading passage cannot exceed 600 words."));
  assert.deepEqual(over.saveIssues, [], "a long draft can still be SAVED (only publishing needs 600 or fewer)");
});

test("pasted multiline stories: Windows line breaks, single line breaks and blank lines are counted correctly; nothing is cut", () => {
  const pasted = "Ana walked to the river.\r\nShe saw a fish.\r\n\r\nThe fish swam away\r\nunder the bridge.\r\n";
  const paragraphs = textToPassage(pasted);
  assert.deepEqual(plain(paragraphs), ["Ana walked to the river.\nShe saw a fish.", "The fish swam away\nunder the bridge."], "a single line break stays inside its paragraph");
  const stats = passageStats(paragraphs);
  assert.deepEqual([stats.words, stats.paragraphs], [16, 2]);
  const long = "x".repeat(3001);
  assert.equal(textToPassage(long)[0].length, 3001, "no truncation");
  const s = passageStats([long, words(25)]);
  assert.deepEqual(s.saveIssues, ["Paragraph 1 has 3,001 characters; a paragraph can have at most 3,000. Add a blank line to split it."]);
  const eleven = passageStats(Array.from({ length: 11 }, (_, i) => words(3, `p${i}`)));
  assert.deepEqual(eleven.saveIssues, ["The reading passage can have at most 10 paragraphs (now 11). Remove a blank line to join paragraphs."]);
  // The same messages appear in the publish checklist.
  const req = assessmentRequirements({ passageTitle: "T", paragraphs: [words(5)], questions: [] });
  assert.ok(req.includes("The reading passage must contain at least 20 words."));
});

test("display labels: one assessment name per language; Published and Active kept distinct", () => {
  assert.equal(labels.initialAssessmentName("en"), "Initial Diagnostic — English");
  assert.equal(labels.initialAssessmentName("fil"), "Initial Diagnostic — Filipino");
  assert.deepEqual(plain(labels.INITIAL_STATUS_LABELS), { draft: "Draft", in_review: "Submitted", approved: "Approved", published: "Published", retired: "Retired" });
  assert.equal(labels.versionStateLabel("published", false), "Published");
  assert.equal(labels.versionStateLabel("published", true), "Published · Active");
  assert.equal(labels.versionStateLabel("retired", true), "Retired · Active", "a retired version learners still take");
});

const STORY = { passageTitle: "Si Lito at ang Mais", paragraphs: [words(30)], questions: [] };
const version = (id: string, label: string, extra: Record<string, unknown> = {}) => ({
  id, versionNumber: Number(label[0]), versionLabel: label, status: "published", source: "authored", createdAt: "2026-11-20T00:00:00Z",
  submittedAt: null, reviewedAt: null, publishedAt: null, retiredAt: null, basedOnVersionId: null, content: STORY, contentSha256: null,
  issues: [], reviewNote: null, educatorReviewAttestation: null, createdBy: "Sam", submittedBy: null, reviewedBy: null, publishedBy: null,
  retiredBy: null, stageLabel: "", activeForLearners: false, activationNote: "", educatorEndorsed: false, educatorReviews: [], ...extra,
});
const filPkg = { id: "p2", category: "initial", language: "fil", title: "Si Lito at ang Mais", archived: false, createdAt: "", updatedAt: "",
  publishedVersion: "4.0", activeVersion: "4.0", latestVersion: null, versionCount: 3, permissions: { view: true, manage: true, review: true, publish: true },
  activation: { available: true, canManage: true, activeVersionId: "v4" } };

function mountEditor(detail: unknown) {
  const runtime = createHookRuntime(require("react"));
  let current = detail as any;
  const mod = loadComponentModule(new URL("../src/modules/module2/components/InitialDiagnosticEditor.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id === "react-router-dom") return { Link: "Link" };
    if (id === "lucide-react") return { ArrowLeft: "ArrowLeft" };
    if (id.endsWith("/AssessmentPreviewDialog")) return { default: "AssessmentPreviewDialog" };
    if (id.includes("ReadFlowDialog")) return { confirmReadFlow: async () => true };
    if (id.endsWith("/hooks/useAssessmentLeaveGuard")) return { useAssessmentLeaveGuard: () => {} };
    if (id.endsWith("/services/assessmentEditor")) return require(path("modules/module2/services/assessmentEditor.ts"));
    if (id.endsWith("/utils/initialDiagnosticLabels")) return labels;
    if (id.endsWith("/services/assessmentPackages")) {
      return loadComponentModule(new URL("../src/modules/module2/services/assessmentPackages.ts", import.meta.url), (inner) => {
        if (inner === "axios") return { default: { isAxiosError: () => false } };
        if (inner.endsWith("/services/api")) return { default: {} };
        if (inner.endsWith("/services/authHeaders")) return { getSessionAuthHeaders: async () => ({}) };
        return require(inner.endsWith("/data/diagnosticData") ? path("modules/module2/data/diagnosticData.ts") : inner);
      });
    }
    return require(id);
  });
  return () => runtime.render(mod.default, { detail: current, siblings: [], onDetail: (next: unknown) => { current = next; } });
}

test("Filipino page: assessment name, version and passage title shown separately; Published and Active both visible", () => {
  const render = mountEditor({ package: filPkg, versions: [version("v4", "4.0", { activeForLearners: true }), version("v3", "3.0", { status: "retired", source: "code_import" })] });
  const tree = render();
  const text = textOf(tree);
  assert.equal(textOf(findAll(tree, (n) => n.type === "h1")[0]), "Initial Diagnostic — Filipino", "never the passage title as the assessment name");
  assert.match(text, /AssessmentInitial Diagnostic — Filipino/);
  assert.match(text, /Passage titleSi Lito at ang Mais/);
  assert.match(text, /Active versionVersion 4\.0.*Published versionVersion 4\.0/s);
  assert.match(text, /Version 4\.0 — Published · Active/, "the version selector shows both meanings");
  assert.match(text, /Selected: Version 4\.0 · Published · Active/);
  assert.doesNotMatch(text, /Published in library|Publish to Library|Learners take|Active for Learners(?! )/, "old wording is gone");
  const rows = findAll(tree, (n) => n.type === "tr").slice(1).map((r) => textOf(r));
  assert.deepEqual(rows.map((r) => r.replace(/\d+\/\d+\/\d+/, "")), ["4.0Si Lito at ang MaisPublishedActiveSelected", "3.0Si Lito at ang MaisRetiredSelect"]);
});

test("draft editor: limits shown before typing, a live counter, and Save Draft held back only for limits the server refuses", async () => {
  const draft = version("v5", "5.0", { status: "draft", content: { passageTitle: "Kite", paragraphs: [words(10)], questions: [] } });
  const render = mountEditor({ package: { ...filPkg, activation: { available: true, canManage: true, activeVersionId: null }, activeVersion: "3.0" }, versions: [draft] });
  let tree = render();
  findAll(tree, (n) => n.type === "button" && textOf(n) === "Edit Draft")[0].props.onClick();
  for (let i = 0; i < 3; i++) { await tick(); render(); }
  tree = render();
  assert.match(textOf(tree), /Allowed length: 20–600 words · up to 10 paragraphs\s*· up to 3,000 characters per paragraph/);
  const counter = () => findAll(render(), (n) => n.props?.id === "m2-id-story-count")[0];
  assert.match(textOf(counter()), /10 \/ 600 words.*Below the minimum of 20 words.*1 \/ 10 paragraphs/s);
  assert.equal(counter().props["data-state"], "below");
  const story = () => findAll(render(), (n) => n.type === "textarea")[0];
  story().props.onChange({ target: { value: `${words(40)}\n\n${words(27)}` } });
  assert.match(textOf(counter()), /67 \/ 600 words.*Within the accepted range.*2 \/ 10 paragraphs/s);
  // 650 words in 3 paragraphs (each under 3,000 characters), so only the word maximum is exceeded.
  story().props.onChange({ target: { value: [words(220, "a"), words(220, "b"), words(210, "c")].join("\n\n") } });
  assert.match(textOf(counter()), /650 \/ 600 words.*Over the maximum of 600 words/s);
  tree = render();
  assert.match(textOf(tree), /The reading passage cannot exceed 600 words\./);
  assert.equal(findAll(tree, (n) => n.type === "button" && textOf(n) === "Save Draft")[0].props.disabled, false, "an over-long draft can be saved and fixed later");
  assert.equal(story().props.value.trim().split(/\s+/).length, 650, "nothing is cut");
  story().props.onChange({ target: { value: Array.from({ length: 11 }, (_, i) => words(3, `p${i}`)).join("\n\n") } });
  tree = render();
  const save = findAll(tree, (n) => n.type === "button" && textOf(n) === "Save Draft")[0];
  assert.equal(save.props.disabled, true, "the server would refuse 11 paragraphs");
  assert.equal(textOf(findAll(tree, (n) => n.props?.id === save.props["aria-describedby"])[0]), "Fix the passage limits above before saving.");
  assert.match(textOf(tree), /can have at most 10 paragraphs \(now 11\)/);
});

test("Initial Diagnostic list: consistent assessment names (not passage titles) and Published / Active columns; Reassessment unchanged", async () => {
  const runtime = createHookRuntime(require("react"));
  const pkgs = [
    { ...filPkg, latestVersion: { id: "v4", versionNumber: 2, versionLabel: "4.0", status: "published", source: "authored", createdAt: "" } },
    { ...filPkg, id: "p1", language: "en", title: "Initial Diagnostic — English", publishedVersion: "4.0", activeVersion: "3.0",
      latestVersion: { id: "v5", versionNumber: 3, versionLabel: "5.0", status: "draft", source: "authored", createdAt: "" } },
    { ...filPkg, id: "p3", category: "independent", language: "en", title: "Central IL Reassessment — EN", activeVersion: null,
      latestVersion: { id: "r1", versionNumber: 1, versionLabel: "1.0", status: "published", source: "authored", createdAt: "" } },
  ];
  const mod = loadComponentModule(new URL("../src/modules/module2/pages/AssessmentPackagesPage.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith(".css")) return {};
    if (id === "lucide-react") return { ArrowLeft: "ArrowLeft" };
    if (id.endsWith("/hooks/useAssessmentLeaveGuard")) return { useAssessmentLeaveGuard: () => {} };
    if (id.endsWith("/utils/initialDiagnosticLabels")) return labels;
    if (id === "react-router-dom") return { Link: "Link", useNavigate: () => () => {} };
    if (id.endsWith("/services/assessmentPackages")) {
      const actual = loadComponentModule(new URL("../src/modules/module2/services/assessmentPackages.ts", import.meta.url), (inner) => {
        if (inner === "axios") return { default: { isAxiosError: () => false } };
        if (inner.endsWith("/services/api")) return { default: {} };
        if (inner.endsWith("/services/authHeaders")) return { getSessionAuthHeaders: async () => ({}) };
        return require(inner.endsWith("/data/diagnosticData") ? path("modules/module2/data/diagnosticData.ts") : inner);
      });
      return { ...actual, listAssessmentPackages: async () => ({ packages: pkgs, capabilities: { create: ["independent"], importInitial: [] } }) };
    }
    return require(id);
  });
  const show = async (section: string) => {
    runtime.render(mod.default, { role: "system_admin", section });
    for (let i = 0; i < 4; i++) { await tick(); runtime.render(mod.default, { role: "system_admin", section }); }
    return runtime.render(mod.default, { role: "system_admin", section });
  };
  // The runtime renders one level: expand the (hook-free) table component.
  const table = (t: any) => { const el = findAll(t, (n) => n.type?.name === "PackageTable")[0]; return el.type(el.props); };
  let tree = await show("initial");
  let rendered = table(tree);
  const headers = findAll(rendered, (n) => n.type === "th").map((h) => textOf(h));
  assert.deepEqual(headers, ["Assessment", "Language", "Published version", "Active version", "Latest version", "Action"]);
  const rows = findAll(rendered, (n) => n.type === "tr").slice(1).map((r) => textOf(r));
  assert.deepEqual(rows, [
    "Initial Diagnostic — FilipinoFilipinoVersion 4.0Version 4.0Version 4.0 PublishedOpen / Manage",
    "Initial Diagnostic — EnglishEnglishVersion 4.0Version 3.0Version 5.0 DraftOpen / Manage",
  ]);
  assert.doesNotMatch(textOf(rendered), /Si Lito at ang Mais|Published in library/);
  tree = await show("independent");
  rendered = table(tree);
  assert.ok(findAll(rendered, (n) => n.type === "th").map((h) => textOf(h)).includes("Published in library"), "Reassessment (F10) wording is unchanged");
  assert.match(textOf(rendered), /Central IL Reassessment — EN/);
});
