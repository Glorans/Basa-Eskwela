import { activityLanguageFromState, activityLanguageState, getActivityText } from "./activityLanguage";
import { assignedReadingTarget } from "../../modules/module5/services/assignedReadingNavigation";
import { updateReadingActivityStatus } from "../../modules/module4/services/classroomService";
import { BookOpen, Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import ActivityHeader from "./ActivityHeader";
import { useAudioRecorder } from "../../modules/module2/hooks/useAudioRecorder";
import { uploadDiagnosticAudio } from "../../modules/module2/services/diagnosticAudio";
import {
  createOralReadingAttempt,
  getOralReadingModule,
  getOwnOralReadingAttempts,
  getAssignedReadingProgress,
} from "../../modules/module5/services/oralReadingService";
import {
  ORAL_READING_MAX_RECORDING_SECONDS,
  ORAL_READING_SEGMENT_DURATION_SECONDS,
  processOralReading,
} from "../../modules/module5/services/oralReadingProcessing";
import type {
  CreateOralReadingAttemptInput,
  LearnerM5Role,
  OralReadingModule,
} from "../../modules/module5/types/oralReading";
import { storyParagraphs } from "./storyDisplay";
import { useVoiceFollowStoryScroll } from "./useVoiceFollowStoryScroll";
import { tokenizePassageParagraphs } from "./voiceFollow";
import "@fontsource/fredoka/latin-600.css";
import "@fontsource/nunito/latin-700.css";
import "./ActivityPage.css";
import "./ReadAloudPage.css";

interface ReadAloudPageProps {
  role: LearnerM5Role;
}

type ProcessingStatus = "idle" | "processing" | "saving" | "transcription-error" | "save-error";

export default function ReadAloudPage({ role }: ReadAloudPageProps) {
  const { moduleId, materialId } = useParams<{ moduleId: string; materialId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const passageId = searchParams.get("passageId");
  const roomId = searchParams.get("roomId");
  const assignmentId = searchParams.get("assignmentId");
  const activityAssignmentId = searchParams.get("activityAssignmentId");
  const viewReading = searchParams.get("viewReading") === "1";
  const [continueTarget, setContinueTarget] = useState<string>();
  const recordAgain = searchParams.get("recordAgain") === "1";
  const [savedAttempts, setSavedAttempts] = useState<{ id: string; passageTitle: string }[]>([]);
  const [historyError, setHistoryError] = useState<string>();
  const sourceKey = `${moduleId}:${materialId}:${passageId}:${roomId}:${assignmentId}:${activityAssignmentId}`;
  const [loadedSource, setLoadedSource] = useState<{ key: string; value: OralReadingModule }>();
  const module = loadedSource?.key === sourceKey ? loadedSource.value : undefined;
  const setModule = (value: OralReadingModule | undefined) => setLoadedSource(value ? { key: sourceKey, value } : undefined);
  const ui = getActivityText(module ? module.language : activityLanguageFromState(location.state));
  const { language, t } = ui;
  const activityState = activityLanguageState(language);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>("idle");
  const [processingError, setProcessingError] = useState<string | Error>();
  const [pendingAttempt, setPendingAttempt] = useState<CreateOralReadingAttemptInput>();
  const processingRef = useRef(false);
  const autoProcessed = useRef<Blob[] | null>(null);
  const generation = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const storyRef = useRef<HTMLDivElement>(null);
  // Display only; scoring still receives module.passage unchanged.
  const storyTokens = module
    ? tokenizePassageParagraphs(storyParagraphs(module.passage, module.passageTitle || module.title))
    : [];
  // Visual only: the text follows the child's voice (or a pace estimate when
  // live recognition is unavailable). The saved recording is untouched.
  const storyFollow = useVoiceFollowStoryScroll(
    storyRef,
    storyTokens.flat().flatMap((token) => token.type === "word" ? [token.text] : []),
    module?.language === "fil" ? "fil" : "en",
  );
  const {
    audioSegments,
    audioURLs,
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
    maxSegmentDurationSeconds: ORAL_READING_SEGMENT_DURATION_SECONDS,
    maxTotalDurationSeconds: ORAL_READING_MAX_RECORDING_SECONDS,
    // Shares the recorder's microphone stream; the recording itself is unchanged.
    onStreamReady: storyFollow.onStreamReady,
    onStreamStopped: storyFollow.onStreamStopped,
  });

  const backTarget = materialId && roomId
    ? `/dashboard/learning-rooms/${roomId}`
    : role === "student" && (module?.roomId || roomId)
    ? `/dashboard/learning-rooms/${module?.roomId ?? roomId}`
    : moduleId ? `${role === "student" ? "/dashboard/materials" : "/m3/general/modules"}/${moduleId}?${searchParams}`
    : role === "student" ? "/dashboard/materials" : "/m3/general/modules";
  const backLabel = materialId ? "Back to Learning Room" : role === "student" && (module?.roomId || roomId) ? "Back to Classroom" : "Back to Reading Module";

  useEffect(() => {
    let active = true;
    generation.current += 1;
    setLoading(true);
    setLoadError(undefined);
    setModule(undefined);
    setContinueTarget(undefined);
    setPendingAttempt(undefined);
    setProcessingStatus("idle");
    setProcessingError(undefined);
    resetRecording();
    if (!moduleId && !materialId) {
      setLoading(false);
      setLoadError("Reading module not found.");
      return () => { active = false; };
    }
    setSavedAttempts([]);
    setHistoryError(undefined);
    void getOwnOralReadingAttempts(moduleId, materialId ? { materialId, activityAssignmentId } : {}).then(attempts => { if (active) setSavedAttempts(attempts); })
      .catch(() => { if (active) setHistoryError("Unable to load your saved results. Please refresh to retry."); });
    void (async () => {
      if (materialId && roomId && activityAssignmentId && !recordAgain) {
        const progress = await getAssignedReadingProgress(roomId);
        const saved = progress.find(item => item.activityAssignmentId === activityAssignmentId && item.materialId === materialId);
        if (!saved) throw new Error("This reading activity is not assigned to you.");
        if (saved.oralReadingAttemptId) {
          if (saved.readAloudOnly === true) await updateReadingActivityStatus(saved.activityAssignmentId, "completed");
          if (!viewReading) {
            if (active) navigate(assignedReadingTarget(saved), { replace: true, state: activityState });
            return;
          }
          if (active) setContinueTarget(assignedReadingTarget(saved));
        }
      }

      const loadedModule = await getOralReadingModule(moduleId, { passageId, roomId, assignmentId, materialId, activityAssignmentId });
      if (active) setModule(loadedModule);
    })().catch((error: unknown) => {
      if (active) setLoadError(error instanceof Error ? error.message : "Unable to load the activity.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; generation.current += 1; };

  }, [moduleId, materialId, passageId, roomId, assignmentId, activityAssignmentId, recordAgain, viewReading]);

  const isProcessing = processingStatus === "processing" || processingStatus === "saving";
  const recordingBusy = isStarting || isStopping || isProcessing;
  const statusMessage = processingStatus === "processing"
    ? "Processing your reading..."
    : processingStatus === "saving"
      ? "Saving your oral-reading result..."
      : processingError ?? message;

  const handleRecordingButton = () => {
    if (isRecording) {
      stopRecording();
      return;
    }
    setPendingAttempt(undefined);
    setProcessingStatus("idle");
    setProcessingError(undefined);
    void startRecording();
  };

  const saveAttempt = async (input: CreateOralReadingAttemptInput) => {
    const currentGeneration = generation.current;
    setProcessingStatus("saving");
    const attempt = await createOralReadingAttempt(input);
    if (module?.readAloudOnly === true && module.activityAssignmentId) {
      await updateReadingActivityStatus(module.activityAssignmentId, "completed");
    }
    if (currentGeneration !== generation.current) return;
    const resultPath = role === "student"
      ? `/dashboard/read-aloud/results/${attempt.id}`
      : `/m3/general/read-aloud/results/${attempt.id}`;
    // Every saved reading shows its feedback first; that page offers the questions.
    navigate(resultPath, { replace: true, state: activityLanguageState(module?.language) });
  };

  const handleProcess = async () => {
    if (
      !module
      || processingRef.current
      || audioSegments.length === 0
      || recordingDurationSeconds === null
    ) return;

    processingRef.current = true;
    const currentGeneration = generation.current;
    setProcessingError(undefined);
    let attemptInput = pendingAttempt;
    try {
      if (!attemptInput) {
        setProcessingStatus("processing");
        attemptInput = await processOralReading({
          moduleId: module.id,
          materialId: module.materialId, activityAssignmentId: module.activityAssignmentId, passageRevision: module.passageRevision,
          passageId: module.passageId, roomId: module.roomId, assignmentId: module.assignmentId,
          submissionId: crypto.randomUUID(),
          expectedText: module.passage,
          language: module.language,
          audioSegments,
          segmentDurationsSeconds,
          recordingDurationSeconds,
          uploadSegment: uploadDiagnosticAudio,
        });
        if (currentGeneration !== generation.current) return;
        setPendingAttempt(attemptInput);
      }
      if (currentGeneration !== generation.current) return;
      await saveAttempt(attemptInput);
    } catch (error) {
      if (currentGeneration !== generation.current) return;
      if (attemptInput) {
        setPendingAttempt(attemptInput);
        setProcessingStatus("save-error");
        setProcessingError(error instanceof Error ? error : "Your result could not be saved. Please try again.");
      } else {
        setProcessingStatus("transcription-error");
        setProcessingError(error instanceof Error ? error : "We couldn't process your full reading. Please record it again.");
      }
    } finally {
      processingRef.current = false;
    }
  };

  const handleRecordAgain = () => {
    processingRef.current = false;
    setPendingAttempt(undefined);
    setProcessingStatus("idle");
    setProcessingError(undefined);
    autoProcessed.current = null;
    resetRecording();
  };

  useEffect(() => {
    if (!isRecording) return;
    const started = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(() => {
    // The recorder publishes segments only after the final segment has stopped.
    if (!materialId || !module || isRecording || isStopping || isStarting || !audioSegments.length
      || recordingDurationSeconds === null || autoProcessed.current === audioSegments) return;
    autoProcessed.current = audioSegments;
    void handleProcess();
  }, [audioSegments, recordingDurationSeconds, isRecording, isStopping, isStarting, module, materialId]);

  if (loading || !module) {
    return (
      <div className="activity-page-shell" lang={language}>
        <ActivityHeader uiLanguage={language} title={t("Read Aloud")} language="" onBack={() => navigate(backTarget)} />
        <div className="activity-page">
          <div className="activity-missing" role={loadError ? "alert" : "status"}>
            <BookOpen size={36} />
            <p>{loadError ? ui.message(loadError, "Unable to load the activity.") : t("Loading oral-reading activity...")}</p>
            {loadError && <button type="button" onClick={() => window.location.reload()}>{t("Retry")}</button>}
            {loadError && <button type="button" onClick={() => navigate(backTarget)}>{t(backLabel)}</button>}
            {savedAttempts.map((saved, index) => <p key={saved.id}><button type="button" onClick={() => navigate(role === "student" ? `/dashboard/read-aloud/results/${saved.id}` : `/m3/general/read-aloud/results/${saved.id}`, { state: activityState })}>{saved.passageTitle} - {t("Saved Result")} {index + 1}</button></p>)}
          </div>
        </div>
      </div>
    );
  }


  return (
    <div lang={language} className={`activity-page-shell${materialId ? " assigned-reading" : ""}`}>
      <ActivityHeader uiLanguage={language}
        title={module.passageTitle || module.title}
        language={language === "fil" ? "Filipino" : "English"}
        onBack={() => navigate(backTarget)}
      />

      <div className="activity-page">
        <div className="read-aloud-body">
          {savedAttempts.length > 0 && <details><summary>{t("Saved oral reading results")}</summary><section aria-label={t("Saved oral reading results")}><h2>{t("Your Saved Results")}</h2>
            {savedAttempts.map((saved, index) => <p key={saved.id}><button type="button" onClick={() => navigate(role === "student" ? `/dashboard/read-aloud/results/${saved.id}` : `/m3/general/read-aloud/results/${saved.id}`, { state: activityState })}>{saved.passageTitle} - {t("Result")} {index + 1}</button></p>)}
          </section></details>}
          {historyError && <p role="alert">{ui.message(historyError, "Unable to load your saved results. Please refresh to retry.")}</p>}
          <h2 className="read-aloud-story-heading">{t("Read the Story Aloud")}</h2>
          <div className="read-aloud-story-box">
            {/* Exactly N lines tall with no vertical padding, so no line is ever cut. */}
            <div
              ref={storyRef}
              className="read-aloud-story-viewport"
              tabIndex={0}
              role="region"
              aria-label={t("Story to read aloud")}
            >
              <div className="read-aloud-story-text">
                {storyTokens.map((paragraph, index) => (
                  <p key={index} lang={language}>
                    {paragraph.map((token, tokenIndex) => token.type === "word"
                      ? <span key={tokenIndex} data-word={token.wordIndex}>{token.text}</span>
                      : token.text)}
                  </p>
                ))}
              </div>
            </div>
          </div>
          <div className="read-aloud-controls">
            {continueTarget ? <>
              <p role="status">{t("Your reading is saved.")}</p>
              <button className="read-aloud-continue" type="button" onClick={() => navigate(continueTarget, { state: activityState })}>
                {module.readAloudOnly ? t("View Reading Result")
                  : continueTarget.includes("/read-aloud/results/") ? t("See My Reading Feedback") : t("Continue to Comprehension")}
              </button>
            </> : <>

            <button
              className={`read-aloud-record-button ${isRecording ? "read-aloud-record-button--active" : ""}`}
              type="button"
              disabled={recordingBusy || (materialId !== undefined && audioSegments.length > 0)}
              onClick={handleRecordingButton}
            >
              {isRecording ? <Square size={18} fill="currentColor" /> : <Mic size={19} />}
              {isStarting
                ? t("Opening microphone...")
                : isStopping
                  ? t("Finishing recording...")
                  : isRecording
                    ? t("Stop Recording")
                    : t("Start Recording")}
            </button>

            {isRecording && (
              <span className="read-aloud-story-timer" aria-label={t("Recording time {minutes} minutes {seconds} seconds", { minutes: Math.floor(elapsed / 60), seconds: elapsed % 60 })}>
                {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
              </span>
            )}
            <p className="read-aloud-status" role="status" aria-live="polite">
              {ui.message(statusMessage, processingStatus === "save-error" ? "Your result could not be saved. Please try again." : "We couldn't process your full reading. Please record it again.")}
            </p>

            {audioURLs.length > 0 && (
              <div className="read-aloud-review">
                <details><summary>{t("Review Recording")}</summary>
                {audioURLs.map((audioURL, index) => (
                  <div className="read-aloud-part" key={audioURL}>
                    {audioURLs.length > 1 && <span>{t("Part")} {index + 1}</span>}
                    <audio controls src={audioURL} aria-label={t("Your reading recording part {part}", { part: index + 1 })} />
                  </div>
                ))}
                </details>
                <div className="read-aloud-actions">
                  <button className="read-aloud-secondary" type="button" disabled={isProcessing || processingStatus === "save-error"} onClick={handleRecordAgain}>{t("Record Again")}</button>
                  {(!materialId && processingStatus !== "transcription-error" || processingStatus === "save-error" || materialId && processingStatus === "transcription-error") && (
                    <button className="read-aloud-continue" type="button" disabled={isProcessing} onClick={handleProcess}>
                      {processingStatus === "processing"
                        ? t("Processing your reading...")
                        : processingStatus === "saving"
                          ? t("Saving result...")
                          : processingStatus === "save-error"
                            ? t("Try Saving Again")
                            : materialId ? t("Retry Processing") : t("Process Reading")}
                    </button>
                  )}
                </div>
              </div>
            )}
            </>}
          </div>

        </div>
      </div>
    </div>
  );
}
