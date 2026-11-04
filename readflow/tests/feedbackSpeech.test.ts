import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as activityLanguage from "../src/pages/reading-activity/activityLanguage.ts";
import * as playerModule from "../src/services/feedbackSpeechPlayer.ts";

const { createFeedbackSpeechPlayer, speechChunks, MAX_SPEECH_CHUNK, MAX_SPEECH_CHUNKS, MUTED_STORAGE_KEY } = playerModule;
const require = createRequire(import.meta.url);
const tick = () => new Promise(resolve => setImmediate(resolve));

class FakeAudio {
  static all: FakeAudio[] = [];
  listeners = new Map<string, () => void>();
  playing = false;
  paused = false;
  url: string;
  failPlay: boolean;
  constructor(url: string, failPlay = false) { this.url = url; this.failPlay = failPlay; FakeAudio.all.push(this); }
  async play() { if (this.failPlay) throw Error("blocked"); this.playing = true; }
  pause() { this.paused = true; this.playing = false; }
  addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener); }
  removeEventListener(type: string) { this.listeners.delete(type); }
  end() { this.playing = false; this.listeners.get("ended")?.(); }
}

function setup(options: { failSynthesis?: boolean; failPlay?: boolean; cacheLimit?: number; stored?: string } = {}) {
  FakeAudio.all = [];
  const requests: [string, string][] = [];
  const revoked: string[] = [];
  const saved = new Map<string, string>(options.stored ? [[MUTED_STORAGE_KEY, options.stored]] : []);
  let urls = 0;
  const player = createFeedbackSpeechPlayer({
    synthesize: async (text, language) => {
      requests.push([text, language]);
      if (options.failSynthesis) throw Error("SPEECH_NOT_CONFIGURED");
      return new Blob([text]);
    },
    createAudio: (url) => new FakeAudio(url, options.failPlay),
    createObjectURL: () => `blob:${++urls}`,
    revokeObjectURL: (url) => revoked.push(url),
    storage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
    cacheLimit: options.cacheLimit,
  });
  return { player, requests, revoked, saved };
}

test("text is split at sentence and word boundaries within the backend's 1,000-character limit", () => {
  assert.deepEqual(speechChunks("  Magaling!\n Subukan  muli. "), ["Magaling! Subukan muli."]);
  assert.deepEqual(speechChunks("   "), []);
  const sentence = `${"word ".repeat(150).trim()}.`;
  const long = `${sentence} ${sentence} ${sentence}`;
  const chunks = speechChunks(long);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.length <= MAX_SPEECH_CHUNK));
  assert.equal(chunks.join(" "), long);
  assert.ok(speechChunks("x".repeat(2500)).every(chunk => chunk.length <= MAX_SPEECH_CHUNK));
});

test("playback is user-started, one clip at a time, and replay reuses the fetched audio", async () => {
  const { player, requests } = setup();
  assert.equal(player.getState().status, "idle");
  const first = player.play("Magaling!", "fil");
  assert.equal(player.getState().status, "loading");
  await tick();
  assert.equal(player.getState().status, "playing");
  assert.equal(player.getState().key, "fil:Magaling!");
  // A second clip stops the first.
  const second = player.play("Try again.", "en");
  assert.equal(FakeAudio.all[0].paused, true);
  assert.equal(await first, false);
  await tick();
  FakeAudio.all[1].end();
  assert.equal(await second, true);
  assert.equal(player.getState().status, "idle");
  // Replay: no new synthesis request.
  const replay = player.play("Magaling!", "fil");
  await tick();
  FakeAudio.all[2].end();
  assert.equal(await replay, true);
  assert.deepEqual(requests, [["Magaling!", "fil"], ["Try again.", "en"]]);
});

