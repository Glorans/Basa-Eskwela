import type { Difficulty, ReadingLevel } from "../../../data/dashboardData";

export type DiagnosticLanguage = "en" | "fil";

interface DiagnosticChoice {
  id: string;
  label: string;
}

export interface DiagnosticQuestion {
  id: string;
  prompt: string;
  choices: readonly DiagnosticChoice[];
  correctChoiceId: string;
}

export interface DiagnosticPassage<
  Language extends DiagnosticLanguage = DiagnosticLanguage,
> {
  language: Language;
  title: string;
  paragraphs: readonly string[];
}

export interface DiagnosticAssessment<
  Language extends DiagnosticLanguage = DiagnosticLanguage,
> {
  id: string;
  title: string;
  gradeLevel: number;
  language: Language;
  assessmentType: string;
  sourceLabel: string;
  sourceUrl: string;
  version: string;
  contentStatus: "active";
  passage: DiagnosticPassage<Language>;
  questions: readonly DiagnosticQuestion[];
}

export type DiagnosticAssessmentRegistry = Readonly<{
  [Language in DiagnosticLanguage]: DiagnosticAssessment<Language> | null;
}>;

export interface DiagnosticTranscription {
  text: string;
  confidence?: number;
  /** Server-signed proof that the backend produced this Azure transcript. */
  receipt?: string;
  /** A part of an M2 recording that held only silence or noise (signed, empty receipt). */
  noSpeech?: boolean;
}

export type ReadingWordAlignment =
  | {
      type: "match" | "substitution";
      expectedWord: string;
      spokenWord: string;
    }
  | {
      type: "omission";
      expectedWord: string;
    }
  | {
      type: "insertion";
      spokenWord: string;
    };

export interface OralReadingMetrics {
  alignment: ReadingWordAlignment[];
  totalExpectedWords: number;
  numberOfWordsRead: number;
  correctWords: number;
  substitutions: number;
  omissions: number;
  insertions: number;
  detectableMiscues: number;
  /** Literal aligned-match percentage; not the final Phil-IRI-aligned score. */
  wordAccuracy: number;
  wordReadingScore: number;
  /** M2 only: spoken title words set aside before scoring (0 when the title was not read or not set aside). */
  titleWordsExcluded?: number;
  readingSpeedWpm?: number;
  correctWordsPerMinute?: number;
  recordingDurationSeconds?: number;
}

/** One continuous reading of the whole passage: one transcript, one metric set. */
export interface DiagnosticQuestionsRouteState {
  language: DiagnosticLanguage;
  transcription: DiagnosticTranscription;
  oralReadingMetrics: OralReadingMetrics;
  /** One receipt per transcribed part, in order; the backend scores only these. */
  transcriptReceipts: string[];
}

export type DiagnosticVerificationStatus = "unverified" | "server_verified";

/** M2 F7 staff Practice Mode: where the practice routes live and where "Exit practice" returns to. */
export interface DiagnosticPracticeOptions {
  basePath: string;
  exitTo: string;
  /** Text of the Exit link (e.g. "Back to Package"); the banner's default wording when omitted. */
  exitLabel?: string;
}

/** M2 F8 Student reassessment: the assignment being taken, where its screens live and where "Back" returns to. */
export interface DiagnosticReassessmentOptions {
  assignmentId: string;
  basePath: string;
  exitTo: string;
}

/**
 * Frontend representation of a diagnostic_results record.
 * Optional values stay unavailable until a real scoring/STT source provides them.
 */
export interface DiagnosticResult {
  comprehensionAnswers?: Record<string, string>;
  language: DiagnosticLanguage;
  assessmentId?: string;
  assessmentVersion?: string;
  /** Score of STT-detected oral reading miscues, not confirmed pronunciation errors. */
  orvScore?: number;
  comprehensionScore?: number;
  readingLevel?: ReadingLevel;
  difficultyTier?: Difficulty;
  readingSpeedWpm?: number;
  transcript?: string;
  googleConfidence?: number;
  oralReadingMetrics?: OralReadingMetrics;
  transcriptReceipts?: string[];
  verificationStatus?: DiagnosticVerificationStatus;
}

export interface SavedDiagnosticResult {
  id: string;
  userId: string;
  assessmentType: string;
  completedAt: string;
  createdAt: string;
  updatedAt: string;
  result: DiagnosticResult;
}
