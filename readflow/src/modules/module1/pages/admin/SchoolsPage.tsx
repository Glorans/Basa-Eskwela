import { useEffect, useState, type FormEvent } from "react";
import { confirmReadFlow } from "../../../../components/ReadFlowDialog";
import { getAdminUserError } from "../../services/adminUsers";
import {
  createSchool,
  listSchools,
  normalizeSchoolCode,
  normalizeSchoolName,
  SCHOOL_CODE_PATTERN,
  updateSchool,
  type School,
} from "../../services/schools";
import "../../../../pages/admin/UserManagementPage.css";
import "./CreateSchoolAdminPage.css";

type FieldErrors = Partial<Record<"name" | "code", string>>;

// M1 F8 Create School (System Admin only): name, unique code and status, and the list of schools. Schools are never
// deleted; an inactive school keeps every account and record but accepts no new School Admins, Teachers or Students.
// The server and the database re-check everything shown here.
export default function SchoolsPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<School["status"]>("active");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [pendingId, setPendingId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      setSchools(await listSchools());
    } catch (loadError) {
      setError(getAdminUserError(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const cleanName = normalizeSchoolName(name), cleanCode = normalizeSchoolCode(code);
    const nextErrors: FieldErrors = {
      name: cleanName.length >= 2 && cleanName.length <= 120 ? undefined : "Enter the school name (2 to 120 characters).",
      code: SCHOOL_CODE_PATTERN.test(cleanCode) ? undefined : "Use 2 to 32 letters, numbers or hyphens (for example SCHOOL-2).",
    };
    setErrors(nextErrors);
    setError(""); setSuccess("");
    if (Object.values(nextErrors).some(Boolean)) return;
    setSubmitting(true);
    try {
      await createSchool({ name: cleanName, code: cleanCode, status });
      setName(""); setCode(""); setStatus("active");
      setSuccess(`School created: ${cleanName} (${cleanCode}).`);
      await refresh();
    } catch (createError) {
      setError(getAdminUserError(createError));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleStatus(school: School) {
    const next = school.status === "active" ? "inactive" : "active";
    const confirmed = await confirmReadFlow(next === "inactive"
      ? `Deactivate ${school.name}? Its accounts and records are kept, but it will accept no new School Admins, Teachers or Students until it is reactivated.`
      : `Reactivate ${school.name}?`);
    if (!confirmed) return;
    setPendingId(school.id); setError(""); setSuccess("");
    try {
      await updateSchool(school.id, { status: next });
      setSuccess(next === "inactive" ? `${school.name} is now inactive.` : `${school.name} is active again.`);
      await refresh();
    } catch (updateError) {
      setError(getAdminUserError(updateError));
    } finally {
      setPendingId("");
    }
  }

  const fieldError = (key: keyof FieldErrors) => errors[key] && <small id={`school-${key}-error`} role="alert">{errors[key]}</small>;

  return (
    <section className="admin-users-page create-school-admin-page">
      <header className="admin-users-header">
        <div>
          <h1>Schools</h1>
          <p>Create a school, then invite its School Admin from User Management. Each school's records are visible only to that school.</p>
        </div>
      </header>

      {error && <p className="admin-users-message admin-users-message--error" role="alert">{error}</p>}
      {success && <p className="admin-users-message admin-users-message--success" role="status">{success}</p>}

      <form className="create-school-admin-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <fieldset>
          <legend>Create School</legend>
          <label>
            <span>School name</span>
            <input type="text" autoComplete="off" maxLength={120} value={name} onChange={(event) => setName(event.target.value)}
              aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "school-name-error" : undefined} disabled={submitting} />
            {fieldError("name")}
          </label>
          <label>
            <span>School code (unique identifier)</span>
            <input type="text" autoComplete="off" maxLength={32} placeholder="For example: SCHOOL-2" value={code}
              onChange={(event) => setCode(event.target.value)}
              aria-invalid={Boolean(errors.code)} aria-describedby={errors.code ? "school-code-error" : undefined} disabled={submitting} />
            {fieldError("code")}
          </label>
          <label>
            <span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as School["status"])} disabled={submitting}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </fieldset>
        <button type="submit" disabled={submitting}>{submitting ? "Creating school…" : "Create School"}</button>
      </form>

      <div className="admin-users-table-wrap">
        <table className="admin-users-table">
          <thead>
            <tr>
              <th>School</th>
              <th>Code</th>
              <th>Status</th>
              <th>School Admins</th>
              <th>Teachers</th>
              <th>Students</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td className="admin-users-empty" colSpan={7}>Loading schools…</td></tr>}
            {!loading && schools.length === 0 && <tr><td className="admin-users-empty" colSpan={7}>No schools yet.</td></tr>}
            {!loading && schools.map((school) => (
              <tr key={school.id}>
                <td>{school.name}{school.isLegacy ? " (existing school)" : ""}</td>
                <td>{school.code}</td>
                <td>{school.status === "active" ? "Active" : "Inactive"}</td>
                <td>{school.schoolAdmins}</td>
                <td>{school.teachers}</td>
                <td>{school.students}</td>
                <td>
                  <button type="button" disabled={pendingId === school.id} onClick={() => void toggleStatus(school)}>
                    {school.status === "active" ? "Deactivate" : "Reactivate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
