import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getActivityText } from "../src/pages/reading-activity/activityLanguage.ts";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

test("transcript differences stay in F5 and are never called skips or mispronunciations", () => {
  const result = source("pages/reading-activity/ReadingResultPage.tsx");
  assert.doesNotMatch(result, /t\("skipped"\)|"Skipped"|Words We Heard Differently|t\("not detected"\)|t\("read differently"\)|getWordsToPractice/);
  assert.match(result, /t\("Orange words are different from the story\."\)/);
  assert.match(result, /t\("Sometimes the computer can make mistakes when listening\."\)/);
  // Reading Accuracy and the English pronunciation check stay separate measurements.
  assert.match(result, /t\("Reading Accuracy"\)/);
  assert.match(result, /<PronunciationFeedbackPanel check=\{pronunciation\} autoStart=\{panel === "feedback"\} \/>/);
  assert.match(result, /<PronunciationAccuracyPanel check=\{pronunciation\} story=\{pronunciationStory\} \/>/);
  assert.match(result, /<PronunciationWordsPanel check=\{pronunciation\} story=\{pronunciationStory\} \/>/);
});

test("new feedback wording has Filipino equivalents", () => {
  const fil = getActivityText("fil");
  for (const text of [
    "Reading Complete!",
    "You finished your reading activity! Explore your results below to see how you did.",
    "See your pronunciation accuracy score.",
    "Mispronounced Words",
    "The Story",
    "What We Heard",
    " (not heard)",
    " (different from the story)",
    "Words with a dashed line were not heard.",
    "The story says: “{word}”.",
    "This word is not in the story.",
    "Tap an orange word to compare it with the story.",
    "We heard every scored word of the story! Great reading!",
    "Orange words are different from the story.",
    "Sometimes the computer can make mistakes when listening.",
    "How closely the words we heard matched the story.",
    "We heard almost every word of the story. Great reading!",
    "Most of the words we heard matched the story. Nice job!",
    "Good try! Some words we heard were different from the story.",
    "Words Matched",
    "Story words that matched the words we heard.",
    "Reading Speed",
    "How many words we heard in each minute of your recording.",
    "Open Read-Aloud Transcript to see which words were different.",
    "See your reading accuracy, reading speed, and words matched.",
  ] as const) assert.notEqual(fil.t(text), text, text);
  assert.equal(fil.t("{matched} of {total}", { matched: 3, total: 4 }), "3 sa 4");
  assert.equal(fil.t("{wpm} words per minute", { wpm: 61 }), "61 salita bawat minuto");
  assert.equal(fil.t("The story says: “{word}”.", { word: "pusa" }), "Ang nasa kuwento: “pusa”.");
});

test("F4 never claims every word was pronounced correctly and says the computer can make mistakes", () => {
  const feedback = source("modules/module5/components/PronunciationFeedback.tsx");
  const summary = source("modules/module5/services/pronunciationSummary.ts");
  assert.doesNotMatch(feedback + summary, /Every word/);
  assert.match(summary, /No words were flagged for pronunciation practice in the part checked\./);
  assert.match(feedback, /Sometimes the computer can make listening mistakes, especially with names\./);
  assert.match(feedback, /ask your teacher to listen to your recording\./);
  assert.match(feedback, /it can make mistakes/);
  // Only words the check flagged are listed: no transcript word lists or per-word labels.
  assert.doesNotMatch(feedback, /needs clearer pronunciation|wordMetrics|result-feedback-words/);
  // "Hear Yourself" needs word timestamps, which saved recordings do not have; only the example voice is offered.
  assert.doesNotMatch(code(feedback), /Hear Yourself|currentTime/);
  assert.match(feedback, /aria-hidden="true" \/>Hear\r?\n/);
  assert.match(feedback, /aria-label=\{`Hear American English: \$\{word\}`\}/);
  assert.match(feedback, /Listen to the American English example/);
  assert.doesNotMatch(code(feedback), /Hear an Example/);
});

test("F3 says when only part of the speech was checked, without seconds, phrase counts or Reading Accuracy", () => {
  const feedback = source("modules/module5/components/PronunciationFeedback.tsx");
  assert.match(feedback, /Only part of your reading could be checked, so this score covers the part we could check\./);
  assert.match(feedback, /\{partial && <p className="result-feedback-note" role="note">\{PARTIAL_SCORE_NOTE\}<\/p>\}/);
  assert.doesNotMatch(code(feedback), /assessedSeconds|unassessedSeconds|spoken phrase|summary\.utterances === 1|It is different from Reading Accuracy/);
  assert.match(feedback, /Clear Words — Pronunciation Accuracy/);
  // F3 shows Pronunciation Accuracy only: no Fluency card or score (agreed F3 scope).
  assert.doesNotMatch(code(feedback), /Smooth Reading|summary\.fluency|label="Fluency"/);
  assert.match(feedback, /Orange words were flagged for more pronunciation practice\./);
  assert.match(feedback, /Open Mispronounced Words to hear and practice these words\./);
  // No pause data is saved, so F3 never claims pauses.
  assert.doesNotMatch(code(feedback), /paused|pauses at/i);
});

