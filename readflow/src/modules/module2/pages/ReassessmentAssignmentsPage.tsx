import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReassessmentRequestError,
  cancelReassessmentAssignment,
  createReassessmentAssignments,
  formatManilaDate,
  getAssignablePackages,
  getAssignmentOverview,
  getRoomRoster,
  listReassessmentAssignments,
  manilaToday,
  type AssignablePackage,
  type AssignmentRoom,
  type AssignmentStatus,
  type IneligibleStudent,
  type ReassessmentAssignment,
  type RosterStudent,
} from "../services/reassessments";
import "../../module7/m7.css";
import "./AssessmentPackages.css";
import AssessmentBackButton from "../components/AssessmentBackButton";
import { getRoleHomePath } from "../../module1/utils/authOnboarding";

const LANGUAGE = { en: "English", fil: "Filipino" } as const;
/** The server's explanation when there is one, otherwise a plain fallback. */
const messageOf = (error: unknown, fallback: string) =>
  (typeof (error as { message?: unknown })?.message === "string" && (error as { message: string }).message) || fallback;
const STATUS = { active: "Active", completed: "Completed", cancelled: "Cancelled" } as const;

/** M2 F9 Assign Reassessment for approved Teachers (own rooms, own packages) and School Admins (single-school pilot). */
export default function ReassessmentAssignmentsPage({ role }: { role: "admin" | "teacher" }) {
  const [enabled, setEnabled] = useState(false);
  const [rooms, setRooms] = useState<AssignmentRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [roomId, setRoomId] = useState("");
  const [packages, setPackages] = useState<AssignablePackage[]>([]);
  const [versionId, setVersionId] = useState("");
  const [roster, setRoster] = useState<RosterStudent[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"selected" | "all_eligible">("selected");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState<{ message: string; ineligible: IneligibleStudent[] } | null>(null);
  const [assignments, setAssignments] = useState<ReassessmentAssignment[]>([]);
  const [statusFilter, setStatusFilter] = useState<AssignmentStatus | "">("");
  const [cancelling, setCancelling] = useState<{ id: string; reason: string } | null>(null);
  const [tableError, setTableError] = useState("");

  const loadAssignments = useCallback(async (status: AssignmentStatus | "") => {
    setTableError("");
    try {
      setAssignments((await listReassessmentAssignments(status || undefined)).assignments);
    } catch (error) {
      setTableError(messageOf(error, "Unable to load assignments."));
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const overview = await getAssignmentOverview();
      setEnabled(overview.enabled);
      setRooms(overview.rooms);
      setPackages(overview.packages);
      await loadAssignments("");
    } catch (error) {
      setLoadError(messageOf(error, "Unable to load reassessment assignments."));
    } finally {
      setLoading(false);
    }
  }, [loadAssignments]);
  useEffect(() => { void load(); }, [load]);

  const refreshRoster = useCallback(async (room: string, version: string) => {
    if (!room) { setRoster(null); return; }
    try {
      setRoster((await getRoomRoster(room, version || undefined)).students);
    } catch (error) {
      setFormError({ message: messageOf(error, "Unable to load the Students."), ineligible: [] });
    }
  }, []);

  const chooseRoom = async (room: string) => {
    setRoomId(room); setVersionId(""); setSelected([]); setNotice(""); setFormError(null);
    if (!room) { setRoster(null); return; }
    try {
      setPackages((await getAssignablePackages(room)).packages);
    } catch (error) {
      setFormError({ message: messageOf(error, "Unable to load packages."), ineligible: [] });
    }
    await refreshRoster(room, "");
  };
  const choosePackage = async (version: string) => {
    setVersionId(version); setSelected([]); setNotice(""); setFormError(null);
    await refreshRoster(roomId, version);
  };

  const pkg = packages.find((p) => p.versionId === versionId) ?? null;
  const eligibleStudents = useMemo(() => (roster ?? []).filter((s) => !s.reason), [roster]);
  const unavailable = packages.filter((p) => !p.eligible);
  const count = mode === "all_eligible" ? eligibleStudents.length : selected.length;
  const canAssign = enabled && !busy && Boolean(roomId && pkg?.eligible) && count > 0;

  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  const assign = async () => {
    if (!canAssign || !pkg?.versionId) return;
    setBusy(true); setNotice(""); setFormError(null);
    try {
      const result = await createReassessmentAssignments({
        roomId, packageVersionId: pkg.versionId, mode, ...(mode === "selected" ? { studentIds: selected } : {}),
        ...(dueDate ? { dueDate } : {}),
      });
      const skipped = result.skipped.length ? ` ${result.skipped.length} Student${result.skipped.length === 1 ? " was" : "s were"} not eligible and not assigned.` : "";
      setNotice(`Assigned "${pkg.title}" to ${result.created} Student${result.created === 1 ? "" : "s"}.${skipped}`);
      setSelected([]);
      await Promise.all([refreshRoster(roomId, pkg.versionId), loadAssignments(statusFilter)]);
    } catch (error) {
      setFormError({
        message: messageOf(error, "Unable to assign the reassessment."),
        ineligible: error instanceof ReassessmentRequestError ? error.ineligible : [],
      });
      await refreshRoster(roomId, pkg.versionId);
    } finally {
      setBusy(false);
    }
  };

  const confirmCancel = async () => {
    if (!cancelling || !cancelling.reason.trim() || busy) return;
    setBusy(true); setTableError("");
    try {
      await cancelReassessmentAssignment(cancelling.id, cancelling.reason.trim());
      setCancelling(null);
      await Promise.all([loadAssignments(statusFilter), refreshRoster(roomId, versionId)]);
    } catch (error) {
      setTableError(messageOf(error, "Unable to cancel the assignment."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="m7-page m2-packages-page">
      <AssessmentBackButton fallback={getRoleHomePath(role)} />
      <h1>Reassessment Assignments</h1>
      <p className="m2-packages-intro">
        {role === "teacher"
          ? "Assign your published reassessment packages to Students in your active Learning Rooms."
          : "Assign school reassessment packages to Students in active Learning Rooms."}
      </p>
      {!loading && !loadError && !enabled && (
        <p className="m2-packages-notice" role="note">
          Official reassessment is not enabled yet. You can review rooms and packages, but assignments cannot be created
          until it is switched on in a separate, approved step. Students cannot take reassessments yet.
        </p>
      )}
      {loading && <p role="status">Loading reassessment assignments...</p>}
      {loadError && (
        <div role="alert">
          <p>{loadError}</p>
          <button type="button" onClick={() => void load()}>Try Again</button>
        </div>
      )}

      {!loading && !loadError && (
        <>
          <section className="m2-packages-panel" aria-labelledby="f9-assign">
            <h2 id="f9-assign">Assign a Reassessment</h2>
            {rooms.length === 0 ? (
              <p className="m2-packages-empty">{role === "teacher" ? "You have no active Learning Rooms." : "There are no active Learning Rooms."}</p>
            ) : (
              <div className="m2-packages-form">
                <label>
                  <span>Learning Room</span>
                  <select value={roomId} onChange={(event) => void chooseRoom(event.target.value)}>
                    <option value="">Choose a Learning Room</option>
                    {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}{r.teacherName ? ` (${r.teacherName})` : ""}</option>)}
                  </select>
                </label>
                {roomId && (
                  <label>
                    <span>Package</span>
                    <select value={versionId} onChange={(event) => void choosePackage(event.target.value)}>
                      <option value="">Choose a package</option>
                      {packages.filter((p) => p.eligible && p.versionId).map((p) => (
                        <option key={p.versionId!} value={p.versionId!}>
                          {p.title} · {LANGUAGE[p.language]} · Version {p.versionLabel}{p.ownerName ? ` · ${p.ownerName}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {roomId && packages.length === 0 && (
                  <p className="m2-packages-empty">
                    {role === "teacher" ? "You have no reassessment packages yet. Create one under Reassessment Packages." : "There are no classroom reassessment packages yet."}
                  </p>
                )}
                {roomId && unavailable.length > 0 && (
                  <details className="m2-packages-unavailable">
                    <summary>{unavailable.length} package{unavailable.length === 1 ? "" : "s"} not available</summary>
                    <ul>{unavailable.map((p) => <li key={p.packageId}>{p.title}: {p.reason}</li>)}</ul>
                  </details>
                )}

                {roster && pkg && (
                  <fieldset className="m2-f9-students">
                    <legend>Students currently enrolled ({roster.length})</legend>
                    <div className="m2-f9-modes" role="radiogroup" aria-label="Who to assign">
                      <label className="m2-f9-choice">
                        <input type="radio" name="f9-mode" checked={mode === "selected"} onChange={() => setMode("selected")} />
                        <span>Selected Students</span>
                      </label>
                      <label className="m2-f9-choice">
                        <input type="radio" name="f9-mode" checked={mode === "all_eligible"} onChange={() => setMode("all_eligible")} />
                        <span>All eligible Students enrolled now ({eligibleStudents.length})</span>
                      </label>
                    </div>
                    {roster.length === 0 ? <p className="m2-packages-empty">No Students are enrolled in this room.</p> : (
                      <ul className="m2-f9-roster">
                        {roster.map((s) => (
                          <li key={s.id} data-ineligible={s.reason ? "true" : undefined}>
                            <label className="m2-f9-choice">
                              <input type="checkbox" disabled={mode === "all_eligible" || Boolean(s.reason)}
                                aria-describedby={s.reason ? `f9-reason-${s.id}` : undefined}
                                checked={mode === "all_eligible" ? !s.reason : selected.includes(s.id)} onChange={() => toggle(s.id)} />
                              <span className="m2-f9-name">{s.name}</span>
                            </label>
                            {s.reason && <span id={`f9-reason-${s.id}`} className="m2-f9-reason">{s.reason}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="m2-packages-meta">Students who join the room later are not assigned automatically.</p>
                  </fieldset>
                )}

                {pkg && (
                  <label>
                    <span>Due date (optional)</span>
                    <input type="date" min={manilaToday()} value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
                  </label>
                )}
                {pkg && (
                  <div className="m2-packages-actions">
                    <button type="button" disabled={!canAssign} onClick={() => void assign()}>
                      Assign to {count} Student{count === 1 ? "" : "s"}
                    </button>
                  </div>
                )}
              </div>
            )}
            {notice && <p role="status" className="m2-f9-success">{notice}</p>}
            {formError && (
              <div role="alert" className="m2-packages-error">
                <p>{formError.message}</p>
                {formError.ineligible.length > 0 && (
                  <ul>{formError.ineligible.map((s) => <li key={s.studentId}>{s.name ?? "A selected Student"}: {s.reason}</li>)}</ul>
                )}
              </div>
            )}
          </section>

          <section aria-labelledby="f9-list">
            <div className="m2-f9-list-head">
              <h2 id="f9-list">Existing Assignments</h2>
              <label>
                <span>Status</span>
                <select value={statusFilter} onChange={(event) => {
                  const next = event.target.value as AssignmentStatus | "";
                  setStatusFilter(next);
                  void loadAssignments(next);
                }}>
                  <option value="">All</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
            </div>
            {tableError && <p role="alert" className="m2-packages-error">{tableError}</p>}
            {assignments.length === 0 ? <p className="m2-packages-empty">No assignments yet.</p> : (
              <div className="m2-packages-table-wrap">
                <table className="m2-packages-table m2-f9-table">
                  <thead>
                    <tr>
                      <th scope="col">Student</th>
                      <th scope="col">Package</th>
                      <th scope="col">Learning Room</th>
                      <th scope="col">Assigned</th>
                      <th scope="col">Due</th>
                      <th scope="col">Status</th>
                      <th scope="col"><span className="m2-f9-sr">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map((a) => (
                      <tr key={a.id}>
                        <td data-label="Student">{a.studentName}</td>
                        <td data-label="Package">{a.packageTitle} · {LANGUAGE[a.language]}{a.versionLabel ? ` · Version ${a.versionLabel}` : ""}</td>
                        <td data-label="Learning Room">{a.roomName}</td>
                        <td data-label="Assigned">{formatManilaDate(a.assignedAt)}<span className="m2-packages-meta"> by {a.assignedBy}</span></td>
                        <td data-label="Due">{a.dueAt ? formatManilaDate(a.dueAt) : "None"}</td>
                        <td data-label="Status">
                          <span className="m2-packages-status" data-status={a.status === "active" ? "approved" : a.status === "completed" ? "published" : "retired"}>
                            {STATUS[a.status]}
                          </span>
                          {a.status === "cancelled" && a.cancelReason && (
                            <span className="m2-packages-meta"> {a.cancelReason} ({a.cancelledBy}, {formatManilaDate(a.cancelledAt)})</span>
                          )}
                          {a.status === "completed" && <span className="m2-packages-meta"> {formatManilaDate(a.completedAt)}</span>}
                        </td>
                        <td>
                          {a.status === "active" && (cancelling?.id === a.id ? (
                            <div className="m2-packages-inline">
                              <label><span>Reason</span>
                                <input value={cancelling.reason} maxLength={500} onChange={(event) => setCancelling({ id: a.id, reason: event.target.value })} />
                              </label>
                              <button type="button" className="m2-packages-danger" disabled={busy || !cancelling.reason.trim()}
                                onClick={() => void confirmCancel()}>Confirm Cancel</button>
                              <button type="button" onClick={() => setCancelling(null)}>Keep</button>
                            </div>
                          ) : (
                            <button type="button" disabled={busy} onClick={() => setCancelling({ id: a.id, reason: "" })}>Cancel</button>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
