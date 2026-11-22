import type { DiagnosticHistoryEntry } from "../services/diagnosticHistory";
import {
  assessmentTypeLabel,
  formatCompletedDate,
  formatScore,
  groupHistoryByLanguage,
  versionLabel,
} from "../utils/diagnosticHistory";
import "./DiagnosticHistoryTables.css";

/**
 * M2 F3: one table per language (English, then Filipino), newest first. Shows only saved results; nothing is
 * inferred. `owner` words the empty state ("You have" vs "This Student has"). With `language`, only that language is
 * shown and the caller supplies the heading (the learner page's language selector).
 */
export default function DiagnosticHistoryTables({ results, owner = "self", idPrefix, language }: {
  results: DiagnosticHistoryEntry[];
  owner?: "self" | "student";
  idPrefix: string;
  language?: "en" | "fil";
}) {
  const groups = groupHistoryByLanguage(results).filter(({ code }) => !language || code === language);
  return (
    <div className="diagnostic-history">
      {groups.map(({ code, label, entries }) => (
        <section key={code} className="diagnostic-history-language" aria-labelledby={language ? undefined : `${idPrefix}-${code}`}>
          {!language && <h3 id={`${idPrefix}-${code}`}>{label}</h3>}
          {entries.length === 0 ? (
            <p className="diagnostic-history-empty">
              {owner === "self" ? `You have not completed the ${label} diagnostic yet.` : `No ${label} diagnostic completed yet.`}
            </p>
          ) : (
            <div className="m7-scroll diagnostic-history-scroll" role="region" aria-label={`${label} assessment history`} tabIndex={0}>
              <table className="diagnostic-history-table">
                <thead>
                  <tr>
                    <th scope="col">Assessment</th>
                    <th scope="col">Date Completed</th>
                    <th scope="col">Word Recognition</th>
                    <th scope="col">Comprehension</th>
                    <th scope="col">Reading Level</th>
                    <th scope="col">Version</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td data-label="Assessment">
                        {assessmentTypeLabel(entry.assessmentType)}
                        {entry.assessmentTitle && <span className="diagnostic-history-note"> · {entry.assessmentTitle}</span>}
                      </td>
                      <td data-label="Date Completed">{formatCompletedDate(entry.completedAt)}</td>
                      <td data-label="Word Recognition">{formatScore(entry.wordRecognitionScore)}</td>
                      <td data-label="Comprehension">{formatScore(entry.comprehensionScore)}</td>
                      <td data-label="Reading Level">
                        <span className="diagnostic-history-level" data-level={entry.readingLevel}>{entry.readingLevel}</span>
                      </td>
                      <td data-label="Version">{versionLabel(entry.assessmentVersion)}</td>
                      <td data-label="Status">
                        <span className="diagnostic-history-status" data-verified={entry.verified ? "true" : "false"}>
                          {entry.verified ? "Verified" : "Not verified"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