test("F2 is one or two sentences from the saved check and never contradicts F3 or F4", async () => {
  const { pronunciationOverview, clarityMessage, practiceWordsSummary } = await import("../src/modules/module5/services/pronunciationSummary.ts");
  const base = { parts: 1, utterances: 3, accuracy: 72, fluency: 64, wordsToPractice: ["saturday", "orchard"], complete: true };
  assert.equal(pronunciationOverview(base), "Most of your words sounded clear. Open Mispronounced Words to practice 2 words.");
  assert.equal(pronunciationOverview({ ...base, wordsToPractice: ["orchard"] }), "Most of your words sounded clear. Open Mispronounced Words to practice 1 word.");
  assert.equal(pronunciationOverview({ ...base, accuracy: 90, wordsToPractice: [] }), "Your words sounded very clear! No words were flagged for practice.");
  assert.equal(pronunciationOverview({ ...base, complete: false }),
    "Most of your words sounded clear. Open Mispronounced Words to practice 2 words from the part we could check.");
  assert.equal(pronunciationOverview({ ...base, wordsToPractice: [], complete: false }),
    "Most of your words sounded clear. No words were flagged for practice in the part we could check.");
  assert.match(pronunciationOverview({ ...base, accuracy: null }), /could not measure your pronunciation/);
  assert.match(pronunciationOverview({ ...base, utterances: 0 }), /couldn't hear enough speech/);
  // A low score with no flagged words never says words need practice.
  assert.doesNotMatch(pronunciationOverview({ ...base, accuracy: 50, wordsToPractice: [] }), /need more practice|Open Mispronounced/);
  // The same word, spelled differently, is counted once in F2 and F4.
  const repeated = { ...base, wordsToPractice: ["don't", "dont", "Orchard"] };
  assert.match(pronunciationOverview(repeated), /practice 2 words\./);
  assert.equal(practiceWordsSummary(repeated), "The computer flagged 2 words for more pronunciation practice.");
  // Story words the check never scored make it partial even when no audio went unrecognized.
  const uncovered = { ...base, storyWords: 74, assessedStoryWords: 72 };
  assert.equal(pronunciationOverview(uncovered),
    "Most of your words sounded clear. Open Mispronounced Words to practice 2 words from the part we could check.");
  assert.equal(practiceWordsSummary({ ...uncovered, wordsToPractice: [] }), "No words were flagged for pronunciation practice in the part checked.");
  assert.equal(pronunciationOverview({ ...base, storyWords: 74, assessedStoryWords: 74 }), pronunciationOverview(base));
  for (const summary of [base, { ...base, accuracy: 40 }, { ...base, accuracy: 95, wordsToPractice: [] }, { ...base, complete: false }]) {
    const text = pronunciationOverview(summary);
    // The first sentence is F3's Clear Words message; there are at most two sentences.
    assert.ok(text.startsWith(clarityMessage(summary)), text);
    assert.ok(text.split(/(?<=[.!])\s+/).length <= 2, text);
    assert.doesNotMatch(text, /saturday|orchard|\/100|%|wrong|bad|poor/i);
  }
});

test("F4's summary uses the saved word count and the saved list limit", async () => {
  const { practiceWordsSummary, MAX_SAVED_PRACTICE_WORDS } = await import("../src/modules/module5/services/pronunciationSummary.ts");
  const base = { parts: 1, utterances: 3, accuracy: 72, fluency: 64, wordsToPractice: [] as string[], complete: true };
  assert.equal(practiceWordsSummary(base), "No words were flagged for pronunciation practice. Great job!");
  assert.equal(practiceWordsSummary({ ...base, complete: false }), "No words were flagged for pronunciation practice in the part checked.");
  assert.equal(practiceWordsSummary({ ...base, wordsToPractice: ["orchard"] }), "The computer flagged 1 word for more pronunciation practice.");
  const full = Array.from({ length: MAX_SAVED_PRACTICE_WORDS }, (_, index) => `word${String.fromCharCode(97 + index)}`);
  assert.equal(practiceWordsSummary({ ...base, wordsToPractice: full }), "Here are the first 10 words flagged for pronunciation practice.");
  // The limit matches the server's saved list.
  assert.match(source("../../server/services/pronunciationCheckService.js"), /MAX_PRACTICE_WORDS = 10;/);
});

test("final M5 cleanup: no summary stars, and no Fluency in F7 or the Teacher review", () => {
  const result = source("pages/reading-activity/ReadingResultPage.tsx");
  assert.doesNotMatch(result, /result-feedback-stars|starCount|out of 3 stars/);
  for (const path of ["modules/module5/pages/ReadingHistoryPage.tsx", "modules/module5/pages/TeacherOralReadingAttemptPage.tsx"]) {
    assert.doesNotMatch(code(source(path)), /luency/, path);
  }
});

test("every read-aloud processing and saving step has a Filipino status", () => {
  const fil = getActivityText("fil");
  for (const text of ["Preparing your recording...", "Sending your recording...", "Processing your reading...",
    "Saving your result...", "Saving your recording...", "Speech processing timed out. Please try again.",
    "The connection is too slow right now. Please check your internet and try again."] as const) {
    assert.notEqual(fil.message(text, "Unable to load activity."), text, text);
    assert.notEqual(fil.message(text, "Unable to load activity."), fil.t("Unable to load activity."), text);
  }
});

test("the pronunciation panels never auto-run the check and never name the provider", () => {
  const feedback = source("modules/module5/components/PronunciationFeedback.tsx");
  const result = source("pages/reading-activity/ReadingResultPage.tsx");
  // A paid check starts only in F2: automatically when F2 is open and nothing is saved, or from Try Again.
  assert.deepEqual(feedback.match(/check\.check\b/g), ["check.check"]);
  assert.match(feedback, /onClick=\{check\.check\}\s*>\s*Try Again/);
  assert.match(feedback, /if \(autoStart && status === "idle" && !loadError\) autoCheck\(\);/);
  assert.equal(feedback.match(/pronunciationChecks\.autoStart\(/g)?.length, 1);
  assert.match(feedback, /pronunciationChecks\.autoStart\(key, attemptId, runPronunciationCheck, sessionMarker\)/);
  // Only F2 receives autoStart, and only while it is the open panel; F3-F7 never start a check.
  assert.equal(result.match(/autoStart=/g)?.length, 1);
  assert.doesNotMatch(feedback.slice(feedback.indexOf("function ResultWaiting"), feedback.indexOf("/** The story the learner read")), /check\.check|autoCheck|<button[^>]*onClick=\{check\.check/);
  assert.doesNotMatch(code(feedback), /Azure|Microsoft/);
  assert.doesNotMatch(code(result), /Azure|Microsoft/);
  // Results are saved now: the old "kept only until you refresh" warning is gone everywhere.
  const language = source("pages/reading-activity/activityLanguage.ts");
  const history = source("modules/module5/pages/ReadingHistoryPage.tsx");
  for (const text of [feedback, result, language, history]) {
    assert.doesNotMatch(text, /not saved yet|kept only until you refresh|are not saved\./);
  }
  // Opening a reading only reads the saved check (free); the paid check stays on the button.
  assert.match(feedback, /pronunciationChecks\.load\(key, attemptId, loadSavedCheck\)/);
  assert.equal(feedback.match(/pronunciationChecks\.start\(/g)?.length, 1);
  // No saved-date message in F2-F4; a result the server could not save still says so, in every result branch.
  assert.doesNotMatch(code(feedback), /Saved pronunciation check|toLocaleDateString|checkedAt/);
  assert.match(feedback, /if \(check\.status !== "done" \|\| check\.saved !== false\) return null;\s*return <p className="result-feedback-note" role="alert">\{check\.notice\}<\/p>;/);
  assert.equal(feedback.match(/<UnsavedNote check=\{check\} \/>/g)?.length, 5);
  // The check is shared through the attempt-scoped store, never component state.
  assert.match(feedback, /useSyncExternalStore\(pronunciationChecks\.subscribe/);
  assert.match(feedback, /pronunciationChecks\.start\(key, attemptId, runPronunciationCheck\)/);
  assert.doesNotMatch(feedback, /abort\(\)/, "closing or remounting a panel never cancels the check");
  assert.match(result, /usePronunciationCheck\(attempt\?\.language === "en" \? attempt\.id : undefined, attempt\?\.userId\)/);
  // F2 has no feedback text-to-speech; F4's example words use the Philippine voice.
  assert.doesNotMatch(feedback + result, /FeedbackSpeechControls |Listen to feedback/);
  assert.match(feedback, /speech\.play\(word, "en", undefined, "american"\)/);
  assert.doesNotMatch(result, /speech\.play\(/);
});
