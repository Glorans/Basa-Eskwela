import { useEffect, useRef, useState } from "react";

const INITIAL_MESSAGE = "Press the microphone button when you're ready.";
const PREFERRED_MIME_TYPE = "audio/webm;codecs=opus";

// How long a finished session waits for the continuous recorder's final data.
const FULL_RECORDING_STOP_TIMEOUT_MS = 5000;

interface AudioRecorderOptions {
  /**
   * Also records the whole session, start to stop, with one MediaRecorder on the
   * same stream. The rotating segments are still produced for speech processing;
   * the continuous file is the one to save and replay.
   */
  captureFullRecording?: boolean;
  createPlaybackUrls?: boolean;
  maxSegmentDurationSeconds?: number;
  maxTotalDurationSeconds?: number;
  onStreamReady?: (stream: MediaStream) => void;
  onStreamStopped?: (reason: StreamStopReason) => void;
  preserveOnTrackEnd?: boolean;
}

type RecorderStopReason = "manual" | "rotate" | "maximum";
type RecorderStopAction =
  | "rotate"
  | "finish-manual"
  | "finish-maximum"
  | "abort";
type StreamStopReason = "manual" | "maximum" | "unmount" | "fatal";

function logRecorderLifecycle(
  event: string,
  details: Record<string, unknown> = {},
) {
  if (import.meta.env?.DEV) {
    console.info(`[AudioRecorder] ${event}`, {
      timestamp: new Date().toISOString(),
      ...details,
    });
  }
}

export function getRecorderStopAction(
  reason: RecorderStopReason,
  sessionIsActive: boolean,
  terminalReason: "manual" | "maximum" | null = null,
): RecorderStopAction {
  if (reason === "rotate" && sessionIsActive) return "rotate";
  if (terminalReason !== null) {
    return terminalReason === "maximum" ? "finish-maximum" : "finish-manual";
  }
  if (reason === "rotate") return "abort";
  return reason === "maximum" ? "finish-maximum" : "finish-manual";
}

