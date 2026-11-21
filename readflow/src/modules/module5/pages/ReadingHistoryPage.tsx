import { getActivityText, type ActivityLanguage } from "../../../pages/reading-activity/activityLanguage";
import { useEffect, useRef, useState } from "react";
import SavedAssessmentModal from "../components/SavedAssessmentModal";
import { getOwnOralReadingAttempts, type OwnOralReadingSummary } from "../services/oralReadingService";
import { numberHistoryReadings } from "../services/savedAttemptOrder";
import type { LearnerM5Role } from "../types/oralReading";

/**
 * F7 Review Saved Oral Reading Assessment. Each saved reading is one card,
 * newest first, labelled with its real reading number for that story
 * ("Reading 1, 2, 3…" in completion order). Selecting a card opens that
 * reading's complete saved assessment in one modal over this page; the URL
 * does not change and no other result page or panel is opened.
 * embedded: shown inside another container that supplies the heading.
 */
export default function ReadingHistoryPage({ role, embedded = false, language }: { role: LearnerM5Role; embedded?: boolean; language?: ActivityLanguage }) {
  // Embedded shell follows its saved parent activity; mixed standalone history has no single activity language.
  const ui = getActivityText((role === "admin" || role === "system_admin") ? "en" : language);
  const { t } = ui;
  const [attempts, setAttempts] = useState<OwnOralReadingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  // The one open assessment (only one modal at a time), and the card to refocus when it closes.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const lastSelected = useRef<string | null>(null);
  const cards = useRef(new Map<string, HTMLButtonElement>());
  // Reuse the in-flight request during StrictMode's effect replay. Retry gets
  // a new request; no records or rejected promises are shared across users.
  const request = useRef<{ revision: number; promise: Promise<OwnOralReadingSummary[]> }>();
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    if (!request.current || request.current.revision !== revision) {
      request.current = { revision, promise: getOwnOralReadingAttempts() };
    }
    void request.current.promise.then(rows => {
      if (active) setAttempts(rows);
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : "Unable to load reading history.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  // Closing the assessment returns keyboard focus to the card that opened it.
  useEffect(() => {
    if (selectedId === null && lastSelected.current) cards.current.get(lastSelected.current)?.focus();
  }, [selectedId]);

  const numbers = numberHistoryReadings(attempts);
  // Newest first; each card keeps its real reading number.
  const ordered = [...attempts].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt) || (a.id < b.id ? 1 : -1));
  const selected = selectedId ? attempts.find(attempt => attempt.id === selectedId) : undefined;
  const open = (id: string) => { lastSelected.current = id; setSelectedId(id); };

  return <section lang={ui.language} className={embedded ? "rounded-3xl bg-white p-6 text-[#173f3b]" : "m-4 rounded-3xl bg-white p-6 text-[#173f3b] md:m-8"}>
    {!embedded && <h1 className="text-3xl font-extrabold">{t("Reading History")}</h1>}
    {!(role === "admin" || role === "system_admin") && <p className="my-3">{t("Select a reading to review its saved assessment, including your recording.")}</p>}
    <p className="my-3 text-sm">{t("Pronunciation checks for English readings are saved. Reopen a reading to review its pronunciation feedback, scores and words to practice.")}</p>
    {loading ? <p role="status" className="flex items-center gap-2 text-sm">
      <span aria-hidden="true" className="h-3 w-3 rounded-full border-2 border-[#173f3b]/20 border-t-[#173f3b] motion-safe:animate-spin" />
      <span>{t(embedded ? "Loading saved assessments…" : "Loading reading history...")}</span>
    </p> : error ? <div role="alert">
      <p>{ui.message(error, "Unable to load reading history.")}</p><button className="mt-3 rounded-xl bg-[#f7cf4a] px-4 py-2 font-bold" onClick={() => setRevision(v => v + 1)}>{t("Retry")}</button>
    </div> : attempts.length === 0 ? (!(role === "admin" || role === "system_admin") && <p role="status">{t("No saved reading attempts yet. Complete a read-aloud activity to see it here.")}</p>) :
      <ul className="space-y-4">{ordered.map(attempt => {
        const rowUi = getActivityText((role === "admin" || role === "system_admin") ? "en" : attempt.language);
        const rowT = rowUi.t;
        const number = numbers.get(attempt.id);
        const title = attempt.passageTitle || attempt.moduleTitle;
        return <li lang={rowUi.language} key={attempt.id}>
          {/* The whole card is one button: Enter or Space opens the saved assessment. */}
          <button
            type="button"
            ref={(element) => { if (element) cards.current.set(attempt.id, element); else cards.current.delete(attempt.id); }}
            className="block w-full cursor-pointer rounded-2xl border-2 border-[#dce8e7] bg-white p-5 text-left transition hover:border-[#173f3b] focus-visible:border-[#173f3b] focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#f7cf4a]"
            aria-haspopup="dialog"
            onClick={() => open(attempt.id)}
          >
            <span className="block text-xl font-bold">{title}{number !== undefined && <> — {rowT("Reading {number}", { number })}</>}</span>
            {attempt.passageTitle && attempt.moduleTitle && attempt.passageTitle !== attempt.moduleTitle && <span className="block">{attempt.moduleTitle}</span>}
            <span className="block">
              <time dateTime={attempt.completedAt}>{new Date(attempt.completedAt).toLocaleString()}</time>
              {attempt.language && <> · {attempt.language === "fil" ? "Filipino" : "English"}</>}
              {role === "student" && !attempt.materialId && !attempt.roomId && <> · {rowT("Personal practice")}</>}
            </span>
            {/* The saved field is transcript-based reading accuracy, not a pronunciation score. */}
            <span className="my-3 block">{rowT("Reading accuracy: ")}{attempt.pronunciationAccuracy.toFixed(1)}% · {rowT("Speed: ")}{Math.round(attempt.readingSpeedWpm)} {rowT("WPM")}</span>
            {/* The saved English pronunciation check, separate from transcript-based reading accuracy. */}
            {attempt.language !== "fil" && attempt.pronunciationCheck && <span className="my-3 block">
              {rowT("Saved pronunciation check: ")}{attempt.pronunciationCheck.accuracy !== null ? `${attempt.pronunciationCheck.accuracy}/100` : rowT("Not assessed")}
              {!attempt.pronunciationCheck.complete && <> · {rowT("Some speech was not checked.")}</>}
            </span>}
            <span className="block font-bold underline">{rowT("Review saved assessment")}</span>
          </button>
        </li>;
      })}</ul>}
    {selected && <SavedAssessmentModal
      key={selected.id}
      role={role}
      summary={selected}
      readingNumber={numbers.get(selected.id)}
      onClose={() => setSelectedId(null)}
    />}
  </section>;
}
