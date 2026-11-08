import axios from "axios";
import { supabase } from "../../../lib/supabaseClient";
import api from "../../../services/api";

export type QuestionType = "literal" | "inferential" | "critical";

export interface AnswerHistory {
  requestId: string;
  optionIndex: number;
  correct: boolean;
  hintUsed: boolean;
  answeredAt: string;
}

export interface ComprehensionQuestion {
  id: string;
  type: QuestionType;
  questionText: string;
  options: string[];
  firstOptionIndex: number | null;
  firstAnswerCorrect: boolean | null;
  answerHistory: AnswerHistory[];
  /** True only for activities saved before the single-attempt rule. */
  hintUsed: boolean;
  /** A hint the learner asked for before the single-attempt rule; null otherwise. */
  hint: string | null;
  /** True once the question has its final (first) answer. */
  resolved: boolean;
  /** F2 scaffolding prompt: a guiding hint shown after an incorrect final answer. */
  scaffoldingPrompt?: string | null;
  correctOptionIndex: number | null;
  answerExplanation: string | null;
  supportingEvidence: string | null;
}

export interface TypeSummary {
  total: number;
  answered: number;
  firstCorrect: number;
  resolved: number;
  hintsUsed: number;
  firstAttemptPercentage: number;
}

export interface ComprehensionAttempt {
  id: string;
  moduleId?: string | null;
  passageId?: string | null;
  materialId?: string | null;
  activityAssignmentId?: string | null;
  oralReadingAttemptId?: string | null;
  /** The learning activity's one assessment; differs from id only for an extra attempt saved before that rule. */
  activityAttemptId?: string | null;
  roomId?: string | null;
  /** Set by the server for an unfinished assessment of an archived classroom: read-only, no new answers. */
  roomArchived?: boolean;
  passageTitle: string;
  passageText: string;
  language: "en" | "fil";
  status: "in_progress" | "completed";
  createdAt: string;
  completedAt: string | null;
  questions: ComprehensionQuestion[];
  summary: {
    totalQuestions: number;
    answered: number;
    firstCorrect: number;
    firstAttemptPercentage: number;
    resolved: number;
    hintsUsed: number;
    allResolved: boolean;
    byType: Record<QuestionType, TypeSummary>;
  };
}

export interface StartComprehensionInput {
  moduleId?: string | null;
  passageId?: string | null;
  materialId?: string | null;
  activityAssignmentId?: string | null;
  oralReadingAttemptId?: string | null;
  submissionId: string;
  roomId?: string;
  assignmentId?: string;
}

export type ComprehensionAction =
  | {
      action: "answer";
      questionId: string;
      optionIndex: number;
      requestId: string;
    }
  | {
      action: "complete";
    };

interface AttemptResponse {
  success: boolean;
  attempt: ComprehensionAttempt;
}

export interface ActionResponse extends AttemptResponse {
  outcome: {
    correct?: boolean;
    resolved?: boolean;
    /** Single attempt: every saved answer is final. */
    final?: boolean;
    completed?: boolean;
  };
}

async function authHeaders() {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (error || !token) {
    throw new Error(
      "Your session has expired. Please sign in again.",
    );
  }

  return { Authorization: `Bearer ${token}` };
}

function serviceError(error: unknown, fallback: string): Error {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message;

    if (typeof message === "string" && message.trim()) {
      return new Error(message);
    }

    if (error.response) {
      return new Error(
        `${fallback} Server returned HTTP ${error.response.status}.`,
      );
    }

    return new Error(
      `${fallback} ${error.message}. Check that the backend is running and the API URL is correct.`,
    );
  }

  return error instanceof Error ? error : new Error(fallback);
}

export async function startComprehension(
  input: StartComprehensionInput,
): Promise<ComprehensionAttempt> {
  try {
    const { data } = await api.post<AttemptResponse>(
      "/api/comprehension/attempts",
      input,
      { headers: await authHeaders() },
    );

    return data.attempt;
  } catch (error) {
    throw serviceError(error, "Unable to start this activity.");
  }
}

export async function getComprehension(
  attemptId: string,
): Promise<ComprehensionAttempt> {
  try {
    const { data } = await api.get<AttemptResponse>(
      `/api/comprehension/attempts/${encodeURIComponent(attemptId)}`,
      { headers: await authHeaders() },
    );

    return data.attempt;
  } catch (error) {
    throw serviceError(error, "Unable to reopen this activity.");
  }
}

/** The learner's own M6 activity for one saved reading, or null. Read-only: never starts one. */
export interface LinkedComprehension {
  id: string;
  status: "in_progress" | "completed";
}

export async function getComprehensionForReading(
  oralReadingAttemptId: string,
): Promise<LinkedComprehension | null> {
  try {
    const { data } = await api.get<{ success: boolean; attempt: LinkedComprehension | null }>(
      `/api/comprehension/readings/${encodeURIComponent(oralReadingAttemptId)}`,
      { headers: await authHeaders() },
    );

    return data.attempt ?? null;
  } catch (error) {
    throw serviceError(error, "Unable to check your comprehension activity.");
  }
}

export async function sendComprehensionAction(
  attemptId: string,
  action: ComprehensionAction,
): Promise<ActionResponse> {
  try {
    const { data } = await api.post<ActionResponse>(
      `/api/comprehension/attempts/${encodeURIComponent(attemptId)}/actions`,
      action,
      { headers: await authHeaders() },
    );

    return data;
  } catch (error) {
    throw serviceError(error, "Unable to save your activity.");
  }
}