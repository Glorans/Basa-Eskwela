import { ArrowLeft, BookOpen, Mic } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useM3Content } from "../modules/module3/context/M3ContentContext";
import {
  adjacentPassageId,
  type StudentModuleDetail,
} from "../modules/module3/services/studentModuleDetail";
import { readAloudTarget } from "../modules/module5/services/oralReadingNavigation";
import "./StudentModuleViewPage.css";

interface ClassroomNavigationState {
  fromClassroom?: boolean;
  roomId?: string;
  assignmentId?: string;
}

interface StudentModuleViewPageProps {
  role?: "student" | "general_user";
}

export default function StudentModuleViewPage({
  role = "student",
}: StudentModuleViewPageProps) {
  const { moduleId } = useParams<{ moduleId: string }>();
  const location = useLocation();
  const { getStudentModule } = useM3Content();

  const query = new URLSearchParams(location.search);
  const navigationState =
    location.state as ClassroomNavigationState | null;

  const requestedPassageId = query.get("passageId") ?? undefined;
  const roomId =
    navigationState?.roomId ?? query.get("roomId") ?? undefined;
  const assignmentId =
    navigationState?.assignmentId ??
    query.get("assignmentId") ??
    undefined;

  const cameFromClassroom =
    role === "student" &&
    Boolean(roomId) &&
    (navigationState?.fromClassroom ?? Boolean(query.get("roomId")));

  const backTarget = cameFromClassroom
    ? `/dashboard/learning-rooms/${roomId}`
    : role === "general_user"
      ? "/m3/general/modules"
      : "/dashboard/materials";

  const backLabel = cameFromClassroom
    ? "Back to Classroom"
    : role === "general_user"
      ? "Back to Reading Modules"
      : "Back to My Materials";

  const [module, setModule] = useState<StudentModuleDetail>();
  const [activePassageId, setActivePassageId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setLoadFailed(false);
    setModule(undefined);
    setActivePassageId(undefined);

    void getStudentModule(moduleId)
      .then((loadedModule) => {
        if (!active) return;

        setModule(loadedModule);

        const requestedPassage = loadedModule?.passages.find(
          (passage) => passage.id === requestedPassageId,
        );

        setActivePassageId(
          requestedPassage?.id ?? loadedModule?.passages[0]?.id,
        );
      })
      .catch(() => {
        if (!active) return;

        setModule(undefined);
        setLoadFailed(true);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [getStudentModule, moduleId, requestedPassageId]);

  if (loading || (module && module.id !== moduleId)) {
    return (
      <div className="basa-reading-module-empty" role="status">
        <BookOpen size={38} aria-hidden="true" />
        <h1>Loading reading module...</h1>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="basa-reading-module-empty" role="alert">
        <BookOpen size={38} aria-hidden="true" />
        <h1>Unable to load the reading module.</h1>
        <p>Please try again.</p>
        <Link to={backTarget}>{backLabel}</Link>
      </div>
    );
  }

  if (!module) {
    return (
      <div className="basa-reading-module-empty">
        <BookOpen size={38} aria-hidden="true" />
        <h1>Reading module not found.</h1>
        <p>
          The module does not exist or is not available to your account.
        </p>
        <Link to={backTarget}>{backLabel}</Link>
      </div>
    );
  }

  const activeIndex = module.passages.findIndex(
    (passage) => passage.id === activePassageId,
  );

  const activePassage = module.passages[activeIndex];

  const previousPassageId = adjacentPassageId(
    module.passages,
    activePassageId,
    -1,
  );

  const nextPassageId = adjacentPassageId(
    module.passages,
    activePassageId,
    1,
  );

  return (
    <div className="basa-reading-module-page">
      <Link className="basa-reading-module-back" to={backTarget}>
        <ArrowLeft size={17} aria-hidden="true" />
        {backLabel}
      </Link>

      <section className="basa-reading-module-card">
        <header>
          <span className="basa-reading-module-icon">
            <BookOpen size={24} aria-hidden="true" />
          </span>

          <div>
            <p>{module.learningPath}</p>
            <h1>{module.title}</h1>

            <span
              className={`basa-badge basa-badge--${module.difficulty.toLowerCase()}`}
            >
              {module.difficulty}
            </span>
          </div>
        </header>

        {module.passages.length > 1 && (
          <nav
            className="basa-passage-navigation"
            aria-label="Passage navigation"
          >
            <button
              type="button"
              disabled={!previousPassageId}
              onClick={() => {
                if (previousPassageId) {
                  setActivePassageId(previousPassageId);
                }
              }}
            >
              Previous
            </button>

            <span role="status">
              Passage {activeIndex + 1} of {module.passages.length}
            </span>

            <button
              type="button"
              disabled={!nextPassageId}
              onClick={() => {
                if (nextPassageId) {
                  setActivePassageId(nextPassageId);
                }
              }}
            >
              Next
            </button>
          </nav>
        )}

        <article
          className="basa-reading-module-passage"
          key={activePassage?.id ?? "legacy"}
          data-passage-id={activePassage?.id}
        >
          <h2>{activePassage?.title || "Reading Passage"}</h2>

          <p>
            {activePassage?.passageText ??
              (module.passages.length === 0 ? module.passage : "")}
          </p>
        </article>

        <div className="basa-reading-module-actions">
          <Link
            to={readAloudTarget(role, module.id, {
              passageId: activePassage?.id ?? module.id,
              roomId: cameFromClassroom ? roomId : undefined,
              assignmentId: cameFromClassroom
                ? assignmentId
                : undefined,
            })}
            state={
              cameFromClassroom
                ? {
                    fromClassroom: true,
                    roomId,
                    assignmentId,
                  }
                : undefined
            }
          >
            <Mic size={18} aria-hidden="true" />
            Start Read-Aloud
          </Link>
        </div>
      </section>
    </div>
  );
}