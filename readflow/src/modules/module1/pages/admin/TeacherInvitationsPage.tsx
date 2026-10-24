import PendingTeacherApprovals from "./PendingTeacherApprovals";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { confirmReadFlow } from "../../../../components/ReadFlowDialog";
import { createTeacherInvitation, invitationError, listTeacherInvitations, revokeTeacherInvitation, type TeacherInvitation } from "../../services/teacherInvitations";
import "./TeacherInvitationsPage.css";

function defaultExpiry() {
  const date = new Date(Date.now() + 7 * 86400000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export default function TeacherInvitationsPage() {
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get("tab") === "pending" ? "pending" : "invitations");
  const [invitations, setInvitations] = useState<TeacherInvitation[]>([]);
  const [expires, setExpires] = useState(defaultExpiry);
  const [maxUses, setMaxUses] = useState("1");
  const [revealed, setRevealed] = useState<{ id: string; code: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshRequired, setRefreshRequired] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const mounted = useRef(false);
  const revealHeading = useRef<HTMLHeadingElement>(null);

  async function refresh() {
    setLoading(true); setError("");
    try {
      const rows = await listTeacherInvitations();
      if (mounted.current) { setInvitations(rows); setRefreshRequired(false); }
    } catch (err) { if (mounted.current) { setError(invitationError(err)); setRefreshRequired(true); } }
    finally { if (mounted.current) setLoading(false); }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const clearSecret = () => setRevealed(null);
    window.addEventListener("pagehide", clearSecret);
    return () => { mounted.current = false; window.removeEventListener("pagehide", clearSecret); };
  }, []);
  useEffect(() => { if (revealed) revealHeading.current?.focus(); }, [revealed]);

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (lock.current || revealed || refreshRequired || loading) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const result = await createTeacherInvitation(new Date(expires).toISOString(), Number(maxUses));
      if (!mounted.current) return;
      setInvitations(rows => [result.invitation, ...rows]);
      setRevealed({ id: result.invitation.id, code: result.code });
    } catch (err) {
      if (mounted.current) { setError(invitationError(err)); setRefreshRequired(true); }
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function revoke(invitation: TeacherInvitation) {
    if (lock.current) return;
    lock.current = true;
    try {
      if (!await confirmReadFlow("Revoke this invitation? It will no longer allow new teacher registrations. Existing teachers are unchanged.")) return;
      setBusy(true); setError(""); setMessage("");
      const saved = await revokeTeacherInvitation(invitation.id);
      if (!mounted.current) return;
      setInvitations(rows => rows.map(row => row.id === saved.id ? saved : row));
      setRevealed(value => value?.id === saved.id ? null : value);
      setMessage("Invitation revoked.");
    } catch (err) { if (mounted.current) setError(invitationError(err)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function copyCode() {
    if (!revealed) return;
    try { await navigator.clipboard.writeText(revealed.code); setMessage("Code copied. Share it privately with the intended teacher."); }
    catch { setMessage("Copy was unavailable. Select the code and copy it manually before dismissing this panel."); }
  }
  return <main className="teacher-invitations" aria-busy={busy || loading}>
    <header><div><p className="teacher-invitations-eyebrow">Admin Dashboard</p><h1>Teacher Invitations</h1>
      </div>
      {tab === "invitations" && <button type="button" onClick={() => void refresh()} disabled={busy || loading}>Refresh list</button>}</header>
    <div role="tablist" aria-label="Teacher management" className="teacher-invitations-tabs">
      {(["invitations", "pending"] as const).map((value, index) => <button key={value} type="button" role="tab"
        id={`teacher-tab-${value}`} aria-controls={`teacher-panel-${value}`} aria-selected={tab === value}
        tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? "invitations" : event.key === "End" ? "pending" : index === 0 ? "pending" : "invitations";
          setTab(next); document.getElementById(`teacher-tab-${next}`)?.focus();
        }}>{value === "invitations" ? "Invitations" : "Pending Approval"}</button>)}
    </div>
    <div role="tabpanel" id="teacher-panel-pending" aria-labelledby="teacher-tab-pending" hidden={tab !== "pending"}>
      {tab === "pending" && <PendingTeacherApprovals />}
    </div>
    <div role="tabpanel" id="teacher-panel-invitations" aria-labelledby="teacher-tab-invitations" hidden={tab !== "invitations"}>
    {error && <p className="teacher-invitations-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {revealed && <section className="teacher-invitations-reveal" aria-labelledby="invitation-code-title">
      <h2 id="invitation-code-title" ref={revealHeading} tabIndex={-1}>Copy your new invitation now</h2>
      <p>This is the only time this code will be shown. Copy it before dismissing or leaving this page. It cannot be retrieved later.</p>
      <code>{revealed.code}</code>
      <div className="teacher-invitations-actions"><button type="button" onClick={() => void copyCode()}>Copy Code</button>
        <button type="button" onClick={() => { setRevealed(null); setMessage(""); }}>Dismiss code</button></div>
    </section>}
    <form onSubmit={generate}>
      <h2>Generate invitation</h2>
      <div className="teacher-invitations-fields">
        <label>Expiration date and time (your local time)<input type="datetime-local" required value={expires} onChange={event => setExpires(event.target.value)} disabled={busy || !!revealed} /></label>
        <label>Maximum uses<input type="number" min="1" max="2147483647" step="1" required value={maxUses} onChange={event => setMaxUses(event.target.value)} disabled={busy || !!revealed} /></label>
      </div>
      <button type="submit" disabled={busy || loading || !!revealed || refreshRequired}>{busy ? "Please wait..." : "Generate invitation"}</button>
      {refreshRequired && !loading && <p>Refresh the list before generating another invitation. Revoke any code you did not receive.</p>}
    </form>
    <section><h2>Existing invitations</h2>
      {loading ? <p role="status">Loading invitations...</p> : invitations.length === 0 ? <p>No invitations to display.</p> :
        <div className="teacher-invitations-table"><table><thead><tr><th>Invitation ID</th><th>Created</th><th>Expires</th><th>Uses</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{invitations.map(invitation => <tr key={invitation.id}>
            <td data-label="Invitation ID">{invitation.id}</td><td data-label="Created">{new Date(invitation.createdAt).toLocaleString()}</td>
            <td data-label="Expires">{invitation.expiresAt ? new Date(invitation.expiresAt).toLocaleString() : "No expiration"}</td>
            <td data-label="Uses">{invitation.useCount} / {invitation.maxUses ?? "Unlimited"}</td><td data-label="Status">{invitation.status}</td>
            <td data-label="Action">{invitation.active ? <button type="button" disabled={busy || loading} onClick={() => void revoke(invitation)} aria-label={`Revoke invitation ${invitation.id}`}>Revoke</button> : "Revoked"}</td>
          </tr>)}</tbody></table></div>}
    </section>
    </div>
  </main>;
}
