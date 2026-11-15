// M5 Filipino "Pakinggan" in Mga Salitang Dapat Balikan (Words to Review). Runs the real panel, the
// real word button, the real shared player and the real /api/tts client, with axios, auth headers and
// browser audio replaced. No network, no Azure, no real recordings or accounts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as feedbackService from "../src/modules/module5/services/filipinoReadingFeedback.ts";
import * as resultWords from "../src/modules/module5/services/resultWords.ts";
import * as activityLanguage from "../src/pages/reading-activity/activityLanguage.ts";
import * as playerModule from "../src/services/feedbackSpeechPlayer.ts";
import { createHookRuntime, loadComponentModule } from "./helpers/hookRuntime.ts";

const require = createRequire(import.meta.url);
const react = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const src = (path: string) => new URL(`../src/${path}`, import.meta.url);
const read = (path: string) => readFileSync(src(path), "utf8");

type Metric = { expected: string | null; actual: string | null; type: "match" | "substitution" | "omission" | "insertion" };
const same = (word: string): Metric => ({ expected: word, actual: word, type: "match" });

// Synthetic story. Saved metrics as the M5 scorer stores them: lower case, story order.
const STORY = "Si Aling Rosa ay nagtitinda ng kakanin. Araw-araw, gumigising siya nang maaga.";
const METRICS: Metric[] = [
  same("si"), same("aling"), same("rosa"), same("ay"),
  { expected: "nagtitinda", actual: "nagbebenta", type: "substitution" },
  { expected: "ng", actual: null, type: "omission" },
  same("kakanin"),
  { expected: null, actual: "po", type: "insertion" },
  { expected: "araw", actual: "arawaraw", type: "substitution" },
  { expected: "araw", actual: null, type: "omission" },
  same("gumigising"), same("siya"), same("nang"), same("maaga"),
];
const attempt = {
  id: "attempt", userId: "learner", moduleId: "m", moduleTitle: "Kuwento", passageTitle: "", language: "fil" as const,
  passageSnapshot: STORY, transcript: "si aling rosa ay nagbebenta kakanin po arawaraw gumigising siya nang maaga", wordMetrics: METRICS,
  expectedWordCount: 13, scoringVersion: 2, pronunciationAccuracy: 61.54, readingSpeedWpm: 80, durationSeconds: 9,
  detectedErrorCount: 5, sttConfidence: null, completedAt: "2026-11-14T01:00:00Z",
};

// --- The audio chain: real player and /api/tts client, fake axios and browser audio -----------

class FakeAudio {
  static all: FakeAudio[] = [];
  listeners = new Map<string, () => void>();
  paused = false;
  url: string;
  constructor(url: string) { this.url = url; FakeAudio.all.push(this); }
  async play() {}
  pause() { this.paused = true; }
  addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener); }
  removeEventListener(type: string) { this.listeners.delete(type); }
  end() { this.listeners.get("ended")?.(); }
}

