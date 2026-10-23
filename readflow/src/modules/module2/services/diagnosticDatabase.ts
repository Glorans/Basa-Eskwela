import axios from "axios";
import api from "../../../services/api";
import { getSessionAuthHeaders } from "../../../services/authHeaders";
import { supabase } from "../../../lib/supabaseClient";
import {
  createDiagnosticRepository,
  type DiagnosticSubmission,
  type DiagnosticSubmissionResponse,
} from "./diagnosticRepository";
export { DiagnosticDatabaseError } from "./diagnosticRepository";

// The backend is the only writer of diagnostic results (DT1).
async function submitDiagnosticResult(submission: DiagnosticSubmission): Promise<DiagnosticSubmissionResponse> {
  let headers: Awaited<ReturnType<typeof getSessionAuthHeaders>>;
  try {
    headers = await getSessionAuthHeaders("Your session has expired. Please sign in again.");
  } catch {
    return { status: 401, code: "AUTH_REQUIRED" };
  }
  try {
    const response = await api.post<{ result?: DiagnosticSubmissionResponse["result"] }>(
      "/api/diagnostic/results", submission, { headers },
    );
    return { status: response.status, result: response.data.result };
  } catch (error) {
    if (axios.isAxiosError<{ code?: unknown }>(error) && error.response) {
      const code = error.response.data?.code;
      return { status: error.response.status, ...(typeof code === "string" ? { code } : {}) };
    }
    return { status: 0 };
  }
}

export const {
  saveInitialDiagnosticResult,
  getInitialDiagnosticResult,
  getCompletedDiagnosticLanguages,
  hasCompletedInitialDiagnostic,
} = createDiagnosticRepository(supabase, {
  submit: submitDiagnosticResult,
  onSaveError: import.meta.env.DEV
    ? (failure) => console.error("[DiagnosticSave] Backend save failed", failure)
    : undefined,
});
