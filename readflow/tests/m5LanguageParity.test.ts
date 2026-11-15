// M5 English/Filipino result parity: the Filipino F3 and F4 panels use the English card structure
// and classes, show the saved values unchanged, and never present a pronunciation score.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as feedbackService from "../src/modules/module5/services/filipinoReadingFeedback.ts";
import * as resultWords from "../src/modules/module5/services/resultWords.ts";
import * as activityLanguage from "../src/pages/reading-activity/activityLanguage.ts";
import { loadComponentModule } from "./helpers/hookRuntime.ts";

const require = createRequire(import.meta.url);
const react = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const src = (path: string) => new URL(`../src/${path}`, import.meta.url);
const read = (path: string) => readFileSync(src(path), "utf8");

const panels = loadComponentModule(src("modules/module5/components/FilipinoReadingFeedback.tsx"), (id) => {
  if (id === "react") return react;
  if (id === "react/jsx-runtime") return require("react/jsx-runtime");
  if (id === "lucide-react") return new Proxy({}, { get: (_, name) => String(name) });
  if (id.endsWith("/activityLanguage")) return activityLanguage;
  if (id.endsWith("/filipinoReadingFeedback")) return feedbackService;
  if (id.endsWith("/resultWords")) return resultWords;
  if (id.endsWith("/FeedbackSpeechControls")) return { useFeedbackSpeechState: () => ({ status: "idle", key: null, muted: false }) };
  if (id.endsWith("/feedbackSpeech")) return { getFeedbackSpeech: () => ({ play: async () => true, stop() {}, stopIf() {} }) };
  throw new Error(`Unexpected import ${id}`);
});

