import { useEffect, useRef } from "react";

/** Follows visual progress inside the story only; never participates in scoring. */
export function useDiagnosticStoryScroll(
  latestVisualWordIndex: number,
  isRecording: boolean,
  readingAttempt: number,
) {
  const storyCardRef = useRef<HTMLElement | null>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const lastWordIndex = useRef(-1);
  const lastScrollTarget = useRef(0);

  useEffect(() => {
    lastWordIndex.current = -1;
    lastScrollTarget.current = 0;
    storyCardRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [readingAttempt]);

  useEffect(() => {
    if (!isRecording || latestVisualWordIndex <= lastWordIndex.current) return;
    lastWordIndex.current = latestVisualWordIndex;

    const card = storyCardRef.current;
    const word = wordRefs.current[latestVisualWordIndex];
    if (!card || !word || card.clientHeight === 0) return;

    const wordBottom = word.getBoundingClientRect().bottom
      - card.getBoundingClientRect().top - card.clientTop;
    if (wordBottom < card.clientHeight * 0.68) return;

    const top = Math.min(
      card.scrollHeight - card.clientHeight,
      card.scrollTop + wordBottom - card.clientHeight * 0.45,
    );
    // Words on the same line must not restart an in-flight smooth scroll.
    // Wheel/touch scrolling remains native; following resumes on later lines.
    if (top <= Math.max(card.scrollTop, lastScrollTarget.current) + 1) return;
    lastScrollTarget.current = top;
    card.scrollTo({
      top,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto" : "smooth",
    });
  }, [latestVisualWordIndex, isRecording, readingAttempt]);

  return { storyCardRef, wordRefs };
}
