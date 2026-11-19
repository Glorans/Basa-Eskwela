import type { Difficulty, ReadingLevel } from "../../../data/dashboardData";
import type { Database, Json } from "../../../lib/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { diagnosticAssessmentRegistry, getRequiredDiagnosticLanguages, isDiagnosticLanguage } from "../data/diagnosticData.ts";
import { FIRST_OFFICIAL_INITIAL_VERSION, INITIAL_DIAGNOSTIC_LINEAGE, initialVersionNumber } from "../data/permanentInitialAssessments.ts";
import type {
  DiagnosticLanguage,
  DiagnosticResult,
  DiagnosticVerificationStatus,
  OralReadingMetrics,
  ReadingWordAlignment,
  SavedDiagnosticResult,
} from "../types/diagnostic";

const INITIAL_ASSESSMENT_TYPE = "initial" as const;
// Only results the backend scored from server-signed transcripts count as
// completed. Rows the browser wrote before DT1 stay 'unverified' and are kept.
const SERVER_VERIFIED = "server_verified" as const;
type DiagnosticResultDatabaseRow =
  Database["public"]["Tables"]["diagnostic_results"]["Row"];

/** An official initial result: server-verified, of the language's initial lineage, version 3.0 or later (never v2.0). */
function isOfficialInitialRow(row: Pick<DiagnosticResultDatabaseRow, "language" | "assessment_id" | "assessment_version" | "verification_status"> & { assessment_type?: string | null }) {
  if (row.verification_status !== SERVER_VERIFIED || (row.assessment_type !== undefined && row.assessment_type !== INITIAL_ASSESSMENT_TYPE)) return false;
  if (!isDiagnosticLanguage(row.language)) return false;
  return row.assessment_id === INITIAL_DIAGNOSTIC_LINEAGE[row.language]
    && initialVersionNumber(row.assessment_version) >= FIRST_OFFICIAL_INITIAL_VERSION;
}

export type DiagnosticSaveErrorCode =
  | "AUTH_REQUIRED"
  | "ALREADY_COMPLETED"
  | "READING_NOT_VERIFIED"
  | "ASSESSMENT_CHANGED"
  | "SAVE_FAILED";

export class DiagnosticDatabaseError extends Error {
  readonly code: DiagnosticSaveErrorCode;

  constructor(message: string, code: DiagnosticSaveErrorCode = "SAVE_FAILED") {
    super(message);
    this.name = "DiagnosticDatabaseError";
    this.code = code;
  }
}

/** What the browser may send: answers and the server's own receipts, never scores. */
export interface DiagnosticSubmission {
  language: DiagnosticLanguage;
  assessmentId: string;
  assessmentVersion: string;
  answers: Record<string, string>;
  transcriptReceipts: string[];
  recordingDurationSeconds?: number;
}

export interface DiagnosticSubmissionResponse {
  status: number;
  code?: string;
  result?: DiagnosticResultDatabaseRow;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWordAlignment(value: unknown): ReadingWordAlignment | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;

  if (
    (value.type === "match" || value.type === "substitution") &&
    typeof value.expectedWord === "string" &&
    typeof value.spokenWord === "string"
  ) {
    return {
      type: value.type,
      expectedWord: value.expectedWord,
      spokenWord: value.spokenWord,
    };
  }

  if (value.type === "omission" && typeof value.expectedWord === "string") {
    return { type: "omission", expectedWord: value.expectedWord };
  }

  if (value.type === "insertion" && typeof value.spokenWord === "string") {
    return { type: "insertion", spokenWord: value.spokenWord };
  }

  return null;
}

function parseOralReadingMetrics(
  value: Json | null,
): OralReadingMetrics | undefined {
  if (!isRecord(value) || !Array.isArray(value.alignment)) return undefined;

  const alignment = value.alignment.map(parseWordAlignment);
  if (alignment.some((word) => word === null)) return undefined;

  const numericKeys = [
    "totalExpectedWords",
    "numberOfWordsRead",
    "correctWords",
    "substitutions",
    "omissions",
    "insertions",
    "detectableMiscues",
    "wordAccuracy",
    "wordReadingScore",
  ] as const;

  if (numericKeys.some((key) => typeof value[key] !== "number")) {
    return undefined;
  }

  const readingSpeedWpm =
    typeof value.readingSpeedWpm === "number"
      ? value.readingSpeedWpm
      : undefined;
  const correctWordsPerMinute =
    typeof value.correctWordsPerMinute === "number"
      ? value.correctWordsPerMinute
      : undefined;
  const recordingDurationSeconds =
    typeof value.recordingDurationSeconds === "number"
      ? value.recordingDurationSeconds
      : undefined;

  return {
    alignment: alignment as ReadingWordAlignment[],
    totalExpectedWords: value.totalExpectedWords as number,
    numberOfWordsRead: value.numberOfWordsRead as number,
    correctWords: value.correctWords as number,
    substitutions: value.substitutions as number,
    omissions: value.omissions as number,
    insertions: value.insertions as number,
    detectableMiscues: value.detectableMiscues as number,
    wordAccuracy: value.wordAccuracy as number,
    wordReadingScore: value.wordReadingScore as number,
    ...(readingSpeedWpm === undefined ? {} : { readingSpeedWpm }),
    ...(correctWordsPerMinute === undefined
      ? {}
      : { correctWordsPerMinute }),
    ...(recordingDurationSeconds === undefined
      ? {}
      : { recordingDurationSeconds }),
  };
}

