// Admin "Student Reading Assessments" frontend. No network, no speech service; boundaries are stubs.
// The server's authorization and scope rules are tested in server/tests/adminStudentReading.test.js.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as pronunciationSummary from "../src/modules/module5/services/pronunciationSummary.ts";
import * as resultWords from "../src/modules/module5/services/resultWords.ts";
import * as savedAttemptOrder from "../src/modules/module5/services/savedAttemptOrder.ts";
import { createHookRuntime, loadComponentModule } from "./helpers/hookRuntime.ts";

const require = createRequire(import.meta.url);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
const text = (tree: unknown) => JSON.stringify(tree);
function findAll(tree: any, predicate: (node: any) => boolean, found: any[] = []): any[] {
  if (!tree || typeof tree !== "object") return found;
  if (predicate(tree)) found.push(tree);
  for (const child of [tree.props?.children].flat(Infinity)) findAll(child, predicate, found);
  return found;
}
const find = (tree: any, predicate: (node: any) => boolean) => findAll(tree, predicate)[0];

// --- Page -------------------------------------------------------------------

const STUDENTS = [
  { id: "ana", name: "Ana", readingCount: 2, latestCompletedAt: "2026-11-05T00:00:00Z" },
  { id: "ben", name: "Ben Reyes", readingCount: 1, latestCompletedAt: "2026-11-01T00:00:00Z" },
];
const reading = (id: string, completedAt: string, extra: Record<string, unknown> = {}) => ({
  id, moduleId: "m", passageId: "help", moduleTitle: "Grade 5 Stories", passageTitle: "A Helping Hand", language: "en",
  completedAt, pronunciationAccuracy: 98.65, readingSpeedWpm: 99.4, detectedErrorCount: 1, ...extra,
});

function page(overrides: Record<string, unknown> = {}) {
  const runtime = createHookRuntime(require("react"));
  const requested: string[] = [];
  const component = loadComponentModule(new URL("../src/modules/module5/pages/AdminStudentReadingAssessmentsPage.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id === "react/jsx-runtime") return require("react/jsx-runtime");
    if (id === "lucide-react") return { ArrowLeft: "arrow" };
    if (id.endsWith("/AdminStudentAssessmentModal")) return { default: "assessment-modal" };
    if (id.endsWith("/savedAttemptOrder")) return savedAttemptOrder;
    if (id.endsWith("/oralReadingService")) return {
      getAdminStudents: async () => STUDENTS,
      getAdminStudentReadings: async (studentId: string) => {
        requested.push(studentId);
        return { student: { id: studentId, name: "Ana" }, attempts: [reading("first", "2026-11-03T00:00:00Z"),
          reading("second", "2026-11-05T00:00:00Z", { pronunciationCheck: { accuracy: 95, fluency: 97, complete: true, checkedAt: "x" } })] };
      },
      ...overrides,
    };
    throw new Error(`Unexpected import ${id}`);
  });
  return { render: () => runtime.render(component.default, {}), requested };
}
const buttons = (tree: unknown) => findAll(tree, (node) => node.type === "button");

