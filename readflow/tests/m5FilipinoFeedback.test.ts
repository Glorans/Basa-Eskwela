// Filipino F2, F3, F4 and F7 content from one saved attempt. Saved word metrics are written out here, so
// these tests do not depend on any change to the server scorer. No network, no speech service.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { getReadingWords } from "../src/modules/module2/services/diagnosticScoring.ts";
import * as feedbackService from "../src/modules/module5/services/filipinoReadingFeedback.ts";
import { markStory, markTranscript, placeStoryWords, readingAccuracyMessage } from "../src/modules/module5/services/resultWords.ts";
import * as activityLanguage from "../src/pages/reading-activity/activityLanguage.ts";
import { loadComponentModule } from "./helpers/hookRuntime.ts";

const { buildFilipinoFeedback, filipinoReadingStats, MAX_START_WORDS } = feedbackService;
const require = createRequire(import.meta.url);
const react = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

type Metric = { expected: string | null; actual: string | null; type: "match" | "substitution" | "omission" | "insertion" };
const same = (word: string): Metric => ({ expected: word, actual: word, type: "match" });
const sub = (expected: string, actual: string): Metric => ({ expected, actual, type: "substitution" });
const skip = (expected: string): Metric => ({ expected, actual: null, type: "omission" });
const extra = (actual: string): Metric => ({ expected: null, actual, type: "insertion" });

const attempt = (story: string, transcript: string, wordMetrics: Metric[], overrides: Record<string, unknown> = {}) => ({
  id: "attempt", userId: "ana", moduleId: "m", moduleTitle: "Kuwento", passageTitle: "", language: "fil" as const, passageSnapshot: story, transcript, wordMetrics,
  expectedWordCount: wordMetrics.filter((metric) => metric.type !== "insertion").length, scoringVersion: 2,
  pronunciationAccuracy: 80, readingSpeedWpm: 90.4, durationSeconds: 30, detectedErrorCount: 0, sttConfidence: null, completedAt: "2026-11-05T01:36:00Z", ...overrides,
});
function ready(input: ReturnType<typeof attempt>) {
  const feedback = buildFilipinoFeedback(input);
  assert.equal(feedback.status, "ready");
  return feedback as Extract<typeof feedback, { status: "ready" }>;
}

const GRIPO = `May gripo sa plasa ng barangay nina Ella. Doon umiinom at
naghuhugas ng kamay ang mga tao. Isang hapon, nakita ni Ella
na bukas ang gripo at walang tao. Tumutulo ang tubig sa lupa.
Agad niyang isinara ang gripo. Napansin din niya na may butas
ang tubo. Pumunta siya sa barangay hall at sinabi ito kay Kapitan.
Kinabukasan, naayos na ang tubo. "Salamat, Ella," sabi ni
Kapitan. "Dapat alagaan natin ang tubig ng lahat."`;
const GRIPO_HEARD = "My grate po sa grasya ng Barangay Nina Ella doon umiinom at naghuhugas ng kamay ang mga tao. 1 hapon nakita ni Ella na bukas ang gripo at walang tao tumutulo ang tubig sa lupa agad niyang isinara ang gripo. Napansin din niyang Na may butas ang tubo. Pumunta siya sa barangay hall at sinabi ito kay Kapitan. Kinabukasan naayos na ang tubo. Salamat, Ela, sabi ni Kapitan. Dapat alagaan natin ang tubig mga lahat.";
// The saved metrics of that reading, as stored: scored before any number rule existed.
function gripoAttempt() {
  const words = getReadingWords(GRIPO, "fil");
  const changes = new Map<number, string>([[0, "grate"], [1, "po"], [3, "grasya"], [words.indexOf("isang"), "1"], [words.indexOf("niya"), "niyang"],
    [words.lastIndexOf("ella"), "ela"], [words.lastIndexOf("ng"), "mga"]]);
  const metrics = [extra("my"), ...words.map((word, index) => (changes.has(index) ? sub(word, changes.get(index) as string) : same(word)))];
  return attempt(GRIPO, GRIPO_HEARD, metrics, { passageTitle: "Ang Gripo sa Plasa", pronunciationAccuracy: 89.19, readingSpeedWpm: 112.69 });
}

