// M5 result panels F2-F6 content: word placement (resultWords) and the real
// F2/F3/F4 components rendered to HTML. No network, no speech service.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { calculateOralReadingMetrics } from "../src/modules/module2/services/diagnosticScoring.ts";
import { toOralReadingWordMetrics } from "../src/modules/module5/services/oralReadingProcessing.ts";
import * as resultWords from "../src/modules/module5/services/resultWords.ts";
import * as pronunciationSummary from "../src/modules/module5/services/pronunciationSummary.ts";

const { markStory, markTranscript, placePracticeWords, practiceExcerpt } = resultWords;
const require = createRequire(import.meta.url);
const react = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const metricsFor = (story: string, heard: string) => toOralReadingWordMetrics(calculateOralReadingMetrics(story, heard));
const text = (pieces: { text: string }[]) => pieces.map((piece) => piece.text).join("");

// --- F5: story and transcript marks ---

test("F5 story marks a word as not heard only when the saved alignment lines up word for word", () => {
  const story = "The dog sat on the mat.";
  const marked = markStory(story, "", "en", metricsFor(story, "the cat sat the mat"));
  assert.ok(marked);
  assert.equal(marked.length, 1);
  assert.equal(text(marked[0]), story, "the story text is unchanged");
  assert.deepEqual(marked[0].filter((piece) => piece.skipped).map((piece) => piece.text), ["on"]);
  // "dog" was heard as "cat": a difference, not a skip.
  assert.ok(!marked[0].some((piece) => piece.skipped && piece.text === "dog"));
  // Metrics that do not cover the whole story are never guessed onto it.
  const short = metricsFor(story, "the cat sat the mat").slice(0, -1);
  assert.equal(markStory(story, "", "en", short), null);
  assert.equal(markStory(story, "", "en", [{ type: "omission", expected: "elephant", actual: null }]), null);
  assert.equal(markStory("", "", "en", []), null);
});

test("F5 story leaves out a hidden title like the read-aloud screen and keeps punctuation and paragraphs", () => {
  const passage = "Seeds\n\nA well-known seed grows.\n\nIt needs water, sun and soil!";
  const body = "A well-known seed grows.\n\nIt needs water, sun and soil!";
  const marked = markStory(passage, "Seeds", "en", metricsFor(body, "a well known seed grows it needs water and soil"));
  assert.ok(marked);
  assert.deepEqual(marked.map(text), ["A well-known seed grows.", "It needs water, sun and soil!"]);
  assert.deepEqual(marked.flat().filter((piece) => piece.skipped).map((piece) => piece.text), ["sun"]);
});

test("F5 transcript marks different words, links them to the story word, and never invents one", () => {
  const story = "The dog sat on the mat.";
  const heard = markTranscript("The cat sat on the big mat", metricsFor(story, "The cat sat on the big mat"), "en");
  assert.equal(heard.reliable, true);
  const different = heard.pieces.filter((piece) => piece.differs);
  assert.deepEqual(different.map((piece) => [piece.text, piece.expected]), [["cat", ["dog"]], ["big", []]]);
  assert.equal(text(heard.pieces), "The cat sat on the big mat");

  // The scorer may split one heard word into two story words; it still lines up.
  const joined = markTranscript("The sunflower grew", [
    { type: "match", expected: "the", actual: "the" }, { type: "match", expected: "sun", actual: "sun" },
    { type: "match", expected: "flower", actual: "flower" }, { type: "match", expected: "grew", actual: "grew" }], "en");
  assert.equal(joined.reliable, true);
  assert.ok(!joined.pieces.some((piece) => piece.differs));

  // A transcript that does not match the saved metrics gets no story words attached.
  const mismatch = markTranscript("Completely different words", metricsFor(story, "The cat sat on the big mat"), "en");
  assert.equal(mismatch.reliable, false);
  assert.ok(mismatch.pieces.every((piece) => piece.expected === undefined));
});