function parseComprehensionAnswers(value: Json | null) {
  const answers = isRecord(value) ? value.comprehensionAnswers : undefined;
  if (!isRecord(answers) || Object.values(answers).some(answer => typeof answer !== "string")) return undefined;
  return { ...answers } as Record<string, string>;
}

function parseVerificationStatus(value: unknown): DiagnosticVerificationStatus {
  return value === SERVER_VERIFIED ? SERVER_VERIFIED : "unverified";
}

function parseDiagnosticLanguage(value: string): DiagnosticLanguage {
  if (isDiagnosticLanguage(value)) return value;
  throw new DiagnosticDatabaseError("The saved diagnostic language is invalid.");
}

function parseReadingLevel(value: string): ReadingLevel {
  if (
    value === "Independent"
    || value === "Instructional"
    || value === "Frustration"
  ) {
    return value;
  }

  throw new DiagnosticDatabaseError("The saved diagnostic reading level is invalid.");
}

function parseDifficultyTier(value: string): Difficulty {
  if (value === "Easy" || value === "Medium" || value === "Hard") {
    return value;
  }

  throw new DiagnosticDatabaseError("The saved diagnostic difficulty is invalid.");
}

interface DiagnosticSaveFailure {
  status: number;
  code: string | null;
  payloadFieldNames: string[];
}

const SAVE_FAILED_MESSAGE = "We couldn't save your diagnostic result. Please try again.";

function toSaveError(response: DiagnosticSubmissionResponse) {
  if (response.status === 401) {
    return new DiagnosticDatabaseError("Your session has expired. Please sign in again.", "AUTH_REQUIRED");
  }
  if (response.code === "DIAGNOSTIC_ALREADY_COMPLETED") {
    return new DiagnosticDatabaseError("This diagnostic is already completed.", "ALREADY_COMPLETED");
  }
  if (response.code === "READING_NOT_VERIFIED" || response.code === "NO_SPEECH") {
    return new DiagnosticDatabaseError(
      "We couldn't verify your reading. Please go back to the story and record it again.",
      "READING_NOT_VERIFIED",
    );
  }
  if (response.code === "ASSESSMENT_CHANGED") {
    return new DiagnosticDatabaseError("This diagnostic was updated. Please reload the page and start again.", "ASSESSMENT_CHANGED");
  }
  return new DiagnosticDatabaseError(SAVE_FAILED_MESSAGE);
}