test("the Philippine voice is requested only when asked for and cached apart from the default voice", async () => {
  FakeAudio.all = [];
  const requests: unknown[][] = [];
  const player = createFeedbackSpeechPlayer({
    synthesize: async (...args) => { requests.push(args); return new Blob(["mp3"]); },
    createAudio: (url) => new FakeAudio(url), createObjectURL: () => `blob:${requests.length}`, revokeObjectURL() {},
  });
  const play = async (...args: Parameters<typeof player.play>) => {
    const done = player.play(...args);
    await tick(); await tick();
    FakeAudio.all.at(-1)!.end();
    return done;
  };
  assert.equal(await play("Great job!", "en"), true);
  assert.equal(await play("Great job!", "en", undefined, "philippine"), true);
  assert.equal(await play("Great job!", "en", undefined, "philippine"), true);
  assert.equal(await play("Mahusay!", "fil", undefined, "philippine"), true);
  // One request per text, language and voice; replaying the Philippine clip reuses its audio.
  assert.deepEqual(requests, [["Great job!", "en", "default"], ["Great job!", "en", "philippine"], ["Mahusay!", "fil", "philippine"]]);
  assert.equal(playerModule.feedbackSpeechKey("dog", "en"), "en:dog", "default keys are unchanged (M6)");
  assert.equal(playerModule.feedbackSpeechKey("dog", "en", "philippine"), "philippine:en:dog");
});

test("stop during loading prevents playback; stopIf only stops its own clip", async () => {
  const { player } = setup();
  const pending = player.play("Hint: look at the first sentence.", "en");
  player.stop();
  assert.equal(await pending, false);
  assert.equal(FakeAudio.all.length, 0);
  assert.equal(player.getState().status, "idle");
  const playing = player.play("Correct!", "en");
  await tick();
  player.stopIf("en:Something else");
  assert.equal(player.getState().status, "playing");
  player.stopIf("en:Correct!");
  assert.equal(await playing, false);
  assert.equal(player.getState().status, "idle");
});

test("mute is remembered, stops current audio and blocks playback without requests", async () => {
  const { player, requests, saved } = setup();
  const playing = player.play("Magaling!", "fil");
  await tick();
  player.setMuted(true);
  assert.equal(await playing, false);
  assert.equal(saved.get(MUTED_STORAGE_KEY), "true");
  assert.equal(await player.play("Ulitin", "fil"), false);
  assert.equal(requests.length, 1);
  assert.equal(setup({ stored: "true" }).player.getState().muted, true);
});

test("synthesis and playback failures become an error state for that clip only", async () => {
  const failing = setup({ failSynthesis: true });
  assert.equal(await failing.player.play("Magaling!", "fil"), false);
  assert.deepEqual(failing.player.getState(), { status: "error", key: "fil:Magaling!", muted: false });
  const blocked = setup({ failPlay: true });
  assert.equal(await blocked.player.play("Magaling!", "fil"), false);
  assert.equal(blocked.player.getState().status, "error");
});

test("long feedback is capped and old cached audio is released", async () => {
  const { player, requests, revoked } = setup({ cacheLimit: 2 });
  const playing = player.play(Array.from({ length: 300 }, (_, i) => `Sentence ${i} is here.`).join(" "), "en");
  for (let i = 0; i < MAX_SPEECH_CHUNKS; i++) { await tick(); FakeAudio.all[i]?.end(); }
  assert.equal(await playing, true);
  assert.equal(requests.length, MAX_SPEECH_CHUNKS);
  assert.ok(requests.every(([text]) => text.length <= MAX_SPEECH_CHUNK));
  assert.deepEqual(revoked, ["blob:1", "blob:2"]);
});

