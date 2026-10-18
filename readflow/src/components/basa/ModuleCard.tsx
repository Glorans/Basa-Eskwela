import { BookOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { getStudentModuleAction } from "../../modules/module3/state/studentModuleState";
import type { StudentReadingModule } from "../../modules/module3/types/content";
import "./ModuleCard.css";

const DIFFICULTY_STYLES: Record<string, string> = {
  Easy: "basa-badge--easy",
  Medium: "basa-badge--medium",
  Hard: "basa-badge--hard",
};

export default function ModuleCard({ mod }: { mod: StudentReadingModule }) {
  const action = getStudentModuleAction(mod.id);

  return (
    <article className="basa-module-card">
      <div className="basa-module-card-top">
        <BookOpen size={20} />
      </div>

      <h3 className="basa-module-title">{mod.title}</h3>

      <div className="basa-module-meta">
        <span>{mod.learningPath}</span>
        <span className={`basa-badge ${DIFFICULTY_STYLES[mod.difficulty]}`}>{mod.difficulty}</span>
      </div>

      <div className="basa-module-footer">
        <span className="basa-module-xp">Reading passage</span>
        <Link className="basa-module-action" to={action.to}>
          {action.label} &gt;
        </Link>
      </div>
    </article>
  );
}