export function createDiagnosticRepository(
  supabase: SupabaseClient<Database>,
  options: {
    /** Sends the submission to POST /api/diagnostic/results with the session token. */
    submit?: (submission: DiagnosticSubmission) => Promise<DiagnosticSubmissionResponse>;
    onSaveError?: (failure: DiagnosticSaveFailure) => void;
  } = {},
) {
  async function getAuthenticatedUserId() {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      throw new DiagnosticDatabaseError(
        "You need to sign in before accessing a diagnostic result.",
      );
    }

    return user.id;
  }

  function mapDatabaseRow(
    row: DiagnosticResultDatabaseRow,
  ): SavedDiagnosticResult {
    const comprehensionAnswers = parseComprehensionAnswers(row.oral_reading_metrics);
    return {
      id: row.id,
      userId: row.user_id,
      assessmentType: row.assessment_type,
      completedAt: row.completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      result: {
        language: parseDiagnosticLanguage(row.language),
        assessmentId: row.assessment_id ?? undefined,
        assessmentVersion: row.assessment_version ?? undefined,
        orvScore: row.orv_score,
        comprehensionScore: row.comprehension_score,
        readingLevel: parseReadingLevel(row.reading_level),
        difficultyTier: parseDifficultyTier(row.difficulty_tier),
        readingSpeedWpm: row.reading_speed_wpm ?? undefined,
        transcript: row.transcript ?? undefined,
        googleConfidence: row.stt_confidence ?? undefined,
        oralReadingMetrics: parseOralReadingMetrics(row.oral_reading_metrics),
        ...(comprehensionAnswers ? { comprehensionAnswers } : {}),
        verificationStatus: parseVerificationStatus(row.verification_status),
      },
    };
  }

  /**
   * The backend rescores the reading from its own signed transcripts and stores
   * the official result. Scores, levels and tiers in `result` are local
   * previews only and are never sent.
   */
  async function saveInitialDiagnosticResult(
    result: DiagnosticResult,
  ): Promise<SavedDiagnosticResult> {
    if (!options.submit) throw new DiagnosticDatabaseError(SAVE_FAILED_MESSAGE);
    if (!result.assessmentId || !result.assessmentVersion) throw new DiagnosticDatabaseError("Assessment identity is required.");
    if (!result.comprehensionAnswers || !result.transcriptReceipts?.length) {
      throw new DiagnosticDatabaseError(
        "The diagnostic result is incomplete and cannot be saved yet.",
      );
    }
    const duration = result.oralReadingMetrics?.recordingDurationSeconds;
    const submission: DiagnosticSubmission = {
      language: parseDiagnosticLanguage(result.language),
      assessmentId: result.assessmentId,
      assessmentVersion: result.assessmentVersion,
      answers: { ...result.comprehensionAnswers },
      transcriptReceipts: [...result.transcriptReceipts],
      ...(typeof duration === "number" && Number.isFinite(duration) ? { recordingDurationSeconds: duration } : {}),
    };

    let response: DiagnosticSubmissionResponse;
    try {
      response = await options.submit(submission);
    } catch {
      response = { status: 0 };
    }
    const row = response.result;
    if ((response.status === 200 || response.status === 201) && row
      && row.verification_status === SERVER_VERIFIED && row.language === submission.language) {
      return mapDatabaseRow(row);
    }
    // The browser facade enables this only in development. Never pass the
    // session, receipts, transcripts or answers to logs.
    try {
      options.onSaveError?.({
        status: response.status,
        code: response.code ?? null,
        payloadFieldNames: Object.keys(submission),
      });
    } catch { /* Logging must not interfere with the child-friendly retry. */ }
    throw toSaveError(response);
  }

  // Learner/Module 3 retrieval: the official initial result for the language, i.e. the active version or a
  // permanently valid one (PERMANENT_INITIAL_ASSESSMENTS), preferring the active version. Historical rows remain
  // available through the existing admin results API and database.
  async function getInitialDiagnosticResult(language: DiagnosticLanguage = "en"): Promise<SavedDiagnosticResult | null> {
    const userId = await getAuthenticatedUserId();
    const { data, error } = await supabase
      .from("diagnostic_results")
      .select()
      .eq("user_id", userId)
      .eq("assessment_type", INITIAL_ASSESSMENT_TYPE)
      .eq("language", language)
      .eq("verification_status", SERVER_VERIFIED);

    if (error) {
      throw new DiagnosticDatabaseError(
        "We couldn't load your diagnostic result. Please try again.",
      );
    }

    const rows = ((data ?? []) as DiagnosticResultDatabaseRow[]).filter((row) => isOfficialInitialRow(row));
    const active = diagnosticAssessmentRegistry[language];
    const preferred = rows.find((row) => row.assessment_id === active?.id && row.assessment_version === active?.version)
      ?? [...rows].sort((a, b) => String(b.verified_at ?? "").localeCompare(String(a.verified_at ?? "")))[0];
    return preferred ? mapDatabaseRow(preferred) : null;
  }

  async function getCompletedDiagnosticLanguages(): Promise<DiagnosticLanguage[]> {
    const userId = await getAuthenticatedUserId();
    const { data, error } = await supabase.from("diagnostic_results")
      .select("language, assessment_id, assessment_version, verification_status").eq("user_id", userId).eq("assessment_type", INITIAL_ASSESSMENT_TYPE)
      .eq("verification_status", SERVER_VERIFIED);
    if (error) throw new DiagnosticDatabaseError("We couldn't check your diagnostic status. Please try again.");
    // Completion is permanent: the active version OR a permanently valid one (a newer version never forces a retake).
    return [...new Set((data ?? []).flatMap(row => (isDiagnosticLanguage(row.language) && isOfficialInitialRow(row) ? [row.language] : [])))];
  }

  async function hasCompletedInitialDiagnostic(language?: DiagnosticLanguage): Promise<boolean> {
    const completed = await getCompletedDiagnosticLanguages();
    return (language ? [language] : getRequiredDiagnosticLanguages()).every(item => completed.includes(item));
  }

  return { saveInitialDiagnosticResult, getInitialDiagnosticResult, getCompletedDiagnosticLanguages, hasCompletedInitialDiagnostic };
}