test("Admin chooses a student, sees that student's numbered readings newest first, and opens one in a modal", async () => {
  const p = page();
  assert.match(text(p.render()), /Loading students…/);
  await tick();
  let tree = p.render();
  assert.match(text(tree), /Student Reading Assessments/);
  assert.match(text(tree), /Your own practice readings are in Reading History/);
  assert.equal(buttons(tree).length, 2);
  assert.match(text(buttons(tree)[0]), /"Ana"/);
  assert.match(text(buttons(tree)[0]), /2 saved readings/);
  assert.match(text(buttons(tree)[1]), /1 saved reading"/);

  buttons(tree)[0].props.onClick();
  tree = p.render(); await tick();
  tree = p.render();
  assert.deepEqual(p.requested, ["ana"]);
  const cards = findAll(tree, (node) => node.type === "button" && node.props["aria-haspopup"] === "dialog");
  // Newest first, each with its real number.
  assert.deepEqual(cards.map((card) => Number(text(card).match(/" — Reading ",(\d)/)?.[1])), [2, 1]);
  assert.match(text(cards[0]), /"Pronunciation Accuracy: ","95 out of 100"/);
  assert.match(text(cards[1]), /"Pronunciation Accuracy: ","Not assessed"/);
  assert.equal(findAll(tree, (node) => node.type === "a" || node.props?.to).length, 0, "no navigation away");
  assert.equal(find(tree, (node) => node.type === "assessment-modal"), undefined);

  const focused: string[] = [];
  cards.forEach((card, index) => card.ref({ focus: () => focused.push(index === 0 ? "second" : "first") }));
  cards[1].props.onClick();
  tree = p.render();
  const modals = findAll(tree, (node) => node.type === "assessment-modal");
  assert.equal(modals.length, 1, "only one modal");
  assert.deepEqual([modals[0].props.summary.id, modals[0].props.readingNumber, modals[0].props.studentName], ["first", 1, "Ana"]);
  modals[0].props.onClose();
  tree = p.render();
  assert.equal(find(tree, (node) => node.type === "assessment-modal"), undefined);
  assert.deepEqual(focused, ["first"], "focus returns to the card that opened it");

  // Back to the student list.
  find(tree, (node) => node.type === "button" && text(node).includes("All students")).props.onClick();
  assert.match(text(p.render()), /Search students/);
});

test("the student search filters by name and says when nothing matches", async () => {
  const p = page();
  p.render(); await tick();
  find(p.render(), (node) => node.type === "input").props.onChange({ target: { value: "BEN" } });
  assert.deepEqual(buttons(p.render()).length, 1);
  assert.match(text(p.render()), /Ben Reyes/);
  find(p.render(), (node) => node.type === "input").props.onChange({ target: { value: "zzz" } });
  assert.match(text(p.render()), /No students match your search\./);
});

test("empty and failed lists are clear, and failures show no details and offer Retry", async () => {
  const empty = page({ getAdminStudents: async () => [] });
  empty.render(); await tick();
  assert.match(text(empty.render()), /No students have saved oral-reading assessments yet\./);
  const failed = page({ getAdminStudents: async () => { throw new Error("private detail"); } });
  failed.render(); await tick();
  const tree = failed.render();
  assert.match(text(tree), /could not be loaded/);
  assert.doesNotMatch(text(tree), /private detail/);
  assert.ok(find(tree, (node) => node.type === "button" && text(node).includes("Retry")));
});

// --- Modal ------------------------------------------------------------------

const STORY = "A Helping Hand\nEvery Saturday, Ben visited Mrs. Santos. Mrs. Santos smiled.";
const attemptFixture = (overrides: Record<string, unknown> = {}) => ({
  id: "third", userId: "ana-id", learnerName: "Ana", moduleId: "m", passageId: "help", moduleTitle: "Grade 5 Stories", passageTitle: "A Helping Hand",
  language: "en", passageSnapshot: STORY, transcript: "every saturday ben visited mrs sampsons mrs santos smiled",
  wordMetrics: [{ type: "match" }, { type: "match" }, { type: "substitution" }], expectedWordCount: 9,
  pronunciationAccuracy: 98.65, readingSpeedWpm: 99.4, durationSeconds: 6, detectedErrorCount: 1, completedAt: "2026-11-04T20:36:06Z", ...overrides,
});
const completed = (summary: Record<string, unknown> = {}) => ({ status: "completed", check: { saved: true, summary: {
  parts: 1, utterances: 2, accuracy: 95, fluency: 97, wordsToPractice: ["santos"], complete: true, storyWords: 9, assessedStoryWords: 9,
  // every(0) saturday(1) ben(2) visited(3) mrs(4) santos(5) mrs(6) santos(7) smiled(8): the SECOND Santos was flagged.
  practiceOccurrences: [{ word: "santos", storyWordIndex: 7 }], ...summary } } });

function modal(attempt: unknown, saved: () => Promise<unknown>, summaryOverrides: Record<string, unknown> = {}) {
  const runtime = createHookRuntime(require("react"));
  const component = loadComponentModule(new URL("../src/modules/module5/components/AdminStudentAssessmentModal.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id === "react/jsx-runtime") return require("react/jsx-runtime");
    if (id.endsWith(".css")) return {};
    if (id === "lucide-react") return { BookOpen: "book", Mic: "mic", MessageCircle: "message" };
    if (id.endsWith("/oralReadingService")) return { getAdminStudentAttempt: async () => attempt };
    if (id.endsWith("/oralReadingTranscription")) return { getAdminPronunciationCheck: saved };
    if (id.endsWith("/pronunciationSummary")) return pronunciationSummary;
    if (id.endsWith("/resultWords")) return resultWords;
    if (id.endsWith("/M5Modal")) return { default: "m5-modal" };
    if (id.endsWith("/RecordingPlayback")) return { default: "recording-playback" };
    if (id.endsWith("/SavedTranscript")) return { default: "saved-transcript" };
    if (id.endsWith("/FilipinoReadingFeedback")) return { default: "filipino-reading-feedback", FilipinoWordReviewPanel: "filipino-word-review-panel" };
    throw new Error(`Unexpected import ${id}`);
  });
  let closed = 0;
  const props = { studentName: "Ana", readingNumber: 3, onClose: () => { closed++; },
    summary: { id: "third", moduleId: "m", moduleTitle: "Grade 5 Stories", passageTitle: "A Helping Hand", language: "en", completedAt: "2026-11-04T20:36:06Z", ...summaryOverrides } };
  return { render: () => runtime.render(component.default, props), closed: () => closed };
}

test("the modal shows the complete saved assessment, read-only, for the flagged occurrence", async () => {
  const m = modal(attemptFixture(), async () => completed());
  m.render(); await tick();
  const tree = m.render();
  const dialog = find(tree, (node) => node.type === "m5-modal");
  assert.deepEqual([dialog.props.title, dialog.props.open], ["Saved Oral Reading Assessment", true]);
  dialog.props.onClose();
  assert.equal(m.closed(), 1);
  const all = text(tree);
  assert.match(all, /"A Helping Hand — Reading 3"/);
  assert.match(all, /"Ana"/);
  assert.match(all, /"English"/);
  assert.match(all, /dateTime":"2026-11-04T20:36:06Z"/);
  assert.match(all, /\[99,"%"\]/);
  assert.match(all, /"2 of 9"/);
  assert.match(all, /\[99," words per minute"\]/);
  assert.match(all, /"children":\[\{[^}]*"children":95[^}]*\}[^\]]*" out of 100"\]/);
  assert.match(all, /A 0-100 score, not the percent of words said correctly\./);
  assert.match(all, /Open Mispronounced Words to practice 1 word\./, "the exact feedback the student received");
  assert.match(all, /"Santos"/);
  // Sentence context around the flagged (second) occurrence, not the first.
  const excerpts = findAll(tree, (node) => Array.isArray(node.props?.pieces));
  assert.equal(excerpts.length, 1);
  const pieces = excerpts[0].props.pieces as { text: string; practice?: boolean }[];
  assert.equal(pieces.map((piece) => piece.text).join(""), "Mrs. Santos smiled.");
  assert.deepEqual(pieces.filter((piece) => piece.practice).map((piece) => piece.text), ["Santos"]);
  assert.match(all, /Listen to the recording before treating a flagged word as a reading mistake\./);
  const recording = find(tree, (node) => node.type === "recording-playback");
  assert.deepEqual([recording.props.attemptId, recording.props.admin], ["third", true]);
  const transcript = find(tree, (node) => node.type === "saved-transcript");
  assert.deepEqual([transcript.props.attempt.id, transcript.props.uiLanguage], ["third", "en"]);
  // Nothing for an Admin to act on: no M6 link, no paid example audio, no check buttons.
  assert.doesNotMatch(all, /Questions & Results|\/comprehension|Hear|Try Again|Check My Pronunciation|Continue to Questions/);
  assert.equal(findAll(tree, (node) => node.type === "a" || node.type === "button").length, 0);
  // Written for a reviewer. The one learner-facing sentence is the quoted feedback, labelled as such.
  assert.doesNotMatch(all, /luency|your recording|ask your teacher/i);
  const feedback = find(tree, (node) => node.type === "section" && node.props["aria-labelledby"] === "admin-feedback-title");
  assert.match(text(feedback), /Feedback Shown to the Student/);
  assert.match(text(feedback), /Your words sounded very clear!/);
  assert.equal(all.match(/Your words/g)?.length, 1);
});

