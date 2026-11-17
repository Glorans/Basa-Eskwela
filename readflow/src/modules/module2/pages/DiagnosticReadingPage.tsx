import { diagnosticProcessingMessage } from "../services/diagnosticAudioError";
import { diagnosticCopy } from "../utils/diagnosticCopy";
import "../components/DiagnosticProgress.css";
import { useDiagnosticSession } from "../components/DiagnosticSessionProvider";
import { Mic, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import DiagnosticLayout from "../components/DiagnosticLayout";
import { getDiagnosticPassageText } from "../data/diagnosticData";

import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { useDiagnosticStreamingSpeech } from "../hooks/useDiagnosticStreamingSpeech";
import { useDiagnosticStoryScroll } from "../hooks/useDiagnosticStoryScroll";
import { uploadDiagnosticAudio } from "../services/diagnosticAudio";
import {
  DIAGNOSTIC_MAX_RECORDING_SECONDS,
  DIAGNOSTIC_SEGMENT_DURATION_SECONDS,
  processDiagnosticRecording,
} from "../services/diagnosticRecording";
import {
  LiveReadingTracker,
  tokenizePassageParagraphs,
} from "../services/liveReadingAlignment";
import type {
  DiagnosticAssessment,
  DiagnosticQuestionsRouteState,
} from "../types/diagnostic";
import "./DiagnosticReadingPage.css";

type UploadStatus = "idle" | "uploading" | "success" | "error";

interface DiagnosticReadingPageProps {
  assessment: DiagnosticAssessment;
}

export default function DiagnosticReadingPage({
  assessment,
}: DiagnosticReadingPageProps) {
  const navigate = useNavigate();
  const t = (text: string) => diagnosticCopy(assessment.language, text);
  const diagnosticSession = useDiagnosticSession();
  // The whole passage (all sentences, one per paragraph) is read and graded as
  // one continuous reading: one recording, one transcript, one set of metrics.
  const { passage } = assessment;
  const passageText = getDiagnosticPassageText(assessment);
  const [currentResult, setCurrentResult] = useState<DiagnosticQuestionsRouteState | undefined>(
    () => diagnosticSession.get(assessment)?.reading,
  );
  function saveReading(reading?: DiagnosticQuestionsRouteState) {
    setCurrentResult(reading);
    if (!reading) {
      diagnosticSession.clear(assessment);
      return;
    }
    diagnosticSession.save(assessment, { assessmentId: assessment.id, assessmentVersion: assessment.version,
      reading, answers: {}, questionIndex: 0 });
  }
  const passageTokens = useMemo(
    () => tokenizePassageParagraphs(passage.paragraphs),
    [passage.paragraphs],
  );
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const processingRef = useRef(false);
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const streaming = useDiagnosticStreamingSpeech(assessment.language, {
    assessmentId: assessment.id, assessmentVersion: assessment.version,
  });
  const [readingAttempt, setReadingAttempt] = useState(0);
  const tracker = useMemo(() => new LiveReadingTracker(passageText), [passageText, readingAttempt]);
  const startingRef = useRef(false);
  const {
    audioSegments,
    segmentDurationsSeconds,
    isRecording,
    isStarting,
    isStopping,
    message,
    recordingDurationSeconds,
    resetRecording,
    startRecording,
    stopRecording,
  } = useAudioRecorder({
    createPlaybackUrls: false,
    preserveOnTrackEnd: true,
    maxSegmentDurationSeconds: DIAGNOSTIC_SEGMENT_DURATION_SECONDS,
    maxTotalDurationSeconds: DIAGNOSTIC_MAX_RECORDING_SECONDS,
    onStreamReady: (stream) => {
      streaming.start(stream);
    },
    onStreamStopped: (reason) => {
      if (reason === "unmount" || reason === "fatal") streaming.cancel();
      else void streaming.stop();
    },
  });
  const liveAlignment = useMemo(
    () => tracker.update(streaming.confirmedTranscript, streaming.interimTranscript),
    [tracker, streaming.confirmedTranscript, streaming.interimTranscript],
  );
  const latestVisualWordIndex = liveAlignment.visualReadWordIndexes[
    liveAlignment.visualReadWordIndexes.length - 1
  ] ?? -1;
  const { storyCardRef, wordRefs } = useDiagnosticStoryScroll(
    latestVisualWordIndex, isRecording, readingAttempt,
  );

  const isUploading = uploadStatus === "uploading";
  const recordingBusy = isStarting || isStopping || isUploading;
  const statusMessage =
    uploadStatus === "uploading"
      ? t("Processing your reading...")
      : uploadStatus === "error"
        ? uploadError ??
          t("We couldn't process your full reading. Please try recording again.")
        : uploadStatus === "success"
          ? t("Your reading was processed successfully.")
          : streaming.failed
            ? isRecording
              ? t("Keep reading. We can process your recording after you stop.")
              : t("Your recording is ready. Continue to process your reading.")
            : message;

  const handleRecordingButtonClick = () => {
    if (recordingBusy || startingRef.current) return;
    if (isRecording) {
      stopRecording();
      return;
    }

    setUploadStatus("idle");
    setUploadError(null);
    saveReading(undefined);
    startingRef.current = true;
    setReadingAttempt((attempt) => attempt + 1);
    streaming.reset();
    void startRecording().finally(() => { startingRef.current = false; });
  };

  const handleContinue = async () => {
    if (
      audioSegments.length === 0
      || recordingDurationSeconds === null
      || isRecording
      || isStarting
      || isStopping
      || isUploading
      || processingRef.current
    ) {
      return;
    }

    processingRef.current = true;
    setUploadStatus("uploading");
    setUploadError(null);

    try {
      // Only a complete Azure stream can bypass the existing upload fallback.
      const streamingTranscription = await streaming.stop();
      if (!mountedRef.current) return;
      if (!streamingTranscription && import.meta.env.DEV) {
        console.info("[DiagnosticStreaming] fallback triggered: processing captured recording");
      }
      const { transcription, oralReadingMetrics, transcriptReceipts } =
        await processDiagnosticRecording({
          audioSegments,
          language: assessment.language,
          expectedText: passageText,
          recordingDurationSeconds,
          segmentDurationsSeconds,
          uploadSegment: uploadDiagnosticAudio,
          streamingTranscription,
          // A new recording identity per processing attempt; every part is uploaded again on retry.
          diagnostic: {
            recordingId: crypto.randomUUID(),
            assessmentId: assessment.id,
            assessmentVersion: assessment.version,
          },
        });

      if (!mountedRef.current) return;
      setUploadStatus("success");

      saveReading({ language: assessment.language, transcription, oralReadingMetrics, transcriptReceipts });

    } catch (error) {
      if (!mountedRef.current) return;
      setUploadError(t(diagnosticProcessingMessage(error)));
      setUploadStatus("error");
    } finally {
      processingRef.current = false;
    }
  };

  // Failed attempts wait for an explicit retry.
  useEffect(() => {
    if (audioSegments.length > 0 && !isRecording && !isStarting && !isStopping && uploadStatus === "idle" && !currentResult) void handleContinue();
  }, [audioSegments, isRecording, isStarting, isStopping, uploadStatus, currentResult]);

  const handleRecordAgain = () => {
    if (processingRef.current) return;
    saveReading(undefined);
    setUploadStatus("idle");
    setUploadError(null);
    setReadingAttempt((attempt) => attempt + 1);
    streaming.reset();
    resetRecording();
  };

  return (
    <DiagnosticLayout
      className="diagnostic-reading-panel"
      labelledBy="diagnostic-reading-title"
    >
      <header className="diagnostic-reading-header">
        <h1 id="diagnostic-reading-title">{t("Read the Story Aloud")}</h1>

        <p>{t("Read the whole story below, from the first line to the last. When you're ready, press the microphone button and begin reading.")}</p>
      </header>

      <article
        ref={storyCardRef}
        className="diagnostic-story-card"
        aria-labelledby="diagnostic-story-title"
        tabIndex={0}
      >
        <h2 id="diagnostic-story-title">{passage.title}</h2>
        <div className="diagnostic-story-content">
          {passageTokens.map((paragraphTokens, paragraphIndex) => (
            <p key={`${paragraphIndex}-${passage.paragraphs[paragraphIndex]}`}>
              {paragraphTokens.map((token, tokenIndex) => {
                if (token.type === "separator") {
                  return token.text;
                }

                // Keep token refs and internal alignment, but disable visual highlighting.
                return (
                  <span
                    ref={(element) => { wordRefs.current[token.wordIndex] = element; }}
                    className="diagnostic-story-word"
                    key={`${paragraphIndex}-${tokenIndex}-${token.wordIndex}`}
                  >
                    {token.text}
                  </span>
                );
              })}
            </p>
          ))}
        </div>
      </article>

      <div className="diagnostic-recording-controls">
        {(isRecording || (audioSegments.length === 0 && !currentResult)) && (
          <button
            className={`diagnostic-primary-button diagnostic-record-button${
              isRecording ? " diagnostic-record-button--active" : ""
            }`}
            type="button"
            disabled={recordingBusy}
            onClick={handleRecordingButtonClick}
          >
            {isRecording ? (
              <Square size={19} fill="currentColor" aria-hidden="true" />
            ) : (
              <Mic size={21} aria-hidden="true" />
            )}
            {isStarting
              ? t("Opening microphone...")
              : isStopping
                ? t("Finishing recording...")
                : isRecording
                  ? t("Stop recording")
                  : t("Start recording")}
          </button>
        )}

        <p className="diagnostic-recording-status" role="status" aria-live="polite">
          {t(statusMessage)}
        </p>

        {!isRecording && !isStarting && !isStopping && (audioSegments.length > 0 || currentResult) && (
          <div className="diagnostic-recording-review">
            <div className="diagnostic-recording-summary">
              <strong>{currentResult ? t("Reading Complete") : t("Recording Complete")}</strong>
              <span>
                {currentResult
                  ? t("Great reading! Next, answer a few questions about the story.")
                  : t("Your reading is ready to process.")}
              </span>
            </div>

            <div className="diagnostic-recording-review-actions">
              <button
                className="diagnostic-recording-secondary-button"
                type="button"
                disabled={isUploading}
                onClick={handleRecordAgain}
              >{t("Record Again")}</button>
              <button
                className="diagnostic-primary-button"
                type="button"
                disabled={isUploading}
                onClick={() => {
                  if (!currentResult) { void handleContinue(); return; }
                  navigate(`/diagnostic/${assessment.language}/questions`);
                }}
              >
                {isUploading
                  ? t("Processing your reading...")
                  : uploadStatus === "error"
                    ? t("Try Processing Again")
                    : currentResult ? t("Continue to Questions") : t("Process Recording")}
              </button>
            </div>
          </div>
        )}
      </div>
    </DiagnosticLayout>
  );
}
