import { useCallback, useEffect, useMemo, useState } from "react";
import type { LanguageProgress, ProgressPoint, ProgressStudent } from "../services/readingProgress";
import "./ClassReadingResults.css";

/**
 * M2 F3 + F5 class view for Teachers (own active Learning Rooms) and School Admins (every Student, single-school pilot).
 * One page, built only from the server's OFFICIAL results (initial diagnostic + official reassessments):
 *   Reading Progress — one row per Student: current English and Filipino levels, latest assessment, View History;
 *   All Results      — one row per official assessment, filterable by type, language, level and date.
 * Filters sit at the top and work together; View History opens one Student's history (newest first, English and
 * Filipino separate) and Back to Student List keeps the room, search, filters and page.
 */
type Lang = "en" | "fil";
type LevelFilter = "" | "Independent" | "Instructional" | "Frustration" | "none";
const LANGS: Lang[] = ["en", "fil"];
const LANGUAGE_NAMES: Record<Lang, string> = { en: "English", fil: "Filipino" };
const LEVELS = ["Independent", "Instructional", "Frustration"] as const;
const RANK: Record<string, number> = { Frustration: 0, Instructional: 1, Independent: 2 };
const PAGE_SIZE = 25;
const NO_ROOM = "none";

const formatDate = (value: string | null | undefined) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { dateStyle: "medium" });
};
const score = (value: number | null) => (typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 10) / 10}%` : "—");
const assessmentName = (p: ProgressPoint) => (p.assessmentType === "reassessment" ? `Reassessment${p.title ? `: ${p.title}` : ""}` : "Initial Diagnostic");
const pointsOf = (progress: LanguageProgress) => [...(progress.initial ? [progress.initial] : []), ...progress.reassessments];
const newestFirst = (a: { completedAt: string }, b: { completedAt: string }) => String(b.completedAt).localeCompare(String(a.completedAt));

export default function ClassReadingResults({ load, idPrefix, showNoRoom = false, emptyMessage = "No Students to show." }: {
  load: () => Promise<ProgressStudent[]>; idPrefix: string; showNoRoom?: boolean; emptyMessage?: string;
}) {
  const [students, setStudents] = useState<ProgressStudent[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"progress" | "results">("progress");
  const [search, setSearch] = useState("");
  const [room, setRoom] = useState("");
  const [language, setLanguage] = useState<"all" | Lang>("all");
  const [level, setLevel] = useState<LevelFilter>("");
  const [type, setType] = useState<"" | "initial" | "reassessment">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<{ key: "name" | "latest"; dir: "ascending" | "descending" }>({ key: "name", dir: "ascending" });
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { setStudents(await load()); }
    catch (e) { setError(e instanceof Error && e.message ? e.message : "Unable to load reading results."); }
    finally { setLoading(false); }
  }, [load]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setPage(1); }, [search, room, language, level, type, from, to, sort, view]);

  const rooms = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of students ?? []) for (const r of s.rooms ?? []) map.set(r.id, r.name);
    return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [students]);
  const langs = language === "all" ? LANGS : [language];
  const scoped = useMemo(() => (students ?? []).filter((s) => {
    if (search.trim() && !s.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (!room) return true;
    return room === NO_ROOM ? !(s.rooms ?? []).length : (s.rooms ?? []).some((r) => r.id === room);
  }), [students, search, room]);
  const latestOf = (s: ProgressStudent) => LANGS.flatMap((l) => pointsOf(s.progress[l])).map((p) => p.completedAt).sort().pop() ?? "";

  const progressRows = useMemo(() => scoped.filter((s) => {
    if (!level) return true;
    return langs.some((l) => (level === "none" ? !s.progress[l].current : s.progress[l].current?.readingLevel === level));
  }).sort((a, b) => {
    const order = sort.key === "name" ? a.name.localeCompare(b.name) : latestOf(a).localeCompare(latestOf(b));
    return sort.dir === "ascending" ? order : -order;
  }), [scoped, level, language, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const resultRows = useMemo(() => scoped.flatMap((s) => langs.flatMap((l) => pointsOf(s.progress[l]).map((p) => ({ student: s, language: l, point: p }))))
    .filter(({ point }) => (!type || point.assessmentType === type)
      && (!level || (level === "none" ? false : point.readingLevel === level))
      && (!from || point.completedAt.slice(0, 10) >= from) && (!to || point.completedAt.slice(0, 10) <= to))
    .sort((a, b) => newestFirst(a.point, b.point)), [scoped, language, type, level, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = view === "progress" ? progressRows.length : resultRows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pages);
  const slice = <T,>(rows: T[]) => rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const filtered = Boolean(search.trim() || room || language !== "all" || level || type || from || to);
  const clear = () => { setSearch(""); setRoom(""); setLanguage("all"); setLevel(""); setType(""); setFrom(""); setTo(""); };
  const sortBy = (key: "name" | "latest") => setSort((s) => ({ key, dir: s.key === key && s.dir === "ascending" ? "descending" : "ascending" }));
  const selected = selectedId ? (students ?? []).find((s) => s.id === selectedId) ?? null : null;

  if (selected) return <StudentHistory student={selected} idPrefix={idPrefix} onBack={() => setSelectedId(null)} />;

  const levelCell = (s: ProgressStudent, l: Lang) => {
    const p = s.progress[l];
    if (!p.current) return <span className="crr-none">No result</span>;
    const latest = pointsOf(p).sort(newestFirst)[0];
    return <>
      <span className="crr-level" data-level={p.current.readingLevel}>{p.current.readingLevel}</span>
      {latest && latest.assessmentType === "reassessment" && latest.readingLevel !== p.current.readingLevel
        && <span className="crr-note">Latest reassessment: {latest.readingLevel}</span>}
    </>;
  };
  const sortHeader = (key: "name" | "latest", label: string) => <th scope="col" aria-sort={sort.key === key ? sort.dir : "none"}>
    <button type="button" className="crr-sort" onClick={() => sortBy(key)}>{label}<span aria-hidden="true">{sort.key === key ? (sort.dir === "ascending" ? " ▲" : " ▼") : ""}</span></button>
  </th>;

  return (
    <section className="crr" aria-labelledby={`${idPrefix}-title`}>
      <h2 id={`${idPrefix}-title`} className="diagnostic-visually-hidden">Reading results</h2>
      <div className="crr-filters" role="search" aria-label="Filter reading results">
        <label><span>Search Student</span><input type="search" value={search} placeholder="Student name" onChange={(e) => setSearch(e.target.value)} /></label>
        <label><span>Learning Room</span><select value={room} onChange={(e) => setRoom(e.target.value)}>
          <option value="">All Learning Rooms</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          {showNoRoom && <option value={NO_ROOM}>Not in a Learning Room</option>}
        </select></label>
        <label><span>Language</span><select value={language} onChange={(e) => setLanguage(e.target.value as "all" | Lang)}>
          <option value="all">All</option><option value="en">English</option><option value="fil">Filipino</option>
        </select></label>
        <label><span>Reading Level</span><select value={level} onChange={(e) => setLevel(e.target.value as LevelFilter)}>
          <option value="">All</option>{LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}<option value="none">No Result</option>
        </select></label>
        {view === "results" && <>
          <label><span>Assessment</span><select value={type} onChange={(e) => setType(e.target.value as "" | "initial" | "reassessment")}>
            <option value="">All</option><option value="initial">Initial Diagnostic</option><option value="reassessment">Reassessment</option>
          </select></label>
          <label><span>From</span><input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
          <label><span>To</span><input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
        </>}
        <div className="crr-filter-actions">
          <button type="button" disabled={!filtered} onClick={clear}>Clear Filters</button>
          <button type="button" disabled={loading} onClick={() => void refresh()}>Refresh</button>
        </div>
      </div>

      <div className="crr-views" role="tablist" aria-label="Results view">
        {([["progress", "Reading Progress"], ["results", "All Results"]] as const).map(([key, label]) => <button key={key} type="button" role="tab"
          aria-selected={view === key} className={view === key ? "crr-view crr-view--active" : "crr-view"} onClick={() => setView(key)}>{label}</button>)}
      </div>

      {loading && !students && <p role="status">Loading reading results…</p>}
      {error && <div role="alert" className="crr-error"><p>{error}</p><button type="button" onClick={() => void refresh()}>Try Again</button></div>}
      {students && <>
        <p className="crr-count" aria-live="polite">
          {view === "progress" ? `${total} of ${students.length} Students` : `${total} official result${total === 1 ? "" : "s"}`}
          {room && room !== NO_ROOM ? ` · ${rooms.find((r) => r.id === room)?.name ?? ""}` : ""}
          {view === "progress" && <span className="crr-meta"> · Current level = reading placement (official initial diagnostic while reassessment placement is off).</span>}
        </p>
        {total === 0 ? <p className="crr-empty">{students.length === 0 ? emptyMessage : "No results match these filters."}</p>
          : view === "progress" ? (
            <table className="crr-table">
              <thead><tr>{sortHeader("name", "Student")}<th scope="col">Learning Room</th><th scope="col">English</th><th scope="col">Filipino</th>
                {sortHeader("latest", "Latest Assessment")}<th scope="col"><span className="diagnostic-visually-hidden">History</span></th></tr></thead>
              <tbody>{slice(progressRows).map((s) => <tr key={s.id}>
                <td data-label="Student">{s.name}</td>
                <td data-label="Learning Room">{(s.rooms ?? []).map((r) => r.name).join(", ") || "—"}</td>
                <td data-label="English">{levelCell(s, "en")}</td>
                <td data-label="Filipino">{levelCell(s, "fil")}</td>
                <td data-label="Latest Assessment">{formatDate(latestOf(s))}</td>
                <td><button type="button" onClick={() => setSelectedId(s.id)} aria-label={`View history for ${s.name}`}>View History</button></td>
              </tr>)}</tbody>
            </table>
          ) : (
            <table className="crr-table">
              <thead><tr><th scope="col">Date</th><th scope="col">Student</th><th scope="col">Assessment</th><th scope="col">Language</th>
                <th scope="col">Word Recognition</th><th scope="col">Comprehension</th><th scope="col">Reading Level</th>
                <th scope="col"><span className="diagnostic-visually-hidden">History</span></th></tr></thead>
              <tbody>{slice(resultRows).map(({ student, language: l, point }) => <tr key={`${student.id}:${point.id}`}>
                <td data-label="Date">{formatDate(point.completedAt)}</td>
                <td data-label="Student">{student.name}</td>
                <td data-label="Assessment">{assessmentName(point)}</td>
                <td data-label="Language">{LANGUAGE_NAMES[l]}</td>
                <td data-label="Word Recognition">{score(point.wordRecognitionScore)}</td>
                <td data-label="Comprehension">{score(point.comprehensionScore)}</td>
                <td data-label="Reading Level"><span className="crr-level" data-level={point.readingLevel}>{point.readingLevel}</span></td>
                <td><button type="button" onClick={() => setSelectedId(student.id)} aria-label={`View history for ${student.name}`}>View History</button></td>
              </tr>)}</tbody>
            </table>
          )}
        {pages > 1 && <nav className="crr-pages" aria-label="Pages">
          <button type="button" disabled={current <= 1} onClick={() => setPage(current - 1)}>Previous</button>
          <span>Page {current} of {pages}</span>
          <button type="button" disabled={current >= pages} onClick={() => setPage(current + 1)}>Next</button>
        </nav>}
      </>}
    </section>
  );
}

/** One Student's official history, newest first, English and Filipino separate; the change is to the previous result. */
function StudentHistory({ student, idPrefix, onBack }: { student: ProgressStudent; idPrefix: string; onBack: () => void }) {
  return (
    <section className="crr" aria-labelledby={`${idPrefix}-student`}>
      <button type="button" className="crr-back" onClick={onBack}>← Back to Student List</button>
      <h2 id={`${idPrefix}-student`}>{student.name}</h2>
      {(student.rooms ?? []).length > 0 && <p className="crr-meta">{(student.rooms ?? []).map((r) => r.name).join(", ")}</p>}
      {LANGS.map((l) => {
        const p = student.progress[l];
        const points = pointsOf(p).sort(newestFirst);
        return <section key={l} className="crr-history" aria-labelledby={`${idPrefix}-${l}`}>
          <h3 id={`${idPrefix}-${l}`}>{LANGUAGE_NAMES[l]}</h3>
          {!points.length ? <p className="crr-empty">No official {LANGUAGE_NAMES[l]} assessment yet.</p> : <>
            <p className="crr-meta">Current reading level: <strong>{p.current?.readingLevel ?? "—"}</strong>
              {p.current ? (p.current.rule === "initial" ? " (from the initial diagnostic)" : " (latest official assessment)") : ""}
              {p.placementNote ? ` · ${p.placementNote}` : ""}</p>
            <table className="crr-table">
              <thead><tr><th scope="col">Date</th><th scope="col">Assessment</th><th scope="col">Word Recognition</th>
                <th scope="col">Comprehension</th><th scope="col">Reading Level</th><th scope="col">Change</th></tr></thead>
              <tbody>{points.map((point, i) => {
                const older = points[i + 1];
                const change = !older ? "—" : RANK[point.readingLevel] > RANK[older.readingLevel] ? `Higher (from ${older.readingLevel})`
                  : RANK[point.readingLevel] < RANK[older.readingLevel] ? `Lower (from ${older.readingLevel})` : "Same";
                return <tr key={point.id}>
                  <td data-label="Date">{formatDate(point.completedAt)}</td>
                  <td data-label="Assessment">{assessmentName(point)}</td>
                  <td data-label="Word Recognition">{score(point.wordRecognitionScore)}</td>
                  <td data-label="Comprehension">{score(point.comprehensionScore)}</td>
                  <td data-label="Reading Level"><span className="crr-level" data-level={point.readingLevel}>{point.readingLevel}</span></td>
                  <td data-label="Change">{change}</td>
                </tr>;
              })}</tbody>
            </table>
          </>}
        </section>;
      })}
      <button type="button" className="crr-back" onClick={onBack}>← Back to Student List</button>
    </section>
  );
}
