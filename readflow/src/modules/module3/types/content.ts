import type { Difficulty, ReadingLevel } from "../../../data/dashboardData";

export type M3Role = "admin" | "teacher" | "general_user";

export type ModuleDifficulty = Difficulty;
export type ModuleStatus = "draft" | "published" | "archived";
export type MaterialLanguage = "English" | "Filipino";
export type MaterialLanguageCode = "en" | "fil";
export type MaterialFileType = "PDF" | "DOCX" | "JPG" | "PNG";
export type MaterialProcessingStatus =
  | "pending"
  | "processing"
  | "completed"
  | "pending_ocr"
  | "failed";
export type MaterialUploaderRole = "Admin" | "Teacher" | "Independent Learner" | "User";
export type QuestionType = "literal" | "inferential" | "critical";
export type GeneratedQuestionsReviewStatus = "generated" | "reviewed";

export interface LearningPath {
  id: string;
  name: string;
  language: MaterialLanguageCode;
  readingLevel: ReadingLevel;
  difficultyTier: ModuleDifficulty;
}

export interface ReadingModule {
  id: string;
  title: string;
  difficulty: ModuleDifficulty;
  learningPathId: string;
  learningPath: string;
  language: MaterialLanguageCode;
  readingLevel: ReadingLevel;
  difficultyTier: ModuleDifficulty;
  status: ModuleStatus;
  createdAt: string;
  publishedAt?: string;
  passage: string;
  questionCount: number;
  sourceMaterialId?: string;
}

export interface StudentReadingModule {
  id: string;
  title: string;
  difficulty: ModuleDifficulty;
  learningPath: string;
  language: MaterialLanguageCode;
  readingLevel: ReadingLevel;
  difficultyTier: ModuleDifficulty;
  passage: string;
}

export interface ModuleFormValues {
  title: string;
  learningPathId: string;
  difficulty: ModuleDifficulty;
  passage: string;
}

export interface M3ModuleMutationResult {
  ok: boolean;
  message: string;
  module?: ReadingModule;
}

export type M3FeedbackKind = "success" | "error";

export interface M3Feedback {
  kind: M3FeedbackKind;
  message: string;
}

export interface UploadedMaterial {
  id: string;
  title: string;
  uploadedById: string;
  uploaderName: string;
  uploaderRole: MaterialUploaderRole;
  fileType: MaterialFileType;
  language: MaterialLanguage;
  uploadedAt: string;
  processingStatus: MaterialProcessingStatus;
  originalFilename: string;
  fileSizeBytes: number;
  fileSizeLabel: string;
  rawExtractedText: string | null;
  contentText: string | null;
  ocrConfidence: number | null;
  mimeType: string;
  languageCode: MaterialLanguageCode;
  questionCount?: number;
  questionSetCount?: number;
}

export interface GeneratedComprehensionQuestion {
  id: string;
  type: QuestionType;
  questionText: string;
  options: [string, string, string, string];
  correctAnswer: string;
  correctOptionIndex?: number;
  scaffoldingHint: string;
  reviewStatus?: GeneratedQuestionsReviewStatus;
  displayOrder?: number;
}

export interface ReviewableComprehensionQuestion {
  id: string;
  type: QuestionType;
  questionText: string;
  options: [string, string, string, string];
  correctOptionIndex: number;
  scaffoldingHint: string;
}

export interface MaterialGeneratedQuestions {
  questions: GeneratedComprehensionQuestion[];
  reviewStatus: GeneratedQuestionsReviewStatus;
}

export type GeneratedQuestionsByMaterial = Record<string, MaterialGeneratedQuestions>;


export interface MaterialQuestionSetSummary {
  id: string;
  materialId: string;
  name: string;
  sequenceNumber: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  questionCount: number;
  counts: Record<QuestionType, number>;
  reviewStatus: GeneratedQuestionsReviewStatus;
  /** Student assignment rows (class activities) that use this set. */
  assignedCount?: number;
  /** True once a student has started comprehension from one of those activities. */
  hasStudentAttempts?: boolean;
}
export interface MaterialQuestionSet extends MaterialQuestionSetSummary {
  questions: GeneratedComprehensionQuestion[];
}