function speechApp({ fail = false } = {}) {
  FakeAudio.all = [];
  const posts: { url: string; body: unknown; config: any }[] = [];
  let failing = fail;
  const tts = loadComponentModule(src("modules/module2/services/diagnosticTts.ts"), (id) => {
    if (id.endsWith("/services/api")) {
      return { default: { post: async (url: string, body: unknown, config: unknown) => {
        posts.push({ url, body: JSON.parse(JSON.stringify(body)), config: JSON.parse(JSON.stringify(config)) });
        if (failing) throw Object.assign(new Error("Request failed with status code 500"), { response: { status: 500 } });
        return { data: new Blob(["mp3"]) };
      } } };
    }
    if (id.endsWith("/authHeaders")) return { getSessionAuthHeaders: async () => ({ Authorization: "Bearer synthetic-session" }) };
    throw new Error(`Unexpected import ${id}`);
  });
  let urls = 0;
  const shared = loadComponentModule(src("services/feedbackSpeech.ts"), (id) => {
    if (id.endsWith("/diagnosticTts")) return tts;
    if (id.endsWith("/feedbackSpeechPlayer")) return playerModule;
    throw new Error(`Unexpected import ${id}`);
  }, {
    Audio: FakeAudio,
    URL: { createObjectURL: () => `blob:${++urls}`, revokeObjectURL() {} },
    window: { localStorage: { getItem: () => null, setItem() {} } },
  });
  const controlsFor = (reactModule: unknown) => loadComponentModule(src("components/reading-feedback/FeedbackSpeechControls.tsx"), (id) => {
    if (id === "react") return reactModule;
    if (id === "react/jsx-runtime") return require("react/jsx-runtime");
    if (id === "lucide-react") return new Proxy({}, { get: (_, name) => String(name) });
    if (id.endsWith("/activityLanguage")) return activityLanguage;
    if (id.endsWith("/feedbackSpeechPlayer")) return playerModule;
    if (id.endsWith("/feedbackSpeech")) return shared;
    if (id.endsWith(".css")) return {};
    throw new Error(`Unexpected import ${id}`);
  });
  const panelsFor = (reactModule: unknown) => loadComponentModule(src("modules/module5/components/FilipinoReadingFeedback.tsx"), (id) => {
    if (id === "react") return reactModule;
    if (id === "react/jsx-runtime") return require("react/jsx-runtime");
    if (id === "lucide-react") return new Proxy({}, { get: (_, name) => String(name) });
    if (id.endsWith("/activityLanguage")) return activityLanguage;
    if (id.endsWith("/filipinoReadingFeedback")) return feedbackService;
    if (id.endsWith("/resultWords")) return resultWords;
    if (id.endsWith("/FeedbackSpeechControls")) return controlsFor(reactModule);
    if (id.endsWith("/feedbackSpeech")) return shared;
    throw new Error(`Unexpected import ${id}`);
  });
  // One React hook runtime per mounted component, all sharing the one app player.
  function mount(component: "word" | "controls", props: Record<string, unknown>) {
    const runtime = createHookRuntime(react);
    const fn = component === "word" ? panelsFor(runtime.react).WordListenButton : controlsFor(runtime.react).default;
    const render = () => runtime.render(fn, props);
    const nodes = (type: string) => {
      const found: any[] = [];
      const walk = (node: any) => {
        if (!node || typeof node !== "object") return;
        if (node.type === type) found.push(node);
        [node.props?.children].flat(Infinity).forEach(walk);
      };
      walk(render());
      return found;
    };
    const button = () => nodes("button")[0];
    const label = () => button().props["aria-label"];
    const visible = () => [button().props.children].flat(Infinity).filter((child: unknown) => typeof child === "string").join("");
    const alert = () => nodes("small")[0]?.props.children ?? null;
    return { button, label, visible, alert };
  }
  return { posts, mount, panelsFor, player: shared.getFeedbackSpeech(), fixRequests() { failing = false; } };
}

const fil = activityLanguage.getActivityText("fil").t;
const en = activityLanguage.getActivityText("en").t;

// --- The panel: which word each row speaks -----------------------------------

function rowsOf(props: Record<string, unknown> = {}) {
  const panels = speechApp().panelsFor(react);
  const html = renderToStaticMarkup(react.createElement(panels.FilipinoWordReviewPanel, { attempt, ...props })).replaceAll("&quot;", "\"");
  return [...html.matchAll(/<li class="result-practice-item">(.*?)<\/li>/g)].map(([, row]) => ({
    word: row.match(/<strong class="result-practice-word">(.*?)<\/strong>/)?.[1],
    button: row.match(/<button type="button" class="result-feedback-button result-practice-example" aria-label="(.*?)">/)?.[1] ?? null,
    excerpt: /<p class="result-practice-excerpt"><BookOpen/.test(row),
  }));
}

test("each different or unheard story word gets a Pakinggan button for the story's own spelling, never the heard word", () => {
  const rows = rowsOf();
  assert.deepEqual(rows.map(({ word, button }) => [word, button]), [
    ["nagtitinda", "Pakinggan: nagtitinda"], // heard "nagbebenta": never spoken
    ["ng", "Pakinggan: ng"], // not heard
    ["po", null], // an extra heard word has no story word to play
    ["Araw-araw", "Pakinggan: Araw-araw"], // the story's hyphenated spelling, not "arawaraw" or the scorer's "araw"
    ["Araw-araw", "Pakinggan: Araw-araw"],
  ]);
  assert.ok(rows.every((row) => row.excerpt), "every row shows its sentence with the English book icon");
  for (const heard of ["nagbebenta", "arawaraw"]) assert.ok(rows.every((row) => !row.button?.includes(heard)), heard);
});

test("Admin keeps English button labels; the spoken word stays the Filipino story word", () => {
  assert.deepEqual(rowsOf({ uiLanguage: "en" }).map((row) => row.button), ["Hear: nagtitinda", "Hear: ng", null, "Hear: Araw-araw", "Hear: Araw-araw"]);
});

test("no Pakinggan button when nothing can be compared or every word matched", () => {
  const panels = speechApp().panelsFor(react);
  const html = (input: unknown) => renderToStaticMarkup(react.createElement(panels.FilipinoWordReviewPanel, { attempt: input }));
  assert.doesNotMatch(html({ ...attempt, transcript: "" }), /<button/);
  const perfect = METRICS.filter((m) => m.type === "match");
  assert.doesNotMatch(html({ ...attempt, wordMetrics: perfect, expectedWordCount: perfect.length }), /<button/);
});

