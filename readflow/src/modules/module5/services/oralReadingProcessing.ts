import type { DiagnosticLanguage, OralReadingMetrics } from "../../module2/types/diagnostic.ts";
import type { DiagnosticAudioUploadResult } from "../../module2/services/diagnosticAudio.ts";
import {
  DIAGNOSTIC_MAX_RECORDING_SECONDS,
  DIAGNOSTIC_SEGMENT_DURATION_SECONDS,
  processDiagnosticRecording,
} from "../../module2/services/diagnosticRecording.ts";
import type {
  CreateOralReadingAttemptInput,
  OralReadingWordMetric,
  OralReadingContext,
} from "../types/oralReading.ts";

export const ORAL_READING_SEGMENT_DURATION_SECONDS = DIAGNOSTIC_SEGMENT_DURATION_SECONDS;
export const ORAL_READING_MAX_RECORDING_SECONDS = DIAGNOSTIC_MAX_RECORDING_SECONDS;

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
  audioSegments: readonly Blob[];
  segmentDurationsSeconds: readonly number[];
  recordingDurationSeconds: number;
  uploadSegment: (
    audioSegment: Blob,
    language: DiagnosticLanguage,
  ) => Promise<DiagnosticAudioUploadResult>;
}

export async function processOralReading({
  moduleId,
  passageId, roomId, assignmentId, submissionId, materialId, activityAssignmentId, passageRevision,
  expectedText,
  language,
  audioSegments,
  segmentDurationsSeconds,
  recordingDurationSeconds,
  uploadSegment,
}: ProcessOralReadingInput): Promise<CreateOralReadingAttemptInput> {
  const { transcription, oralReadingMetrics } = await processDiagnosticRecording({
    audioSegments,
    language,
    expectedText,
    recordingDurationSeconds,
    segmentDurationsSeconds,
    uploadSegment,
  });

  return {
    moduleId,
    passageId, roomId, assignmentId, submissionId, materialId, activityAssignmentId, passageRevision,
    transcript: transcription.text,
    durationSeconds: recordingDurationSeconds,
    wordMetrics: toOralReadingWordMetrics(oralReadingMetrics),
    sttConfidence: transcription.confidence ?? null,
  };
}