test("partial checks say how much was scored, and flagged-word text matches", async () => {
  const m = modal(attemptFixture(), async () => completed({ assessedStoryWords: 7, wordsToPractice: [], practiceOccurrences: [] }));
  m.render(); await tick();
  const all = text(m.render());
  assert.match(all, /Only part of this reading was checked/);
  assert.match(all, /7 of 9 story words were scored/);
  assert.match(all, /No words were flagged in the part that was checked\./);
});

test("missing results say Not assessed; a load failure is not reported as Not assessed", async () => {
  for (const [saved, note] of [
    [{ status: "none", check: null }, /This reading has no saved pronunciation check\./],
    [{ status: "unsupported", check: null }, /Pronunciation checks are available for English readings only\./],
    [completed({ accuracy: null, utterances: 0, wordsToPractice: [] }), /This check could not score any speech in the reading\./],
  ] as const) {
    const m = modal(attemptFixture(), async () => saved);
    m.render(); await tick();
    const all = text(m.render());
    assert.match(all, /"Not assessed"/);
    assert.match(all, note);
    assert.doesNotMatch(all, /out of 100/);
    assert.ok(find(m.render(), (node) => node.type === "recording-playback"), "the recording still shows");
    assert.ok(find(m.render(), (node) => node.type === "saved-transcript"), "the transcript still shows");
  }
  const running = modal(attemptFixture(), async () => ({ status: "running", check: null }));
  running.render(); await tick();
  assert.match(text(running.render()), /still running/);
  const failed = modal(attemptFixture(), async () => { throw new Error("private detail"); });
  failed.render(); await tick();
  const tree = failed.render();
  assert.match(text(tree), /The saved pronunciation check could not be loaded\./);
  assert.doesNotMatch(text(tree), /Not assessed|private detail/);
  assert.ok(find(tree, (node) => node.type === "button" && text(node).includes("Retry")));
});

