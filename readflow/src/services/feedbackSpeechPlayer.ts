/**
 * User-controlled playback of spoken feedback (Azure neural TTS through the
 * backend /api/tts). Nothing here plays on its own: audio starts only from
 * play(), one clip at a time. Synthesized clips are cached for the page session
 * so Replay never repeats a paid request. No imports, so it is unit-testable.
 */
export type FeedbackSpeechLanguage = "en" | "fil";
/** "philippine": the en-PH / fil-PH feedback voice (M5). "default": the server's configured voice. */
export type FeedbackSpeechVoice = "default" | "philippine";
export type FeedbackSpeechStatus = "idle" | "loading" | "playing" | "error";

export interface FeedbackSpeechState {
  status: FeedbackSpeechStatus;
  /** The clip the status belongs to; null when idle. */
  key: string | null;
  muted: boolean;
}

export interface AudioLike {
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: "ended" | "error", listener: () => void): void;
  removeEventListener(type: "ended" | "error", listener: () => void): void;
}

export interface FeedbackSpeechDependencies {
  synthesize(text: string, language: FeedbackSpeechLanguage, voice: FeedbackSpeechVoice): Promise<Blob>;
  createAudio(url: string): AudioLike;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  cacheLimit?: number;
}

/** Same limit as the backend (server/routes/speech.js MAX_TTS_TEXT_LENGTH). */
export const MAX_SPEECH_CHUNK = 1000;
/** Longest feedback is an explanation (1,500) plus evidence (1,000): three chunks. */
export const MAX_SPEECH_CHUNKS = 4;
export const MUTED_STORAGE_KEY = "basa.feedbackSpeech.muted";

export function feedbackSpeechKey(text: string, language: FeedbackSpeechLanguage, voice: FeedbackSpeechVoice = "default") {
  return voice === "default" ? `${language}:${text}` : `${voice}:${language}:${text}`;
}

/** Splits text at sentence, then word, boundaries into chunks the backend accepts. */
export function speechChunks(text: string, max = MAX_SPEECH_CHUNK): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];
  const pieces = clean.match(/[^.!?]+[.!?]*\s*/g) ?? [clean];
  const chunks: string[] = [];
  let current = "";
  const push = (piece: string) => {
    if ((current + piece).trim().length <= max) { current += piece; return; }
    if (current.trim()) chunks.push(current.trim());
    current = piece;
  };
  for (const sentence of pieces) {
    if (sentence.trim().length <= max) { push(sentence); continue; }
    for (const word of sentence.split(/(?<=\s)/)) {
      for (let start = 0; start < word.length; start += max) push(word.slice(start, start + max));
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function createFeedbackSpeechPlayer(deps: FeedbackSpeechDependencies) {
  const cacheLimit = deps.cacheLimit ?? 30;
  const cache = new Map<string, string>();
  const listeners = new Set<() => void>();
  let muted = false;
  try { muted = deps.storage?.getItem(MUTED_STORAGE_KEY) === "true"; } catch { /* storage unavailable */ }
  let state: FeedbackSpeechState = { status: "idle", key: null, muted };
  let generation = 0;
  let audio: AudioLike | null = null;
  let endCurrent: (() => void) | null = null;

  function set(next: Partial<FeedbackSpeechState>) {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  }

  async function clipUrl(chunk: string, language: FeedbackSpeechLanguage, voice: FeedbackSpeechVoice) {
    const cacheKey = feedbackSpeechKey(chunk, language, voice);
    const cached = cache.get(cacheKey);
    if (cached) {
      cache.delete(cacheKey);
      cache.set(cacheKey, cached);
      return cached;
    }
    const url = deps.createObjectURL(await deps.synthesize(chunk, language, voice));
    cache.set(cacheKey, url);
    while (cache.size > cacheLimit) {
      const [oldest, oldUrl] = cache.entries().next().value as [string, string];
      cache.delete(oldest);
      deps.revokeObjectURL(oldUrl);
    }
    return url;
  }

  function playClip(url: string) {
    return new Promise<void>((resolve, reject) => {
      const element = deps.createAudio(url);
      const cleanup = () => {
        element.removeEventListener("ended", ended);
        element.removeEventListener("error", failed);
        if (audio === element) audio = null;
        if (endCurrent === ended) endCurrent = null;
      };
      const ended = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error("Audio playback failed.")); };
      audio = element;
      // stop() ends the wait without an error.
      endCurrent = ended;
      element.addEventListener("ended", ended);
      element.addEventListener("error", failed);
      element.play().catch(failed);
    });
  }

  function stop() {
    generation += 1;
    audio?.pause();
    const end = endCurrent;
    endCurrent = null;
    end?.();
    if (state.status !== "idle" || state.key !== null) set({ status: "idle", key: null });
  }

  /** Plays text in the given language and voice. Resolves true only if it played to the end. */
  async function play(text: string, language: FeedbackSpeechLanguage, key?: string, voice: FeedbackSpeechVoice = "default") {
    key ??= feedbackSpeechKey(text, language, voice);
    stop();
    const chunks = speechChunks(text).slice(0, MAX_SPEECH_CHUNKS);
    if (state.muted || !chunks.length) return false;
    const current = ++generation;
    set({ status: "loading", key });
    try {
      for (const chunk of chunks) {
        const url = await clipUrl(chunk, language, voice);
        if (current !== generation) return false;
        set({ status: "playing", key });
        await playClip(url);
        if (current !== generation) return false;
      }
      set({ status: "idle", key: null });
      return true;
    } catch {
      if (current === generation) set({ status: "error", key });
      return false;
    }
  }

  return {
    play,
    stop,
    /** Stops only when this clip is the one loading or playing (e.g. on unmount). */
    stopIf(key: string) {
      if (state.key === key && state.status !== "error") stop();
    },
    setMuted(value: boolean) {
      if (value) stop();
      try { deps.storage?.setItem(MUTED_STORAGE_KEY, String(value)); } catch { /* storage unavailable */ }
      set({ muted: value });
    },
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export type FeedbackSpeechPlayer = ReturnType<typeof createFeedbackSpeechPlayer>;
