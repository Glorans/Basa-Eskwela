import { useEffect, useRef, useState } from "react";
import { confirmReadFlow } from "../../../../components/ReadFlowDialog";
import { getManagedUsers, getAdminUserError, reviewTeacherRegistration, type ManagedUser } from "../../services/adminUsers";
import { getManagedUserDisplayName, isPendingTeacher } from "./userManagementFilters";

export default function PendingTeacherApprovals() {
  const [teachers, setTeachers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const mounted = useRef(false);
  const lock = useRef(false);

  async function refresh() {
    setLoading(true); setError("");
    try {
      const users = await getManagedUsers();
      if (mounted.current) setTeachers(users.filter(isPendingTeacher));
    } catch (err) { if (mounted.current) setError(getAdminUserError(err)); }
    finally { if (mounted.current) setLoading(false); }
  }
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; }; }, []);

  async function review(teacher: ManagedUser, decision: "approved" | "rejected") {
    if (lock.current || loading || !teacher.fullName.trim()) return;
    lock.current = true; setBusy(true);
    try {
      if (!await confirmReadFlow(`${decision === "approved" ? "Approve" : "Reject"} Teacher ${getManagedUserDisplayName(teacher)}?`)) return;
      if (!mounted.current) return;
      setError(""); setMessage("");
      const status = await reviewTeacherRegistration(teacher.id, decision);
      if (!mounted.current) return;
      setTeachers(rows => rows.filter(row => row.id !== teacher.id));
      setMessage(`Teacher registration ${status}.`);
    } catch (err) { if (mounted.current) setError(getAdminUserError(err)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }

  return <section aria-busy={loading || busy}>
    <header><h2>Pending Approval</h2><button type="button" disabled={loading || busy} onClick={() => void refresh()}>Refresh pending teachers</button></header>
    {error && <p role="alert" className="teacher-invitations-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {loading ? <p role="status">Loading pending teachers...</p> : error ? <p>Unable to update the pending list. Refresh to try again.</p> : teachers.length === 0 ? <p>No pending teacher applications.</p> :
      <div className="pending-teachers-list">{teachers.map(teacher => <article className="pending-teacher" key={teacher.id}>
        <h3>{getManagedUserDisplayName(teacher)}</h3>
        <dl><div><dt>Email</dt><dd>{teacher.email || "Unavailable"}</dd></div>
          <div><dt>Registered</dt><dd>{new Date(teacher.createdAt).toLocaleDateString()}</dd></div>
          <div><dt>Account status</dt><dd>{teacher.status || "Unavailable"}</dd></div>
          <div><dt>Teacher verification</dt><dd>{teacher.teacherStatus}</dd></div></dl>
        {!teacher.fullName.trim() && <p>Awaiting profile completion</p>}
        <div className="teacher-invitations-actions">
          <button type="button" disabled={busy || !teacher.fullName.trim()} onClick={() => void review(teacher, "approved")}>Approve Teacher</button>
          <button type="button" disabled={busy || !teacher.fullName.trim()} onClick={() => void review(teacher, "rejected")}>Reject Teacher</button>
        </div>
      </article>)}</div>}
  </section>;
}
