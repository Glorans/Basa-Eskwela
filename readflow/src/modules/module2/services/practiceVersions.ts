import axios from "axios";
import api from "../../../services/api";
import { getSessionAuthHeaders } from "../../../services/authHeaders";
import type { DiagnosticAssessment, DiagnosticLanguage } from "../types/diagnostic";

/** M2 F7: the identity prefix the server uses for practising an authored Initial Diagnostic version. */
export const PRACTICE_VERSION_PREFIX = "m2-practice-version:";

export interface PracticeVersion {
  packageId: string;
  versionId: string;
  activeForLearners: boolean;
  assessment: DiagnosticAssessment;
}

export class PracticeVersionError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "PracticeVersionError";
  }
}

interface ServerContent {
  packageId: string;
  versionId: string;
  activeForLearners: boolean;
  assessment: {
    id: string; version: string; language: DiagnosticLanguage; title: string;
    passage: { language: DiagnosticLanguage; title: string; paragraphs: string[] };
    questions: { id: string; prompt: string; choices: { id: string; label: string }[] }[];
  };
}

/**
 * Loads the selected version's passage and questions for practice. The server decides who may practise which version
 * and never sends answer keys: it scores with the stored keys of this exact version.
 */
export async function getPracticeVersion(versionId: string): Promise<PracticeVersion> {
  const headers = await getSessionAuthHeaders("Your session has expired. Please sign in again.");
  try {
    const response = await api.get<{ success: true; data: ServerContent }>(
      `/api/diagnostic/practice/versions/${encodeURIComponent(versionId)}`, { headers });
    const data = response.data.data;
    const a = data?.assessment;
    if (!a || a.id !== `${PRACTICE_VERSION_PREFIX}${versionId}` || !a.passage?.paragraphs?.length || !a.questions?.length) {
      throw new PracticeVersionError("This version could not be loaded for practice.");
    }
    return {
      packageId: data.packageId,
      versionId: data.versionId,
      activeForLearners: data.activeForLearners,
      assessment: {
        id: a.id,
        title: a.title,
        gradeLevel: 5,
        language: a.language,
        assessmentType: "initial",
        sourceLabel: "Initial diagnostic practice",
        sourceUrl: "",
        version: a.version,
        contentStatus: "active",
        passage: { language: a.language, title: a.passage.title, paragraphs: [...a.passage.paragraphs] },
        questions: a.questions.map((q) => ({ id: q.id, prompt: q.prompt, choices: q.choices.map((c) => ({ id: c.id, label: c.label })), correctChoiceId: "" })),
      },
    };
  } catch (error) {
    if (error instanceof PracticeVersionError) throw error;
    if (axios.isAxiosError<{ code?: string; message?: string }>(error) && error.response) {
      throw new PracticeVersionError(error.response.data?.message || "This version could not be loaded for practice.", error.response.data?.code);
    }
    throw new PracticeVersionError("We couldn't reach the server. Check your connection and try again.");
  }
}