// Executes the real control with a real player and a minimal React hook runtime.
function mountControls(props: Record<string, unknown>, player = setup().player) {
  const slots: any[] = [];
  let cursor = 0;
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value: any) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useEffect(callback: () => any, deps: unknown[]) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        previous?.cleanup?.();
        slots[index] = { deps, cleanup: callback() };
      }
    },
  };
  const module = { exports: {} as any };
  const source = readFileSync(new URL("../src/components/reading-feedback/FeedbackSpeechControls.tsx", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    module, exports: module.exports,
    require: (id: string) => {
      if (id === "react") return react;
      if (id === "lucide-react") return new Proxy({}, { get: (_, name) => String(name) });
      if (id.endsWith("/activityLanguage")) return activityLanguage;
      if (id.endsWith("/feedbackSpeechPlayer")) return playerModule;
      if (id.endsWith("/feedbackSpeech")) return { getFeedbackSpeech: () => player };
      if (id.endsWith(".css")) return {};
      return require(id);
    },
  });
  return {
    player,
    render(next: Record<string, unknown> = {}) { cursor = 0; return module.exports.default({ ...props, ...next }); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

const buttons = (tree: any): any[] => {
  if (!tree || typeof tree !== "object") return [];
  return [...(tree.type === "button" ? [tree] : []), ...[tree.props?.children].flat(Infinity).flatMap(buttons)];
};

test("controls play the shown text in the activity language, offer Stop, and stop on unmount", async () => {
  const c = mountControls({ text: "Pahiwatig: Basahin ang simula.", language: "fil", listenLabel: "Listen to the hint", showMute: true });
  let [listen, mute] = buttons(c.render());
  assert.equal(listen.props["aria-label"], "Pakinggan ang pahiwatig");
  assert.equal(mute.props["aria-label"], "I-mute ang audio");
  assert.equal(mute.props["aria-pressed"], false);
  // Nothing plays until the learner presses Listen.
  assert.equal(FakeAudio.all.length, 0);
  listen.props.onClick();
  await tick();
  [listen] = buttons(c.render());
  assert.equal(listen.props["aria-label"], "Ihinto ang audio");
  assert.equal(c.player.getState().key, "fil:Pahiwatig: Basahin ang simula.");
  c.unmount();
  assert.equal(c.player.getState().status, "idle");
  assert.equal(FakeAudio.all[0].paused, true);
});

test("controls are blocked while disabled, hidden when muted, and report unavailable audio", async () => {
  const c = mountControls({ text: "Correct!", language: "en", showMute: true });
  assert.equal(buttons(c.render({ disabled: true }))[0].props.disabled, true);
  buttons(c.render())[1].props.onClick();
  const muted = buttons(c.render());
  assert.equal(muted.length, 1);
  assert.equal(muted[0].props["aria-pressed"], true);
  const failing = mountControls({ text: "Correct!", language: "en" }, setup({ failSynthesis: true }).player);
  buttons(failing.render())[0].props.onClick();
  await tick();
  assert.match(JSON.stringify(failing.render()), /Audio is unavailable right now\. Please try again\./);
});

test("mascot styles respect reduced motion and the mascot never scores", () => {
  const css = readFileSync(new URL("../src/components/reading-feedback/ReadingFeedback.css", import.meta.url), "utf8");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^}]*\.reading-mascot-image[^}]*animation: none/);
  const mascot = readFileSync(new URL("../src/components/reading-feedback/ReadingMascot.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(mascot, /correct(Option|Answer)|summary|autoplay|\.play\(/i);
  assert.match(mascot, /alt="" aria-hidden="true"/);
  assert.doesNotMatch(mascot, /FeedbackSpeechControls|feedbackSpeech|synthesize|\bAudio\b|speechSynthesis/);
});

function loadMascotModule() {
  const module = { exports: {} as any };
  const source = readFileSync(new URL("../src/components/reading-feedback/ReadingMascot.tsx", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module, exports: module.exports, require: (id: string) => id.endsWith(".png") ? { default: id }
    : id.endsWith(".css") ? {} : id.endsWith("/activityLanguage") ? activityLanguage : require(id) });
  return module.exports;
}

test("phone popups never cover the protected controls and prefer the space just above them", () => {
  const { chooseCompactTop, PHONE_QUERY } = loadMascotModule();
  assert.equal(PHONE_QUERY, "(max-width: 480px)");
  const view = { top: 8, bottom: 632 };
  const box = (top: number, bottom: number) => ({ top, bottom, left: 20, right: 340 });
  const actions = [box(480, 520), box(530, 570), box(580, 620)];
  // Free space directly above the buttons: used.
  const above = chooseCompactTop(view, 100, 8, 352, actions, []);
  assert.ok(above + 100 <= 480 - 8, `${above}`);
  assert.ok(above >= 360, `${above}`);
  // Answer choices there: moves to the least-covered free space instead.
  const options = [box(280, 330), box(340, 390), box(400, 450)];
  const top = chooseCompactTop(view, 100, 8, 352, actions, options);
  assert.ok(top + 100 <= 280 || (top >= 450 && top + 100 <= 472), `${top}`);
  // Never over a protected control, whatever else is covered.
  const crowded = [box(8, 470)];
  const forced = chooseCompactTop(view, 100, 8, 352, actions, crowded);
  for (const control of actions) assert.ok(forced + 100 <= control.top - 8 || forced >= control.bottom + 8, `${forced}`);
});
