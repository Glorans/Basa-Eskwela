import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useDiagnosticStreamingSpeech } from "../../modules/module2/hooks/useDiagnosticStreamingSpeech";
import { getReadingWords } from "../../modules/module2/services/diagnosticScoring";
import { LiveReadingTracker } from "../../modules/module2/services/liveReadingAlignment";
import type { DiagnosticLanguage } from "../../modules/module2/types/diagnostic";
import {
  STORY_GLIDE_MS,
  acceptVoicePosition,
  lastPageStart,
  lineForOffset,
  linesPerPage,
  paceEstimate,
  scrollTargetLine,
  totalLines,
  usesVoice,
} from "./voiceFollow";

const TICK_MS = 250;
const RETRY_DELAY_MS = 4000;
const MAX_RETRIES = 3;

interface StoryLayout {
  lineHeight: number;
  pageLines: number;
  lineCount: number;
  wordLines: number[];
}

/** Measures real line positions of the rendered word spans (`data-word`). */
function measureStory(viewport: HTMLElement): StoryLayout | null {
  const text = viewport.firstElementChild as HTMLElement | null;
  const paragraph = viewport.querySelector("p");
  if (!text || !paragraph) return null;
  const style = getComputedStyle(paragraph);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.9;
  if (!(lineHeight > 0)) return null;
  const textRect = text.getBoundingClientRect();
  const wordLines: number[] = [];
  text.querySelectorAll<HTMLElement>("[data-word]").forEach((word) => {
    const rect = word.getClientRects()[0] ?? word.getBoundingClientRect();
    wordLines[Number(word.dataset.word)] = lineForOffset((rect.top + rect.bottom) / 2 - textRect.top, lineHeight);
  });
  return {
    lineHeight,
    pageLines: linesPerPage(viewport.clientHeight, lineHeight),
    lineCount: totalLines(textRect.height, lineHeight),
    wordLines: Array.from(wordLines, (line, index) => line ?? wordLines[index - 1] ?? 0),
  };
}

/**
 * Moves the story up to follow the child's voice while recording.
 *
 * VISUAL ONLY, like Module 2: it borrows the recorder's microphone stream and
 * the existing diagnostic speech stream. The live transcript is never saved or
 * sent anywhere else, and scoring always uses the saved recording.
 *
 * When live recognition is unavailable or silent for LIVE_SILENCE_MS, the text
 * follows a pace estimate from the last known position, and switches back to
 * the recognized position when recognition returns. Pass the returned
 * callbacks to useAudioRecorder's onStreamReady / onStreamStopped.
 */
