import { useEffect, useMemo, useRef, useState } from "react";
import { getOralReadingRecording } from "../services/oralReadingService";
import { createSegmentPlaybackQueue } from "../services/recordingPlaybackQueue";

interface RecordingPlaybackProps {
  attemptId: string;
  teacher?: boolean;
  language?: "en" | "fil";
}

const TEXT = {
  fil: {
    region: "Rekording ng pagbasa",
    title: (teacher: boolean) => (teacher ? "Rekording ng mag-aaral" : "Pakinggan ang iyong rekording"),
    description: (teacher: boolean) =>
      teacher
        ? "Pakinggan ang rekording habang inihahambing ito sa teksto at transkripsiyon sa ibaba."
        : "Pakinggan ang iyong pagbasa at sanayin ang mga salitang nais mong pagbutihin.",
    continuous: "Kusang magpapatuloy ang pagtugtog sa susunod na bahagi.",
    loading: "Kinukuha ang rekording…",
    unavailable:
      "Walang naka-save na rekording para sa gawaing ito. Maaaring walang naitalang audio sa mga naunang resulta.",
    loadError: "Hindi makuha ang rekording. Pakisubukang muli.",
    playbackError:
      "Hindi mapatugtog ang rekording o nag-expire na ang link nito. Pindutin ang “Kunin muli ang rekording” upang subukang muli.",
    reload: "Kunin muli ang rekording",
    part: (index: number, total: number) => `Bahagi ${index} sa ${total}`,
    audioLabel: (index: number) => `Rekording ng pagbasa, bahagi ${index}`,
  },
  en: {
    region: "Read-aloud recording",
    title: (teacher: boolean) => (teacher ? "Student’s recording" : "Listen to your recording"),
    description: (teacher: boolean) =>
      teacher
        ? "Listen while comparing the saved passage and transcript below."
        : "Listen to your reading and practice words you want to improve.",
    continuous: "Playback continues automatically to the next part.",
    loading: "Loading recording…",
    unavailable: "Recording unavailable for this activity. Older results may not have saved audio.",
    loadError: "Unable to load recording. Please retry.",
    playbackError: "Audio could not load or its link expired. Reload the recording to try again.",
    reload: "Reload recording",
    part: (index: number, total: number) => `Part ${index} of ${total}`,
    audioLabel: (index: number) => `Read-aloud recording part ${index}`,
  },
} as const;

export default function RecordingPlayback({ attemptId, teacher = false, language = "en" }: RecordingPlaybackProps) {
  const [segments, setSegments] = useState<string[]>();
  const [error, setError] = useState<"load" | "playback">();
  const [retry, setRetry] = useState(0);
  const audioRefs = useRef<(HTMLAudioElement | null)[]>([]);
  const text = TEXT[language === "fil" ? "fil" : "en"];
  const queue = useMemo(
    () => createSegmentPlaybackQueue((index) => audioRefs.current[index], () => audioRefs.current.length),
    [],
  );

  useEffect(() => {
    let active = true;
    setSegments(undefined);
    setError(undefined);
    void getOralReadingRecording(attemptId, teacher)
      .then((recording) => {
        if (active) setSegments(recording.available ? recording.segments : []);
      })
      .catch(() => {
        if (active) setError("load");
      });
    return () => {
      active = false;
    };
  }, [attemptId, teacher, retry]);

  audioRefs.current.length = segments?.length ?? 0;

  return (
    <section
      lang={language}
      aria-label={text.region}
      style={{ padding: "20px", borderRadius: "16px", background: "#fff9e9", margin: "16px 0" }}
    >
      <h3>{text.title(teacher)}</h3>
      <p>{text.description(teacher)}</p>
      {!segments && !error && <p role="status">{text.loading}</p>}
      {segments?.length === 0 && <p>{text.unavailable}</p>}
      {segments && segments.length > 1 && <p>{text.continuous}</p>}
      {segments?.map((src, index) => (
        <div key={src}>
          {segments.length > 1 && <p>{text.part(index + 1, segments.length)}</p>}
          <audio
            ref={(element) => {
              audioRefs.current[index] = element;
            }}
            controls
            preload={index === 0 ? "metadata" : "none"}
            src={src}
            aria-label={text.audioLabel(index + 1)}
            style={{ width: "100%" }}
            onPlay={() => queue.handlePlay(index)}
            onEnded={() => queue.handleEnded(index)}
            onError={() => setError("playback")}
          />
        </div>
      ))}
      {error && <p role="alert">{error === "playback" ? text.playbackError : text.loadError}</p>}
      {(error || !!segments?.length) && (
        <button type="button" onClick={() => setRetry((value) => value + 1)}>
          {text.reload}
        </button>
      )}
    </section>
  );
}
