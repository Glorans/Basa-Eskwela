// F7 Review Saved Oral Reading Assessment: Reading History cards and the saved-assessment modal.
// No network, no speech service: every boundary is a stub.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as activityLanguage from "../src/pages/reading-activity/activityLanguage.ts";
import * as resultWords from "../src/modules/module5/services/resultWords.ts";
import * as pronunciationSummary from "../src/modules/module5/services/pronunciationSummary.ts";
import * as savedAttemptOrder from "../src/modules/module5/services/savedAttemptOrder.ts";
import { calculateOralReadingMetrics } from "../src/modules/module2/services/diagnosticScoring.ts";
import { toOralReadingWordMetrics } from "../src/modules/module5/services/oralReadingProcessing.ts";
import { createHookRuntime, loadComponentModule } from "./helpers/hookRuntime.ts";

const require = createRequire(import.meta.url);
const tick = () => new Promise((resolve) => setImmediate(resolve));
function find(tree: any, predicate: (node: any) => boolean): any {
  if (!tree || typeof tree !== "object") return;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) {
    const found = find(child, predicate); if (found) return found;
  }
}
function findAll(tree: any, predicate: (node: any) => boolean, found: any[] = []): any[] {
  if (!tree || typeof tree !== "object") return found;
  if (predicate(tree)) found.push(tree);
  for (const child of [tree.props?.children].flat(Infinity)) findAll(child, predicate, found);
  return found;
}
const text = (tree: unknown) => JSON.stringify(tree);

// --- Reading numbers --------------------------------------------------------

test("readings are numbered 1, 2, 3 per story in completion order, separately for each story", () => {
  const rows = [
    { id: "h3", moduleId: "m", passageId: "help", completedAt: "2026-11-05T03:00:00Z" },
    { id: "h1", moduleId: "m", passageId: "help", completedAt: "2026-11-03T03:00:00Z" },
    { id: "k1", moduleId: "m", passageId: "kite", completedAt: "2026-11-04T03:00:00Z" },
    { id: "h2", moduleId: "m", passageId: "help", completedAt: "2026-11-04T03:00:00Z" },
    { id: "a1", moduleId: "m", materialId: "mat", activityAssignmentId: "act", completedAt: "2026-11-02T03:00:00Z" },
    { id: "a2", moduleId: "m", materialId: "mat", activityAssignmentId: "act", completedAt: "2026-11-06T03:00:00Z" },
    { id: "b1", moduleId: "m", materialId: "mat", activityAssignmentId: "other", completedAt: "2026-11-06T04:00:00Z" },
  ];
  const numbers = savedAttemptOrder.numberHistoryReadings(rows);
  assert.deepEqual(Object.fromEntries(numbers), { h1: 1, h2: 2, h3: 3, k1: 1, a1: 1, a2: 2, b1: 1 });
});

// --- Reading History page ---------------------------------------------------

function historyPage(rows: unknown[], role = "student") {
  const runtime = createHookRuntime(require("react"));
  const page = loadComponentModule(new URL("../src/modules/module5/pages/ReadingHistoryPage.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith("/activityLanguage")) return activityLanguage;
    if (id.endsWith("/savedAttemptOrder")) return savedAttemptOrder;
    if (id.endsWith("/oralReadingService")) return { getOwnOralReadingAttempts: async () => rows };
    if (id.endsWith("/SavedAssessmentModal")) return { default: "saved-assessment-modal" };
    return require(id);
  });
  return { render: () => runtime.render(page.default, { role }) };
}

const HELPING = (id: string, completedAt: string, extra: Record<string, unknown> = {}) => ({
  id, moduleId: "m", passageId: "help", moduleTitle: "Grade 5 Stories", passageTitle: "A Helping Hand", language: "en",
  completedAt, pronunciationAccuracy: 98.65, readingSpeedWpm: 99, detectedErrorCount: 1, ...extra,
});

