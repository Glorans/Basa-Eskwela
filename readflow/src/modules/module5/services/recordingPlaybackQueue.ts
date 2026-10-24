/**
 * New read-aloud recordings are saved as one continuous file. Older results were saved as
 * ~25 s parts; for those, playback continues from one part to the next in saved order and
 * every part keeps its own manual controls.
 */
export interface PlayableSegment {
  paused: boolean;
  currentTime: number;
  preload: string;
  play(): Promise<void> | void;
  pause(): void;
}

export function nextSegmentIndex(current: number, total: number): number | null {
  if (!Number.isInteger(current) || current < 0 || current + 1 >= total) return null;
  return current + 1;
}

export function createSegmentPlaybackQueue(
  getSegment: (index: number) => PlayableSegment | null | undefined,
  getTotal: () => number,
) {
  return {
    /** Only one part plays at a time, and the following part starts loading early. */
    handlePlay(index: number) {
      const total = getTotal();
      for (let other = 0; other < total; other++) {
        const segment = getSegment(other);
        if (other !== index && segment && !segment.paused) segment.pause();
      }
      const next = nextSegmentIndex(index, total);
      const following = next === null ? null : getSegment(next);
      if (following && following.preload === "none") following.preload = "auto";
    },
    /** Starts the next part from its beginning. Returns the started index, if any. */
    handleEnded(index: number): number | null {
      const next = nextSegmentIndex(index, getTotal());
      const segment = next === null ? null : getSegment(next);
      if (next === null || !segment) return null;
      segment.currentTime = 0;
      // A blocked autoplay leaves the part ready for a manual press.
      void Promise.resolve()
        .then(() => segment.play())
        .catch(() => undefined);
      return next;
    },
  };
}
