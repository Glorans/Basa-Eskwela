import { useEffect, useId, useState } from "react";
import { Languages, LoaderCircle } from "lucide-react";
import { getMaterialServiceError, updateMaterialLanguage } from "../services/materialService";
import type { MaterialLanguageCode } from "../types/content";

const LANGUAGE_NAMES: Record<MaterialLanguageCode, string> = { en: "English", fil: "Filipino" };

/**
 * Lets the uploader correct a saved material's language. The server only allows it
 * while the material is unassigned and has no student results, so classroom
 * assignments, results, scores and XP are never reinterpreted.
 */
export default function MaterialLanguageControl({ materialId, language, canEdit, hasQuestionSets, onChanged }: {
  materialId: string;
  language: MaterialLanguageCode;
  canEdit: boolean;
  /** Teachers keep question sets per material; Independent Learners do not. */
  hasQuestionSets: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const fieldId = useId();
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<MaterialLanguageCode>(language);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  // Shows the saved language at once; the refreshed material list then takes over.
  const [savedLanguage, setSavedLanguage] = useState<MaterialLanguageCode>();
  const current = savedLanguage ?? language;

  useEffect(() => { setSavedLanguage(undefined); }, [language, materialId]);

  async function save() {
    if (busy) return;
    if (choice === current) { setEditing(false); return; }
    setBusy(true); setError(""); setSuccess("");
    try {
      await updateMaterialLanguage(materialId, choice);
      setSavedLanguage(choice);
      setEditing(false);
      setSuccess(`Language changed to ${LANGUAGE_NAMES[choice]}.${hasQuestionSets
        ? " Existing question sets were not changed; review them, or generate a new set, before assigning this material."
        : ""}`);
      await onChanged();
    } catch (saveError) {
      setError(getMaterialServiceError(saveError, "The material language could not be changed. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="m3-material-language">
      <div className="m3-material-language__current">
        <span>Language</span>
        <strong>{LANGUAGE_NAMES[current]}</strong>
        {canEdit && !editing && (
          <button type="button" className="m3-button m3-button--secondary"
            onClick={() => { setChoice(current); setEditing(true); setError(""); setSuccess(""); }}>
            <Languages size={16} /> Correct Language
          </button>
        )}
      </div>
      {editing && (
        <div className="m3-material-language__form">
          <label className="m3-field" htmlFor={fieldId}>
            <span>Correct language</span>
            <select id={fieldId} value={choice} disabled={busy}
              onChange={(event) => setChoice(event.target.value as MaterialLanguageCode)}>
              <option value="en">English</option>
              <option value="fil">Filipino</option>
            </select>
          </label>
          <p>
            You can change the language only before this material is assigned in a Learning Room
            and before students have results for it.
          </p>
          <div className="m3-form-actions">
            <button type="button" className="m3-button m3-button--secondary" disabled={busy}
              onClick={() => { setEditing(false); setError(""); }}>
              Cancel
            </button>
            <button type="button" className="m3-button m3-button--primary" disabled={busy} aria-busy={busy}
              onClick={() => void save()}>
              {busy && <LoaderCircle className="m3-spinner" size={17} />}
              {busy ? "Saving..." : "Save Language"}
            </button>
          </div>
        </div>
      )}
      {error && <p className="m3-error-message" role="alert">{error}</p>}
      {success && <p className="m3-success-message" role="status">{success}</p>}
    </div>
  );
}
