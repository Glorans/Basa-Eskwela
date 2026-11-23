import M3Dialog from "./M3Dialog";
import { groupPublishIssues } from "../utils/publishIssues";

/**
 * Centered, screen-reader announced dialog for publishing / validation problems (every authoring role). Lists the
 * module-level problems and each affected passage with what is missing. "Review Passage N" closes the dialog and
 * moves to that passage in the editor when the caller supports it.
 */
export default function PublishIssuesDialog({ issues, heading = "This module cannot be published yet", serverMessage, onClose, onReviewPassage }: {
  issues: string[];
  heading?: string;
  /** A refusal message from the server that is not tied to a passage. */
  serverMessage?: string;
  onClose: () => void;
  onReviewPassage?: (passageNumber: number) => void;
}) {
  const grouped = groupPublishIssues(issues);
  return (
    <M3Dialog title={heading} size="small" role="alertdialog" onRequestClose={onClose}
      subtitle="Nothing was published. Complete these requirements, then publish again."
      footer={<button type="button" className="m3-button m3-button--primary" onClick={onClose}>Close and Review</button>}>
      <div className="m3-publish-problems">
        {serverMessage && <section><h3>Why publishing failed</h3><p>{serverMessage}</p></section>}
        {grouped.module.length > 0 && (
          <section><h3>Module</h3><ul>{grouped.module.map((issue) => <li key={issue}>{issue}.</li>)}</ul></section>
        )}
        {grouped.passages.map(({ passage, messages }) => (
          <section key={passage}>
            <h3>Passage {passage}</h3>
            <ul>{messages.map((message) => <li key={message}>{message}</li>)}</ul>
            {onReviewPassage && <button type="button" className="m3-button m3-button--secondary m3-publish-problems__review"
              onClick={() => onReviewPassage(Number(passage))}>Review Passage {passage}</button>}
          </section>
        ))}
      </div>
    </M3Dialog>
  );
}