test("F5 transcript works for Filipino readings", () => {
  const heard = markTranscript("ang aso", [{ type: "match", expected: "ang", actual: "ang" }, { type: "substitution", expected: "pusa", actual: "aso" }], "fil");
  assert.equal(heard.reliable, true);
  assert.deepEqual(heard.pieces.filter((piece) => piece.differs).map((piece) => piece.expected), [["pusa"]]);
});

// --- F3/F4: practice words placed in the story ---

const STORY = "Every Saturday, Ana walks to the orchard. She picks apples in the orchard and don't forget the pears!\n\nSaturday is her favorite day.";

// Story word positions as the server counts them (title excluded):
// Every(0) Saturday(1) Ana(2) walks(3) to(4) the(5) orchard(6) She(7) picks(8) apples(9) in(10) the(11)
// orchard(12) and(13) dont(14) forget(15) the(16) pears(17) Saturday(18) is(19) her(20) favorite(21) day(22)
// "orchard" and "Saturday" each appear twice; here the check flagged the SECOND "orchard".
const OCCURRENCES = [{ word: "saturday", storyWordIndex: 1 }, { word: "orchard", storyWordIndex: 12 }, { word: "dont", storyWordIndex: 14 }];

test("F4 places a repeated word where the check flagged it, once, in story order, with the story's spelling", () => {
  const placed = placePracticeWords(["orchard", "dont", "saturday", "Orchard", "zebra"], STORY, "", OCCURRENCES);
  assert.deepEqual(placed.map((word) => word.word), ["Saturday", "orchard", "don't", "zebra"]);
  assert.deepEqual(placed.map((word) => word.excerpt && text(word.excerpt)), [
    "Every Saturday, Ana walks to the orchard.",
    "She picks apples in the orchard and don't forget the pears!",
    "She picks apples in the orchard and don't forget the pears!",
    null,
  ]);
  // The first "orchard" (sentence 1) is NOT marked; the flagged second one is.
  assert.deepEqual(placed[0].excerpt?.filter((piece) => piece.practice).map((piece) => piece.text), ["Saturday"]);
  assert.deepEqual(placed[1].excerpt?.filter((piece) => piece.practice).map((piece) => piece.text), ["orchard"]);
  assert.equal(placed[3].position, null, "a word not in the story is not placed");
});

test("without saved positions a repeated word is never guessed; a word that appears once is placed", () => {
  const placed = placePracticeWords(["orchard", "saturday", "pears"], STORY, "");
  assert.deepEqual(placed.map((word) => [word.word, word.excerpt && text(word.excerpt)]), [
    ["pears", "She picks apples in the orchard and don't forget the pears!"],
    ["orchard", null],
    ["saturday", null],
  ]);
  assert.deepEqual(practiceExcerpt(placed, STORY, "").flat().filter((piece) => piece.practice).map((piece) => piece.text), ["pears"]);
});

test("a saved position is used only when the story has that exact word there", () => {
  const wrong = [{ word: "orchard", storyWordIndex: 11 }, { word: "saturday", storyWordIndex: 99 }, { word: "pears", storyWordIndex: 1 }];
  const placed = placePracticeWords(["orchard", "saturday", "pears"], STORY, "", wrong);
  assert.ok(placed.every((word) => word.position === null && word.excerpt === null));
  // An empty list from a newer server means no word was placed: nothing falls back to guessing.
  assert.ok(placePracticeWords(["pears"], STORY, "", []).every((word) => word.position === null));
});

test("the reviewed reading: the flagged first Santos is marked, not the second, and Mrs. does not end a sentence", () => {
  const passage = "A Helping Hand\nEvery Saturday, Ben visited Mrs. Santos, an elderly neighbor. Her hands were weak. In return, Mrs. Santos told him stories.";
  const occurrences = [{ word: "santos", storyWordIndex: 5 }, { word: "were", storyWordIndex: 11 }];
  const placed = placePracticeWords(["santos", "were"], passage, "A Helping Hand", occurrences);
  assert.deepEqual(placed.map((word) => [word.word, word.excerpt && text(word.excerpt)]), [
    ["Santos", "Every Saturday, Ben visited Mrs. Santos, an elderly neighbor."],
    ["were", "Her hands were weak."],
  ]);
  const second = placePracticeWords(["santos"], passage, "A Helping Hand", [{ word: "santos", storyWordIndex: 16 }]);
  assert.equal(text(second[0].excerpt ?? []), "In return, Mrs. Santos told him stories.");
});

