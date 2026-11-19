import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  formatManilaDay, getMyReassessments, startIndependentReassessment, type MyReassessments, type StudentReassessment,
} from "../services/studentReassessments";
import { REASSESSMENT_FLOW_PATH, assessmentHistoryPath, type ReassessmentAudience } from "../utils/reassessmentPaths";
import "../../module7/m7.css";
import "./AssessmentPackages.css";

const LANGUAGE = { en: "English", fil: "Filipino" } as const;
const percent = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%` : "—";

/**
 * M2 F8: the signed-in learner's own reassessments (the server returns only theirs). Students see what their teacher
 * assigned; Independent Learners also see the centrally approved reassessments they can start themselves.
 */
export default function StudentReassessmentsPage({ audience = "student" }: { audience?: ReassessmentAudience }) {
  const navigate = useNavigate();
  const [data, setData] = useState<MyReassessments | null>(null);
  const items: StudentReassessment[] | null = data?.reassessments ?? null;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState("");
  const [startError, setStartError] = useState("");
  const independent = audience === "independent";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await getMyReassessments());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't load your reassessments.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const active = (items ?? []).filter((r) => r.status === "active");
  const done = (items ?? []).filter((r) => r.status === "completed");
  const flowPath = (id: string, language: string, step: string) => `${REASSESSMENT_FLOW_PATH}/${encodeURIComponent(id)}/${language}/${step}`;
  const start = async (packageVersionId: string) => {
    if (starting) return;
    setStarting(packageVersionId);
    setStartError("");
    try {
      const { assignment } = await startIndependentReassessment(packageVersionId);
      navigate(flowPath(assignment.id, assignment.language, "reading"));
    } catch (startFailure) {
      const message = (startFailure as { message?: unknown } | null)?.message;
      setStartError(typeof message === "string" && message ? message : "We couldn't start this reassessment.");
      setStarting("");
      void load();
    }
  };

  return (
    <main className="m7-page m2-packages-page">
      <h1>My Reassessments</h1>
      <p className="m2-packages-intro">
        {independent
          ? "When a new reading check opens, you can read a new story to see how your reading has grown. Read the story out loud, then answer the questions. Take your time."
          : "Your teacher may ask you to read a new story to see how your reading has grown. Read the story out loud, then answer the questions. Take your time."}
      </p>
      {loading && <p role="status">Loading your reassessments...</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>Try Again</button>
        </div>
      )}
      {!loading && !error && items && (
        <>
          {independent && data?.available && (
            <section aria-labelledby="my-reassessments-available">
              <h2 id="my-reassessments-available">Start a Reassessment</h2>
              {data.languages && (
                <ul className="m2-student-languages">
                  {(["en", "fil"] as const).filter((code) => data.languages![code]?.reason).map((code) => (
                    <li key={code} className="m2-packages-meta">{LANGUAGE[code]}: {data.languages![code].reason}</li>
                  ))}
                </ul>
              )}
              {data.available.length === 0 ? <p className="m2-packages-empty">No reassessments are ready yet.</p> : (
                <ul className="m2-student-reassessments">
                  {data.available.map((a) => (
                    <li key={a.packageVersionId} className="m2-packages-panel">
                      <h3>{a.title}</h3>
                      <p className="m2-packages-meta">{LANGUAGE[a.language]}</p>
                      {a.canStart ? (
                        <button type="button" className="m2-student-start" disabled={Boolean(starting)} onClick={() => void start(a.packageVersionId)}>
                          {starting === a.packageVersionId ? "Starting..." : "Start"}
                        </button>
                      ) : (
                        <p className="m2-packages-meta" role="note">{a.reason}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {startError && <p role="alert" className="m2-packages-error">{startError}</p>}
            </section>
          )}

          <section aria-labelledby="my-reassessments-todo">
            <h2 id="my-reassessments-todo">{independent ? "In Progress" : "To Do"}</h2>
            {active.length === 0 ? <p className="m2-packages-empty">You have no reassessments to do right now.</p> : (
              <ul className="m2-student-reassessments">
                {active.map((r) => (
                  <li key={r.id} className="m2-packages-panel">
                    <h3>{r.title}</h3>
                    <p className="m2-packages-meta">
                      {independent
                        ? `${LANGUAGE[r.language]} · Started ${formatManilaDay(r.assignedAt)}`
                        : `${LANGUAGE[r.language]} · ${r.roomName ?? "Learning Room"} · Given ${formatManilaDay(r.assignedAt)}${r.dueAt ? ` · Due ${formatManilaDay(r.dueAt)}` : ""}`}
                    </p>
                    {r.available ? (
                      <Link className="m2-student-start" to={flowPath(r.id, r.language, "reading")}>
                        Start or Continue
                      </Link>
                    ) : (
                      <p className="m2-packages-meta" role="note">{r.unavailableReason}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="my-reassessments-done">
            <h2 id="my-reassessments-done">Finished</h2>
            {done.length === 0 ? <p className="m2-packages-empty">You have not finished a reassessment yet.</p> : (
              <div className="m2-packages-table-wrap">
                <table className="m2-packages-table">
                  <thead>
                    <tr>
                      <th scope="col">Reassessment</th>
                      <th scope="col">Language</th>
                      <th scope="col">Finished</th>
                      <th scope="col">Reading accuracy</th>
                      <th scope="col">Understanding</th>
                      <th scope="col">Reading level</th>
                    </tr>
                  </thead>
                  <tbody>
                    {done.map((r) => (
                      <tr key={r.id}>
                        <td><Link to={flowPath(r.id, r.language, "result")}>{r.title}</Link></td>
                        <td>{LANGUAGE[r.language]}</td>
                        <td>{formatManilaDay(r.completedAt)}</td>
                        <td>{percent(r.result?.wordRecognitionScore)}</td>
                        <td>{percent(r.result?.comprehensionScore)}</td>
                        <td>{r.result?.readingLevel ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <p><Link to={assessmentHistoryPath(audience)}>See all my assessment results</Link></p>
        </>
      )}
    </main>
  );
}
