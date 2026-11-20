import { Link } from "react-router-dom";
import DiagnosticLayout from "../components/DiagnosticLayout";
import PracticeModeBanner from "../components/PracticeModeBanner";
import { PRACTICE_BASE_PATH, usePracticeOptions } from "../utils/practiceMode";
import { diagnosticAssessmentRegistry } from "../data/diagnosticData";
import "./PracticeDiagnostic.css";

/** M2 F7: staff choose a language and try the current initial diagnostic in Practice Mode. */
export default function PracticeStartPage() {
  const practice = usePracticeOptions();
  const options = [
    { language: "en", label: "English", assessment: diagnosticAssessmentRegistry.en },
    { language: "fil", label: "Filipino", assessment: diagnosticAssessmentRegistry.fil },
  ].filter((option) => option.assessment);

  return (
    <DiagnosticLayout className="practice-diagnostic-panel" labelledBy="practice-start-title">
      <PracticeModeBanner exitTo={practice.exitTo} exitLabel={practice.exitLabel} />
      <header className="practice-diagnostic-header">
        <h1 id="practice-start-title">Try the Diagnostic Assessment</h1>
        <p>
          Experience the same reading and comprehension steps learners complete. You will read the story aloud, answer
          the questions and see a practice score. Nothing is saved: there is no official result, no assessment history,
          and no change to placement, analytics or rewards. You can practise as often as you like.
        </p>
      </header>
      <ul className="practice-diagnostic-languages" aria-label="Choose a language">
        {options.map(({ language, label, assessment }) => (
          <li key={language}>
            <Link className="diagnostic-primary-button practice-diagnostic-language" to={`${PRACTICE_BASE_PATH}/${language}/reading`} state={{ practiceExitTo: practice.exitTo }}>
              <span>Practise in {label}</span>
              <small>{assessment!.passage.title} · Version {assessment!.version}</small>
            </Link>
          </li>
        ))}
      </ul>
      <p className="practice-diagnostic-note">Your microphone is used for the reading step, as in the learner diagnostic.</p>
    </DiagnosticLayout>
  );
}