export function useAudioRecorder(options: AudioRecorderOptions = {}) {
  const observerOptionsRef = useRef(options);
  observerOptionsRef.current = options;
  const [isRecording, setIsRecording] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [audioSegments, setAudioSegments] = useState<Blob[]>([]);
  const [audioURLs, setAudioURLs] = useState<string[]>([]);
  const [segmentDurationsSeconds, setSegmentDurationsSeconds] = useState<number[]>([]);
  const [fullRecording, setFullRecording] = useState<Blob | null>(null);
  const [fullRecordingURL, setFullRecordingURL] = useState<string | null>(null);
  const [message, setMessage] = useState(INITIAL_MESSAGE);
  const [recordingDurationSeconds, setRecordingDurationSeconds] = useState<
    number | null
  >(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const fullRecorderRef = useRef<MediaRecorder | null>(null);
  // Identifies the session whose continuous recording may still be published.
  const sessionTokenRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const capturedSegmentsRef = useRef<Blob[]>([]);
  const capturedDurationsRef = useRef<number[]>([]);
  const segmentTimerRef = useRef<number | null>(null);
  const maximumTimerRef = useRef<number | null>(null);
  const stopCurrentSegmentRef = useRef<
    ((reason: RecorderStopReason) => void) | null
  >(null);
  const stopSessionRef = useRef<((reason: "manual" | "maximum") => void) | null>(null);
  const mountedRef = useRef(false);
  const startingRef = useRef(false);
  const sessionActiveRef = useRef(false);
  const sessionFinalizedRef = useRef(true);
  const sessionStartedAtRef = useRef<number | null>(null);
  const sessionEndedAtRef = useRef<number | null>(null);
  const terminalStopReasonRef = useRef<"manual" | "maximum" | null>(null);
  const nextSegmentIndexRef = useRef(1);
  const trackEndedHandlersRef = useRef(
    new Map<MediaStreamTrack, () => void>(),
  );
  const captureFullRecording = options.captureFullRecording ?? false;
  const createPlaybackUrls = options.createPlaybackUrls ?? true;
  const maxSegmentDurationSeconds = options.maxSegmentDurationSeconds;
  const maxTotalDurationSeconds = options.maxTotalDurationSeconds;
  const preserveOnTrackEnd = options.preserveOnTrackEnd ?? false;

  function clearTimers() {
    if (segmentTimerRef.current !== null) {
      window.clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }

    if (maximumTimerRef.current !== null) {
      window.clearTimeout(maximumTimerRef.current);
      maximumTimerRef.current = null;
    }
  }

  function releaseRecorder() {
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    stopCurrentSegmentRef.current = null;
    stopSessionRef.current = null;
    if (!recorder) return;

    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.onerror = null;
    if (recorder.state !== "inactive") {
      try { recorder.stop(); } catch {
        // Cleanup still releases the microphone if the recorder already ended.
      }
    }
  }

  /** Discards the continuous recording of a failed or abandoned session. */
  function releaseFullRecorder() {
    const recorder = fullRecorderRef.current;
    fullRecorderRef.current = null;
    if (!recorder) return;
    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.onerror = null;
    if (recorder.state !== "inactive") {
      try { recorder.stop(); } catch {
        // The recorder already ended with its stream.
      }
    }
  }

  /** Ends the continuous recording; its onstop handler delivers the file. */
  function stopFullRecorder() {
    const recorder = fullRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    try { recorder.stop(); } catch {
      // onerror or the stop timeout settles the pending file.
    }
  }

  function stopStream(reason: StreamStopReason) {
    const stream = streamRef.current;
    streamRef.current = null;
    if (!stream) return;

    // Observers borrow the microphone; their failures never control recording.
    try { observerOptionsRef.current.onStreamStopped?.(reason); } catch {
      logRecorderLifecycle("stream observer cleanup failed");
    }

    stream.getTracks().forEach((track) => {
      const endedHandler = trackEndedHandlersRef.current.get(track);
      if (endedHandler) track.removeEventListener("ended", endedHandler);
      trackEndedHandlersRef.current.delete(track);
      track.stop();
    });
    logRecorderLifecycle("MediaStream stopped", { reason });
  }

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      sessionActiveRef.current = false;
      sessionFinalizedRef.current = true;
      clearTimers();
      releaseRecorder();
      releaseFullRecorder();
      capturedSegmentsRef.current = [];
      capturedDurationsRef.current = [];
      stopStream("unmount");
    };
  }, []);

  useEffect(() => {
    return () => {
      audioURLs.forEach((audioURL) => URL.revokeObjectURL(audioURL));
    };
  }, [audioURLs]);

  useEffect(() => {
    return () => {
      if (fullRecordingURL) URL.revokeObjectURL(fullRecordingURL);
    };
  }, [fullRecordingURL]);

  const resetRecording = () => {
    if (isRecording || isStarting || isStopping) return;
    capturedSegmentsRef.current = [];
    capturedDurationsRef.current = [];
    setAudioSegments([]);
    setAudioURLs([]);
    setFullRecording(null);
    setFullRecordingURL(null);
    setSegmentDurationsSeconds([]);
    setRecordingDurationSeconds(null);
    setMessage(INITIAL_MESSAGE);
  };

  const startRecording = async () => {
    if (startingRef.current || sessionActiveRef.current || mediaRecorderRef.current) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMessage("Audio recording is unavailable. Use a supported browser on HTTPS or localhost.");
      return;
    }

    startingRef.current = true;
    setIsStarting(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        logRecorderLifecycle("MediaStream stopped", { reason: "unmount" });
        return;
      }

      streamRef.current = stream;
      logRecorderLifecycle("microphone stream opened");
      sessionTokenRef.current += 1;
      const sessionToken = sessionTokenRef.current;
      capturedSegmentsRef.current = [];
      capturedDurationsRef.current = [];
      setAudioSegments([]);
      setAudioURLs([]);
      setFullRecording(null);
      setFullRecordingURL(null);
      setSegmentDurationsSeconds([]);
      setRecordingDurationSeconds(null);
      sessionActiveRef.current = true;
      sessionFinalizedRef.current = false;
      sessionStartedAtRef.current = performance.now();
      sessionEndedAtRef.current = null;
      terminalStopReasonRef.current = null;
      nextSegmentIndexRef.current = 1;
      logRecorderLifecycle("session start", {
        sessionStartTimestamp: new Date().toISOString(),
      });
      const recorderOptions = MediaRecorder.isTypeSupported(PREFERRED_MIME_TYPE)
        ? { mimeType: PREFERRED_MIME_TYPE }
        : undefined;
      let microphoneEnded = false;
      // Resolves with the continuous file, or null if it could not be recorded.
      let fullRecordingDone: Promise<Blob | null> = Promise.resolve(null);

      const abortRecording = (source: string) => {
        if (sessionFinalizedRef.current) return;
        sessionFinalizedRef.current = true;
        sessionActiveRef.current = false;
        clearTimers();
        logRecorderLifecycle("fatal microphone error", { source });
        releaseRecorder();
        releaseFullRecorder();
        stopStream("fatal");
        capturedSegmentsRef.current = [];
        capturedDurationsRef.current = [];

        if (mountedRef.current) {
          setIsRecording(false);
          setIsStopping(false);
          setAudioSegments([]);
          setAudioURLs([]);
          setSegmentDurationsSeconds([]);
          setRecordingDurationSeconds(null);
          setMessage("Recording failed. Please try again.");
        }
      };

      const finishRecording = (reason: "manual" | "maximum") => {
        if (sessionFinalizedRef.current) return;
        sessionFinalizedRef.current = true;
        clearTimers();
        sessionActiveRef.current = false;
        mediaRecorderRef.current = null;
        stopCurrentSegmentRef.current = null;
        stopSessionRef.current = null;
        // Flush the continuous file before the microphone tracks end.
        stopFullRecorder();
        stopStream(reason);

        if (!mountedRef.current) return;

        const segments = [...capturedSegmentsRef.current];
        const durations = [...capturedDurationsRef.current];
        const startedAt = sessionStartedAtRef.current;
        const endedAt = sessionEndedAtRef.current ?? performance.now();
        setIsRecording(false);

        const publish = (full: Blob | null) => {
          fullRecorderRef.current = null;
          setIsStopping(false);

          if (segments.length === 0) {
            setRecordingDurationSeconds(null);
            setMessage("No audio was captured. Please try again.");
            return;
          }

          setAudioSegments(segments);
          setAudioURLs(
            createPlaybackUrls
              ? segments.map((segment) => URL.createObjectURL(segment))
              : [],
          );
          setFullRecording(full);
          setFullRecordingURL(full && createPlaybackUrls ? URL.createObjectURL(full) : null);
          setSegmentDurationsSeconds(durations);
          setRecordingDurationSeconds(startedAt === null
            ? durations.reduce((total, duration) => total + duration, 0)
            : Math.max(0, (endedAt - startedAt) / 1000));
          setMessage(
            reason === "maximum"
              ? "Recording reached the five-minute limit. Your reading was captured successfully."
              : "Recording complete. Your reading was captured successfully.",
          );
        };

        if (!captureFullRecording) {
          publish(null);
          return;
        }
        // Results appear only once the continuous file is final, so nothing is
        // processed or saved from a partial recording.
        let timeout: number | undefined;
        void Promise.race([
          fullRecordingDone,
          new Promise<null>((resolve) => {
            timeout = window.setTimeout(() => resolve(null), FULL_RECORDING_STOP_TIMEOUT_MS);
          }),
        ]).then((full) => {
          window.clearTimeout(timeout);
          if (!mountedRef.current || sessionTokenRef.current !== sessionToken) return;
          if (!full) logRecorderLifecycle("continuous recording unavailable; keeping segments");
          publish(full);
        });
      };

      const startSegment = (): boolean => {
        if (!sessionActiveRef.current || sessionFinalizedRef.current) return false;

        let recorder: MediaRecorder;
        try {
          recorder = new MediaRecorder(stream, recorderOptions);
        } catch {
          abortRecording("MediaRecorder construction failed");
          return false;
        }

        const segmentIndex = nextSegmentIndexRef.current;
        nextSegmentIndexRef.current += 1;
        const chunks: Blob[] = [];
        const segmentStartedAt = performance.now();
        let segmentStoppedAt: number | null = null;
        let stopReason: RecorderStopReason | null = null;
        let segmentStopRequested = false;
        mediaRecorderRef.current = recorder;

        const requestSegmentStop = (reason: RecorderStopReason) => {
          if (segmentStopRequested) return;
          segmentStopRequested = true;
          stopReason = reason;
          segmentStoppedAt = performance.now();
          if (reason === "rotate") {
            logRecorderLifecycle("internal segment stop", { segmentIndex });
          }

          if (recorder.state === "inactive") {
            // Track loss may already have queued MediaRecorder's final data/stop
            // events. Let those events preserve the captured recording.
            if (microphoneEnded) return;
            abortRecording("MediaRecorder was already inactive when stop was requested");
            return;
          }

          try {
            recorder.stop();
          } catch {
            abortRecording("MediaRecorder stop failed");
          }
        };
        stopCurrentSegmentRef.current = requestSegmentStop;

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };

        recorder.onerror = (event) => {
          abortRecording(`MediaRecorder error: ${event.type}`);
        };

        recorder.onstop = () => {
          if (segmentTimerRef.current !== null) {
            window.clearTimeout(segmentTimerRef.current);
            segmentTimerRef.current = null;
          }
          if (sessionFinalizedRef.current) return;

          if (!segmentStopRequested || stopReason === null) {
            if (preserveOnTrackEnd && stream.getAudioTracks().every((track) => track.readyState === "ended")) {
              microphoneEnded = true;
              stopReason = "manual";
              sessionActiveRef.current = false;
              terminalStopReasonRef.current = "manual";
              sessionEndedAtRef.current = performance.now();
            } else {
              abortRecording("MediaRecorder stopped without a requested rotation or session stop");
              return;
            }
          }

          const stoppedAt = segmentStoppedAt ?? performance.now();
          if (chunks.length > 0) {
            capturedSegmentsRef.current.push(
              new Blob(chunks, { type: recorder.mimeType }),
            );
            capturedDurationsRef.current.push(
              Math.max(0, (stoppedAt - segmentStartedAt) / 1000),
            );
          }

          const stopAction = getRecorderStopAction(
            stopReason,
            sessionActiveRef.current,
            terminalStopReasonRef.current,
          );

          if (stopAction === "rotate") {
            if (startSegment()) {
              logRecorderLifecycle("internal segment start", {
                segmentIndex: nextSegmentIndexRef.current - 1,
              });
            }
            return;
          }

          if (stopAction === "abort") {
            abortRecording(
              "Internal rotation ended after the session became inactive without a terminal stop",
            );
            return;
          }

          finishRecording(
            stopAction === "finish-maximum" ? "maximum" : "manual",
          );
        };

        try {
          recorder.start();
          logRecorderLifecycle("MediaRecorder start", { segmentIndex });
        } catch {
          abortRecording("MediaRecorder start failed");
          return false;
        }

        if (
          typeof maxSegmentDurationSeconds === "number"
          && Number.isFinite(maxSegmentDurationSeconds)
          && maxSegmentDurationSeconds > 0
        ) {
          segmentTimerRef.current = window.setTimeout(() => {
            if (sessionActiveRef.current) requestSegmentStop("rotate");
          }, maxSegmentDurationSeconds * 1000);
        }

        return true;
      };

      stream.getTracks().forEach((track) => {
        const handleTrackEnded = () => {
          logRecorderLifecycle("MediaStream track ended", {
            kind: track.kind,
            label: track.label,
            readyState: track.readyState,
          });
          if (sessionActiveRef.current) {
            if (preserveOnTrackEnd) {
              microphoneEnded = true;
              stopSessionRef.current?.("manual");
            } else {
              abortRecording("MediaStream track ended unexpectedly");
            }
          }
        };
        trackEndedHandlersRef.current.set(track, handleTrackEnded);
        track.addEventListener("ended", handleTrackEnded);
      });

      stopSessionRef.current = (reason) => {
        if (
          !sessionActiveRef.current
          || sessionFinalizedRef.current
          || terminalStopReasonRef.current !== null
        ) return;
        sessionActiveRef.current = false;
        terminalStopReasonRef.current = reason;
        sessionEndedAtRef.current = performance.now();
        clearTimers();
        stopFullRecorder();
        if (reason === "manual") {
          logRecorderLifecycle("manual Stop");
        }
        setIsStopping(true);
        setMessage(
          reason === "maximum"
            ? "Finishing your recording at the five-minute limit..."
            : "Finishing your recording...",
        );
        const stopCurrentSegment = stopCurrentSegmentRef.current;
        if (!stopCurrentSegment) {
          abortRecording("No active MediaRecorder was available for session stop");
          return;
        }
        stopCurrentSegment(reason);
      };

      if (captureFullRecording) {
        // A failure here keeps the session: the segments are still saved instead.
        try {
          const fullRecorder = new MediaRecorder(stream, recorderOptions);
          const fullChunks: Blob[] = [];
          fullRecordingDone = new Promise((resolve) => {
            fullRecorder.ondataavailable = (event) => {
              if (event.data.size > 0) fullChunks.push(event.data);
            };
            fullRecorder.onstop = () => {
              resolve(fullChunks.length
                ? new Blob(fullChunks, { type: fullRecorder.mimeType })
                : null);
            };
            fullRecorder.onerror = () => {
              logRecorderLifecycle("continuous MediaRecorder error");
              resolve(null);
            };
          });
          fullRecorder.start();
          fullRecorderRef.current = fullRecorder;
          logRecorderLifecycle("continuous MediaRecorder start");
        } catch {
          fullRecordingDone = Promise.resolve(null);
          logRecorderLifecycle("continuous MediaRecorder unavailable");
        }
      }

      if (!startSegment()) return;
      try { observerOptionsRef.current.onStreamReady?.(stream); } catch {
        logRecorderLifecycle("stream observer setup failed");
      }

      if (
        typeof maxTotalDurationSeconds === "number"
        && Number.isFinite(maxTotalDurationSeconds)
        && maxTotalDurationSeconds > 0
      ) {
        maximumTimerRef.current = window.setTimeout(() => {
          stopSessionRef.current?.("maximum");
        }, maxTotalDurationSeconds * 1000);
      }

      setIsRecording(true);
      setMessage("Recording... Read aloud, then press Stop recording.");
    } catch (error) {
      sessionActiveRef.current = false;
      sessionFinalizedRef.current = true;
      clearTimers();
      releaseFullRecorder();
      stopStream("fatal");
      mediaRecorderRef.current = null;

      if (mountedRef.current) {
        setIsRecording(false);
        const name = error instanceof Error ? error.name : "";
        setMessage(
          name === "NotAllowedError"
            ? "Microphone access was denied. Allow microphone access in your browser's site settings, then try again."
            : name === "NotFoundError"
              ? "No microphone was found. Connect a microphone, then try again."
              : "Could not start recording. Check that your microphone is connected and not in use by another app, then try again.",
        );
      }
    } finally {
      startingRef.current = false;
      if (mountedRef.current) setIsStarting(false);
    }
  };

  const stopRecording = () => {
    stopSessionRef.current?.("manual");
  };

  return {
    audioBlob: audioSegments.length === 1 ? audioSegments[0] : null,
    audioURL: audioURLs.length === 1 ? audioURLs[0] : null,
    audioSegments,
    audioURLs,
    fullRecording,
    fullRecordingURL,
    segmentDurationsSeconds,
    isRecording,
    isStarting,
    isStopping,
    message,
    recordingDurationSeconds,
    resetRecording,
    startRecording,
    stopRecording,
  };
}