type Metric = { expected: string | null; actual: string | null; type: "match" | "substitution" | "omission" | "insertion" };
const same = (word: string): Metric => ({ expected: word, actual: word, type: "match" });
const STORY = "Si Aling Rosa ay nagtitinda ng kakanin. Araw-araw, gumigising siya nang maaga.";
// 12 of 13 story words matched, one omission and one extra word: stored accuracy (13 - 2) / 13 = 84.62,
// while matched / total = 92.3. The panel must show the stored value, not recompute it.
const METRICS: Metric[] = [
  same("si"), same("aling"), same("rosa"), same("ay"), same("nagtitinda"),
  { expected: "ng", actual: null, type: "omission" },
  same("kakanin"), { expected: null, actual: "po", type: "insertion" },
  same("araw"), same("araw"), same("gumigising"), same("siya"), same("nang"), same("maaga"),
];
const attempt = {
  id: "attempt", userId: "learner", moduleId: "m", moduleTitle: "Kuwento", passageTitle: "", language: "fil" as const,
  passageSnapshot: STORY, transcript: "si aling rosa ay nagtitinda kakanin po araw araw gumigising siya nang maaga", wordMetrics: METRICS,
  expectedWordCount: 13, scoringVersion: 2, pronunciationAccuracy: 84.61538461538461, readingSpeedWpm: 80, durationSeconds: 9,
  detectedErrorCount: 2, sttConfidence: null, completedAt: "2026-11-14T01:00:00Z",
};
const html = (panel: unknown, input: unknown = attempt, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(react.createElement(panel, { attempt: input, ...props })).replaceAll("&quot;", "\"");
const classes = (markup: string) => new Set([...markup.matchAll(/class(?:Name)?="([^"]+)"/g)].flatMap(([, value]) => value.split(/\s+/)));

test("Filipino F3 uses the English Clear Words card structure and classes", () => {
  const english = read("modules/module5/components/PronunciationFeedback.tsx");
  const filipino = classes(html(panels.FilipinoReadingAccuracyPanel));
  for (const name of ["result-pronunciation-cards", "result-feedback-card", "result-pronunciation-card", "result-feedback-note",
    "result-pronunciation-value", "result-feedback-progress", "result-feedback-message", "result-score-help",
    "result-story-excerpt", "result-practice-mark", "result-legend", "result-legend-swatch", "result-legend-swatch--practice"]) {
    assert.ok(english.includes(name), `English uses ${name}`);
    assert.ok(filipino.has(name), `Filipino uses ${name}`);
  }
});

test("Filipino F4 uses the English word-card structure and classes", () => {
  const english = read("modules/module5/components/PronunciationFeedback.tsx");
  const filipino = classes(html(panels.FilipinoWordReviewPanel));
  for (const name of ["result-feedback-card", "result-practice", "result-feedback-message", "result-feedback-note", "result-practice-list",
    "result-practice-item", "result-practice-word", "result-practice-excerpt", "result-practice-mark", "result-feedback-button", "result-practice-example"]) {
    assert.ok(english.includes(name), `English uses ${name}`);
    assert.ok(filipino.has(name), `Filipino uses ${name}`);
  }
});

test("Filipino F3 shows the stored accuracy, matched words and differences unchanged (no recalculation)", () => {
  const shown = html(panels.FilipinoReadingAccuracyPanel);
  assert.match(shown, /<p class="result-pronunciation-value"><strong>85<\/strong>%<\/p>/);
  assert.match(shown, /<progress class="result-feedback-progress" value="85" max="100" aria-label="Katumpakan ng Pagbasa: 85%">/);
  assert.match(shown, /<dt>Mga Salitang Tumugma<\/dt><dd class="result-feedback-summary-value">12 sa 13<\/dd>/);
  assert.match(shown, /<dt>Mga Pagkakaibang Natukoy<\/dt><dd class="result-feedback-summary-value">2<\/dd>/);
  assert.doesNotMatch(shown, />92%?</, "never matched / total");
  // The same short message as F6 for the same saved value.
  assert.match(shown, new RegExp(activityLanguage.getActivityText("fil").t(resultWords.readingAccuracyMessage(85, false))));
  // The requested explanation, and never a pronunciation score.
  assert.match(shown, /Ang resultang ito ay batay sa paghahambing ng kuwento at mga salitang nakilala ng computer\. Hindi nito direktang sinusukat ang pagbigkas\./);
  assert.match(shown, /<summary>Paano nakuha ang resultang ito\?<\/summary>/);
  assert.doesNotMatch(shown, /out of 100|Katumpakan ng Pagbigkas|mali ang bigkas/i);
  // The excerpt marks the unheard story word only; the extra word "po" is never in the story.
  assert.match(shown, /<mark class="result-practice-mark">ng<span class="result-visually-hidden"> \(salitang dapat balikan\)<\/span><\/mark>/);
  assert.doesNotMatch(shown, /<mark[^>]*>po/);
});

test("Filipino F3 for a fully matched reading: no excerpt, the F6 praise, and no pointer to listen", () => {
  const perfect = METRICS.filter((m) => m.type === "match").concat(same("ng"));
  const shown = html(panels.FilipinoReadingAccuracyPanel, { ...attempt, pronunciationAccuracy: 100, wordMetrics: perfect });
  assert.doesNotMatch(shown, /result-story-excerpt/);
  assert.match(shown, new RegExp(activityLanguage.getActivityText("fil").t("We heard every scored word of the story! Great reading!")));
  assert.doesNotMatch(shown, /Buksan ang Mga Salitang Dapat Balikan/);
});

test("Filipino F3 in an Admin view keeps English labels and still says it is not pronunciation", () => {
  const shown = html(panels.FilipinoReadingAccuracyPanel, attempt, { uiLanguage: "en" });
  assert.match(shown, /Reading Accuracy/);
  assert.match(shown, /It does not directly measure pronunciation\./);
  assert.match(shown, /This is not a pronunciation score\./);
});

test("reviewExcerpt marks story words only where the saved metrics line up, and guesses nothing", () => {
  const excerpt = resultWords.reviewExcerpt(STORY, "", "fil", METRICS);
  assert.deepEqual(excerpt, [[
    { text: "Si Aling Rosa ay nagtitinda " }, { text: "ng", practice: true }, { text: " kakanin." },
  ]]);
  assert.equal(resultWords.reviewExcerpt(STORY, "", "fil", METRICS.slice(1)), null, "misaligned metrics mark nothing");
  assert.equal(resultWords.reviewExcerpt("", "", "fil", METRICS), null);
});

test("the shared F5 and F6 panels stay the same component for both languages", () => {
  const page = read("pages/reading-activity/ReadingResultPage.tsx");
  // One transcript and one result modal, no language branch inside them.
  assert.equal(page.match(/id="m5-panel-transcript"/g)?.length, 1);
  assert.equal(page.match(/id="m5-panel-result"/g)?.length, 1);
  const transcript = page.slice(page.indexOf('id="m5-panel-transcript"'), page.indexOf('id="m5-panel-result"'));
  assert.doesNotMatch(transcript, /language === "en"|filipino/);
});

test("Filipino F2 groups its existing text like the English cards, without changing any wording", () => {
  const markup = html(panels.default);
  const text = (value: string) => value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const { t } = activityLanguage.getActivityText("fil");
  const feedback = feedbackService.buildFilipinoFeedback(attempt);
  if (feedback.status !== "ready") throw new Error("the sample reading must produce feedback");
  // The reading facts sit in one cream panel; the tip uses the shared instruction box.
  const facts = markup.match(/<div class="result-feedback-facts">(.*?)<\/div>/)?.[1] ?? "";
  assert.match(text(facts), /: 2\./, "the number of places to check is inside the facts panel");
  assert.ok(text(facts).includes(t("Words to start with:")));
  const tip = markup.match(/<p class="result-info-box result-feedback-tip">(.*?)<\/p>/)?.[1] ?? "";
  assert.equal(text(tip), `${t("Practice tip:")} ${t(feedback.tip)}`);
  // Every existing sentence is still shown, in the same order as before.
  const expected = [
    t(feedback.summary),
    t("Places to check in this reading: {count}. You can see them in Words to Review.", { count: feedback.differences.length }),
    `${t("Words to start with:")} ${feedback.startWords.join(", ")}`,
    `${t("Practice tip:")} ${t(feedback.tip)}`,
    `${t("This compares the story with the words the computer heard. It is not a pronunciation score, and a difference does not always mean a reading mistake.")} ${t("Sometimes the computer can make mistakes when listening.")}`,
  ];
  let position = 0;
  for (const sentence of expected) {
    const at = text(markup).indexOf(sentence, position);
    assert.ok(at >= position, `missing or out of order: ${sentence}`);
    position = at + sentence.length;
  }
});

test("the F2 grouping styles are new Filipino-only classes and leave shared English rules unchanged", () => {
  const css = read("pages/reading-activity/ReadingResultPage.css");
  const start = css.indexOf("/* Filipino F2 only");
  const end = css.indexOf("/*", start + 2);
  const block = css.slice(start, end === -1 ? undefined : end);
  const selectors = block.split(/\r?\n/).filter((line) => line.trim().endsWith("{")).map((line) => line.replace("{", "").trim());
  assert.deepEqual(selectors, [".result-feedback-facts", ".result-feedback-facts p", ".result-feedback-tip", ".result-feedback-tip strong"]);
  assert.equal(read("modules/module5/components/PronunciationFeedback.tsx").includes("result-feedback-facts"), false);
});