test("long sentences are shortened around the word", () => {
  const long = "When the big red bus finally stopped near the old school gate after a very long and noisy ride the children cheered.";
  const [placed] = placePracticeWords(["cheered"], long, "");
  const excerpt = text(placed.excerpt ?? []);
  assert.match(excerpt, /^… /);
  assert.match(excerpt, /cheered\.$/);
  assert.ok(excerpt.split(" ").length <= 9);
});

test("F3's excerpt shows at most two sentences and marks exactly the occurrences F4 places", () => {
  const placed = placePracticeWords(["pears", "saturday", "orchard"], STORY, "", [...OCCURRENCES, { word: "pears", storyWordIndex: 17 }]);
  const excerpt = practiceExcerpt(placed, STORY, "");
  assert.equal(excerpt.length, 2);
  assert.deepEqual(excerpt.map((pieces) => pieces.filter((piece) => piece.practice).map((piece) => piece.text)),
    [["Saturday"], ["orchard", "pears"]]);
  assert.deepEqual(practiceExcerpt([], STORY, ""), []);
  assert.deepEqual(placePracticeWords(["orchard"], "", "").map((word) => word.excerpt), [null]);
});

test("speech-to-text hints are a few story names only, never ordinary story words", () => {
  const passage = "A Helping Hand\nEvery Saturday, Ben visited Mrs. Santos, an elderly neighbor. Her hands were weak. In return, Mrs. Santos told him about Manila and Lola Rosa.";
  assert.deepEqual(resultWords.storyNames(passage, "A Helping Hand", "en"), ["Ben", "Santos", "Manila", "Lola", "Rosa"]);
  // Sentence-initial words, days, titles and words also written in lower case are left out.
  assert.deepEqual(resultWords.storyNames("Mother smiled. The Bus came on Monday, and mother waved at the bus.", "", "en"), []);
  assert.deepEqual(resultWords.storyNames(passage, "A Helping Hand", "fil"), [], "Filipino readings send no hints");
  const many = Array.from({ length: 15 }, (_, index) => `Name${String.fromCharCode(97 + index)}`).join(" and ");
  assert.equal(resultWords.storyNames(`They met ${many}.`, "", "en").length, resultWords.MAX_STORY_NAMES);
});

// --- Real F2/F3/F4 components ---

function loadPanels(speechState = { status: "idle", key: null, muted: false }) {
  const path = new URL("../src/modules/module5/components/PronunciationFeedback.tsx", import.meta.url);
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const played: unknown[][] = [];
  const modules: Record<string, unknown> = {
    react, "react/jsx-runtime": require("react/jsx-runtime"), "lucide-react": require("lucide-react"),
    "../../../components/reading-feedback/FeedbackSpeechControls": { useFeedbackSpeechState: () => speechState },
    "../../../services/feedbackSpeech": { getFeedbackSpeech: () => ({ play: async (...args: unknown[]) => { played.push(args); return true; }, getState: () => speechState }) },
    "../../module2/services/speechWav": {}, "../services/oralReadingService": {}, "../services/oralReadingTranscription": {},
    "../services/pronunciationCheckStore": { pronunciationCheckKey: () => "key", pronunciationChecks: {} },
    "../services/pronunciationSummary": pronunciationSummary,
    "../services/resultWords": resultWords,
  };
  const module = { exports: {} as Record<string, any> };
  new Function("module", "exports", "require", output)(module, module.exports, (id: string) => {
    if (!(id in modules)) throw new Error(`Unexpected import ${id}`);
    return modules[id];
  });
  return { panels: module.exports, played };
}

