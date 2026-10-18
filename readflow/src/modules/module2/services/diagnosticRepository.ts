import { createPassageDiagnosticResult } from "./diagnosticPassage.ts";
import type { Difficulty, ReadingLevel } from "../../../data/dashboardData";
import type { Database, Json } from "../../../lib/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { diagnosticAssessmentRegistry, getRequiredDiagnosticLanguages, isDiagnosticLanguage } from "../data/diagnosticData.ts";
import type {
  DiagnosticLanguage,
  DiagnosticResult,
  OralReadingMetrics,
  ReadingWordAlignment,
  SavedDiagnosticResult,
} from "../types/diagnostic";

const INITIAL_ASSESSMENT_TYPE = "initial" as const;
type DiagnosticResultDatabaseRow =
  Database["public"]["Tables"]["diagnostic_results"]["Row"];
type DiagnosticResultDatabaseInsert =
  Database["public"]["Tables"]["diagnostic_results"]["Insert"];

export class DiagnosticDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiagnosticDatabaseError";
  }
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

function serializeOralReadingMetrics(
  metrics: OralReadingMetrics | undefined,
): Json | null {
  if (!metrics) return null;

  return {
    alignment: metrics.alignment.map((word) => ({ ...word })),
    totalExpectedWords: metrics.totalExpectedWords,
    numberOfWordsRead: metrics.numberOfWordsRead,
    correctWords: metrics.correctWords,
    substitutions: metrics.substitutions,
    omissions: metrics.omissions,
    insertions: metrics.insertions,
    detectableMiscues: metrics.detectableMiscues,
    wordAccuracy: metrics.wordAccuracy,
    wordReadingScore: metrics.wordReadingScore,
    readingSpeedWpm: metrics.readingSpeedWpm,
    correctWordsPerMinute: metrics.correctWordsPerMinute,
    recordingDurationSeconds: metrics.recordingDurationSeconds,
  };
}

function parseComprehensionAnswers(value: Json | null) {
  const answers = isRecord(value) ? value.comprehensionAnswers : undefined;
  if (!isRecord(answers) || Object.values(answers).some(answer => typeof answer !== "string")) return undefined;
  return { ...answers } as Record<string, string>;
}

function finiteNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requireCompleteResult(result: DiagnosticResult) {
  const orvScore = finiteNumber(result.orvScore);
  const comprehensionScore = finiteNumber(result.comprehensionScore);

  if (
    !result.readingLevel ||
    !result.difficultyTier ||
    orvScore === null ||
    comprehensionScore === null
  ) {
    throw new DiagnosticDatabaseError(
      "The diagnostic result is incomplete and cannot be saved yet.",
    );
  }

  return {
    readingLevel: result.readingLevel,
    difficultyTier: result.difficultyTier,
    orvScore,
    comprehensionScore,
  };
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
  code: string | null;
  message: string;
  details: string | null;
  hint: string | null;
  payloadFieldNames: string[];
}

