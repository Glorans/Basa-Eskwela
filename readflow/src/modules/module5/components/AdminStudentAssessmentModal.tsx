import { BookOpen, Mic, MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";
import "../../../pages/reading-activity/ReadingResultPage.css";
import { getAdminStudentAttempt, type AdminStudentAttempt, type OwnOralReadingSummary } from "../services/oralReadingService";
import { getAdminPronunciationCheck } from "../services/oralReadingTranscription";
import { isPartialCheck, pronunciationOverview, type SavedPronunciationCheck } from "../services/pronunciationSummary";
import { placePracticeWords, type TextPiece } from "../services/resultWords";
import type { OralReadingAttempt } from "../types/oralReading";
import M5Modal from "./M5Modal";
import RecordingPlayback from "./RecordingPlayback";
import SavedTranscript from "./SavedTranscript";

interface AdminStudentAssessmentModalProps {
  studentName: string;
  /** The reading card that was selected. */
  summary: OwnOralReadingSummary;
  readingNumber?: number;
  onClose: () => void;
}

const LANGUAGE_NAMES = { en: "English", fil: "Filipino" } as const;

function MarkedExcerpt({ pieces }: { pieces: TextPiece[] }) {
  return (
    <>
      {pieces.map((piece, index) => piece.practice
        ? <mark key={index} className="result-practice-mark">{piece.text}<span className="result-visually-hidden"> (flagged word)</span></mark>
        : piece.text)}
    </>
  );
}

/**
 * Admin review of one student's saved assessment. Read-only, third-person
 * wording, and written for a reviewer rather than the learner. Everything comes
 * from the Admin routes. It has no way to start a pronunciation check: it never
 * uses the learner's check store or panels, and has no example-audio buttons, so
 * opening it makes no speech calls. Missing results say "Not assessed".
 */
export default function AdminStudentAssessmentModal({ studentName, summary, readingNumber, onClose }: AdminStudentAssessmentModalProps) {
  const [attempt, setAttempt] = useState<AdminStudentAttempt>();
  const [attemptFailed, setAttemptFailed] = useState(false);
  const [attemptRevision, setAttemptRevision] = useState(0);
  const [saved, setSaved] = useState<SavedPronunciationCheck>();
  const [savedFailed, setSavedFailed] = useState(false);
  const [savedRevision, setSavedRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setAttemptFailed(false);
    void getAdminStudentAttempt(summary.id)
      .then((loaded) => { if (active) setAttempt(loaded); })
      .catch(() => { if (active) setAttemptFailed(true); });
    return () => { active = false; };
  }, [summary.id, attemptRevision]);

  useEffect(() => {
    let active = true;
    setSavedFailed(false);
    setSaved(undefined);
    void getAdminPronunciationCheck(summary.id)
      .then((result) => { if (active) setSaved(result); })
      .catch(() => { if (active) setSavedFailed(true); });
    return () => { active = false; };
  }, [summary.id, savedRevision]);

  // Only this exact attempt is ever shown (several readings of one story share a title).
  const loaded = attempt?.id === summary.id ? attempt : undefined;
  const title = summary.passageTitle || summary.moduleTitle;
  const heading = readingNumber ? `${title} — Reading ${readingNumber}` : title;
  const matched = loaded ? loaded.wordMetrics.filter((word) => word.type === "match").length : 0;
  const check = saved?.status === "completed" ? saved.check : null;
  const results = check?.summary;
  const placed = results && loaded
    ? placePracticeWords(results.wordsToPractice, loaded.passageSnapshot ?? "", loaded.passageTitle || loaded.moduleTitle, results.practiceOccurrences)
    : [];

  return (
    <M5Modal id="m5-admin-student-assessment" title="Saved Oral Reading Assessment" closeLabel="Close" open onClose={onClose}>
      <div lang="en" className="result-saved-assessment">
        <section className="result-feedback-card" aria-labelledby="admin-reading-title">
          <h3 id="admin-reading-title">{heading}</h3>
          <dl className="result-saved-details">
            <div><dt>Student</dt><dd>{studentName}</dd></div>
            <div><dt>Language</dt><dd>{summary.language ? LANGUAGE_NAMES[summary.language] : "Not recorded"}</dd></div>
            <div><dt>Completed</dt><dd><time dateTime={summary.completedAt}>{new Date(summary.completedAt).toLocaleString()}</time></dd></div>
          </dl>
        </section>

        {!loaded ? (
          attemptFailed ? (
            <div role="alert" className="result-feedback-card">
              <p>This saved assessment could not be loaded.</p>
              <button type="button" className="result-feedback-button" onClick={() => setAttemptRevision((value) => value + 1)}>Retry</button>
            </div>
          ) : (
            <p className="result-feedback-note" role="status">Loading saved assessment…</p>
          )
        ) : (
          <>
            <section className="result-feedback-card" aria-labelledby="admin-result-title">
              <h3 id="admin-result-title">Reading Result</h3>
              <dl className="result-feedback-summary">
                <div>
                  <dt>Reading Accuracy</dt>
                  <dd className="result-feedback-summary-value">{Math.round(loaded.pronunciationAccuracy)}%</dd>
                </div>
                <div>
                  <dt>Words Matched</dt>
                  <dd className="result-feedback-summary-value">{loaded.expectedWordCount > 0 ? `${matched} of ${loaded.expectedWordCount}` : "Not assessed"}</dd>
                </div>
                <div>
                  <dt>Reading Speed</dt>
                  <dd className="result-feedback-summary-value">{Math.round(loaded.readingSpeedWpm)} words per minute</dd>
                </div>
              </dl>
              <p className="result-feedback-note">Reading Accuracy compares the words the computer heard with the story. It is separate from Pronunciation Accuracy.</p>
            </section>

            <section className="result-feedback-card" aria-labelledby="admin-pronunciation-title">
              <h3 id="admin-pronunciation-title"><Mic size={22} aria-hidden="true" />Pronunciation Accuracy</h3>
              {savedFailed ? (
                <div role="alert">
                  <p className="result-feedback-note">The saved pronunciation check could not be loaded.</p>
                  <button type="button" className="result-feedback-button" onClick={() => setSavedRevision((value) => value + 1)}>Retry</button>
                </div>
              ) : !saved ? (
                <p className="result-feedback-note" role="status">Loading the saved pronunciation check…</p>
              ) : saved.status === "running" ? (
                <p className="result-feedback-note" role="status">The student's pronunciation check is still running. Reopen this reading later to see it.</p>
              ) : !results || results.accuracy === null ? (
                <>
                  <p className="result-feedback-message">Not assessed</p>
                  <p className="result-feedback-note">
                    {saved.status === "unsupported" ? "Pronunciation checks are available for English readings only."
                      : results ? "This check could not score any speech in the reading."
                        : "This reading has no saved pronunciation check."}
                  </p>
                </>
              ) : (
                <>
                  <p className="result-pronunciation-value"><strong>{results.accuracy}</strong> out of 100</p>
                  <progress className="result-feedback-progress" value={results.accuracy} max={100} aria-label={`Pronunciation Accuracy: ${results.accuracy} out of 100`}>{results.accuracy} out of 100</progress>
                  <p className="result-feedback-note">A 0-100 score, not the percent of words said correctly.</p>
                  {isPartialCheck(results) && (
                    <p className="result-feedback-note" role="note">
                      Only part of this reading was checked
                      {typeof results.storyWords === "number" && typeof results.assessedStoryWords === "number"
                        ? ` (${results.assessedStoryWords} of ${results.storyWords} story words were scored)` : ""}, so these results cover that part only.
                    </p>
                  )}
                </>
              )}
            </section>

            {results && (
              <>
                <section className="result-feedback-card" aria-labelledby="admin-feedback-title">
                  <h3 id="admin-feedback-title"><MessageCircle size={22} aria-hidden="true" />Feedback Shown to the Student</h3>
                  <p className="result-feedback-message">{pronunciationOverview(results)}</p>
                </section>

                <section className="result-feedback-card" aria-labelledby="admin-words-title">
                  <h3 id="admin-words-title"><BookOpen size={22} aria-hidden="true" />Words Flagged for Practice</h3>
                  {placed.length > 0 ? (
                    <ul className="result-practice-list">
                      {placed.map((item) => (
                        <li key={item.key} className="result-practice-item">
                          <strong className="result-practice-word">{item.word}</strong>
                          {item.excerpt && (
                            <p className="result-practice-excerpt"><span><MarkedExcerpt pieces={item.excerpt} /></span></p>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="result-feedback-note">
                      {isPartialCheck(results) ? "No words were flagged in the part that was checked." : "No words were flagged for practice."}
                    </p>
                  )}
                  <p className="result-feedback-note">
                    Scores compare the student's speech with a US English model, so names and Philippine English pronunciations
                    can score low even when read correctly. Listen to the recording before treating a flagged word as a reading mistake.
                  </p>
                </section>
              </>
            )}

            <RecordingPlayback key={loaded.id} attemptId={loaded.id} admin language="en" />
            {/* Labels stay in English; the story and what was heard keep the reading's own language. */}
            <SavedTranscript attempt={{ ...loaded, language: loaded.language ?? "en" } as OralReadingAttempt} uiLanguage="en" />
          </>
        )}
      </div>
    </M5Modal>
  );
}
