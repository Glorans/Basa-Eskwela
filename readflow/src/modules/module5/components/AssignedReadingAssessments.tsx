import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getOwnOralReadingAttempts, type OwnOralReadingSummary } from "../services/oralReadingService";

/** Saved assessment links; this component never writes classroom progress. */
export default function AssignedReadingAssessments({ materialId, roomId, assignmentId, readable }: {
  materialId: string; roomId: string; assignmentId: string; readable: boolean;
}) {
  const [results, setResults] = useState<OwnOralReadingSummary[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setResults([]);
    setError("");
    void getOwnOralReadingAttempts(undefined, { materialId, activityAssignmentId: assignmentId })
      .then(saved => { if (active) setResults(saved); })
      .catch(() => { if (active) setError("We couldn't load your oral-reading results. Open Read Aloud to try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [materialId, assignmentId]);
  const target = `/dashboard/reading-materials/${materialId}/read-aloud?${new URLSearchParams({ roomId, activityAssignmentId: assignmentId })}`;
  return (
    <section className="mt-6 rounded-2xl bg-white p-6 text-[#173f3b]" aria-label="Reading assessments">
      <h2 className="text-xl font-extrabold">Read aloud and explore the story</h2>
      <p className="mt-2">Read aloud, see your feedback, then answer questions about this story when reviewed questions are available.</p>
      <p className="mt-2 text-sm">Your assessment is complete after oral reading is saved and you finish comprehension.</p>
      {readable ? <Link className="mt-4 inline-flex rounded-xl bg-[#f7cf4a] px-5 py-3 font-extrabold transition hover:bg-[#f2c83a]" to={target}>Read Aloud</Link>
        : <p className="mt-3">Oral reading needs readable English or Filipino text.</p>}
      {loading && <p className="mt-3" role="status">Loading your saved oral readings...</p>}
      {error && <p className="mt-3" role="alert">{error}</p>}
      {results.length > 0 && <div className="mt-4">
        <h3 className="font-bold">Your saved oral readings</h3>
        <p>Open a result to continue or reopen its comprehension activity.</p>
        <ul>{results.map((result, index) => <li className="mt-2" key={result.id}>
          <Link className="font-bold underline" to={`/dashboard/read-aloud/results/${result.id}`}>Oral reading result {results.length - index} — {Math.round(result.pronunciationAccuracy)}%</Link>
        </li>)}</ul>
      </div>}
    </section>
  );
}
