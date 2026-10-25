import { Link } from "react-router-dom";
import ModuleCard from "../../../components/basa/ModuleCard";
import type { LearnerPlacement } from "../services/learnerPlacement";
import type { MaterialLanguageCode, StudentReadingModule } from "../types/content";
import "./LearnerReading.css";

type Placement = LearnerPlacement | { status: "loading" | "error"; language: MaterialLanguageCode };
const labels = { en: "English", fil: "Filipino" };

export function ReadingLanguageSelector({ language, onChange }: {
  language: MaterialLanguageCode; onChange: (language: MaterialLanguageCode) => void;
}) {
  return <div className="m3-language-selector" role="group" aria-label="Reading language">
    {(["en", "fil"] as const).map(value => <button key={value} type="button"
      aria-pressed={language === value} onClick={() => onChange(value)}>
      {labels[value]}
    </button>)}
  </div>;
}

export function PlacementSummary({ placement }: { placement: Placement }) {
  const name = labels[placement.language];
  return <section className="m3-placement" aria-label={`${name} reading placement`} aria-live="polite">
    <h3>{name}</h3>
    {placement.status === "ready" ? <dl>
      <div><dt>Your Reading Level</dt><dd>{placement.readingLevel}</dd></div>
      <div><dt>Recommended Level</dt><dd>{placement.difficultyTier}</dd></div>
    </dl> : placement.status === "missing" ? <>
      <strong>Not completed</strong>
      <p>Complete your {name} reading diagnostic to see your recommended {name} stories.</p>
      <Link className="m3-reading-link" to={`/diagnostic/${placement.language}/reading`}>Start {name} diagnostic</Link>
    </> : placement.status === "loading" ? <p role="status">Loading your {name} reading level...</p>
      : <div role="alert"><p>We couldn't load your {name} reading level. Please try again.</p>
        <button type="button" className="m3-reading-link" onClick={() => window.location.reload()}>Reload page</button></div>}
  </section>;
}

export function LearnerModuleCards({ modules, recommended = false }: { modules: StudentReadingModule[]; recommended?: boolean }) {
  return <div className="basa-module-grid m3-learner-grid">{modules.map(module => <div className="m3-learner-card" key={module.id}>
    <div className="m3-card-label"><span>{labels[module.language]}</span>{recommended && <span>Recommended for your level</span>}</div>
    <ModuleCard mod={module} />
  </div>)}</div>;
}

export function RecommendedStories({ placement, modules, loading, failed }: {
  placement: Placement; modules: StudentReadingModule[]; loading: boolean; failed: boolean;
}) {
  return <section className="m3-reading-section" aria-label="Recommended for You">
    <h2>Recommended for You</h2>
    {placement.status === "loading" ? <p role="status">Loading your recommendations...</p>
      : placement.status !== "ready" ? null
      : loading ? <p role="status">Loading stories...</p>
      : failed ? <p role="alert">We couldn't load your stories. Please reload the page to try again.</p>
      : modules.length ? <LearnerModuleCards modules={modules} recommended />
      : <p>No recommended stories are available for this level yet.</p>}
  </section>;
}
