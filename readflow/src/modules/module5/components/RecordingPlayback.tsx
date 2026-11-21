import { getActivityText } from "../../../pages/reading-activity/activityLanguage";
import { useEffect, useMemo, useRef, useState } from "react";
import { getOralReadingRecording } from "../services/oralReadingService";
import { createSegmentPlaybackQueue } from "../services/recordingPlaybackQueue";
import { resolveRecordingDuration } from "../services/recordingDuration";

interface RecordingPlaybackProps {
  attemptId: string;
  teacher?: boolean;
  /** Admin student review: the Admin route, worded like Teacher review. */
  admin?: boolean;
  language?: "en" | "fil";
}

export default function RecordingPlayback({ attemptId, teacher = false, admin = false, language = "en" }: RecordingPlaybackProps) {
  const reviewer = admin ? "admin" : teacher;
  const [segments, setSegments] = useState<string[]>();
  const [error, setError] = useState<"load" | "playback">();
  const [retry, setRetry] = useState(0);
  const audioRefs = useRef<(HTMLAudioElement | null)[]>([]);
  // The signed recording links expire after a few minutes: the first playback error fetches fresh links once,
  // through the same authorized endpoint, before an error is shown. Reset by every successful load.
  const refreshedAfterError = useRef(false);
  const { t } = getActivityText(language);
  const queue = useMemo(
    () => createSegmentPlaybackQueue((index) => audioRefs.current[index], () => audioRefs.current.length),
    [],
  );

  useEffect(() => {
    let active = true;
    setSegments(undefined);
    setError(undefined);
    void getOralReadingRecording(attemptId, reviewer)
      .then((recording) => {
        if (active) setSegments(recording.available ? recording.segments : []);
      })
      .catch(() => {
        if (active) setError("load");
      });
    return () => {
      active = false;
    };
  }, [attemptId, reviewer, retry]);
  useEffect(() => { refreshedAfterError.current = false; }, [attemptId]);
  const handlePlaybackError = () => {
    if (!refreshedAfterError.current) {
      refreshedAfterError.current = true;
      setRetry((value) => value + 1);
      return;
    }
    setError("playback");
  };

  audioRefs.current.length = segments?.length ?? 0;

  return (
    <section
      lang={language}
      aria-label={t("Read-aloud recording")}
      style={{ padding: "20px", borderRadius: "16px", background: "#fff9e9", margin: "16px 0" }}
    >
      <h3>{t(reviewer ? "Student’s recording" : "Listen to your recording")}</h3>
      <p>{t(reviewer ? "Listen while comparing the saved passage and transcript below." : "Listen to your reading and practice words you want to improve.")}</p>
      {!segments && !error && <p role="status">{t("Loading recording…")}</p>}
      {segments?.length === 0 && <p>{t("Recording unavailable for this activity. Older results may not have saved audio.")}</p>}
      {segments && segments.length > 1 && <p>{t("Playback continues automatically to the next part.")}</p>}
      {segments?.map((src, index) => (
        <div key={src}>
          {segments.length > 1 && <p>{t("Part {index} of {total}", { index: index + 1, total: segments.length })}</p>}
          <audio
            ref={(element) => {
              audioRefs.current[index] = element;
            }}
            controls
            preload={index === 0 ? "metadata" : "none"}
            src={src}
            aria-label={segments.length > 1 ? t("Read-aloud recording part {index}", { index: index + 1 }) : t("Read-aloud recording")}
            style={{ width: "100%" }}
            onLoadedMetadata={(event) => { refreshedAfterError.current = false; resolveRecordingDuration(event.currentTarget); }}
            onPlay={() => queue.handlePlay(index)}
            onEnded={() => queue.handleEnded(index)}
            onError={handlePlaybackError}
          />
        </div>
      ))}
      {error && <p role="alert">{error === "playback" ? t("Audio could not load or its link expired. Reload the recording to try again.") : t("Unable to load recording. Please retry.")}</p>}
      {/* Only after a real error: a loaded player that has not read its length yet is not broken. */}
      {error && (
        <button type="button" onClick={() => { refreshedAfterError.current = false; setRetry((value) => value + 1); }}>
          {t("Reload recording")}
        </button>
      )}
    </section>
  );
}
