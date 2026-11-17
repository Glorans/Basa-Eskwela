import type { DiagnosticLanguage, ReadingWordAlignment } from "../../module2/types/diagnostic";

// "admin" and "teacher" are limited to M5/M6 self-practice: own read-alouds, results and recordings.
// Teacher practice is for APPROVED Teachers (enforced by the backend and database).
export type LearnerM5Role = "student" | "general_user" | "admin" | "teacher";
export type PracticeRole = Extract<LearnerM5Role, "admin" | "teacher">;

export interface OralReadingContext {
  materialId?: string | null;
  activityAssignmentId?: string | null;
  passageRevision?: string;
  passageId?: string | null;
  roomId?: string | null;
  assignmentId?: string | null;
}

export interface OralReadingModule extends OralReadingContext {
  readAloudOnly?: boolean;
  /** Set by the server: the reading belongs to an archived classroom (read-only, no recorder). */
  roomArchived?: boolean;
  /** Student only, set by the server: a published module read outside any classroom (personal practice). */
  personalPractice?: boolean;
  passageTitle?: string;
  id: string | null;
  title: string;
  difficulty: string;
  passage: string;
  learningPath: string;
  language: DiagnosticLanguage;
}

export interface OralReadingWordMetric {
  expected: string | null;
  actual: string | null;
  type: ReadingWordAlignment["type"];
}

export interface CreateOralReadingAttemptInput extends OralReadingContext {
  submissionId?: string;
  moduleId: string | null;
  transcript: string;
  durationSeconds: number;
  wordMetrics: OralReadingWordMetric[];
  sttConfidence: number | null;
}

export interface OralReadingAttempt extends OralReadingContext {
  /** "personal" when saved outside any classroom; "classroom" otherwise. Absent from older servers. */
  practiceContext?: "personal" | "classroom";
  readAloudOnly?: boolean;
  readAloudCompleted?: boolean;
  passageTitle?: string;
  passageSnapshot?: string;
  scoringVersion?: number;
  id: string;
  userId: string;
  moduleId: string | null;
  moduleTitle: string;
  language: DiagnosticLanguage;
  transcript: string;
  durationSeconds: number;
  readingSpeedWpm: number;
  pronunciationAccuracy: number;
  expectedWordCount: number;
  detectedErrorCount: number;
  wordMetrics: OralReadingWordMetric[];
  sttConfidence: number | null;
  completedAt: string;
}

export type TeacherComprehensionStatus =
  | "completed"
  | "in_progress"
  | "not_started"
  | "not_applicable"
  | "unavailable";

export type ComprehensionQuestionType = "literal" | "inferential" | "critical";

export interface TeacherComprehensionTypeSummary {
  total: number;
  answered: number;
  firstCorrect: number;
  resolved: number;
  hintsUsed: number;
  firstAttemptPercentage: number;
}

export interface TeacherComprehensionQuestionReview {
  order: number;
  type: ComprehensionQuestionType;
  prompt: string;
  options: string[];
  studentFirstAnswerIndex: number | null;
  correctIndex: number;
  firstAnswerCorrect: boolean | null;
  hintUsed: boolean;
  resolved: boolean;
  secondAnswerIndex?: number;
}

export interface TeacherComprehensionScore {
  firstCorrect: number;
  totalQuestions: number;
  firstAttemptPercentage: number;
  hintsUsed: number;
  completedAt: string | null;
}

export type TeacherComprehensionSummary =
  | { status: "not_started" | "not_applicable" | "unavailable" }
  | ({ status: "completed" | "in_progress" } & TeacherComprehensionScore);

export type TeacherComprehensionDetail =
  | { status: "not_started" | "not_applicable" | "unavailable" }
  | ({
      status: "completed" | "in_progress";
      byType: Record<ComprehensionQuestionType, TeacherComprehensionTypeSummary>;
      questions: TeacherComprehensionQuestionReview[];
    } & TeacherComprehensionScore);

export interface TeacherOralReadingAttemptSummary {
  roomId?: string | null;
  comprehension: TeacherComprehensionSummary;
  passageTitle?: string | null;
  scoringVersion?: number;
  id: string;
  learnerId: string;
  learnerName: string;
  moduleId: string | null;
  moduleTitle: string;
  pronunciationAccuracy: number;
  readingSpeedWpm: number;
  detectedErrorCount: number;
  completedAt: string;
}

export interface TeacherOralReadingAttemptDetail
  extends Omit<TeacherOralReadingAttemptSummary, "comprehension"> {
  comprehension: TeacherComprehensionDetail;
  difficulty: string;
  /** Saved reading language; null for older attempts without one. */
  language: DiagnosticLanguage | null;
  expectedWordCount: number;
  passageSnapshot: string;
  transcript: string;
  wordMetrics: OralReadingWordMetric[];
}