// --- The real button, player and /api/tts client ------------------------------

test("Pakinggan sends one authenticated fil + Philippine voice request for the story word, then Ihinto and Pakinggan Muli", async () => {
  const app = speechApp();
  const word = app.mount("word", { word: "Araw-araw", row: 3, t: fil });
  assert.equal(word.visible(), "Pakinggan");
  assert.equal(word.label(), "Pakinggan: Araw-araw");
  await tick();
  assert.equal(app.posts.length, 0, "never plays on its own");
  assert.equal(FakeAudio.all.length, 0);

  word.button().props.onClick();
  assert.equal(word.visible(), "Inihahanda ang audio...");
  await tick(); await tick();
  assert.deepEqual(app.posts, [{
    url: "/api/tts",
    body: { text: "Araw-araw", language: "fil", voiceProfile: "philippine" },
    config: { headers: { Authorization: "Bearer synthetic-session" }, responseType: "blob" },
  }]);
  assert.equal(word.visible(), "Ihinto");
  assert.equal(word.label(), "Ihinto: Araw-araw");

  // Ihinto stops the clip.
  word.button().props.onClick();
  assert.equal(FakeAudio.all[0].paused, true);
  assert.equal(app.player.getState().status, "idle");
  assert.equal(word.visible(), "Pakinggan Muli");

  // Replay uses the cached audio: no second request; it ends on its own.
  word.button().props.onClick();
  await tick(); await tick();
  assert.equal(app.posts.length, 1);
  assert.equal(FakeAudio.all.length, 2);
  FakeAudio.all[1].end();
  await tick();
  assert.equal(app.player.getState().status, "idle");
  assert.equal(word.visible(), "Pakinggan Muli");
});

test("English labels for the Admin view: Hear, Stop, Hear again", async () => {
  const app = speechApp();
  const word = app.mount("word", { word: "Araw-araw", row: 0, t: en });
  assert.equal(word.visible(), "Hear");
  word.button().props.onClick();
  await tick(); await tick();
  assert.equal(word.visible(), "Stop");
  word.button().props.onClick();
  assert.equal(word.visible(), "Hear again");
  assert.deepEqual(app.posts[0].body, { text: "Araw-araw", language: "fil", voiceProfile: "philippine" });
});

test("only one word plays at a time, and a repeated word shows Ihinto only on the pressed row", async () => {
  const app = speechApp();
  const first = app.mount("word", { word: "Araw-araw", row: 3, t: fil });
  const repeat = app.mount("word", { word: "Araw-araw", row: 4, t: fil });
  const other = app.mount("word", { word: "nagtitinda", row: 0, t: fil });
  first.button().props.onClick();
  await tick(); await tick();
  assert.equal(first.visible(), "Ihinto");
  assert.equal(repeat.visible(), "Pakinggan", "the same word on another row is not playing");
  other.button().props.onClick();
  assert.equal(FakeAudio.all[0].paused, true, "the first word stops");
  await tick(); await tick();
  assert.equal(first.visible(), "Pakinggan Muli");
  assert.equal(other.visible(), "Ihinto");
  // The repeated word reuses the cached clip.
  repeat.button().props.onClick();
  await tick(); await tick();
  assert.equal(app.posts.length, 2);
  assert.equal(repeat.visible(), "Ihinto");
  assert.equal(other.visible(), "Pakinggan Muli");
});

test("a failed request shows the existing audio error, and pressing again retries", async () => {
  const app = speechApp({ fail: true });
  const word = app.mount("word", { word: "Araw-araw", row: 3, t: fil });
  word.button().props.onClick();
  await tick(); await tick();
  assert.equal(word.alert(), "Hindi magamit ang audio ngayon. Pakisubukang muli.");
  assert.equal(app.player.getState().status, "error");
  app.fixRequests();
  word.button().props.onClick();
  await tick(); await tick();
  assert.equal(app.posts.length, 2, "a failed clip is not cached");
  assert.equal(app.player.getState().status, "playing");
  assert.equal(word.alert(), null);
});

test("muted audio disables Pakinggan, as it disables the English Hear button", () => {
  const app = speechApp();
  app.player.setMuted(true);
  assert.equal(app.mount("word", { word: "ng", row: 1, t: fil }).button().props.disabled, true);
  app.player.setMuted(false);
});

// --- Role coverage and unchanged English --------------------------------------

