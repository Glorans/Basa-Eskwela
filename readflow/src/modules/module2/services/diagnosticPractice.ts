import axios from "axios";
import api from "../../../services/api";
import { getSessionAuthHeaders } from "../../../services/authHeaders";
import type { ReadingLevel } from "../../../data/dashboardData";
import type { DiagnosticResult } from "../types/diagnostic";

/** M2 F7: a staff practice result as returned by POST /api/diagnostic/practice. It is never stored anywhere. */
export interface DiagnosticPracticeResult {
  practice: true;
  saved: false;
  language: "en" | "fil";
  assessmentId: string;
  assessmentVersion: string;
  scoringRule: string;
  wordRecognitionScore: number;
  comprehensionScore: number;
  wordRecognitionLevel: ReadingLevel;
  comprehensionLevel: ReadingLevel;
  readingLevel: ReadingLevel;
  readingSpeedWpm: number | null;
  reading: {
    totalExpectedWords: number;
    correctWords: number;
    substitutions: number;
    omissions: number;
    insertions: number;
    titleWordsExcluded: number;
  };
  comprehension: { correct: number; total: number; questions: { id: string; correct: boolean }[] };
}

export class DiagnosticPracticeError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "DiagnosticPracticeError";
  }
}

/**
 * Sends the same server-issued reading receipts and answers the official diagnostic uses, to the PRACTICE endpoint.
 * The server scores with the official rubric and returns the result; nothing is saved. Local preview scores in
 * `result` are never sent. The assessment identity is sent so later versioned packages fit the same contract.
 */
export async function scoreDiagnosticPractice(result: DiagnosticResult): Promise<DiagnosticPracticeResult> {
  if (!result.assessmentId || !result.assessmentVersion || !result.comprehensionAnswers || !result.transcriptReceipts?.length) {
    throw new DiagnosticPracticeError("The practice reading is incomplete. Go back to the story and record it again.", "INCOMPLETE");
  }
  const duration = result.oralReadingMetrics?.recordingDurationSeconds;
  const headers = await getSessionAuthHeaders("Your session has expired. Please sign in again.");
  try {
    const response = await api.post<{ success: true; result: DiagnosticPracticeResult }>("/api/diagnostic/practice", {
      language: result.language,
      assessmentId: result.assessmentId,
      assessmentVersion: result.assessmentVersion,
      answers: { ...result.comprehensionAnswers },
      transcriptReceipts: [...result.transcriptReceipts],
      ...(typeof duration === "number" && Number.isFinite(duration) ? { recordingDurationSeconds: duration } : {}),
    }, { headers });
    const practice = response.data.result;
    if (!practice || practice.practice !== true || practice.saved !== false || practice.language !== result.language) {
      throw new DiagnosticPracticeError("We couldn't score this practice attempt. Please try again.");
    }
    return practice;
  } catch (error) {
    if (error instanceof DiagnosticPracticeError) throw error;
    if (axios.isAxiosError<{ code?: string; message?: string }>(error) && error.response) {
      throw new DiagnosticPracticeError(error.response.data?.message || "We couldn't score this practice attempt. Please try again.", error.response.data?.code);
    }
    throw new DiagnosticPracticeError("We couldn't reach the server. Check your connection and try again.");
  }
}
