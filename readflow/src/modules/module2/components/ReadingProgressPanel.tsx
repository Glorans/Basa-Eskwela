import type { LanguageProgress, ProgressPoint, ReadingProgress } from "../services/readingProgress";
import { formatCompletedDate, formatScore } from "../utils/diagnosticHistory";
import "./DiagnosticHistoryTables.css";

const LANGUAGE_LABELS = { en: "English", fil: "Filipino" } as const;

function PointRow({ point, label }: { point: ProgressPoint; label: string }) {
  return (
    <tr>
      <td data-label="Assessment">
        {label}
        {point.title && <span className="diagnostic-history-note"> · {point.title}</span>}
      </td>
      <td data-label="Date Completed">{formatCompletedDate(point.completedAt)}</td>
      <td data-label="Word Recognition">{formatScore(point.wordRecognitionScore)}</td>
      <td data-label="Comprehension">{formatScore(point.comprehensionScore)}</td>
      <td data-label="Reading Level">
        <span className="diagnostic-history-level" data-level={point.readingLevel}>{point.readingLevel}</span>
      </td>
    </tr>
  );
}

function LanguageCard({ progress, idPrefix, owner }: { progress: LanguageProgress; idPrefix: string; owner: "self" | "student" }) {
  const label = LANGUAGE_LABELS[progress.language];
  const headingId = `${idPrefix}-progress-${progress.language}`;
  return (
    <section className="diagnostic-history-language reading-progress-language" aria-labelledby={headingId}>
      <h3 id={headingId}>{label}</h3>
      {!progress.current ? (
        <p className="diagnostic-history-empty">
          {owner === "self" ? `You have no official ${label} result yet.` : `No official ${label} result yet.`}
        </p>
      ) : (
        <>
          <p className="reading-progress-current">
            Current reading level:{" "}
            <span className="diagnostic-history-level" data-level={progress.current.readingLevel}>{progress.current.readingLevel}</span>
            <span className="diagnostic-history-note">
              {" "}({progress.current.rule === "initial" ? "from the initial diagnostic" : `from the latest official ${progress.current.source === "initial" ? "diagnostic" : "reassessment"}`})
            </span>
          </p>
          <p className="reading-progress-change" data-status={progress.change.status}>{progress.change.message}</p>
          {progress.placementNote && <p className="diagnostic-history-note">{progress.placementNote}</p>}
          <div className="m7-scroll diagnostic-history-scroll" role="region" aria-label={`${label} official results`} tabIndex={0}>
            <table className="diagnostic-history-table">
              <thead>
                <tr>
                  <th scope="col">Assessment</th>
                  <th scope="col">Date Completed</th>
                  <th scope="col">Word Recognition</th>
                  <th scope="col">Comprehension</th>
                  <th scope="col">Reading Level</th>
                </tr>
              </thead>
              <tbody>
                {progress.initial && <PointRow point={progress.initial} label="Initial diagnostic" />}
                {progress.reassessments.map((point) => <PointRow key={point.id} point={point} label="Reassessment" />)}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * M2 F5: one learner's official reading progress, English and Filipino separately (oldest first). Only official,
 * server-verified results reach this component; a change is described between two results, never as a trend.
 */
export default function ReadingProgressPanel({ progress, idPrefix, owner = "self" }: {
  progress: ReadingProgress;
  idPrefix: string;
  owner?: "self" | "student";
}) {
  return (
    <div className="diagnostic-history reading-progress">
      <LanguageCard progress={progress.en} idPrefix={idPrefix} owner={owner} />
      <LanguageCard progress={progress.fil} idPrefix={idPrefix} owner={owner} />
    </div>
  );
}
