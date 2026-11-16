import { useEffect, useMemo, useState } from "react";
import { BookOpen, Eye, FilePlus2, LoaderCircle, PlusCircle, Search } from "lucide-react";
import { Link } from "react-router-dom";
import M3PageHeader from "../components/M3PageHeader";
import M3StatusBadge from "../components/M3StatusBadge";
import { useM3Content } from "../context/M3ContentContext";
import type { M3Role, ModuleDifficulty } from "../types/content";
import { getM3WorkspaceRoot } from "../utils/workspaceRoot";

interface ModuleCatalogPageProps {
  role: Extract<M3Role, "teacher" | "general_user">;
}

type DifficultyFilter = "All" | ModuleDifficulty;

export default function ModuleCatalogPage({ role }: ModuleCatalogPageProps) {
  const [search, setSearch] = useState("");
  const [difficulty, setDifficulty] = useState<DifficultyFilter>("All");
  const basePath = getM3WorkspaceRoot(role);
  const { modules: sharedModules, modulesError, modulesLoading, refreshModules } = useM3Content();
  useEffect(() => { void refreshModules(); }, [refreshModules]);

  const modules = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sharedModules.filter(
      (module) =>
        module.status === "published" &&
        (difficulty === "All" || module.difficulty === difficulty) &&
        (!query ||
          module.title.toLowerCase().includes(query) ||
          module.learningPath.toLowerCase().includes(query)),
    );
  }, [difficulty, search, sharedModules]);

  return (
    <div className="m3-page-stack">
      <M3PageHeader
        eyebrow={`${role === "teacher" ? "Teacher" : "General User"} library`}
        title="Reading Modules"
        description="Browse published Basa Eskwela modules."
        actions={role === "teacher" ? <>
          {/* Teachers author modules in their own workspace (same editor as the School Admin). */}
          <Link className="m3-button m3-button--secondary" to="/m3/teacher/content"><FilePlus2 size={18} aria-hidden="true" /> My Reading Modules</Link>
          <Link className="m3-button m3-button--coral" to="/m3/teacher/content/new"><PlusCircle size={18} aria-hidden="true" /> Create Module</Link>
        </> : undefined}
      />

      <section className="m3-panel">
        <div className="m3-toolbar">
          <label className="m3-search-field">
            <Search size={18} />
            <span className="m3-visually-hidden">Search published modules</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search published modules" />
          </label>
          <div className="m3-filter-group">
            <label>
              <span>Difficulty</span>
              <select
                value={difficulty}
                onChange={(event) => setDifficulty(event.target.value as DifficultyFilter)}
              >
                <option>All</option>
                <option>Easy</option>
                <option>Medium</option>
                <option>Hard</option>
              </select>
            </label>
          </div>
        </div>

        {modulesLoading ? (
          <div className="m3-empty-state" role="status">
            <LoaderCircle className="m3-spinner" size={34} />
            <h2>Loading reading modulesâ€¦</h2>
          </div>
        ) : modulesError ? (
          <div className="m3-empty-state" role="alert">
            <BookOpen size={34} />
            <h2>Unable to load reading modules</h2>
            <p>{modulesError}</p>
          </div>
        ) : modules.length === 0 ? (
          <div className="m3-empty-state m3-empty-state--catalog">
            <BookOpen size={34} />
            <h2>No published modules found</h2>
            <p>Try another search or difficulty.</p>
          </div>
        ) : (
          <div className="m3-catalog-grid">
            {modules.map((module) => (
              <article className="m3-module-tile" key={module.id}>
                <div className="m3-module-tile-top">
                  <span className="m3-record-icon m3-record-icon--module">
                    <BookOpen size={22} />
                  </span>
                  <M3StatusBadge value={module.status} />
                </div>
                <div>
                  <p className="m3-tile-kicker">{module.learningPath}</p>
                  <h2>{module.title}</h2>
                </div>
                <div className="m3-record-meta">
                  <span className={`m3-difficulty m3-difficulty--${module.difficulty.toLowerCase()}`}>
                    {module.difficulty}
                  </span>
                  <span>{module.questionCount} questions</span>
                </div>
                <Link className="m3-button m3-button--secondary m3-button--full" to={`${basePath}/modules/${module.id}`}>
                  <Eye size={17} />
                  View Module
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