const panels = loadComponentModule(new URL("../src/modules/module5/components/FilipinoReadingFeedback.tsx", import.meta.url), (id) => {
  if (id === "react/jsx-runtime") return require("react/jsx-runtime");
  if (id === "lucide-react") return { MessageCircle: "svg", Gauge: "svg", ListChecks: "svg" };
  if (id.endsWith("/activityLanguage")) return activityLanguage;
  if (id.endsWith("/filipinoReadingFeedback")) return feedbackService;
  throw new Error(`Unexpected import ${id}`);
});
const render = (panel: unknown, input: unknown, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(react.createElement(panel, { attempt: input, ...props })).replaceAll("&quot;", "\"");
const f2 = (input: unknown, props = {}) => render(panels.default, input, props);
const f3 = (input: unknown, props = {}) => render(panels.FilipinoReadingAccuracyPanel, input, props);
const f4 = (input: unknown, props = {}) => render(panels.FilipinoWordReviewPanel, input, props);
const rows = (shown: string) => shown.match(/<li /g)?.length ?? 0;
const fil = activityLanguage.getActivityText("fil");

// --- The saved reading -------------------------------------------------------

test("F2 for 'Ang Gripo sa Plasa' is a short summary and suggestion, with no score or word list", () => {
  const shown = f2(gripoAttempt());
  assert.match(shown, /Puna Batay sa Aming Narinig/);
  assert.match(shown, new RegExp(fil.t("Most of the words we heard matched the story. Nice job!")));
  assert.match(shown, /Mga bahaging dapat tingnan sa pagbasang ito: 8\./);
  assert.match(shown, /Simulan sa mga salitang:<\/strong> May, gripo, plasa/);
  assert.match(shown, /Tip sa pagsasanay:/);
  assert.match(shown, /Minsan, nagkakamali ang computer sa pakikinig\./);
  // Scores are in F3; the word list is in F4.
  assert.doesNotMatch(shown, /%|Katumpakan ng Pagbasa|67|74|113|salita bawat minuto|<li|grasya|Ang narinig ng computer/);
});

test("F3 for that reading shows the saved Reading Accuracy, labelled as reading, not pronunciation", () => {
  const shown = f3(gripoAttempt());
  assert.match(shown, /Katumpakan ng Pagbasa/);
  assert.match(shown, />89%</);
  assert.match(shown, /Mga Salitang Tumugma/);
  assert.match(shown, /67 sa 74/);
  assert.match(shown, /Mga Pagkakaibang Binilang/);
  assert.match(shown, />8</, "(74 - 8) / 74 is the saved 89%; the extra word is why it is below 67 of 74");
  assert.match(shown, /ibinabawas ang bawat pagkakaibang/);
  assert.match(shown, /Hindi ito marka sa pagbigkas/);
  assert.match(shown, /Minsan, nagkakamali ang computer/);
  assert.doesNotMatch(shown, /Katumpakan ng Pagbigkas|out of 100|\/100/);
  assert.equal(((74 - 8) / 74 * 100).toFixed(2), "89.19", "the explanation describes the saved value");
});

test("F4 for that reading lists all eight saved differences, including the digit and the extra word", () => {
  const input = gripoAttempt();
  const feedback = ready(input);
  assert.deepEqual(feedback.counts, { different: 7, skipped: 0, extra: 1 });
  assert.deepEqual(feedback.differences.map((item) => [item.kind, item.story, item.heard]), [
    ["extra", null, "my"], ["different", "May", "grate"], ["different", "gripo", "po"], ["different", "plasa", "grasya"],
    ["different", "Isang", "1"], ["different", "niya", "niyang"], ["different", "Ella", "ela"], ["different", "ng", "mga"],
  ]);
  const shown = f4(input);
  assert.equal(rows(shown), 8);
  assert.match(shown, /Mga Salitang Dapat Balikan/);
  assert.match(shown, /Ibang salita: 7\. Hindi narinig: 0\. Dagdag na salita: 1\./);
  assert.match(shown, /Ang narinig ng computer: “grasya”/);
  assert.match(shown, /Ang narinig ng computer: “1”/);
  assert.match(shown, /Maaaring isulat ng computer bilang numero/);
  assert.match(shown, /<mark[^>]*>plasa<\/mark>/);
  assert.match(shown, /Hindi ito mga tiyak na mali sa pagbigkas/);
  assert.doesNotMatch(shown, /Mali ang Bigkas|out of 100|%/);
  // The extra word is shown beside the sentence it was heard near, with nothing in the story marked.
  const near = feedback.differences[0].context;
  assert.equal(near?.map((piece) => piece.text).join(""), "May gripo sa plasa ng barangay nina Ella.");
  assert.ok(near?.every((piece) => !piece.practice));
});

// --- Sharing the saved data --------------------------------------------------

test("F3 and F2 use the same saved values and message as F6, with no new calculation", () => {
  const page = readFileSync(new URL("../src/pages/reading-activity/ReadingResultPage.tsx", import.meta.url), "utf8");
  // F6 is unchanged: same rounding, same count and the shared message.
  assert.match(page, /const accuracy = Math\.round\(attempt\.pronunciationAccuracy\);/);
  assert.match(page, /attempt\.wordMetrics\.filter\(\(word\) => word\.type === "match"\)\.length/);
  assert.match(page, /t\(readingAccuracyMessage\(accuracy, everyWordMatched\)\)/);
  // A saved value that the current formula would not give is still shown as saved.
  const saved = attempt("ang aso", "ang aso", [same("ang"), same("aso")], { pronunciationAccuracy: 73.4 });
  const stats = filipinoReadingStats(saved);
  assert.equal(stats.status === "ready" && stats.accuracy, 73);
  assert.match(f3(saved), />73%</);
  // F2 says what F6 says for the same attempt.
  for (const [accuracy, every] of [[100, true], [95, false], [80, false], [40, false]] as const) {
    const words = ["ang", "aso"];
    const input = attempt("ang aso", "ang aso", every ? words.map(same) : [same("ang"), sub("aso", "pusa")], { pronunciationAccuracy: accuracy });
    assert.equal(ready(input).summary, readingAccuracyMessage(accuracy, every));
  }
  const service = readFileSync(new URL("../src/modules/module5/services/filipinoReadingFeedback.ts", import.meta.url), "utf8");
  assert.doesNotMatch(service, /fetch\(|oralReadingService|oralReadingTranscription|supabase|pronunciationCheckStore|calculateOralReadingMetrics|scorePassage|alignWords/);
});

test("F4 lines up with the saved F5 marks, and building it changes nothing", () => {
  const input = gripoAttempt();
  const heard = markTranscript(input.transcript, input.wordMetrics, "fil");
  assert.equal(heard.reliable, true);
  assert.deepEqual(heard.pieces.filter((piece) => piece.differs).map((piece) => piece.text.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase()),
    ready(input).differences.map((item) => item.heard));
  assert.ok(markStory(input.passageSnapshot, input.passageTitle, "fil", input.wordMetrics));
  assert.deepEqual(input.wordMetrics, gripoAttempt().wordMetrics, "the saved attempt is not changed");
});

// --- Scenarios ---------------------------------------------------------------

test("perfect match: praise in F2, 100% in F3, and no rows in F4", () => {
  const story = "Ang aso ay mabait.";
  const input = attempt(story, "ang aso ay mabait", ["ang", "aso", "ay", "mabait"].map(same), { pronunciationAccuracy: 100 });
  assert.deepEqual(ready(input).differences, []);
  assert.match(f2(input), new RegExp(fil.t("We heard every scored word of the story! Great reading!")));
  assert.doesNotMatch(f2(input), /Simulan sa|Mga bahaging dapat/);
  assert.match(f3(input), />100%</);
  assert.match(f3(input), /4 sa 4/);
  assert.equal(rows(f4(input)), 0);
  assert.match(f4(input), /Walang naka-save na pagkakaiba/);
});

test("substituted, skipped and extra words each give a matching suggestion and their own row", () => {
  const story = "ang aso ay mabait at masaya sa bahay";
  const words = getReadingWords(story, "fil");
  const replaced = attempt(story, "ang pusa ay mabait at masaya sa bahay", words.map((word) => (word === "aso" ? sub(word, "pusa") : same(word))));
  assert.match(ready(replaced).tip, /read its sentence again slowly/);
  assert.match(f4(replaced), /Ang narinig ng computer: “pusa”/);

  const skipped = attempt(story, "ang ay at masaya sa bahay", words.map((word) => (["aso", "mabait"].includes(word) ? skip(word) : same(word))));
  assert.deepEqual(ready(skipped).counts, { different: 0, skipped: 2, extra: 0 });
  assert.match(ready(skipped).tip, /Follow the story with your finger/);
  assert.deepEqual(ready(skipped).startWords, ["aso", "mabait"]);
  assert.equal(f4(skipped).match(/Hindi narinig ng computer ang salitang ito/g)?.length, 2);

  const added = attempt(story, "ang ang aso aso ay mabait at masaya sa bahay", [same("ang"), extra("ang"), same("aso"), extra("aso"), ...words.slice(2).map(same)]);
  assert.deepEqual(ready(added).counts, { different: 0, skipped: 0, extra: 2 });
  assert.match(ready(added).tip, /extra words/);
  assert.deepEqual(ready(added).startWords, [], "an extra word is not a missed story word");
  assert.equal(f4(added).match(/wala ito sa kuwento/g)?.length, 2);
  // A last extra word still has a sentence beside it.
  const lastExtra = ready(attempt("ang aso", "ang aso na", [same("ang"), same("aso"), extra("na")]));
  assert.equal(lastExtra.differences[0].context?.map((piece) => piece.text).join(""), "ang aso");
});

test("F4 is the full list: nothing is capped or merged, and F2 names only a few", () => {
  const words = Array.from({ length: 20 }, (_, index) => `salita${index}`);
  const input = attempt(words.join(" "), "x", words.map((word) => sub(word, "x")), { pronunciationAccuracy: 0 });
  assert.equal(ready(input).counts.different, 20);
  assert.equal(rows(f4(input)), 20);
  assert.equal(ready(input).startWords.length, MAX_START_WORDS);
  assert.doesNotMatch(f2(input), /<li|salita5\b/);
});

test("repeated words: each row marks its own occurrence in its own sentence", () => {
  const story = "Si Ella ay masaya. Tumawa si Ella.";
  const second = ready(attempt(story, "si ella ay masaya tumawa si ela", [same("si"), same("ella"), same("ay"), same("masaya"), same("tumawa"), same("si"), sub("ella", "ela")]));
  assert.equal(second.differences.length, 1);
  const marked = second.differences[0].context;
  assert.equal(marked?.map((piece) => piece.text).join(""), "Tumawa si Ella.", "the sentence with the occurrence that differed");
  assert.deepEqual(marked?.filter((piece) => piece.practice).map((piece) => piece.text), ["Ella"]);

  const both = ready(attempt(story, "si ela ay masaya tumawa si elya", [same("si"), sub("ella", "ela"), same("ay"), same("masaya"), same("tumawa"), same("si"), sub("ella", "elya")]));
  assert.deepEqual(both.differences.map((item) => [item.heard, item.context?.map((piece) => piece.text).join("")]),
    [["ela", "Si Ella ay masaya."], ["elya", "Tumawa si Ella."]]);
  assert.deepEqual(both.startWords, ["Ella"], "F2 names a repeated word once");
});

test("a digit is shown as heard, with a note, and F2 names it only when there is room", () => {
  const story = "Isang hapon, umuwi si Ella.";
  const onlyDigit = attempt(story, "1 hapon umuwi si Ella", [sub("isang", "1"), same("hapon"), same("umuwi"), same("si"), same("ella")]);
  assert.deepEqual(ready(onlyDigit).startWords, ["Isang"]);
  assert.match(f4(onlyDigit), /Ang narinig ng computer: “1”/);
  assert.match(f4(onlyDigit), /Maaaring isulat ng computer bilang numero/);
  const noDigit = attempt(story, "ang hapon umuwi si Ella", [sub("isang", "ang"), same("hapon"), same("umuwi"), same("si"), same("ella")]);
  assert.doesNotMatch(f4(noDigit), /Maaaring isulat ng computer bilang numero/);
  assert.deepEqual(ready(gripoAttempt()).startWords, ["May", "gripo", "plasa"]);
});

test("poor or incomplete recognition is described as a recognition limit, not a verdict", () => {
  const story = "ang aso ay mabait at masaya sa bahay";
  const words = getReadingWords(story, "fil");
  const poor = ready(attempt(story, "ang x y z a b c d", words.map((word, index) => (index ? sub(word, "x") : same(word))), { pronunciationAccuracy: 13 }));
  assert.match(poor.tip, /Noise or a faraway microphone/);
  const cutOff = ready(attempt(story, "ang aso ay mabait", words.map((word, index) => (index < 4 ? same(word) : skip(word))), { pronunciationAccuracy: 50 }));
  assert.match(cutOff.tip, /The last part of the story was not heard/);
});

test("saved historical readings keep their stored values, and nothing is guessed onto the story", () => {
  const misaligned = [same("iba"), sub("kuwento", "kuwerdas")];
  for (const input of [attempt("Ang aso ay mabait.", "iba kuwerdas", misaligned), attempt("", "iba kuwerdas", misaligned, { passageSnapshot: undefined })]) {
    assert.deepEqual(ready(input).differences, [{ kind: "different", story: "kuwento", heard: "kuwerdas", context: null }], "the saved word, as stored");
    assert.equal(rows(f4(input)), 1);
  }
  assert.equal(placeStoryWords("Ang aso.", "", "fil", misaligned), null);
  // A hidden title is not part of the placed story.
  const titled = ready(attempt("Ang Pusa\nAng aso ay mabait.", "ang aso ay mabuti", [same("ang"), same("aso"), same("ay"), sub("mabait", "mabuti")], { passageTitle: "Ang Pusa" }));
  assert.equal(titled.differences[0].context?.map((piece) => piece.text).join(""), "Ang aso ay mabait.");
  // An attempt saved under an older rule shows its score without claiming how it was reached.
  const older = attempt("ang aso", "ang aso", [same("ang"), same("aso")], { pronunciationAccuracy: 90, scoringVersion: 1 });
  assert.match(f3(older), />90%</);
  assert.doesNotMatch(f3(older), /ibinabawas/);
});

test("a missing transcript leaves F2 and F4 with a plain note; F3 still shows the saved score", () => {
  for (const input of [attempt("Ang aso.", "", [skip("ang"), skip("aso")], { pronunciationAccuracy: 0 }), attempt("Ang aso.", "   ", [skip("ang"), skip("aso")], { pronunciationAccuracy: 0 })]) {
    assert.deepEqual(buildFilipinoFeedback(input), { status: "unavailable" });
    assert.match(f2(input), /Walang naka-save na mga salita/);
    assert.match(f4(input), /walang listahan ng salitang/);
    assert.equal(rows(f4(input)), 0);
    assert.match(f3(input), />0%</);
    assert.match(f3(input), /0 sa 2/, "the saved alignment still says nothing matched");
  }
});

test("missing word alignment: F3 shows the saved score without claiming 0 words matched", () => {
  for (const input of [attempt("Ang aso.", "ang aso", [], { expectedWordCount: 2 }), attempt("Ang aso.", "ang aso", [], { wordMetrics: null, expectedWordCount: 2 })]) {
    assert.deepEqual(buildFilipinoFeedback(input), { status: "unavailable" });
    const shown = f3(input);
    assert.match(shown, />80%</);
    assert.match(shown, /Hindi na-save ang paghahambing/);
    assert.doesNotMatch(shown, /Mga Salitang Tumugma|0 sa 2/);
    assert.match(f4(input), /walang listahan ng salitang/);
  }
});

test("no usable saved score: F3 says Not assessed and never shows a broken value", () => {
  for (const input of [attempt("Ang aso.", "ang aso", [same("ang")], { pronunciationAccuracy: Number.NaN }), attempt("Ang aso.", "ang aso", [same("ang")], { expectedWordCount: 0 })]) {
    const shown = f3(input);
    assert.match(shown, /Hindi nasuri/);
    assert.doesNotMatch(shown, /%|NaN|undefined|null/);
    assert.doesNotMatch(f2(input), /NaN|undefined|null/);
    assert.doesNotMatch(f4(input), /NaN|undefined|null/);
  }
});

test("a missing recording is safe: these panels never load audio, and tips do not assume a recording", () => {
  const source = readFileSync(new URL("../src/modules/module5/components/FilipinoReadingFeedback.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /<audio|<RecordingPlayback|fetch\(|oralReadingService|oralReadingTranscription|usePronunciationCheck|"\.\/PronunciationFeedback"/);
  const service = readFileSync(new URL("../src/modules/module5/services/filipinoReadingFeedback.ts", import.meta.url), "utf8");
  for (const tip of service.match(/return "[^"]*listen[^"]*"/g) ?? []) assert.match(tip, /If your recording is available/, tip);
  assert.match(readFileSync(new URL("../src/modules/module5/components/RecordingPlayback.tsx", import.meta.url), "utf8"), /Recording unavailable for this activity/);
  // F2 keeps the recording player beside the feedback on the result page.
  assert.match(readFileSync(new URL("../src/pages/reading-activity/ReadingResultPage.tsx", import.meta.url), "utf8"), /\{feedbackOpened && <RecordingPlayback key=\{attempt\.id\} attemptId=\{attempt\.id\} language=\{language\} \/>\}/);
});

test("no pronunciation claims in any panel, in either language", () => {
  const banned = /mispronounc|mali ang bigkas|katumpakan ng pagbigkas|pronunciation accuracy|out of 100|phoneme|ponema/i;
  for (const uiLanguage of ["fil", "en"]) {
    for (const panel of [f2, f3, f4]) assert.doesNotMatch(panel(gripoAttempt(), { uiLanguage }), banned, uiLanguage);
  }
  assert.match(f3(gripoAttempt(), { uiLanguage: "en" }), /This is not a pronunciation score\./);
  assert.match(f4(gripoAttempt(), { uiLanguage: "en" }), /They are not confirmed pronunciation mistakes/);
});

// --- Separation --------------------------------------------------------------

test("the Admin view keeps English labels and its own F2 heading", () => {
  const shown = f2(gripoAttempt(), { uiLanguage: "en", title: "Feedback Shown to the Student" });
  assert.match(shown, /Feedback Shown to the Student/);
  assert.match(shown, /Most of the words we heard matched the story\. Nice job!/);
  assert.match(f4(gripoAttempt(), { uiLanguage: "en" }), /The computer heard: “grasya”/);
  assert.doesNotMatch(shown, /Tip sa pagsasanay/);
});

test("every Filipino key has its own text, and the old fixed messages are gone", () => {
  assert.equal(fil.t("Reading Accuracy"), "Katumpakan ng Pagbasa");
  assert.equal(fil.t("Words to Review"), "Mga Salitang Dapat Balikan");
  assert.equal(fil.t("Reading Feedback"), "Puna sa Pagbasa");
  assert.equal(fil.t("Feedback from What We Heard"), "Puna Batay sa Aming Narinig");
  for (const key of ["Differences Counted", "Words to start with:", "Practice tip:", "Heard near:", panels.READING_ACCURACY_EXPLANATION,
    "This reading has no saved words to compare with the story, so there is no feedback to show."] as activityLanguage.ActivityText[]) {
    assert.notEqual(fil.t(key), key, key);
  }
  const language = readFileSync(new URL("../src/pages/reading-activity/activityLanguage.ts", import.meta.url), "utf8");
  assert.doesNotMatch(language, /Ang puna sa pagbigkas ay para lamang|Pronunciation Accuracy is available for English readings only|The pronunciation check is available for English readings only/);
  const tips = readFileSync(new URL("../src/modules/module5/services/filipinoReadingFeedback.ts", import.meta.url), "utf8").match(/return "[^"]+"/g) ?? [];
  assert.ok(tips.length >= 6);
  for (const tip of tips) {
    const key = tip.slice(8, -1) as activityLanguage.ActivityText;
    assert.notEqual(fil.t(key), key, key);
  }
});

test("the English result path is still gated to English", () => {
  const page = readFileSync(new URL("../src/pages/reading-activity/ReadingResultPage.tsx", import.meta.url), "utf8");
  assert.match(page, /language === "en" \? \(\s*<PronunciationFeedbackPanel check=\{pronunciation\} autoStart=\{panel === "feedback"\} \/>/);
  assert.match(page, /language === "en" \? \(\s*<PronunciationAccuracyPanel check=\{pronunciation\} story=\{pronunciationStory\} \/>/);
  assert.match(page, /language === "en" \? \(\s*<>\s*<PronunciationWordsPanel check=\{pronunciation\} story=\{pronunciationStory\} \/>/);
  assert.match(page, /usePronunciationCheck\(attempt\?\.language === "en" \? attempt\.id : undefined, attempt\?\.userId\)/);
  for (const panel of ["<FilipinoReadingFeedback ", "<FilipinoReadingAccuracyPanel ", "<FilipinoWordReviewPanel "]) {
    assert.equal(page.split(panel).length - 1, 1, panel);
  }
  // The shared F6 message text is the same for every language's key.
  assert.equal(readingAccuracyMessage(100, true), "We heard every scored word of the story! Great reading!");
  assert.equal(readingAccuracyMessage(95, false), "We heard almost every word of the story. Great reading!");
  assert.equal(readingAccuracyMessage(80, false), "Most of the words we heard matched the story. Nice job!");
  assert.equal(readingAccuracyMessage(40, false), "Good try! Some words we heard were different from the story.");
});
