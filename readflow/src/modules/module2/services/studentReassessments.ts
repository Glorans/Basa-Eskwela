import axios from "axios";
import api from "../../../services/api";
import { getSessionAuthHeaders } from "../../../services/authHeaders";
import type { ReadingLevel } from "../../../data/dashboardData";
import type { DiagnosticAssessment, DiagnosticLanguage, DiagnosticResult } from "../types/diagnostic";

// M2 F8 Complete Reassessment (Students). The server identifies the Student from the session; no learner id is ever
// sent. Content arrives WITHOUT answer keys, and results are scored only by the server.

export interface StudentReassessment {
  id: string;
  status: "active" | "completed";
  language: DiagnosticLanguage;
  title: string;
  /** Students only (Independent Learners have no Learning Room). */
  roomName?: string;
  assignedAt: string;
  dueAt: string | null;
  completedAt: string | null;
  available: boolean;
  unavailableReason: string | null;
  result: { wordRecognitionScore: number | null; comprehensionScore: number | null; readingLevel: ReadingLevel; completedAt: string } | null;
}

/** Independent Learners: whether a new reassessment can start in each language, and plainly why not. */
export interface LanguageAvailability { canStart: boolean; reason: string | null; nextAvailableAt: string | null }
export interface AvailableReassessment { packageVersionId: string; title: string; language: DiagnosticLanguage; canStart: boolean; reason: string | null }
export interface MyReassessments {
  enabled: boolean;
  reassessments: StudentReassessment[];
  languages?: Record<DiagnosticLanguage, LanguageAvailability>;
  available?: AvailableReassessment[];
}

export interface ReassessmentResult {
  assignmentId: string;
  assessmentType: "reassessment";
  language: DiagnosticLanguage;
  title: string;
  completedAt: string;
  wordRecognitionScore: number | null;
  comprehensionScore: number | null;
  wordRecognitionLevel: ReadingLevel;
  comprehensionLevel: ReadingLevel;
  readingLevel: ReadingLevel;
  readingSpeedWpm: number | null;
  reading: { totalExpectedWords: number | null; correctWords: number | null; substitutions: number | null; omissions: number | null; insertions: number | null };
  comprehension: { correct: number; total: number } | null;
  replayed: boolean;
}

interface DeliveredContent {
  assignment: { id: string; dueAt: string | null; title: string };
  assessment: {
    id: string;
    version: string;
    language: DiagnosticLanguage;
    assessmentType: "reassessment";
    title: string;
    passage: { language: DiagnosticLanguage; title: string; paragraphs: string[] };
    questions: { id: string; prompt: string; choices: { id: string; label: string }[] }[];
  };
}

export class StudentReassessmentError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "StudentReassessmentError";
  }
}

const BASE = "/api/reassessments/me";
const headers = async () => ({ headers: await getSessionAuthHeaders("Your session has expired. Please sign in again.") });

async function request<T>(work: () => Promise<{ data: T }>, fallback: string): Promise<T> {
  try {
    return (await work()).data;
  } catch (error) {
    if (axios.isAxiosError<{ code?: string; message?: string }>(error) && error.response) {
      throw new StudentReassessmentError(error.response.data?.message || fallback, error.response.data?.code);
    }
    throw new StudentReassessmentError(error instanceof StudentReassessmentError ? error.message : "We couldn't reach the server. Check your connection and try again.");
  }
}

export const getMyReassessments = async () =>
  request<MyReassessments>(async () => api.get(BASE, await headers()), "We couldn't load your reassessments.");

/** Independent Learners: start (or reopen) a reassessment. The server checks every rule again. */
export const startIndependentReassessment = async (packageVersionId: string) =>
  request<{ assignment: { id: string; language: DiagnosticLanguage }; resumed: boolean }>(async () =>
    api.post(`${BASE}/independent/start`, { packageVersionId }, await headers()), "We couldn't start this reassessment.");

/**
 * The assigned passage and questions as a DiagnosticAssessment, so the existing reading and question screens can be
 * reused. The delivered questions have NO answer key: correctChoiceId is left empty (any local preview score is
 * meaningless and is never sent; the server scores with its own stored keys).
 */
export async function getReassessmentContent(assignmentId: string) {
  const data = await request<DeliveredContent>(async () => api.get(`${BASE}/${encodeURIComponent(assignmentId)}/content`, await headers()),
    "We couldn't open this reassessment.");
  const a = data.assessment;
  const assessment: DiagnosticAssessment = {
    id: a.id,
    title: a.title,
    gradeLevel: 5,
    language: a.language,
    assessmentType: "reassessment",
    sourceLabel: "Reassessment",
    sourceUrl: "",
    version: a.version,
    contentStatus: "active",
    passage: { language: a.language, title: a.passage.title, paragraphs: [...a.passage.paragraphs] },
    questions: a.questions.map((q) => ({ id: q.id, prompt: q.prompt, choices: q.choices.map((c) => ({ id: c.id, label: c.label })), correctChoiceId: "" })),
  };
  return { assignment: data.assignment, assessment };
}

/** Sends only the server-issued reading receipts, the chosen answers and the recording length. */
export async function submitReassessmentResult(assignmentId: string, result: DiagnosticResult): Promise<ReassessmentResult> {
  const answers = result.comprehensionAnswers;
  const receipts = result.transcriptReceipts;
  if (!answers || !receipts?.length) {
    throw new StudentReassessmentError("Your reading is not complete. Go back to the story and read it again.", "INCOMPLETE");
  }
  const duration = result.oralReadingMetrics?.recordingDurationSeconds;
  const data = await request<{ success: true; result: ReassessmentResult }>(async () => api.post(`${BASE}/${encodeURIComponent(assignmentId)}/result`, {
    language: result.language,
    assessmentId: result.assessmentId,
    assessmentVersion: result.assessmentVersion,
    answers: { ...answers },
    transcriptReceipts: [...receipts],
    ...(typeof duration === "number" && Number.isFinite(duration) ? { recordingDurationSeconds: duration } : {}),
  }, await headers()), "We couldn't save your result. Please try again.");
  const saved = data.result;
  if (!saved || saved.assessmentType !== "reassessment" || saved.assignmentId !== assignmentId || saved.language !== result.language) {
    throw new StudentReassessmentError("We couldn't save your result. Please try again.");
  }
  return saved;
}

export function formatManilaDay(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric" }).format(date);
}
