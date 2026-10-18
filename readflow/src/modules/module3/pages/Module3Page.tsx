import { useRef, useState } from "react";
import { Archive, BookOpen, Eye, LoaderCircle, Pencil, PlusCircle, RotateCcw, Search, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import M3PageHeader from "../components/M3PageHeader";
import M3StatusBadge from "../components/M3StatusBadge";
import { useM3Content } from "../context/M3ContentContext";
import type { MaterialLanguageCode, ModuleStatus } from "../types/content";
import "./Module3Page.css";

const statusLabels = { draft: "Draft", published: "Published", archived: "Archived" } as const;

function creationDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(date)
    : "Not available";
}

export default function Module3Page() {
  const { modules, modulesLoading, modulesError, refreshModules, feedback, clearFeedback, deleteModule, archiveModule, restoreModule } = useM3Content();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const mutationPending = useRef(false);
  async function manageModule(action: "delete" | "archive" | "restore", moduleId: string) {
    if (mutationPending.current) return;
    mutationPending.current = true;
    setBusy(true);
    setActionError(null);
    clearFeedback();
    try {
      const result = await (action === "delete" ? deleteModule(moduleId) : action === "archive" ? archiveModule(moduleId) : restoreModule(moduleId));
      if (!result.ok) setActionError(result.message);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "We couldn't complete this action. Refresh the module list to check its status before trying again.");
    } finally { mutationPending.current = false; setBusy(false); }
  }
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ModuleStatus | "all">("all");
  const [language, setLanguage] = useState<MaterialLanguageCode | "all">("all");
  const query = search.trim().toLowerCase();
  const visibleModules = modules.filter(module =>
    module.title.toLowerCase().includes(query)
    && (status === "all" || module.status === status)
    && (language === "all" || module.language === language));
  const hasFilters = Boolean(query || status !== "all" || language !== "all");

  return (
    <div className="m3-page-stack m3-admin-content">
      <M3PageHeader eyebrow="Admin library" title="Content Management"
        description="Manage reading modules and open their passages and question banks."
        actions={<Link className="m3-button m3-button--coral" to="/m3/admin/modules/new"><PlusCircle size={18} aria-hidden="true" /> Create Module</Link>} />

      {feedback && <div className={`m3-feedback-banner m3-feedback-banner--${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>
        <span>{feedback.message}</span><button type="button" onClick={clearFeedback} aria-label="Dismiss message">&times;</button>
      </div>}
      {actionError && feedback?.message !== actionError && <p className="m3-error-message" role="alert">{actionError}</p>}

      <section className="m3-admin-module-summary" aria-label="Module publication totals">
        {(Object.keys(statusLabels) as ModuleStatus[]).map(value => <article className="m3-panel" key={value}>
          <h2>{statusLabels[value]}</h2>
          <strong>{modulesLoading || modulesError ? "—" : modules.filter(module => module.status === value).length}</strong>
          <span>modules</span>
        </article>)}
      </section>

      <section className="m3-panel" aria-label="Reading modules">
        <div className="m3-toolbar">
          <label className="m3-search-field"><Search size={18} aria-hidden="true" />
            <span className="m3-visually-hidden">Search modules by title</span>
            <input type="search" placeholder="Search modules by title" value={search} onChange={event => setSearch(event.target.value)} />
          </label>
          <div className="m3-filter-group">
            <label><span>Publication status</span><select value={status} onChange={event => setStatus(event.target.value as typeof status)}>
              <option value="all">All statuses</option>
              {(Object.keys(statusLabels) as ModuleStatus[]).map(value => <option value={value} key={value}>{statusLabels[value]}</option>)}
            </select></label>
            <label><span>Language</span><select value={language} onChange={event => setLanguage(event.target.value as typeof language)}>
              <option value="all">All languages</option><option value="en">English</option><option value="fil">Filipino</option>
            </select></label>
          </div>
        </div>

        {modulesLoading ? <div className="m3-empty-state" role="status"><LoaderCircle className="m3-spinner" size={34} aria-hidden="true" /><h2>Loading reading modules...</h2></div>
          : modulesError ? <div className="m3-empty-state" role="alert"><h2>Unable to load reading modules</h2><p>{modulesError}</p>
            <button className="m3-button m3-button--primary" type="button" onClick={() => void refreshModules()}>Try Again</button></div>
          : <>
            <p role="status">Showing {visibleModules.length} of {modules.length} modules</p>
            {visibleModules.length === 0 ? <div className="m3-empty-state"><BookOpen size={34} aria-hidden="true" />
              <h2>{modules.length ? "No matching modules" : "No reading modules yet"}</h2>
              <p>{modules.length ? "Try another title, status, or language." : "Create a module to add passages and questions to the library."}</p>
              {hasFilters && <button className="m3-button m3-button--secondary" type="button" onClick={() => { setSearch(""); setStatus("all"); setLanguage("all"); }}>Clear Filters</button>}
            </div> : <div className="m3-card-list">
              {visibleModules.map(module => <article className="m3-record-card" key={module.id}>
                <span className="m3-record-icon m3-record-icon--module"><BookOpen size={22} aria-hidden="true" /></span>
                <div className="m3-record-main">
                  <div className="m3-record-heading"><h2>{module.title}</h2><M3StatusBadge value={module.status} label={statusLabels[module.status]} /></div>
                  <dl className="m3-admin-module-meta">
                    <div><dt>Language</dt><dd>{module.language === "en" ? "English" : "Filipino"}</dd></div>
                    <div><dt>Reading level</dt><dd>{module.readingLevel}</dd></div>
                    <div><dt>Difficulty</dt><dd>{module.difficulty}</dd></div>
                    <div><dt>Learning path</dt><dd>{module.learningPath}</dd></div>
                    <div><dt>Questions</dt><dd>{module.questionCount}</dd></div>
                    <div><dt>Created</dt><dd>{creationDate(module.createdAt)}</dd></div>
                  </dl>
                </div>
                <div className="m3-admin-module-actions">
                  <Link className="m3-button m3-button--secondary" to={`/m3/admin/modules/${module.id}`} aria-label={`View ${module.title}`}><Eye size={17} aria-hidden="true" /> View Details</Link>
                  {module.status === "draft" && !module.publishedAt && <Link className="m3-button m3-button--secondary" to={`/m3/admin/modules/${module.id}/edit`} aria-label={`Edit ${module.title}`}><Pencil size={17} aria-hidden="true" /> Edit Draft</Link>}
                  <button type="button" className="m3-button m3-module-delete-button" disabled={busy} aria-label={`Delete ${module.title}`} onClick={() => void manageModule("delete", module.id)}><Trash2 size={17} aria-hidden="true" /> Delete</button>
                  {module.status === "published" && <button type="button" className="m3-button m3-button--secondary" disabled={busy} onClick={() => void manageModule("archive", module.id)} aria-label={`Archive ${module.title}`}><Archive size={17} aria-hidden="true" /> Archive</button>}
                  {module.status === "archived" && <button type="button" className="m3-button m3-button--secondary" disabled={busy} onClick={() => void manageModule("restore", module.id)} aria-label={`Restore ${module.title}`}><RotateCcw size={17} aria-hidden="true" /> Restore</button>}
                </div>
              </article>)}
            </div>}
          </>}
      </section>
    </div>
  );
}
