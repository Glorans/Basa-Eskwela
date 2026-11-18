import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { createSchoolAdmin, getAdminUserError } from "../../services/adminUsers";
import {
  FULL_NAME_MAX_LENGTH,
  getFullNameValidationError,
  isValidSignupEmail,
  normalizeAuthEmail,
} from "../../utils/authOnboarding";
import "../../../../pages/admin/UserManagementPage.css";
import "./CreateSchoolAdminPage.css";

// M1 F8 (System Admin only). The server re-checks the role and always creates the account as a School Admin; no
// password is chosen here. The new School Admin sets their own password from the email link.
export default function CreateSchoolAdminPage() {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [errors, setErrors] = useState<{ email?: string; fullName?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const nextErrors = {
      email: isValidSignupEmail(email) ? undefined : "Enter a valid email address.",
      fullName: getFullNameValidationError(fullName) ? "Enter the School Admin's full name (up to 100 characters)." : undefined,
    };
    setErrors(nextErrors);
    setError("");
    setSuccess("");
    if (nextErrors.email || nextErrors.fullName) return;

    setSubmitting(true);
    try {
      const result = await createSchoolAdmin({ email: normalizeAuthEmail(email), fullName: fullName.trim() });
      setSuccess(result.message);
      setEmail("");
      setFullName("");
    } catch (createError) {
      setError(getAdminUserError(createError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="admin-users-page create-school-admin-page">
      <Link to="/system-admin/users?section=school">Back to School Accounts</Link>
      <header className="admin-users-header">
        <div>
          <h1>Create School Admin</h1>
          <p>The new School Admin receives an email to set their own password. School Admins manage Teacher and Student accounts.</p>
        </div>
      </header>

      {error && <p className="admin-users-message admin-users-message--error" role="alert">{error}</p>}
      {success && (
        <p className="admin-users-message admin-users-message--success" role="status">
          {success} <Link to="/system-admin/users?section=school">View in School Accounts</Link>
        </p>
      )}

      <form className="create-school-admin-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <label>
          <span>Full name</span>
          <input
            type="text"
            autoComplete="off"
            maxLength={FULL_NAME_MAX_LENGTH}
            value={fullName}
            aria-invalid={Boolean(errors.fullName)}
            aria-describedby={errors.fullName ? "schoolAdminNameError" : undefined}
            onChange={(event) => setFullName(event.target.value)}
            disabled={submitting}
          />
          {errors.fullName && <small id="schoolAdminNameError" role="alert">{errors.fullName}</small>}
        </label>
        <label>
          <span>Email address</span>
          <input
            type="email"
            autoComplete="off"
            value={email}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "schoolAdminEmailError" : undefined}
            onChange={(event) => setEmail(event.target.value)}
            disabled={submitting}
          />
          {errors.email && <small id="schoolAdminEmailError" role="alert">{errors.email}</small>}
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create School Admin"}
        </button>
      </form>
    </section>
  );
}
