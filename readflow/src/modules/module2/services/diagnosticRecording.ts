import type {
  DiagnosticLanguage,
  DiagnosticTranscription,
  OralReadingMetrics,
} from "../types/diagnostic";
import type {
  DiagnosticAudioUploadResult,
  DiagnosticRecordingIdentity,
  DiagnosticSegmentIdentity,
} from "./diagnosticAudio.ts";
import {
  DiagnosticAudioUploadError,
  type DiagnosticAudioErrorCode,
} from "./diagnosticAudioError.ts";
import { calculateOralReadingMetrics, getReadingWords } from "./diagnosticScoring.ts";

export const DIAGNOSTIC_SEGMENT_DURATION_SECONDS = 25;
export const DIAGNOSTIC_MAX_RECORDING_SECONDS = 5 * 60;

export class DiagnosticRecordingProcessingError extends Error {
  readonly code: DiagnosticAudioErrorCode;
  readonly segmentIndex?: number;
  readonly httpStatus?: number;

  constructor({
    code = "STT_PROVIDER_ERROR",
    segmentIndex,
    message = "We couldn't process your reading. Please record it again.",
    httpStatus,
  }: {
    code?: DiagnosticAudioErrorCode;
    segmentIndex?: number;
    message?: string;
    httpStatus?: number;
  } = {}) {
    super(message);
    this.name = "DiagnosticRecordingProcessingError";
    this.code = code;
    this.segmentIndex = segmentIndex;
    this.httpStatus = httpStatus;
  }
}

export function getExpectedDiagnosticSegmentCount(durationSeconds: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;

  return Math.ceil(
    Math.min(durationSeconds, DIAGNOSTIC_MAX_RECORDING_SECONDS)
      / DIAGNOSTIC_SEGMENT_DURATION_SECONDS,
  );
}

export function combineDiagnosticTranscriptions(
  transcriptions: readonly DiagnosticTranscription[],
): DiagnosticTranscription {
  const text = transcriptions
    .map((transcription) => transcription.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const confidences = transcriptions
    .map((transcription) => transcription.confidence)
    .filter((confidence): confidence is number => (
      typeof confidence === "number" && Number.isFinite(confidence)
    ));

  if (confidences.length === 0) return { text };

  return {
    text,
    confidence: confidences.reduce((total, value) => total + value, 0)
      / confidences.length,
  };
}

interface ProcessDiagnosticRecordingInput {
  audioSegments: readonly Blob[];
  language: DiagnosticLanguage;
  expectedText: string;
  recordingDurationSeconds: number;
  segmentDurationsSeconds?: readonly number[];
  uploadSegment: (
    audioSegment: Blob,
    language: DiagnosticLanguage,
    segment?: DiagnosticSegmentIdentity,
  ) => Promise<DiagnosticAudioUploadResult>;
  calculateMetrics?: (
    expectedText: string,
    transcript: string,
    recordingDurationSeconds?: number,
    language?: DiagnosticLanguage,
  ) => OralReadingMetrics;
  /** Only a successfully drained, complete Google stream may supply this. */
  streamingTranscription?: DiagnosticTranscription | null;
  /**
   * Module 2 only. Every transcript must then carry a server receipt; they are
   * returned in order as transcriptReceipts. Module 5 omits it and is unchanged.
   */
  diagnostic?: DiagnosticRecordingIdentity;
}

function missingReceipt(segmentIndex?: number) {
  return new DiagnosticRecordingProcessingError({ code: "STT_PROVIDER_ERROR", segmentIndex });
}

export async function processDiagnosticRecording({
  audioSegments,
  language,
  expectedText,
  recordingDurationSeconds,
  segmentDurationsSeconds = [],
  uploadSegment,
  calculateMetrics = calculateOralReadingMetrics,
  streamingTranscription,
  diagnostic,
}: ProcessDiagnosticRecordingInput) {
  const requireReceipts = diagnostic !== undefined;
  if (
    audioSegments.length === 0
    || !Number.isFinite(recordingDurationSeconds)
    || recordingDurationSeconds <= 0
  ) {
    throw new DiagnosticRecordingProcessingError();
  }

  // An unsigned stream cannot be scored for Module 2; the uploaded parts are used instead.
  if (streamingTranscription?.text.trim() && (!requireReceipts || streamingTranscription.receipt)) {
    if (!getReadingWords(streamingTranscription.text, language).length) throw new DiagnosticRecordingProcessingError({ code: "NO_SPEECH" });
    return {
      transcription: streamingTranscription,
      oralReadingMetrics: calculateMetrics(
        expectedText, streamingTranscription.text, recordingDurationSeconds, language,
      ),
      transcriptReceipts: streamingTranscription.receipt ? [streamingTranscription.receipt] : [],
    };
  }

  const transcriptions: DiagnosticTranscription[] = [];

  for (let index = 0; index < audioSegments.length; index += 1) {
    const audioSegment = audioSegments[index];
    const segmentIndex = index + 1;
    const baseMimeType = audioSegment.type.split(";", 1)[0].trim().toLowerCase();

    if (audioSegment.size <= 0 || baseMimeType !== "audio/webm") {
      throw new DiagnosticRecordingProcessingError({
        code: "STT_INVALID_AUDIO",
        segmentIndex,
        message: "A captured part of the reading is not valid WebM audio.",
      });
    }

    if (import.meta.env?.DEV) {
      console.info(`Diagnostic segment ${segmentIndex}:`, {
        duration: segmentDurationsSeconds[index],
        size: audioSegment.size,
        mime: audioSegment.type,
      });
    }

    try {
      const result = diagnostic
        ? await uploadSegment(audioSegment, language, { ...diagnostic, segmentIndex })
        : await uploadSegment(audioSegment, language);
      const transcription = result.transcription;

      if (!result.success || !transcription?.text.trim()) {
        throw new DiagnosticAudioUploadError(
          result.code ?? "NO_SPEECH",
          result.message,
        );
      }

      if (requireReceipts && !transcription.receipt) throw missingReceipt(segmentIndex);
      transcriptions.push(transcription);
    } catch (error) {
      if (error instanceof DiagnosticRecordingProcessingError) throw error;
      const uploadError = error instanceof DiagnosticAudioUploadError
        ? error
        : new DiagnosticAudioUploadError("STT_PROVIDER_ERROR");

      if (import.meta.env?.DEV) {
        console.error(`Diagnostic STT segment ${segmentIndex} failed:`, {
          httpStatus: uploadError.httpStatus,
          code: uploadError.code,
        });
      }

      throw new DiagnosticRecordingProcessingError({
        code: uploadError.code,
        segmentIndex,
        message: uploadError.message,
        httpStatus: uploadError.httpStatus,
      });
    }
  }

  const transcription = combineDiagnosticTranscriptions(transcriptions);
  if (!getReadingWords(transcription.text, language).length) throw new DiagnosticRecordingProcessingError({ code: "NO_SPEECH" });

  return {
    transcription,
    oralReadingMetrics: calculateMetrics(
      expectedText,
      transcription.text,
      recordingDurationSeconds,
      language,
    ),
    transcriptReceipts: transcriptions.flatMap((item) => item.receipt ? [item.receipt] : []),
  };
}