test("every role's Filipino result view reaches the same panels", () => {
  // Student, Independent Learner, Teacher and Admin practice results (one page, role prop).
  const page = read("pages/reading-activity/ReadingResultPage.tsx");
  assert.match(page, /<FilipinoReadingAccuracyPanel attempt=\{attempt\} \/>/);
  assert.match(page, /<FilipinoWordReviewPanel attempt=\{attempt\} \/>/);
  // F4 shows the learner's own recording below the list, as English does below flagged words.
  assert.match(page, /\{wordsOpened && reviewedWords > 0 && <RecordingPlayback key=\{`words-\$\{attempt\.id\}`\} attemptId=\{attempt\.id\} language=\{language\} \/>\}/);
  // Saved history (Student, Independent Learner, Teacher, Admin practice): feedback, accuracy, words.
  const saved = read("modules/module5/components/SavedAssessmentModal.tsx");
  assert.match(saved, /<FilipinoReadingAccuracyPanel attempt=\{loaded\} uiLanguage=\{language\} \/>/);
  assert.match(saved, /loaded\.language === "fil" && <FilipinoWordReviewPanel attempt=\{loaded\} uiLanguage=\{language\} \/>/);
  // Admin review of a Student's result: English labels.
  const admin = read("modules/module5/components/AdminStudentAssessmentModal.tsx");
  assert.match(admin, /<FilipinoReadingAccuracyPanel attempt=\{loaded\} uiLanguage="en" \/>/);
  assert.match(admin, /loaded\.language === "fil" && <FilipinoWordReviewPanel attempt=\{loaded\} uiLanguage="en" \/>/);
  // Teacher review of a Student's result keeps its own page, with Listen on the passage words for Filipino only.
  const teacher = read("modules/module5/pages/TeacherOralReadingAttemptPage.tsx");
  assert.match(teacher, /\{attempt\.language === "fil" && \(\s*<FeedbackSpeechControls text=\{word\} language="fil" voice="philippine" uiLanguage="en"/);
  assert.match(read("modules/module5/services/oralReadingProcessing.ts"), /\.filter\(\(word\) => word\.type === "substitution" \|\| word\.type === "omission"\)\s*\.map\(\(word\) => word\.expected\)/);
  assert.equal(teacher.match(/<FeedbackSpeechControls /g)?.length, 1);
});

test("English results are unchanged: the English panels and American example stay, labels default as before", () => {
  const english = read("modules/module5/components/PronunciationFeedback.tsx");
  assert.doesNotMatch(english, /<FeedbackSpeechControls|"philippine"|WordListenButton/);
  assert.match(english, /speech\.play\(word, "en", undefined, "american"\)/);
  assert.match(english, /<Volume2 size=\{20\} aria-hidden="true" \/>Hear/);
  const page = read("pages/reading-activity/ReadingResultPage.tsx");
  assert.match(page, /\{wordsOpened && flaggedWords > 0 && <RecordingPlayback key=\{`words-\$\{attempt\.id\}`\} attemptId=\{attempt\.id\} language=\{language\} \/>\}/);
  assert.match(page, /"Listen to words and practice saying them\."/);
  const controls = read("components/reading-feedback/FeedbackSpeechControls.tsx");
  assert.match(controls, /listenLabel = "Listen"/);
  assert.match(controls, /listenAgainLabel = "Listen again"/);
});

test("default control labels are unchanged for existing callers", () => {
  const app = speechApp();
  assert.equal(app.mount("controls", { text: "Basahin ang simula.", language: "fil", listenLabel: "Listen to the hint" }).label(), "Pakinggan ang pahiwatig");
  assert.equal(app.mount("controls", { text: "Good job.", language: "en" }).label(), "Listen");
});

test("the requested Filipino labels", () => {
  const expected: [activityLanguage.ActivityText, string][] = [
    ["Pronunciation Accuracy", "Katumpakan ng Pagbigkas"], // English-only card; Filipino uses Reading Accuracy
    ["Reading Accuracy", "Katumpakan ng Pagbasa"],
    ["Words to Review", "Mga Salitang Dapat Balikan"],
    ["Read-Aloud Transcript", "Transkripsiyon ng Pagbasa nang Malakas"],
    ["Oral Reading Result", "Resulta ng Pagbasa nang Malakas"],
    ["Words Matched", "Mga Salitang Tumugma"],
    ["Differences Counted", "Mga Pagkakaibang Natukoy"],
    ["Reading Speed", "Bilis ng Pagbasa"],
    ["The Story", "Ang Kuwento"],
    ["What We Heard", "Ang Narinig ng Computer"],
    ["Hear", "Pakinggan"],
    ["Stop", "Ihinto"],
    ["Hear again", "Pakinggan Muli"],
    ["This result compares the story with the words the computer recognized. It does not directly measure pronunciation.",
      "Ang resultang ito ay batay sa paghahambing ng kuwento at mga salitang nakilala ng computer. Hindi nito direktang sinusukat ang pagbigkas."],
  ];
  for (const [key, text] of expected) assert.equal(fil(key), text, key);
  assert.equal(fil("Listen to {word}", { word: "bátà" }), "Pakinggan ang bátà");
});
