import type {
  DiagnosticLanguage,
  DiagnosticTranscription,
  OralReadingMetrics,
} from "../../module2/types/diagnostic.ts";
import {
  DIAGNOSTIC_MAX_RECORDING_SECONDS,
  DiagnosticRecordingProcessingError,
} from "../../module2/services/diagnosticRecording.ts";
import { DiagnosticAudioUploadError } from "../../module2/services/diagnosticAudioError.ts";
import { calculateOralReadingMetrics, getReadingWords } from "../../module2/services/diagnosticScoring.ts";
import type {
  CreateOralReadingAttemptInput,
  OralReadingWordMetric,
  OralReadingContext,
} from "../types/oralReading.ts";

export const ORAL_READING_MAX_RECORDING_SECONDS = DIAGNOSTIC_MAX_RECORDING_SECONDS;

// M5-only spoken abbreviation equivalence; never fuzzy-match proper names.
export function normalizeOralReadingAbbreviations(text: string, language: DiagnosticLanguage) {
  return language === "en" ? text.normalize("NFKC").replace(/\bmissus\b/gi, "mrs") : text;
}

export function toOralReadingWordMetrics(
  metrics: OralReadingMetrics,
): OralReadingWordMetric[] {
  return metrics.alignment.map((word) => ({
    expected: "expectedWord" in word ? word.expectedWord : null,
    actual: "spokenWord" in word ? word.spokenWord : null,
    type: word.type,
  }));
}

export function getWordsToPractice(wordMetrics: readonly OralReadingWordMetric[]) {
  const words = wordMetrics
    .filter((word) => word.type === "substitution" || word.type === "omission")
    .map((word) => word.expected)
    .filter((word): word is string => Boolean(word));
  return [...new Set(words)];
}

interface ProcessOralReadingInput extends OralReadingContext {
  submissionId?: string;
  moduleId: string | null;
  expectedText: string;
  language: DiagnosticLanguage;
  /** The one continuous recording, start to stop; the same file is saved for playback. */
  recording: Blob | undefined;
  recordingDurationSeconds: number;
  /** Speech-to-text of the whole recording in one request; resolves only with the final transcript. */
  transcribeRecording: (recording: Blob, language: DiagnosticLanguage) => Promise<DiagnosticTranscription>;
}

/**
 * Module 5: one recording gives one transcript. Nothing is cut into parts or
 * joined here, so no words can be lost or repeated at part boundaries. Any
 * failure rejects without a transcript; the recording stays with the caller
 * for a retry. The server re-scores the transcript against the passage shown.
 */
export async function processOralReading({
  moduleId,
  passageId, roomId, assignmentId, submissionId, materialId, activityAssignmentId, passageRevision,
  expectedText,
  language,
  recording,
  recordingDurationSeconds,
  transcribeRecording,
}: ProcessOralReadingInput): Promise<CreateOralReadingAttemptInput> {
  if (!recording?.size || !Number.isFinite(recordingDurationSeconds) || recordingDurationSeconds <= 0) {
    throw new DiagnosticRecordingProcessingError();
  }
  let transcription: DiagnosticTranscription;
  try {
    transcription = await transcribeRecording(recording, language);
  } catch (error) {
    const failure = error instanceof DiagnosticAudioUploadError ? error : new DiagnosticAudioUploadError("STT_PROVIDER_ERROR");
    throw new DiagnosticRecordingProcessingError({
      code: failure.code, message: failure.message, httpStatus: failure.httpStatus,
    });
  }
  const text = transcription.text.replace(/\s+/g, " ").trim();
  if (!getReadingWords(text, language).length) throw new DiagnosticRecordingProcessingError({ code: "NO_SPEECH" });
  const metrics = calculateOralReadingMetrics(
    normalizeOralReadingAbbreviations(expectedText, language),
    normalizeOralReadingAbbreviations(text, language), recordingDurationSeconds, language,
  );

  return {
    moduleId,
    passageId, roomId, assignmentId, submissionId, materialId, activityAssignmentId, passageRevision,
    transcript: text,
    durationSeconds: recordingDurationSeconds,
    wordMetrics: toOralReadingWordMetrics(metrics),
    sttConfidence: transcription.confidence ?? null,
  };
}