test("a Filipino reading or one with no saved language is not given a score, and labels stay in English", async () => {
  const fil = modal(attemptFixture({ language: "fil" }), async () => ({ status: "unsupported", check: null }), { language: "fil" });
  fil.render(); await tick();
  assert.match(text(fil.render()), /"Filipino"/);
  assert.match(text(fil.render()), /"Not assessed"/);
  const filipinoFeedback = find(fil.render(), (node) => node.type === "filipino-reading-feedback");
  assert.equal(filipinoFeedback.props.attempt.id, "third");
  assert.equal(filipinoFeedback.props.uiLanguage, "en");
  assert.equal(filipinoFeedback.props.title, "Feedback Shown to the Student");
  assert.equal(find(fil.render(), (node) => node.type === "filipino-word-review-panel").props.uiLanguage, "en");
  const unknown = modal(attemptFixture({ language: null }), async () => ({ status: "none", check: null }), { language: null });
  unknown.render(); await tick();
  const tree = unknown.render();
  assert.match(text(tree), /"Not recorded"/);
  assert.equal(find(tree, (node) => node.type === "filipino-reading-feedback"), undefined, "only a Filipino reading gets it");
  assert.equal(find(tree, (node) => node.type === "filipino-word-review-panel"), undefined);
  assert.equal(find(tree, (node) => node.type === "saved-transcript").props.uiLanguage, "en");
});

test("a reply for a different attempt is never shown as the selected reading", async () => {
  const m = modal(attemptFixture({ id: "someone-else" }), async () => completed());
  m.render(); await tick();
  const all = text(m.render());
  assert.match(all, /Loading saved assessment…/);
  assert.doesNotMatch(all, /recording-playback|saved-transcript|"2 of 9"/);
});

// --- Boundaries -------------------------------------------------------------

test("the Admin view cannot reach learner check code, paid audio or M6", () => {
  for (const path of ["modules/module5/components/AdminStudentAssessmentModal.tsx", "modules/module5/pages/AdminStudentReadingAssessmentsPage.tsx"]) {
    assert.doesNotMatch(code(read(path)), /PronunciationFeedback|usePronunciationCheck|pronunciationCheckStore|assessOralReading|feedbackSpeech|speech\.play|comprehension|react-router-dom|peekOralReadingAttempt|\bgetOralReadingAttempt\b/, path);
  }
});

test("the page is an Admin-only route and sidebar item; Reading History stays for own practice", () => {
  const app = read("App.tsx").replace(/\s+/g, " ");
  const layout = read("modules/module3/components/M3Layout.tsx");
  assert.match(app, /path="student-reading-assessments" element=\{<AdminStudentReadingAssessmentsPage \/>\}/);
  assert.equal(app.match(/AdminStudentReadingAssessmentsPage \/>/g)?.length, 1, "one route");
  // That route sits inside the block guarded by RequireRole admin, before the Teacher block.
  const adminStart = app.indexOf('<RequireRole allowedRoles={["admin"]} />');
  const teacherStart = app.indexOf('<RequireRole allowedRoles={["teacher"]} />');
  const route = app.indexOf('path="student-reading-assessments"');
  assert.ok(adminStart >= 0 && adminStart < route && route < teacherStart);
  assert.match(app, /path="reading-history" element=\{<ReadingHistoryPage role="admin" \/>\}/);
  assert.equal(layout.match(/Student Reading Assessments/g)?.length, 1, "one sidebar item");
  const adminItems = layout.slice(layout.indexOf('if (role === "admin")'), layout.indexOf('{ label: "Reading Modules"'));
  assert.match(adminItems, /label: "Student Reading Assessments", to: "\/admin\/student-reading-assessments"/);
  assert.match(adminItems, /label: "Reading History", to: "\/admin\/reading-history"/);
  assert.doesNotMatch(read("components/basa/BasaSidebar.tsx"), /Student Reading Assessments/);
});

test("the recording player and service keep existing callers and use the Admin route only when asked", () => {
  const service = read("modules/module5/services/oralReadingService.ts");
  assert.match(service, /reviewer === "admin" \? "admin\/" : reviewer \? "teacher\/" : ""/);
  const player = read("modules/module5/components/RecordingPlayback.tsx");
  assert.match(player, /const reviewer = admin \? "admin" : teacher;/);
  assert.match(read("modules/module5/pages/TeacherOralReadingAttemptPage.tsx"), /<RecordingPlayback attemptId=\{attempt\.id\} teacher language=/);
  assert.doesNotMatch(read("modules/module5/components/SavedAssessmentModal.tsx"), /<RecordingPlayback[^>]* (admin|teacher)\b/);
});