const { panels } = loadPanels();
const story = { passage: STORY, title: "" };
const summary = { parts: 1, utterances: 4, accuracy: 82, fluency: 74, wordsToPractice: ["orchard", "saturday"], complete: true, assessedSeconds: 36, unassessedSeconds: 0,
  storyWords: 23, assessedStoryWords: 23, practiceOccurrences: OCCURRENCES };
const done = (overrides: Record<string, unknown> = {}, saved = true) =>
  ({ status: "done", step: "assessing", saved, notice: saved ? undefined : "Your pronunciation check finished, but its result could not be saved.",
    checkedAt: "2026-11-05T01:00:00Z", summary: { ...summary, ...overrides }, check() { throw Error("must not run"); }, reload() {} });
const render = (name: string, props: Record<string, unknown>) => renderToStaticMarkup(react.createElement(panels[name], props))
  .replace(/&#x27;/g, "'").replace(/&quot;/g, "\"");
// Visible text: screen-reader-only text removed; inline marks joined, other tags separated by spaces.
const visible = (html: string) => html.replace(/<span class="result-visually-hidden">[^<]*<\/span>/g, "")
  .replace(/<\/?(mark|span)[^>]*>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

test("F2 shows only a short overall message from the saved check: no scores, words, date or speech button", () => {
  const html = render("PronunciationFeedbackPanel", { check: done() });
  assert.match(html, /Your Pronunciation/);
  assert.match(html, /Most of your words sounded clear\. Open Mispronounced Words to practice 2 words\./);
  assert.doesNotMatch(html, /\/100|82|orchard|Saturday|Saved pronunciation check|2026|11\/5|Listen to feedback|Azure|<button/);
  assert.match(render("PronunciationFeedbackPanel", { check: done({}, false) }), /role="alert">Your pronunciation check finished, but its result could not be saved\./);
});

const waiting = (overrides: Record<string, unknown>) => ({ status: "idle", step: "loading", autoTried: false,
  check() { throw Error("must not run on render"); }, autoCheck() {}, reload() {}, ...overrides });

test("F2 before a result: a loading message while it checks, and an explicit Try Again after a failure; never a word result", () => {
  // Opened, nothing saved: the automatic check is about to start or is running. No button.
  for (const check of [waiting({}), waiting({ status: "checking", step: "assessing" })]) {
    const html = render("PronunciationFeedbackPanel", { check, autoStart: true });
    assert.match(html, /aria-busy="true"/);
    assert.match(visible(html), /(Loading your recording|Checking your pronunciation)… This can take about half as long as your reading\./);
    assert.doesNotMatch(html, /<button|Check My Pronunciation|No words were flagged|flagged/);
  }
  assert.match(visible(render("PronunciationFeedbackPanel", { check: waiting({ status: "loading" }), autoStart: true })), /Loading your pronunciation feedback…/);
  // A failure: the error and an explicit Try Again; no result wording.
  const failed = render("PronunciationFeedbackPanel", { check: waiting({ status: "error", error: "Pronunciation check failed. Please try again." }), autoStart: true });
  assert.match(failed, /role="alert">Pronunciation check failed\. Please try again\.</);
  assert.match(failed, />Try Again<\/button>/);
  assert.doesNotMatch(failed, /No words were flagged|sounded clear/);
  // Already started automatically in this session (for example, then refreshed after a failure): Try Again, never a silent retry.
  assert.match(render("PronunciationFeedbackPanel", { check: waiting({ autoTried: true }), autoStart: true }), />Try Again<\/button>/);
  // The saved result could not be read: Try Again.
  assert.match(render("PronunciationFeedbackPanel", { check: waiting({ loadError: "Saved pronunciation results could not be loaded right now." }), autoStart: true }),
    /could not be loaded right now\. Please try again\.[\s\S]*>Try Again<\/button>/);
});

test("F3 and F4 never offer or start a check before a result; they point to Pronunciation Feedback", () => {
  for (const name of ["PronunciationAccuracyPanel", "PronunciationWordsPanel"]) {
    const idle = render(name, { check: waiting({}), story });
    assert.match(visible(idle), /Open Pronunciation Feedback first to check your pronunciation\./, name);
    assert.doesNotMatch(idle, /<button|No words were flagged|out of 100/, name);
    assert.match(visible(render(name, { check: waiting({ status: "checking", step: "assessing" }), story })), /Your pronunciation is being checked\./, name);
    assert.doesNotMatch(render(name, { check: waiting({ status: "error", error: "Failed." }), story }), /<button|No words were flagged/, name);
  }
});

test("F3 shows only the saved Pronunciation Accuracy, with story highlights; no Fluency", () => {
  const html = render("PronunciationAccuracyPanel", { check: done(), story });
  const words = visible(html);
  // A 0-100 score, shown "out of 100", never as a percentage of correct words.
  assert.match(words, /Clear Words — Pronunciation Accuracy How clearly you said the words\. 82 out of 100/);
  assert.doesNotMatch(words, /82%|82 %|\/100/);
  // The optional explanation is closed by default and makes no score breakdown.
  assert.match(html, /<details class="result-score-help"><summary>How was my pronunciation scored\?<\/summary>/);
  assert.doesNotMatch(html, /<details[^>]*open/);
  assert.match(words, /The computer listens to the sounds you make and compares them with the expected sounds of the words\. Your score shows how closely they matched\./);
  assert.match(words, /It is not the percent of words you said correctly\./);
  assert.doesNotMatch(words, /phoneme|syllable/i);
  assert.match(words, /Most of your words sounded clear\./);
  assert.doesNotMatch(words, /Fluency|Smooth|74/);
  assert.match(html, /<mark class="result-practice-mark">Saturday<span class="result-visually-hidden"> \(practice word\)<\/span><\/mark>/);
  // Only the flagged (second) "orchard" is marked; the first one in the first sentence is not.
  assert.match(words, /Every Saturday, Ana walks to the orchard\. She picks apples in the orchard/);
  assert.match(html, /walks to the orchard\.<\/p>/);
  assert.match(html, /apples in the <mark class="result-practice-mark">orchard</);
  assert.match(words, /Orange words were flagged for more pronunciation practice\. Open Mispronounced Words to hear and practice these words\./);
  assert.match(html, /aria-label="Pronunciation Accuracy: 82 out of 100"/);
  // Removed: saved date, seconds, phrase counts, the Reading Accuracy comparison and any pause claims.
  assert.doesNotMatch(words, /Saved|seconds|phrase|Reading Accuracy|paused|Checked your whole recording/);
  // F3 marks exactly the words F4 lists.
  const f4 = render("PronunciationWordsPanel", { check: done(), story });
  const marked = (markup: string) => new Set([...markup.matchAll(/<mark class="result-practice-mark">([^<]+)</g)].map((match) => match[1]));
  assert.deepEqual(marked(html), new Set([...f4.matchAll(/<strong class="result-practice-word">([^<]+)</g)].map((match) => match[1])));
});

test("F3 handles no flagged words, partial checks, missing scores and no speech without inventing results", () => {
  const none = visible(render("PronunciationAccuracyPanel", { check: done({ wordsToPractice: [], accuracy: 91, fluency: 88 }), story }));
  assert.match(none, /Your words sounded very clear!/);
  assert.match(none, /No words were flagged for pronunciation practice\./);
  assert.doesNotMatch(none, /Orange words/);
  const partial = visible(render("PronunciationAccuracyPanel", { check: done({ complete: false, unassessedSeconds: 4 }), story }));
  assert.equal(partial.match(/Only part of your reading could be checked, so this score covers the part we could check\./g)?.length, 1);
  assert.doesNotMatch(partial, /\b4 seconds|seconds/);
  // Story words the check never scored also make the result partial.
  const uncovered = visible(render("PronunciationAccuracyPanel", { check: done({ assessedStoryWords: 21 }), story }));
  assert.equal(uncovered.match(/Only part of your reading could be checked/g)?.length, 1);
  const missing = visible(render("PronunciationAccuracyPanel", { check: done({ accuracy: null, fluency: null }), story }));
  assert.match(missing, /A pronunciation score is not available for this reading\./);
  assert.doesNotMatch(missing, /luency/);
  assert.doesNotMatch(missing, /\/100/);
  const silent = visible(render("PronunciationAccuracyPanel", { check: done({ utterances: 0, accuracy: null, fluency: null, wordsToPractice: [] }), story }));
  assert.match(silent, /couldn't hear enough speech/);
  assert.doesNotMatch(silent, /Clear Words/);
});

test("F4 lists only flagged words in story order with excerpts and example audio, never a fake clip", async () => {
  const { panels: words, played } = loadPanels();
  const html = renderToStaticMarkup(react.createElement(words.PronunciationWordsPanel, { check: done({ wordsToPractice: ["orchard", "saturday", "zebra"] }), story }));
  const shown = visible(html);
  assert.match(shown, /Words to Say Again The computer flagged 3 words for more pronunciation practice\./);
  assert.deepEqual([...html.matchAll(/<strong class="result-practice-word">([^<]+)</g)].map((match) => match[1]), ["Saturday", "orchard", "zebra"]);
  assert.match(shown, /Every Saturday, Ana walks to the orchard\. Hear orchard She picks apples in the orchard/);
  // Visible label "Hear"; the accessible name begins with it and names the accent.
  assert.equal(html.match(/<\/svg>Hear<\/button>/g)?.length, 3);
  assert.doesNotMatch(html, />Hear American English</);
  assert.match(html, /aria-label="Hear American English: Saturday"/);
  assert.match(shown, /The computer flagged these words for practice\. Listen to the American English example and try saying each word again\. Different English accents can sound different, and names can be said in more than one way\./);
  assert.match(shown, /Compare with your full recording below\. It plays your whole reading, not one word\./);
  assert.match(shown, /A different accent is not a mistake\./);
  assert.doesNotMatch(html, /Hear Yourself|<audio|needs clearer pronunciation|Words We Heard Differently|Saved pronunciation/);
  assert.match(shown, /Sometimes the computer can make listening mistakes, especially with names\. A different accent is not a mistake\. If you are sure you said a word correctly, ask your teacher to listen to your recording\./);
  assert.deepEqual(played, [], "rendering never plays audio");
  const none = visible(render("PronunciationWordsPanel", { check: done({ wordsToPractice: [] }), story }));
  assert.match(none, /No words were flagged for pronunciation practice\. Great job!/);
  assert.doesNotMatch(none, /Hear<\/button>|full recording/);
  const partialNone = visible(render("PronunciationWordsPanel", { check: done({ wordsToPractice: [], complete: false }), story }));
  assert.match(partialNone, /No words were flagged for pronunciation practice in the part checked\./);
  const partial = visible(render("PronunciationWordsPanel", { check: done({ complete: false }), story }));
  assert.match(partial, /Some of your reading could not be checked, so this list may not include every word\./);
  const uncovered = visible(render("PronunciationWordsPanel", { check: done({ assessedStoryWords: 21 }), story }));
  assert.match(uncovered, /Some of your reading could not be checked, so this list may not include every word\./);
});

test("F4 example audio is the American English (en-US) voice and is disabled while muted", () => {
  const { panels: muted, played } = loadPanels({ status: "idle", key: null, muted: true });
  const html = renderToStaticMarkup(react.createElement(muted.PronunciationWordsPanel, { check: done({ wordsToPractice: ["orchard"] }), story }));
  assert.match(html, /<button type="button" class="result-feedback-button result-practice-example" disabled="" aria-label="Hear American English: orchard"/);
  assert.deepEqual(played, []);
  assert.match(readFileSync(new URL("../src/modules/module5/components/PronunciationFeedback.tsx", import.meta.url), "utf8"),
    /speech\.play\(word, "en", undefined, "american"\)/);
});
