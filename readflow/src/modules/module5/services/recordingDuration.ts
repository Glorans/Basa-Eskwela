/** The parts of an audio element used to find a recording's length. */
export interface DurationAudio {
  duration: number;
  currentTime: number;
  addEventListener(type: "durationchange" | "timeupdate", listener: () => void): void;
  removeEventListener(type: "durationchange" | "timeupdate", listener: () => void): void;
}

/**
 * Chrome's MediaRecorder writes WebM without a duration, so the player shows no
 * length and seeks poorly. Seeking far past the end once makes the browser read
 * the real duration; the player then returns to the start. Call on loadedmetadata.
 */
export function resolveRecordingDuration(audio: DurationAudio) {
  if (Number.isFinite(audio.duration)) return;
  const settle = () => {
    if (!Number.isFinite(audio.duration)) return;
    audio.removeEventListener("durationchange", settle);
    audio.removeEventListener("timeupdate", settle);
    audio.currentTime = 0;
  };
  audio.addEventListener("durationchange", settle);
  audio.addEventListener("timeupdate", settle);
  audio.currentTime = Number.MAX_SAFE_INTEGER;
}
