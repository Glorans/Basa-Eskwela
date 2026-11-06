import { numberSavedAttempts } from "../../modules/module5/services/savedAttemptOrder";
import { activityLanguageFromState, activityLanguageState, getActivityText } from "./activityLanguage";
import { assignedReadingTarget } from "../../modules/module5/services/assignedReadingNavigation";
import { updateReadingActivityStatus } from "../../modules/module4/services/classroomService";
import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import ActivityHeader from "./ActivityHeader";
import { useAudioRecorder } from "../../modules/module2/hooks/useAudioRecorder";
import {
  type ReadAloudTranscriptionStep,
  startReadAloudTiming,
  transcribeOralReadingRecording,
} from "../../modules/module5/services/oralReadingTranscription";
import { storyNames } from "../../modules/module5/services/resultWords";
import {
  RECORDING_UPLOAD_ERROR,
  createOralReadingAttempt,
  rememberOralReadingAttempt,
  getOralReadingModule,
  getOwnOralReadingAttempts,
  getAssignedReadingProgress,
  type AssignedReadingProgress,
  type OwnOralReadingSummary,
  uploadOralReadingRecording,
} from "../../modules/module5/services/oralReadingService";
import {
  ORAL_READING_MAX_RECORDING_SECONDS,
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
import "../../modules/module5/components/M5Loading.css";

interface ReadAloudPageProps {
  role: LearnerM5Role;
}

// "processing" covers speech-to-text (see transcriptionStep); "saving" the result; "saving-recording" its audio.
type ProcessingStatus = "idle" | "processing" | "saving" | "saving-recording" | "transcription-error" | "save-error" | "recording-error";

const TRANSCRIPTION_STEP_MESSAGES = {
  preparing: "Preparing your recording...",
  uploading: "Sending your recording...",
  recognizing: "Processing your reading...",
} as const;

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
  const [savedAttempts, setSavedAttempts] = useState<OwnOralReadingSummary[]>([]);
  const [historyError, setHistoryError] = useState<string>();
  const sourceKey = `${moduleId}:${materialId}:${passageId}:${roomId}:${assignmentId}:${activityAssignmentId}`;
  const entry = location.state as { readingActivity?: AssignedReadingProgress; oralReadingModule?: OralReadingModule } | null;
  const entryActivity = entry?.readingActivity;
  const preparedActivity = entryActivity?.materialId === materialId && entryActivity?.roomId === roomId
    && entryActivity?.activityAssignmentId === activityAssignmentId ? entryActivity : undefined;
  const entryModule = entry?.oralReadingModule;
  const preparedModule = preparedActivity && entryModule?.materialId === materialId && entryModule?.roomId === roomId
    && entryModule?.activityAssignmentId === activityAssignmentId ? entryModule : undefined;
  const [loadedSource, setLoadedSource] = useState<{ key: string; value: OralReadingModule } | undefined>(
    preparedModule ? { key: sourceKey, value: preparedModule } : undefined);
  const module = loadedSource?.key === sourceKey ? loadedSource.value : undefined;
  const setModule = (value: OralReadingModule | undefined) => setLoadedSource(value ? { key: sourceKey, value } : undefined);
  const ui = getActivityText(module ? module.language : activityLanguageFromState(location.state));
  const { language, t } = ui;
  const activityState = activityLanguageState(language);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [loadRevision, setLoadRevision] = useState(0);
  const loadRequest = useRef<{ key: string; promise: Promise<{ module?: OralReadingModule; target?: string; continueTarget?: string }> }>();
  const historyRequest = useRef<{ key: string; promise: ReturnType<typeof getOwnOralReadingAttempts> }>();
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>("idle");
  const [transcriptionStep, setTranscriptionStep] = useState<ReadAloudTranscriptionStep>("preparing");
  // Cancels an in-flight speech-to-text request when the learner leaves or starts over.
  const transcriptionAbort = useRef<AbortController>();
  const [processingError, setProcessingError] = useState<string | Error>();
  const [pendingAttempt, setPendingAttempt] = useState<CreateOralReadingAttemptInput>();
  // Set once the result is saved but its recording upload failed.
  const [savedAttemptId, setSavedAttemptId] = useState<string>();
  const processingRef = useRef(false);
  const autoProcessed = useRef<Blob[] | null>(null);
  const generation = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const storyRef = useRef<HTMLDivElement>(null);
  // Display only. The server scores the same words: it leaves out the title line hidden here.
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
    isRecording,
    isStarting,
    isStopping,
    message,
    recordingDurationSeconds,
    resetRecording,
    startRecording,
    stopRecording,
  } = useAudioRecorder({
    // One MediaRecorder from Start to Stop: no segment rotation (no
    // maxSegmentDurationSeconds), so audioSegments holds exactly one file, the
    // whole reading. That file is transcribed, saved and replayed.
    maxTotalDurationSeconds: ORAL_READING_MAX_RECORDING_SECONDS,
    // Shares the recorder's microphone stream; the recording itself is unchanged.
    onStreamReady: storyFollow.onStreamReady,
    onStreamStopped: storyFollow.onStreamStopped,
  });

  const resultPathFor = (attemptId: string) => role === "admin"
    ? `/admin/read-aloud/results/${attemptId}`
    : role === "student" ? `/dashboard/read-aloud/results/${attemptId}` : `/m3/general/read-aloud/results/${attemptId}`;
  const backTarget = role === "admin"
    ? "/admin/oral-reading"
    : materialId && roomId
    ? `/dashboard/learning-rooms/${roomId}`
    : role === "student" && (module?.roomId || roomId)
    ? `/dashboard/learning-rooms/${module?.roomId ?? roomId}`
    : moduleId ? `${role === "student" ? "/dashboard/materials" : "/m3/general/modules"}/${moduleId}?${searchParams}`
    : role === "student" ? "/dashboard/materials" : "/m3/general/modules";
  const backLabel = role === "admin" ? "Back to Oral Reading" : materialId ? "Back to Learning Room" : role === "student" && (module?.roomId || roomId) ? "Back to Classroom" : "Back to Reading Module";

  useEffect(() => {
    let active = true;
    generation.current += 1;
    setLoading(true);
    setLoadError(undefined);
    setContinueTarget(undefined);
    setPendingAttempt(undefined);
    setSavedAttemptId(undefined);
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
    const requestKey = `${sourceKey}:${recordAgain}:${viewReading}:${loadRevision}`;
    if (!loadRequest.current || loadRequest.current.key !== requestKey) {
      loadRequest.current = { key: requestKey, promise: (async () => {
        let target: string | undefined;
        if (materialId && roomId && activityAssignmentId && !recordAgain) {
          const progress = preparedActivity && loadRevision === 0 ? [preparedActivity] : await getAssignedReadingProgress(roomId);
          const saved = progress.find(item => item.activityAssignmentId === activityAssignmentId && item.materialId === materialId);
          if (!saved) throw new Error("This reading activity is not assigned to you.");
          if (saved.oralReadingAttemptId) {
            if (saved.readAloudOnly === true) await updateReadingActivityStatus(saved.activityAssignmentId, "completed");
            target = assignedReadingTarget(saved);
            if (!viewReading) return { target };
          }
        }
        const loadedModule = (loadRevision === 0 && preparedModule) || await getOralReadingModule(moduleId, { passageId, roomId, assignmentId, materialId, activityAssignmentId });
        return { module: loadedModule, continueTarget: target };
      })() };
    }
    void loadRequest.current.promise.then(result => {
      if (!active) return;
      if (result.target) {
        // Stay in the pending layout until the destination mounts. Do not flash
        // the history list or an empty activity between the two routes.
        navigate(result.target, { replace: true, state: activityState });
        return;
      }
      setModule(result.module);
      setContinueTarget(result.continueTarget);
      setLoading(false);
      // History is secondary and is unnecessary when redirecting to a saved result.
      if (!historyRequest.current || historyRequest.current.key !== sourceKey) {
        historyRequest.current = { key: sourceKey, promise: getOwnOralReadingAttempts(moduleId, materialId ? { materialId, activityAssignmentId } : {}) };
      }
      void historyRequest.current.promise.then(attempts => { if (active) setSavedAttempts(attempts); })
        .catch(() => { if (active) setHistoryError("Unable to load your saved results. Please refresh to retry."); });
    }).catch((error: unknown) => {
      if (active) {
        setLoadError(error instanceof Error ? error.message : "Unable to load the activity.");
        setLoading(false);
      }
    });
    return () => { active = false; generation.current += 1; transcriptionAbort.current?.abort(); };

  }, [moduleId, materialId, passageId, roomId, assignmentId, activityAssignmentId, recordAgain, viewReading, loadRevision]);

  const isProcessing = processingStatus === "processing" || processingStatus === "saving" || processingStatus === "saving-recording";
  const recordingBusy = isStarting || isStopping || isProcessing;
  const statusMessage = processingStatus === "processing"
    ? TRANSCRIPTION_STEP_MESSAGES[transcriptionStep]
    : processingStatus === "saving"
      ? "Saving your result..."
      : processingStatus === "saving-recording"
        ? "Saving your recording..."
        : processingError ?? message;

  const handleRecordingButton = () => {
    if (isRecording) {
      stopRecording();
      return;
    }
    setPendingAttempt(undefined);
    setSavedAttemptId(undefined);
    setProcessingStatus("idle");
    setProcessingError(undefined);
    void startRecording();
  };

  const saveAttempt = async (input: CreateOralReadingAttemptInput) => {
    const currentGeneration = generation.current;
    setProcessingStatus("saving");
    const savedResult = startReadAloudTiming("save result");
    const attempt = await createOralReadingAttempt(input).catch((error: unknown) => { savedResult("failed"); throw error; });
    savedResult();
    if (module?.readAloudOnly === true && module.activityAssignmentId) {
      await updateReadingActivityStatus(module.activityAssignmentId, "completed");
      // Completion is confirmed by the server before seeding the result screen.
      if (currentGeneration === generation.current) rememberOralReadingAttempt({ ...attempt, readAloudCompleted: true });
    }
    if (currentGeneration !== generation.current) return;
    await saveRecordingThenOpenResult(attempt.id);
  };

  // Every saved reading shows its feedback first; that page offers the questions.
  const openResult = (attemptId: string) =>
    navigate(resultPathFor(attemptId), { replace: true, state: activityLanguageState(module?.language) });

  // The result is already saved here, so a failed upload never discards it: the learner can
  // retry the upload while the recording is still in memory, or continue without it.
  const saveRecordingThenOpenResult = async (attemptId: string) => {
    const currentGeneration = generation.current;
    setProcessingStatus("saving-recording");
    setProcessingError(undefined);
    const savedRecording = startReadAloudTiming("save recording");
    try {
      // The one continuous recording that was transcribed.
      await uploadOralReadingRecording(attemptId, audioSegments);
      savedRecording();
    } catch (error) {
      savedRecording("failed");
      if (currentGeneration !== generation.current) return;
      setSavedAttemptId(attemptId);
      setProcessingStatus("recording-error");
      setProcessingError(error instanceof Error ? error : RECORDING_UPLOAD_ERROR);
      return;
    }
    if (currentGeneration !== generation.current) return;
    setSavedAttemptId(undefined);
    openResult(attemptId);
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
        setTranscriptionStep("preparing");
        transcriptionAbort.current?.abort();
        const abort = new AbortController();
        transcriptionAbort.current = abort;
        const submissionId = crypto.randomUUID();
        attemptInput = await processOralReading({
          moduleId: module.id,
          materialId: module.materialId, activityAssignmentId: module.activityAssignmentId, passageRevision: module.passageRevision,
          passageId: module.passageId, roomId: module.roomId, assignmentId: module.assignmentId,
          submissionId,
          expectedText: module.passage,
          language: module.language,
          recording: audioSegments.length === 1 ? audioSegments[0] : undefined,
          recordingDurationSeconds,
          // Times the upload by its progress and Azure by the server deadline; a request
          // that times out is aborted. The recording stays in memory for a retry.
          transcribeRecording: (recording, language) => transcribeOralReadingRecording(recording, language, {
            recordingDurationSeconds,
            // English: a few story names (never the whole story) help the recognizer hear them.
            storyNames: storyNames(module.passage, module.passageTitle || module.title, language),
            readingContext: {
              moduleId: module.id, passageId: module.passageId, roomId: module.roomId, assignmentId: module.assignmentId,
              materialId: module.materialId, activityAssignmentId: module.activityAssignmentId, submissionId,
            },
            signal: abort.signal,
            onStep: (step) => { if (currentGeneration === generation.current) setTranscriptionStep(step); },
          }),
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
    transcriptionAbort.current?.abort();
    processingRef.current = false;
    setPendingAttempt(undefined);
    setSavedAttemptId(undefined);
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

  if (!module) {
    return (
      <div className="activity-page-shell" lang={language}>
        <ActivityHeader uiLanguage={language} title={t("Read Aloud")} language="" onBack={() => navigate(backTarget)} />
        <div className="activity-page">
          <div className="read-aloud-body">
            <h2 className="read-aloud-story-heading">{t("Read the Story Aloud")}</h2>
            <div className="m5-pending-status" role={loadError ? "alert" : "status"} aria-busy={!loadError}>
            {!loadError && <span className="m5-loading-indicator" aria-hidden="true" />}
            <p>{loadError ? ui.message(loadError, "Unable to load the activity.") : t("Opening your reading activity...")}</p>
            {loadError && <button type="button" onClick={() => setLoadRevision(value => value + 1)}>{t("Retry")}</button>}
            {loadError && <button type="button" onClick={() => navigate(backTarget)}>{t(backLabel)}</button>}
            </div>

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
          {loading && <p className="m5-pending-status" role="status"><span className="m5-loading-indicator" aria-hidden="true" />{t("Opening your reading activity...")}</p>}
          {loadError && <p role="alert">{ui.message(loadError, "Unable to load the activity.")} <button type="button" onClick={() => setLoadRevision(value => value + 1)}>{t("Retry")}</button></p>}
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
              disabled={loading || Boolean(loadError) || recordingBusy || (materialId !== undefined && audioSegments.length > 0)}
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
            <h3 className="read-aloud-instructions-heading">{t("Recording Instructions")}</h3>
            <p className="read-aloud-status" role="status" aria-live="polite">
              {ui.message(statusMessage, processingStatus === "recording-error" ? RECORDING_UPLOAD_ERROR : processingStatus === "save-error" ? "Your result could not be saved. Please try again." : "We couldn't process your full reading. Please record it again.")}
            </p>
            {audioURLs.length > 0 && (
                <div className="read-aloud-actions">
                  {processingStatus === "recording-error" && savedAttemptId ? <>
                    <button className="read-aloud-continue" type="button" onClick={() => void saveRecordingThenOpenResult(savedAttemptId)}>{t("Retry Saving Recording")}</button>
                    <button className="read-aloud-secondary" type="button" onClick={() => openResult(savedAttemptId)}>{t("Continue Without Recording")}</button>
                  </> : <>
                  <button className="read-aloud-secondary" type="button" disabled={isProcessing || processingStatus === "save-error"} onClick={handleRecordAgain}>{t("Record Again")}</button>
                  {(!materialId && processingStatus !== "transcription-error" || processingStatus === "save-error" || materialId && processingStatus === "transcription-error") && (
                    <button className="read-aloud-continue" type="button" disabled={isProcessing} onClick={handleProcess}>
                      {processingStatus === "processing"
                        ? t("Processing your reading...")
                        : processingStatus === "saving" || processingStatus === "saving-recording"
                          ? t("Saving result...")
                          : processingStatus === "save-error"
                            ? t("Try Saving Again")
                            : materialId ? t("Retry Processing") : t("Process Reading")}
                    </button>
                  )}
                  </>}
                </div>
            )}
            </>}
          </div>
          <section className="read-aloud-saved-results" aria-labelledby="saved-reading-results-title">
            <h2 id="saved-reading-results-title">{t("Your Saved Oral Reading Results")}</h2>
            {historyError && <p role="alert">{ui.message(historyError, "Unable to load your saved results. Please refresh to retry.")}</p>}
            <div className="read-aloud-saved-grid">
              {numberSavedAttempts(savedAttempts).map(saved => (
                <button className="read-aloud-saved-card" type="button" key={saved.id}
                  onClick={() => navigate(resultPathFor(saved.id), { state: activityState })}>
                  <span>{saved.passageTitle}</span>
                  <strong>{t("Result")} {saved.resultNumber}</strong>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
