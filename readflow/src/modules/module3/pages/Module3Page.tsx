import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, BookOpen, Eye, LoaderCircle, Pencil, PlusCircle, RotateCcw, Search, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import M3PageHeader from "../components/M3PageHeader";
import M3StatusBadge from "../components/M3StatusBadge";
import { useM3Content } from "../context/M3ContentContext";
import type { MaterialLanguageCode, ModuleDifficulty, ModuleStatus, ReadingModule } from "../types/content";
import { editorPaths, type M3EditorWorkspace } from "../components/AdminCollectionEditor";
import { useAuth } from "../../../auth/useAuth";
import { confirmReadFlow } from "../../../components/ReadFlowDialog";
import { moduleDeletionMessage, modulePurgeMessage, moduleTrashMessage } from "../utils/moduleDeletionMessage";
import { getTrashedModules, purgeTrashedModule, restoreTrashedModule, trashModule, type TrashedModule } from "../services/moduleService";
import "./Module3Page.css";

const statusLabels = { draft: "Draft", published: "Published", archived: "Archived" } as const;

function creationDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(date)
    : "Not available";
}

export default function Module3Page({ workspace = "admin" }: { workspace?: M3EditorWorkspace } = {}) {
  const { modules: allModules, modulesLoading, modulesError, refreshModules, feedback, clearFeedback, deleteModule, archiveModule, restoreModule } = useM3Content();
  const { user } = useAuth();
  // Teacher workspace: only the modules this Teacher created. The database already limits
  // what they can read (their own drafts plus published modules) and change (their own).
  const teacher = workspace === "teacher";
  const paths = editorPaths(workspace);
  const modules = teacher ? allModules.filter(module => Boolean(user?.id) && module.createdBy === user?.id) : allModules;
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const mutationPending = useRef(false);
  // null = Trash not installed: Delete keeps the existing m3_delete_module behaviour.
  const [trash, setTrash] = useState<TrashedModule[] | null>(null);
  const [trashMessage, setTrashMessage] = useState("");
  const loadTrash = useCallback(async () => setTrash(teacher ? null : await getTrashedModules()), [teacher]);
  useEffect(() => { void loadTrash(); }, [loadTrash]);

  async function runTrashAction(work: () => Promise<string>) {
    if (mutationPending.current) return;
    mutationPending.current = true;
    setBusy(true);
    setActionError(null);
    setTrashMessage("");
    clearFeedback();
    try {
      setTrashMessage(await work());
      await Promise.all([refreshModules(), loadTrash()]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "We couldn't complete this action. Refresh the module list before trying again.");
    } finally { mutationPending.current = false; setBusy(false); }
  }

  async function manageModule(action: "delete" | "archive" | "restore", moduleId: string) {
    if (mutationPending.current) return;
    const target = modules.find(module => module.id === moduleId);
    if (action === "delete" && trash && target) {
      if (!(await confirmReadFlow(moduleTrashMessage(target)))) return;
      await runTrashAction(async () => { await trashModule(moduleId); return `${target.title} was moved to the Trash.`; });
      return;
    }
    if (action === "delete" && (!target || !(await confirmReadFlow(moduleDeletionMessage(target))))) return;
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
  // Teacher F2: organize their modules by the existing reading levels and difficulty.
  const [level, setLevel] = useState<ReadingModule["readingLevel"] | "all">("all");
  const [difficulty, setDifficulty] = useState<ModuleDifficulty | "all">("all");
  const query = search.trim().toLowerCase();
  const visibleModules = modules.filter(module =>
    module.title.toLowerCase().includes(query)
    && (status === "all" || module.status === status)
    && (language === "all" || module.language === language)
    && (level === "all" || module.readingLevel === level)
    && (difficulty === "all" || module.difficulty === difficulty));
  const hasFilters = Boolean(query || status !== "all" || language !== "all" || level !== "all" || difficulty !== "all");

  return (
    <div className="m3-page-stack m3-admin-content">
      <M3PageHeader eyebrow={teacher ? "Teacher workspace" : "Admin library"} title={teacher ? "My Reading Modules" : "Content Management"}
        description={teacher
          ? "Create, organize, edit and publish the reading modules you made. Published modules join the shared library."
          : "Manage reading modules and open their passages and question banks."}
        actions={<Link className="m3-button m3-button--coral" to={`${paths.module}/new`}><PlusCircle size={18} aria-hidden="true" /> Create Module</Link>} />

      {feedback && <div className={`m3-feedback-banner m3-feedback-banner--${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>
        <span>{feedback.message}</span><button type="button" onClick={clearFeedback} aria-label="Dismiss message">&times;</button>
      </div>}
      {actionError && feedback?.message !== actionError && <p className="m3-error-message" role="alert">{actionError}</p>}
      {trashMessage && <p className="m3-success-message" role="status">{trashMessage}</p>}

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
            {teacher && <>
              <label><span>Reading level</span><select value={level} onChange={event => setLevel(event.target.value as typeof level)}>
                <option value="all">All reading levels</option>
                {(["Frustration", "Instructional", "Independent"] as const).map(value => <option value={value} key={value}>{value}</option>)}
              </select></label>
              <label><span>Difficulty</span><select value={difficulty} onChange={event => setDifficulty(event.target.value as typeof difficulty)}>
                <option value="all">All difficulties</option>
                {(["Easy", "Medium", "Hard"] as const).map(value => <option value={value} key={value}>{value}</option>)}
              </select></label>
            </>}
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
              {hasFilters && <button className="m3-button m3-button--secondary" type="button" onClick={() => { setSearch(""); setStatus("all"); setLanguage("all"); setLevel("all"); setDifficulty("all"); }}>Clear Filters</button>}
            </div> : <div className="m3-card-list">
              {visibleModules.map(module => <article className="m3-record-card" key={module.id}>
                <span className="m3-record-icon m3-record-icon--module"><BookOpen size={22} aria-hidden="true" /></span>
                <div className="m3-record-main">
                  <div className="m3-record-heading"><h2>{module.title}</h2><M3StatusBadge value={module.status} label={statusLabels[module.status]} /></div>
                  <dl className="m3-admin-module-meta">
                    <div><dt>Language</dt><dd>{module.language === "en" ? "English" : "Filipino"}</dd></div>
                    <div><dt>Reading level</dt><dd>{module.readingLevel}</dd></div>
                    <div><dt>Difficulty</dt><dd>{module.difficulty}{module.difficultyTier && module.difficulty !== module.difficultyTier && <small className="m3-tier-mismatch"> (path tier: {module.difficultyTier})</small>}</dd></div>
                    <div><dt>Learning path</dt><dd>{module.learningPath}</dd></div>
                    <div><dt>Questions</dt><dd>{module.questionCount}</dd></div>
                    <div><dt>Created</dt><dd>{creationDate(module.createdAt)}</dd></div>
                  </dl>
                </div>
                <div className="m3-admin-module-actions">
                  <Link className="m3-button m3-button--secondary" to={`${paths.module}/${module.id}`} aria-label={`View ${module.title}`}><Eye size={17} aria-hidden="true" /> View Details</Link>
                  {module.status === "draft" && !module.publishedAt && <Link className="m3-button m3-button--secondary" to={`${paths.module}/${module.id}/edit`} aria-label={`Edit ${module.title}`}><Pencil size={17} aria-hidden="true" /> Edit Draft</Link>}
                  <button type="button" className="m3-button m3-module-delete-button" disabled={busy} aria-label={`Delete ${module.title}`} onClick={() => void manageModule("delete", module.id)}><Trash2 size={17} aria-hidden="true" /> Delete</button>
                  {!teacher && module.status === "published" && <button type="button" className="m3-button m3-button--secondary" disabled={busy} onClick={() => void manageModule("archive", module.id)} aria-label={`Archive ${module.title}`}><Archive size={17} aria-hidden="true" /> Archive</button>}
                  {!teacher && module.status === "archived" && <button type="button" className="m3-button m3-button--secondary" disabled={busy} onClick={() => void manageModule("restore", module.id)} aria-label={`Restore ${module.title}`}><RotateCcw size={17} aria-hidden="true" /> Restore</button>}
                </div>
              </article>)}
            </div>}
          </>}
      </section>

      {trash && <section className="m3-panel m3-trash" aria-labelledby="m3TrashHeading">
        <h2 id="m3TrashHeading">Trash</h2>
        <p className="m3-editor-help">Deleted modules stay here, hidden from every catalog. Restore brings back a draft as a draft and a published module as archived. Modules with learner or classroom history can be restored but not deleted permanently.</p>
        {trash.length === 0 ? <p>The Trash is empty.</p> : <div className="m3-card-list">
          {trash.map(item => <article className="m3-record-card" key={item.id}>
            <span className="m3-record-icon"><Trash2 size={22} aria-hidden="true" /></span>
            <div className="m3-record-main">
              <div className="m3-record-heading"><h3>{item.title}</h3></div>
              <p className="m3-editor-help">Deleted {creationDate(item.trashedAt)} by {item.trashedByName} · was {item.statusBefore || "unknown"}{item.hasHistory ? " · has learner or classroom history" : ""}</p>
            </div>
            <div className="m3-admin-module-actions">
              <button type="button" className="m3-button m3-button--secondary" disabled={busy} aria-label={`Restore ${item.title} from the Trash`}
                onClick={() => void runTrashAction(async () => {
                  const restored = await restoreTrashedModule(item.id);
                  return restored === "archived"
                    ? `${item.title} was restored as archived. Publish it again when it is ready for learners.`
                    : `${item.title} was restored as a draft.`;
                })}><RotateCcw size={17} aria-hidden="true" /> Restore</button>
              {!item.hasHistory && <button type="button" className="m3-button m3-module-delete-button" disabled={busy} aria-label={`Delete ${item.title} permanently`}
                onClick={() => void (async () => {
                  if (!(await confirmReadFlow(modulePurgeMessage(item.title)))) return;
                  await runTrashAction(async () => { await purgeTrashedModule(item.id); return `${item.title} was permanently deleted.`; });
                })()}><Trash2 size={17} aria-hidden="true" /> Delete Permanently</button>}
            </div>
          </article>)}
        </div>}
      </section>}
    </div>
  );
}