export function createDiagnosticRepository(
  supabase: SupabaseClient<Database>,
  options: { onSaveError?: (failure: DiagnosticSaveFailure) => void } = {},
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
      },
    };
  }

  async function saveInitialDiagnosticResult(
    result: DiagnosticResult,
  ): Promise<SavedDiagnosticResult> {
    const userId = await getAuthenticatedUserId();
    const active = diagnosticAssessmentRegistry[result.language];
    if (!result.assessmentId || !result.assessmentVersion) throw new DiagnosticDatabaseError("Assessment identity is required.");
    if (active && result.assessmentId === active.id && result.assessmentVersion === active.version) {
      // The active whole-passage diagnostic is always rescored from the FINAL
      // transcript, recording duration and answers; submitted scores are ignored.
      result = createPassageDiagnosticResult(active, {
        language: result.language,
        transcription: { text: result.transcript, confidence: result.googleConfidence },
        oralReadingMetrics: result.oralReadingMetrics,
      }, result.comprehensionAnswers ?? {});
    }
    const oralReadingMetrics = serializeOralReadingMetrics(result.oralReadingMetrics);
    const completeResult = requireCompleteResult(result);
    const now = new Date().toISOString();
    const insert: DiagnosticResultDatabaseInsert = {
      user_id: userId,
      assessment_type: INITIAL_ASSESSMENT_TYPE,
      language: parseDiagnosticLanguage(result.language),
      assessment_id: result.assessmentId ?? null,
      assessment_version: result.assessmentVersion ?? null,
      orv_score: completeResult.orvScore,
      comprehension_score: completeResult.comprehensionScore,
      reading_level: completeResult.readingLevel,
      difficulty_tier: completeResult.difficultyTier,
      reading_speed_wpm: finiteNumber(result.readingSpeedWpm),
      transcript: result.transcript ?? null,
      stt_confidence: finiteNumber(result.googleConfidence),
      oral_reading_metrics: oralReadingMetrics && result.comprehensionAnswers
        ? { ...(oralReadingMetrics as Record<string, Json>), comprehensionAnswers: { ...result.comprehensionAnswers } }
        : oralReadingMetrics,
      completed_at: now,
      updated_at: now,
    };

    const { data, error } = await supabase
      .from("diagnostic_results")
      .upsert(insert, { onConflict: "user_id,assessment_type,language,assessment_id,assessment_version" })
      .select()
      .single();

    if (error || !data) {
      // The browser facade enables this only in development. Never pass the
      // client, session, payload values, or arbitrary error properties to logs.
      try {
        options.onSaveError?.({
          code: error?.code ?? null,
          message: error?.message ?? "No saved diagnostic row was returned.",
          details: error?.details ?? null,
          hint: error?.hint ?? null,
          payloadFieldNames: Object.keys(insert),
        });
      } catch { /* Logging must not interfere with the child-friendly retry. */ }
      throw new DiagnosticDatabaseError(
        "We couldn't save your diagnostic result. Please try again.",
      );
    }

    return mapDatabaseRow(data);
  }

  // Learner/Module 3 retrieval selects only the active version. Historical rows
  // remain available through the existing admin results API and database.
  async function getInitialDiagnosticResult(language: DiagnosticLanguage = "en"): Promise<SavedDiagnosticResult | null> {
    const userId = await getAuthenticatedUserId();
    const { data, error } = await supabase
      .from("diagnostic_results")
      .select()
      .eq("user_id", userId)
      .eq("assessment_type", INITIAL_ASSESSMENT_TYPE)
      .eq("language", language)
      .eq("assessment_id", diagnosticAssessmentRegistry[language]!.id)
      .eq("assessment_version", diagnosticAssessmentRegistry[language]!.version)
      .maybeSingle();

    if (error) {
      throw new DiagnosticDatabaseError(
        "We couldn't load your diagnostic result. Please try again.",
      );
    }

    return data ? mapDatabaseRow(data) : null;
  }

  async function getCompletedDiagnosticLanguages(): Promise<DiagnosticLanguage[]> {
    const userId = await getAuthenticatedUserId();
    const { data, error } = await supabase.from("diagnostic_results")
      .select("language, assessment_id, assessment_version").eq("user_id", userId).eq("assessment_type", INITIAL_ASSESSMENT_TYPE);
    if (error) throw new DiagnosticDatabaseError("We couldn't check your diagnostic status. Please try again.");
    return (data ?? []).flatMap(row => {
      if (!isDiagnosticLanguage(row.language)) return [];
      const active = diagnosticAssessmentRegistry[row.language];
      return active?.contentStatus === "active"
        && row.language === active.language
        && row.assessment_id === active.id
        && row.assessment_version === active.version
        ? [row.language] : [];
    });
  }

  async function hasCompletedInitialDiagnostic(language?: DiagnosticLanguage): Promise<boolean> {
    const completed = await getCompletedDiagnosticLanguages();
    return (language ? [language] : getRequiredDiagnosticLanguages()).every(item => completed.includes(item));
  }

  return { saveInitialDiagnosticResult, getInitialDiagnosticResult, getCompletedDiagnosticLanguages, hasCompletedInitialDiagnostic };
}
