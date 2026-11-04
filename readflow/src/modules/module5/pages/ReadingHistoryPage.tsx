import { activityLanguageState, getActivityText, type ActivityLanguage } from "../../../pages/reading-activity/activityLanguage";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getOwnOralReadingAttempts, type OwnOralReadingSummary } from "../services/oralReadingService";
import { comprehensionTargetForReading } from "../services/comprehensionNavigation";
import type { LearnerM5Role } from "../types/oralReading";

/** embedded: shown inside the M5 result page's modal, which supplies the heading. */
export default function ReadingHistoryPage({ role, embedded = false, language }: { role: LearnerM5Role; embedded?: boolean; language?: ActivityLanguage }) {
  // Embedded shell follows its saved parent activity; mixed standalone history has no single activity language.
  const ui = getActivityText(role === "admin" ? "en" : language);
  const { t } = ui;
  const [attempts, setAttempts] = useState<OwnOralReadingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  // Reuse the in-flight request during StrictMode's effect replay. Retry gets
  // a new request; no records or rejected promises are shared across users.
  const request = useRef<{ revision: number; promise: Promise<OwnOralReadingSummary[]> }>();
  const root = role === "admin" ? "/admin" : role === "student" ? "/dashboard" : "/m3/general";
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
  return <section lang={ui.language} className={embedded ? "rounded-3xl bg-white p-6 text-[#173f3b]" : "m-4 rounded-3xl bg-white p-6 text-[#173f3b] md:m-8"}>
    {!embedded && <h1 className="text-3xl font-extrabold">{t("Reading History")}</h1>}
    {role !== "admin" && <p className="my-3">{t("Reopen your saved results, transcripts, feedback, and recordings without reading again.")}</p>}
    <p className="my-3 text-sm">{t("Pronunciation check results for English readings are not saved. Open a reading and check its pronunciation again when you need it.")}</p>
    {loading ? <p role="status" className="flex items-center gap-2 text-sm">
      <span aria-hidden="true" className="h-3 w-3 rounded-full border-2 border-[#173f3b]/20 border-t-[#173f3b] motion-safe:animate-spin" />
      <span>{t(embedded ? "Loading saved assessments…" : "Loading reading history...")}</span>
    </p> : error ? <div role="alert">
      <p>{ui.message(error, "Unable to load reading history.")}</p><button className="mt-3 rounded-xl bg-[#f7cf4a] px-4 py-2 font-bold" onClick={() => setRevision(v => v + 1)}>{t("Retry")}</button>
    </div> : attempts.length === 0 ? (role !== "admin" && <p role="status">{t("No saved reading attempts yet. Complete a read-aloud activity to see it here.")}</p>) :
      <ul className="space-y-4">{attempts.map(attempt => {
        const rowUi = getActivityText(role === "admin" ? "en" : attempt.language);
        const rowT = rowUi.t;
        const activityState = activityLanguageState(attempt.language);
        // Module readings reopen their own comprehension activity (or its results once
        // completed). Assigned materials are reopened from the reading result instead,
        // because this list does not know whether an activity is read-aloud only.
        const comprehension = attempt.materialId ? null : comprehensionTargetForReading(role, {
          id: attempt.id, moduleId: attempt.moduleId, materialId: null, passageId: attempt.passageId ?? null,
          roomId: attempt.roomId ?? null, assignmentId: attempt.assignmentId ?? null, activityAssignmentId: null,
        });
        return <li lang={rowUi.language} key={attempt.id} className="rounded-2xl border border-[#dce8e7] p-5">
        <h2 className="text-xl font-bold">{attempt.moduleTitle}</h2>
        <p>{attempt.passageTitle}</p>
        <p>
          <time dateTime={attempt.completedAt}>{new Date(attempt.completedAt).toLocaleString()}</time>
          {attempt.language && <> · {attempt.language === "fil" ? "Filipino" : "English"}</>}
        </p>
        {/* The saved field is transcript-based reading accuracy, not a pronunciation score. */}
        <p className="my-3">{rowT("Reading accuracy: ")}{attempt.pronunciationAccuracy.toFixed(1)}% · {rowT("Speed: ")}{Math.round(attempt.readingSpeedWpm)} {rowT("WPM")} · {rowT("Recognized-word differences: ")}{attempt.detectedErrorCount}</p>
        <div className="flex flex-wrap gap-3">
          <Link state={activityState} className="inline-block rounded-xl bg-[#f7cf4a] px-4 py-2 font-bold" to={`${root}/read-aloud/results/${attempt.id}?view=result`}>{rowT("View Result")}<span className="sr-only">{rowT(" for {passageTitle}", { passageTitle: attempt.passageTitle ?? "" })}</span></Link>
          <Link state={activityState} className="inline-block rounded-xl border-2 border-[#173f3b] px-4 py-2 font-bold" to={`${root}/read-aloud/results/${attempt.id}?view=transcript`}>{rowT("View Transcript")}<span className="sr-only">{rowT(" for {passageTitle}", { passageTitle: attempt.passageTitle ?? "" })}</span></Link>
          <Link state={activityState} className="inline-block rounded-xl border-2 border-[#173f3b] px-4 py-2 font-bold" to={`${root}/read-aloud/results/${attempt.id}?view=feedback`}>{rowT("Feedback & Recording")}<span className="sr-only">{rowT(" for {passageTitle}", { passageTitle: attempt.passageTitle ?? "" })}</span></Link>
          {comprehension && <Link state={activityState} className="inline-block rounded-xl border-2 border-[#173f3b] px-4 py-2 font-bold" to={comprehension}>{rowT("Questions & Results")}<span className="sr-only">{rowT(" for {passageTitle}", { passageTitle: attempt.passageTitle ?? "" })}</span></Link>}
        </div>
      </li>;
      })}</ul>}
  </section>;
}