test("Reading History shows one clickable card per saved reading, newest first, with its real reading number", async () => {
  const page = historyPage([
    HELPING("first", "2026-11-04T01:22:36Z"),
    HELPING("third", "2026-11-04T20:36:06Z", { pronunciationCheck: { accuracy: 95, fluency: 97, complete: true, checkedAt: "x" } }),
    HELPING("second", "2026-11-04T03:08:15Z"),
  ]);
  page.render(); await tick();
  const tree = page.render();
  const cards = findAll(tree, (node) => node.type === "button" && node.props["aria-haspopup"] === "dialog");
  assert.equal(cards.length, 3);
  // Newest first, each with its real number: Reading 3, 2, 1.
  assert.deepEqual(cards.map((card) => Number(text(card).match(/" — ","Reading (\d)"/)?.[1])), [3, 2, 1]);
  assert.match(text(cards[0]), /"children":\["A Helping Hand",\{[^}]*"children":\[" — ","Reading 3"\]/);
  assert.match(text(cards[0]), /"Saved pronunciation check: ","95\/100"/);
  // No navigation buttons or links on the cards, and the URL never changes.
  assert.equal(findAll(tree, (node) => node.type === "a" || node.props?.to).length, 0);
  assert.doesNotMatch(text(tree), /View Result|View Transcript|Feedback & Recording|Questions & Results/);
  assert.equal(find(tree, (node) => node.type === "saved-assessment-modal"), undefined, "no modal until a card is chosen");
});

test("choosing a card opens only that reading's assessment; closing returns focus to the card", async () => {
  const page = historyPage([HELPING("first", "2026-11-04T01:22:36Z"), HELPING("second", "2026-11-04T03:08:15Z")]);
  page.render(); await tick();
  let tree = page.render();
  const focused: string[] = [];
  const cards = findAll(tree, (node) => node.type === "button" && node.props["aria-haspopup"] === "dialog");
  // Give each card a stand-in element, as React does through the ref callback.
  cards.forEach((card, index) => card.ref({ focus: () => focused.push(index === 0 ? "second" : "first") }));
  cards[1].props.onClick(); // the older reading, "Reading 1"
  tree = page.render();
  const modals = findAll(tree, (node) => node.type === "saved-assessment-modal");
  assert.equal(modals.length, 1, "only one assessment modal");
  assert.deepEqual([modals[0].props.summary.id, modals[0].props.readingNumber, modals[0].props.role], ["first", 1, "student"]);
  modals[0].props.onClose();
  tree = page.render();
  assert.equal(find(tree, (node) => node.type === "saved-assessment-modal"), undefined);
  assert.deepEqual(focused, ["first"], "focus goes back to the card that opened it");
});

test("a Filipino reading's card is in Filipino and never shows a pronunciation score", async () => {
  const page = historyPage([{ ...HELPING("fil", "2026-11-04T01:00:00Z"), language: "fil", passageTitle: "Ang Pusa" }]);
  page.render(); await tick();
  const card = find(page.render(), (node) => node.type === "button" && node.props["aria-haspopup"] === "dialog");
  assert.match(text(card), /"Pagbasa 1"/);
  assert.match(text(card), /Katumpakan ng pagbasa/);
  assert.doesNotMatch(text(card), /pagsusuri ng bigkas: |Saved pronunciation check/i);
});

// --- Saved assessment modal -------------------------------------------------

const STORY = "A Helping Hand\nEvery Saturday, Ben visited Mrs. Santos. Her hands were weak.";
const englishAttempt = (overrides: Record<string, unknown> = {}) => ({
  id: "third", userId: "ana", moduleId: "m", passageId: "help", moduleTitle: "Grade 5 Stories", passageTitle: "A Helping Hand",
  language: "en", passageSnapshot: STORY, transcript: "every saturday ben visited mrs sampsons her hands were weak",
  wordMetrics: toOralReadingWordMetrics(calculateOralReadingMetrics("Every Saturday, Ben visited Mrs. Santos. Her hands were weak.",
    "every saturday ben visited mrs sampsons her hands were weak")),
  expectedWordCount: 10, pronunciationAccuracy: 90, readingSpeedWpm: 99.4, durationSeconds: 6, detectedErrorCount: 1,
  completedAt: "2026-11-04T20:36:06Z", roomId: null, materialId: null, activityAssignmentId: null, assignmentId: null, ...overrides,
});
const checkState = (status: string, extra: Record<string, unknown> = {}) => {
  const calls: string[] = [];
  return { calls, state: { status, step: "loading", autoTried: false, check: () => calls.push("check"), autoCheck: () => calls.push("autoCheck"), reload() {}, ...extra } };
};

function modal(attempt: unknown, check: ReturnType<typeof checkState>, summaryOverrides: Record<string, unknown> = {}, role = "student") {
  const runtime = createHookRuntime(require("react"));
  const hookCalls: unknown[][] = [];
  const loads: unknown[][] = [];
  const component = loadComponentModule(new URL("../src/modules/module5/components/SavedAssessmentModal.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id === "react/jsx-runtime") return require("react/jsx-runtime");
    if (id.endsWith(".css")) return {};
    if (id === "lucide-react") return { Gauge: "gauge", MessageCircle: "message", Mic: "mic" };
    if (id.endsWith("/activityLanguage")) return activityLanguage;
    if (id.endsWith("/oralReadingService")) return { getOralReadingAttempt: async (...args: unknown[]) => { loads.push(args); return attempt; } };
    if (id.endsWith("/pronunciationSummary")) return pronunciationSummary;
    if (id.endsWith("/M5Modal")) return { default: "m5-modal" };
    if (id.endsWith("/PronunciationFeedback")) return {
      PronunciationAccuracyPanel: "accuracy-panel", PronunciationWordsPanel: "words-panel",
      usePronunciationCheck: (...args: unknown[]) => { hookCalls.push(args); return check.state; },
    };
    if (id.endsWith("/RecordingPlayback")) return { default: "recording-playback" };
    if (id.endsWith("/SavedTranscript")) return { default: "saved-transcript" };
    if (id.endsWith("/FilipinoReadingFeedback")) return { default: "filipino-reading-feedback", FilipinoWordReviewPanel: "filipino-word-review-panel",
      READING_ACCURACY_EXPLANATION: "Reading Accuracy starts from all the story words and takes away each difference the computer found: different words, words not heard and extra words. So it can be a little lower than the share of words matched." };
    throw new Error(`Unexpected import ${id}`);
  });
  const summary = { id: "third", moduleId: "m", passageId: "help", moduleTitle: "Grade 5 Stories", passageTitle: "A Helping Hand",
    language: "en", completedAt: "2026-11-04T20:36:06Z", pronunciationAccuracy: 90, readingSpeedWpm: 99, detectedErrorCount: 1, ...summaryOverrides };
  let closed = 0;
  const props = { role, summary, readingNumber: 3, onClose: () => { closed++; } };
  return { render: () => runtime.render(component.default, props), hookCalls, loads, closed: () => closed };
}

test("the modal shows the selected reading's complete saved assessment without starting a pronunciation check", async () => {
  const check = checkState("done", { saved: true, summary: { parts: 1, utterances: 2, accuracy: 95, fluency: 97,
    wordsToPractice: ["santos"], complete: true, storyWords: 10, assessedStoryWords: 10, practiceOccurrences: [{ word: "santos", storyWordIndex: 5 }] } });
  const m = modal(englishAttempt(), check);
  assert.match(text(m.render()), /Loading saved assessment…/);
  await tick();
  const tree = m.render();
  const dialog = find(tree, (node) => node.type === "m5-modal");
  assert.deepEqual([dialog.props.title, dialog.props.open, dialog.props.closeLabel], ["Saved Oral Reading Assessment", true, "Close"]);
  dialog.props.onClose();
  assert.equal(m.closed(), 1, "X, Escape and the backdrop all call onClose (M5Modal)");
  const all = text(tree);
  assert.match(all, /"A Helping Hand — Reading 3"/);
  assert.match(all, /"English"/);
  assert.match(all, /dateTime":"2026-11-04T20:36:06Z"/);
  // Saved values exactly as stored: no new score or grade.
  assert.match(all, /\[90,"%"\]/);
  assert.match(all, /"9 of 10"/);
  assert.match(all, /"99 words per minute"/);
  assert.doesNotMatch(all, /\bpass(ed)?\b|\bfail|overall|your grade|grade:/i);
  // Saved pronunciation results through the existing F3/F4 components, never F2's check prompt.
  // F7 wording points to the words further down the same modal; F2 keeps "Open Mispronounced Words".
  assert.match(all, /Your words sounded very clear! Practice the 1 word below\./);
  assert.doesNotMatch(all, /Open Mispronounced Words/);
  const accuracy = find(tree, (node) => node.type === "accuracy-panel");
  const words = find(tree, (node) => node.type === "words-panel");
  assert.equal(accuracy.props.check, check.state);
  assert.equal(words.props.check, check.state);
  assert.deepEqual({ ...accuracy.props.story }, { passage: STORY, title: "A Helping Hand" });
  assert.equal(find(tree, (node) => node.type === "recording-playback").props.attemptId, "third");
  assert.equal(find(tree, (node) => node.type === "saved-transcript").props.attempt.id, "third");
  assert.deepEqual(check.calls, [], "F7 never calls check() or autoCheck()");
  assert.deepEqual(m.hookCalls.at(-1), ["third", "ana"], "the saved check of this attempt and account only");
  assert.deepEqual(m.loads.map((call) => call[0]), ["third"]);
  assert.equal(find(tree, (node) => node.type === "filipino-reading-feedback"), undefined, "English F7 has no Filipino feedback");
  assert.equal(find(tree, (node) => node.type === "filipino-word-review-panel"), undefined);
  assert.doesNotMatch(all, /Reading Accuracy starts from/);
});

test("missing results say Not assessed, and Filipino readings never get a pronunciation score", async () => {
  for (const status of ["idle", "error"]) {
    const check = checkState(status, status === "error" ? { error: "x" } : {});
    const m = modal(englishAttempt(), check);
    m.render(); await tick();
    const all = text(m.render());
    assert.match(all, /"Not assessed"/, status);
    assert.match(all, /This reading has no saved pronunciation check\./, status);
    assert.doesNotMatch(all, /accuracy-panel|words-panel|Try Again|Check My Pronunciation|out of 100/, status);
    assert.deepEqual(check.calls, [], status);
  }
  const pending = modal(englishAttempt(), checkState("pending"));
  pending.render(); await tick();
  assert.match(text(pending.render()), /The pronunciation check for this reading is still running\./);

  const fil = checkState("idle");
  const m = modal(englishAttempt({ language: "fil", passageTitle: "Ang Pusa" }), fil, { language: "fil", passageTitle: "Ang Pusa" });
  m.render(); await tick();
  const all = text(m.render());
  assert.match(all, /"Naka-save na Pagtatasa ng Pagbasa nang Malakas"/);
  assert.match(all, /"Hindi nasuri"/);
  assert.match(all, /Ang pagsusuri ng bigkas ay para lamang sa mga babasahing Ingles\./);
  assert.doesNotMatch(all, /accuracy-panel|words-panel|out of 100/);
  assert.deepEqual(m.hookCalls.at(-1), [undefined, "ana"], "no pronunciation check is loaded or started for Filipino");
  assert.deepEqual(fil.calls, []);
  // F7 shows the feedback of this exact saved attempt, in the reading's language.
  const feedback = find(m.render(), (node) => node.type === "filipino-reading-feedback");
  assert.equal(feedback.props.attempt.id, "third");
  assert.equal(feedback.props.uiLanguage, "fil");
  // The word list appears once, in its own section.
  const wordLists = findAll(m.render(), (node) => node.type === "filipino-word-review-panel");
  assert.equal(wordLists.length, 1);
  assert.equal(wordLists[0].props.attempt.id, "third");
  assert.equal(m.loads.length, 1, "opening F7 loads the saved attempt once and starts nothing");
});

test("a reply for a different attempt is never shown as the selected reading", async () => {
  const m = modal(englishAttempt({ id: "someone-else" }), checkState("idle"));
  m.render(); await tick();
  const all = text(m.render());
  assert.match(all, /Loading saved assessment…/);
  assert.doesNotMatch(all, /recording-playback|saved-transcript|"9 of 10"/);
});

// --- Saved transcript -------------------------------------------------------

test("F7 transcript marks differences and only reliably aligned skipped words, without calling them mispronunciations", () => {
  const { renderToStaticMarkup } = require("react-dom/server");
  const react = require("react");
  const transcript = loadComponentModule(new URL("../src/modules/module5/components/SavedTranscript.tsx", import.meta.url), (id) => {
    if (id === "react/jsx-runtime") return require("react/jsx-runtime");
    if (id === "lucide-react") return require("lucide-react");
    if (id.endsWith("/activityLanguage")) return activityLanguage;
    if (id.endsWith("/resultWords")) return resultWords;
    throw new Error(`Unexpected import ${id}`);
  });
  const story = "Every Saturday, Ben visited Mrs. Santos.";
  const attempt = englishAttempt({ passageSnapshot: story, passageTitle: "",
    transcript: "every saturday ben visited sampsons",
    wordMetrics: toOralReadingWordMetrics(calculateOralReadingMetrics(story, "every saturday ben visited sampsons")) });
  const html = renderToStaticMarkup(react.createElement(transcript.default, { attempt }));
  assert.match(html, /<mark class="result-feedback-different">sampsons<span class="result-visually-hidden"> \(different from the story\)<\/span><\/mark>/);
  assert.match(html, /Orange words are different from the story\./);
  assert.match(html, /Sometimes the computer can make mistakes when listening\./);
  assert.doesNotMatch(html, /mispronounc|pronunciation/i);
  // Nothing different and nothing skipped: no legends.
  const clean = englishAttempt({ passageSnapshot: "Ben ran.", passageTitle: "", transcript: "ben ran",
    wordMetrics: toOralReadingWordMetrics(calculateOralReadingMetrics("Ben ran.", "ben ran")) });
  const cleanHtml = renderToStaticMarkup(react.createElement(transcript.default, { attempt: clean }));
  assert.doesNotMatch(cleanHtml, /<mark|result-skipped-word|Orange words|dashed line/);
  // Metrics that do not line up with the story mark nothing in the story.
  const broken = englishAttempt({ passageSnapshot: story, passageTitle: "", transcript: "ben", wordMetrics: [{ type: "omission", expected: "elephant", actual: null }] });
  assert.doesNotMatch(renderToStaticMarkup(react.createElement(transcript.default, { attempt: broken })), /result-skipped-word/);
});

test("F7 transcript dashes a skipped story word when the saved alignment identifies it", () => {
  const { renderToStaticMarkup } = require("react-dom/server");
  const react = require("react");
  const transcript = loadComponentModule(new URL("../src/modules/module5/components/SavedTranscript.tsx", import.meta.url), (id) => {
    if (id === "react/jsx-runtime") return require("react/jsx-runtime");
    if (id === "lucide-react") return require("lucide-react");
    if (id.endsWith("/activityLanguage")) return activityLanguage;
    if (id.endsWith("/resultWords")) return resultWords;
    throw new Error(`Unexpected import ${id}`);
  });
  const attempt = englishAttempt({ passageSnapshot: "Ben ran very fast.", passageTitle: "", transcript: "ben ran fast",
    wordMetrics: toOralReadingWordMetrics(calculateOralReadingMetrics("Ben ran very fast.", "ben ran fast")) });
  const html = renderToStaticMarkup(react.createElement(transcript.default, { attempt }));
  assert.match(html, /<span class="result-skipped-word">very<span class="result-visually-hidden"> \(not heard\)<\/span><\/span>/);
  assert.match(html, /Words with a dashed line were not heard\./);
});

test("the saved assessment has no Questions & Results link for any role; its contents and closing are unchanged", async () => {
  for (const role of ["student", "general_user", "admin"]) {
    const m = modal(englishAttempt(), checkState("idle"), {}, role);
    m.render(); await tick();
    const tree = m.render();
    assert.doesNotMatch(text(tree), /Questions & Results|Mga Tanong at Resulta|\/comprehension/, role);
    assert.equal(findAll(tree, (node) => node.type === "a" || node.props?.to).length, 0, role);
    assert.equal(find(tree, (node) => node.type === "recording-playback").props.attemptId, "third", role);
    assert.equal(find(tree, (node) => node.type === "saved-transcript").props.attempt.id, "third", role);
    const dialog = find(tree, (node) => node.type === "m5-modal");
    assert.equal(dialog.props.open, true, role);
    dialog.props.onClose();
    assert.equal(m.closed(), 1, role);
  }
});

test("M6 stays reachable without the F7 link: the result page and the read-aloud page's saved results", () => {
  const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
  const result = read("pages/reading-activity/ReadingResultPage.tsx");
  assert.match(result, /const comprehensionTarget = comprehensionTargetForReading\(role, attempt\);/);
  assert.match(result, /t\("Continue to Questions"\)/);
  // Both roles reopen any saved reading's result page, and so its Continue to Questions, from here.
  const readAloud = read("pages/reading-activity/ReadAloudPage.tsx");
  assert.match(readAloud, /t\("Your Saved Oral Reading Results"\)/);
  assert.match(readAloud, /onClick=\{\(\) => navigate\(resultPathFor\(saved\.id\)/);
  assert.match(readAloud, /role === "student" \? `\/dashboard\/read-aloud\/results\/\$\{attemptId\}` : `\/m3\/general\/read-aloud\/results\/\$\{attemptId\}`/);
  // Both roles' M6 routes are still there.
  const app = read("App.tsx");
  assert.match(app, /path="materials\/:moduleId\/comprehension"/);
  assert.match(app, /path="modules\/:moduleId\/comprehension"\s+element=\{<ComprehensionPage role="general_user" \/>\}/);
  // Students' assigned activities and completed quizzes keep their own links.
  assert.match(read("modules/module5/services/assignedReadingNavigation.ts"), /\/dashboard\/comprehension\//);
});
