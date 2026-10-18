import { supabase } from "../../../lib/supabaseClient";
import { createDiagnosticRepository } from "./diagnosticRepository";
export { DiagnosticDatabaseError } from "./diagnosticRepository";

export const {
  saveInitialDiagnosticResult,
  getInitialDiagnosticResult,
  getCompletedDiagnosticLanguages,
  hasCompletedInitialDiagnostic,
} = createDiagnosticRepository(supabase, {
  onSaveError: import.meta.env.DEV
    ? (failure) => console.error("[DiagnosticSave] Supabase save failed", failure)
    : undefined,
});
