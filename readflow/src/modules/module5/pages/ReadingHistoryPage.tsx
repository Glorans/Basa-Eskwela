import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getOwnOralReadingAttempts, type OwnOralReadingSummary } from "../services/oralReadingService";
import type { LearnerM5Role } from "../types/oralReading";

export default function ReadingHistoryPage({ role }: { role: LearnerM5Role }) {
  const [attempts, setAttempts] = useState<OwnOralReadingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const root = role === "admin" ? "/admin" : role === "student" ? "/dashboard" : "/m3/general";
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void getOwnOralReadingAttempts().then(rows => {
      if (active) setAttempts(rows);
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : "Unable to load reading history.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  return <section className="m-4 rounded-3xl bg-white p-6 text-[#173f3b] md:m-8">
    <h1 className="text-3xl font-extrabold">Reading History</h1>
    {role !== "admin" && <p className="my-3">Reopen your saved results, transcripts, and pronunciation feedback.</p>}
    {loading ? <p role="status">Loading reading history...</p> : error ? <div role="alert">
      <p>{error}</p><button className="mt-3 rounded-xl bg-[#f7cf4a] px-4 py-2 font-bold" onClick={() => setRevision(v => v + 1)}>Retry</button>
    </div> : attempts.length === 0 ? (role !== "admin" && <p role="status">No saved reading attempts yet. Complete a read-aloud activity to see it here.</p>) :
      <ul className="space-y-4">{attempts.map(attempt => <li key={attempt.id} className="rounded-2xl border border-[#dce8e7] p-5">
        <h2 className="text-xl font-bold">{attempt.moduleTitle}</h2>
        <p>{attempt.passageTitle}</p>
        <time dateTime={attempt.completedAt}>{new Date(attempt.completedAt).toLocaleString()}</time>
        <p className="my-3">Accuracy: {attempt.pronunciationAccuracy.toFixed(1)}% · Speed: {Math.round(attempt.readingSpeedWpm)} WPM · Detected errors: {attempt.detectedErrorCount}</p>
        <Link className="inline-block rounded-xl bg-[#f7cf4a] px-4 py-2 font-bold" to={`${root}/read-aloud/results/${attempt.id}`}>View Results<span className="sr-only"> for {attempt.passageTitle}</span></Link>
      </li>)}</ul>}
  </section>;
}