export function useVoiceFollowStoryScroll(
  viewportRef: RefObject<HTMLElement | null>,
  words: readonly string[],
  language: DiagnosticLanguage,
) {
  const streaming = useDiagnosticStreamingSpeech(language);
  const [listening, setListening] = useState(false);
  const wordsKey = words.join(" ");
  const live = useRef({
    stream: null as MediaStream | null,
    tracker: null as LiveReadingTracker | null,
    trackerOffset: 0,
    spokenWords: 0,
    lastVoice: -1,
    lastVoiceAt: 0,
    lastHeardAt: 0,
    effective: -1,
    topLine: 0,
    retries: 0,
  });

  const startTracking = useCallback((offset: number) => {
    const state = live.current;
    state.tracker = new LiveReadingTracker(wordsKey.split(" ").slice(offset).join(" "));
    state.trackerOffset = offset;
    state.spokenWords = 0;
  }, [wordsKey]);

  const onStreamReady = useCallback((stream: MediaStream) => {
    const now = performance.now();
    Object.assign(live.current, {
      stream, spokenWords: 0, lastVoice: -1, lastVoiceAt: now, lastHeardAt: now,
      effective: -1, topLine: 0, retries: 0,
    });
    startTracking(0);
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
    streaming.reset();
    streaming.start(stream);
    setListening(true);
  }, [startTracking, streaming.reset, streaming.start, viewportRef]);

  const onStreamStopped = useCallback(() => {
    // Visual only: the live transcript is not needed after recording stops.
    live.current.stream = null;
    streaming.cancel();
    setListening(false);
  }, [streaming.cancel]);

  // Recognized words move the voice position forward only.
  useEffect(() => {
    const state = live.current;
    if (!listening || !state.tracker) return;
    const spoken = getReadingWords(`${streaming.confirmedTranscript} ${streaming.interimTranscript}`).length;
    const newSpokenWords = spoken - state.spokenWords;
    if (newSpokenWords <= 0) return;
    state.spokenWords = spoken;
    state.lastHeardAt = performance.now();
    const progress = state.tracker.update(streaming.confirmedTranscript, streaming.interimTranscript);
    if (progress.previewCursor < 0) return;
    const accepted = acceptVoicePosition(state.lastVoice, state.trackerOffset + progress.previewCursor, newSpokenWords);
    if (accepted > state.lastVoice) {
      state.lastVoice = accepted;
      state.lastVoiceAt = state.lastHeardAt;
    }
  }, [listening, streaming.confirmedTranscript, streaming.interimTranscript]);

  // A dropped connection is retried from the last known position; the pace
  // estimate keeps the text moving meanwhile.
  useEffect(() => {
    const state = live.current;
    if (!listening || !streaming.failed || state.retries >= MAX_RETRIES) return;
    const timer = window.setTimeout(() => {
      if (!state.stream) return;
      state.retries += 1;
      streaming.reset();
      startTracking(Math.max(0, state.lastVoice + 1));
      streaming.start(state.stream);
    }, RETRY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [listening, streaming.failed, streaming.reset, streaming.start, startTracking]);

  // Moves the text up when the position reaches the last visible line.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!listening || !viewport) return;
    const state = live.current;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let animation = 0;
    let programmaticUntil = 0;

    const glideTo = (top: number) => {
      cancelAnimationFrame(animation);
      const target = Math.max(0, Math.min(top, viewport.scrollHeight - viewport.clientHeight));
      programmaticUntil = performance.now() + STORY_GLIDE_MS + 150;
      if (reduceMotion) { viewport.scrollTop = target; return; }
      const from = viewport.scrollTop;
      const began = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - began) / STORY_GLIDE_MS);
        viewport.scrollTop = from + (target - from) * (1 - (1 - progress) ** 3);
        if (progress < 1) animation = requestAnimationFrame(step);
      };
      animation = requestAnimationFrame(step);
    };

    const tick = window.setInterval(() => {
      const layout = measureStory(viewport);
      if (!layout || lastPageStart(layout.lineCount, layout.pageLines) === 0) return; // the story fits
      const now = performance.now();
      const position = usesVoice(now, state.lastHeardAt, streaming.failed)
        ? state.lastVoice
        : paceEstimate(state.lastVoice, state.lastVoiceAt, now, layout.wordLines.length);
      state.effective = Math.max(state.effective, position);
      const target = scrollTargetLine(state.effective, layout.wordLines, state.topLine, layout.pageLines, layout.lineCount);
      if (target === null) return;
      state.topLine = target;
      glideTo(target * layout.lineHeight);
    }, TICK_MS);

    // A hand scroll moves the reference line forward only.
    const scrolled = () => {
      if (performance.now() < programmaticUntil) return;
      const layout = measureStory(viewport);
      if (layout) state.topLine = Math.max(state.topLine, Math.round(viewport.scrollTop / layout.lineHeight));
    };
    viewport.addEventListener("scroll", scrolled, { passive: true });

    return () => {
      window.clearInterval(tick);
      cancelAnimationFrame(animation);
      viewport.removeEventListener("scroll", scrolled);
    };
  }, [listening, streaming.failed, viewportRef]);

  return { onStreamReady, onStreamStopped };
}
