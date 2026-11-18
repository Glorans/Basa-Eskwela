import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { CONFIRMATION_METHODS, createSchoolAdmin, getAdminUserError } from "../../services/adminUsers";
import {
  FULL_NAME_MAX_LENGTH,
  getFullNameValidationError,
  isValidSignupEmail,
  normalizeAuthEmail,
} from "../../utils/authOnboarding";
import "../../../../pages/admin/UserManagementPage.css";
import "./CreateSchoolAdminPage.css";

type FieldErrors = Partial<Record<"email" | "fullName" | "reference" | "confirmationMethod" | "authorizingPosition" | "note", string>>;

// M1 F8 (System Admin only). The System Admin records the authorization decision and sends an invitation. The
// account gets NO School Admin access until the invitee accepts (enforced on the server and in the database).
// The server re-checks the role; no password and no role is chosen here.
export default function CreateSchoolAdminPage() {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [reference, setReference] = useState("");
  const [confirmationMethod, setConfirmationMethod] = useState("");
  const [authorizingPosition, setAuthorizingPosition] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const ref = reference.trim(), position = authorizingPosition.trim();
    const nextErrors: FieldErrors = {
      email: isValidSignupEmail(email) ? undefined : "Enter a valid email address.",
      fullName: getFullNameValidationError(fullName) ? "Enter the School Admin's full name (up to 100 characters)." : undefined,
      reference: ref.length >= 5 && ref.length <= 300 ? undefined : "Enter the authorization reference (5 to 300 characters).",
      confirmationMethod: confirmationMethod ? undefined : "Choose how you confirmed the request.",
      authorizingPosition: position.length >= 2 && position.length <= 100 ? undefined : "Enter the position of the person who authorized it.",
      note: note.trim().length <= 500 ? undefined : "The note can be at most 500 characters.",
    };
    setErrors(nextErrors);
    setError("");
    setSuccess("");
    if (Object.values(nextErrors).some(Boolean)) return;

    setSubmitting(true);
    try {
      const result = await createSchoolAdmin({
        email: normalizeAuthEmail(email),
        fullName: fullName.trim(),
        authorization: { reference: ref, confirmationMethod, authorizingPosition: position, note: note.trim() || undefined },
      });
      setSuccess(result.message);
      setEmail(""); setFullName(""); setReference(""); setConfirmationMethod(""); setAuthorizingPosition(""); setNote("");
    } catch (createError) {
      setError(getAdminUserError(createError));
    } finally {
      setSubmitting(false);
    }
  }

  const field = (name: keyof FieldErrors) => ({
    "aria-invalid": Boolean(errors[name]),
    "aria-describedby": errors[name] ? `schoolAdmin-${name}-error` : undefined,
    disabled: submitting,
  });
  const fieldError = (name: keyof FieldErrors) => errors[name] && <small id={`schoolAdmin-${name}-error`} role="alert">{errors[name]}</small>;

  return (
    <section className="admin-users-page create-school-admin-page">
      <Link to="/system-admin/users?section=school">Back to School Accounts</Link>
      <header className="admin-users-header">
        <div>
          <h1>Create School Admin</h1>
          <p>
            Record your authorization decision, then send an invitation. The account gets School Admin access only after the
            invitee opens the setup link from their email and sets a password. The invitation stays open for 7 days; each
            emailed link may expire sooner, in which case you can resend it from School Accounts.
          </p>
        </div>
      </header>

      {error && <p className="admin-users-message admin-users-message--error" role="alert">{error}</p>}
      {success && (
        <p className="admin-users-message admin-users-message--success" role="status">
          {success} <Link to="/system-admin/users?section=school">View in School Accounts</Link>
        </p>
      )}

      <form className="create-school-admin-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <fieldset>
          <legend>Invitee</legend>
          <label>
            <span>Full name</span>
            <input type="text" autoComplete="off" maxLength={FULL_NAME_MAX_LENGTH} value={fullName}
              onChange={(event) => setFullName(event.target.value)} {...field("fullName")} />
            {fieldError("fullName")}
          </label>
          <label>
            <span>Email address</span>
            <input type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} {...field("email")} />
            {fieldError("email")}
          </label>
        </fieldset>

        <fieldset>
          <legend>Authorization record</legend>
          <p className="create-school-admin-hint">
            Before inviting, confirm the request with the school through a channel you look up yourself (for example the
            school&apos;s official phone number), not a contact supplied in the request. What you enter here is your recorded
            decision. It is not proof of identity or school affiliation, and no documents are collected.
          </p>
          <label>
            <span>Position of the person who authorized the request</span>
            <input type="text" autoComplete="off" maxLength={100} placeholder="For example: School Principal" value={authorizingPosition}
              onChange={(event) => setAuthorizingPosition(event.target.value)} {...field("authorizingPosition")} />
            {fieldError("authorizingPosition")}
          </label>
          <label>
            <span>How you confirmed the request</span>
            <select value={confirmationMethod} onChange={(event) => setConfirmationMethod(event.target.value)} {...field("confirmationMethod")}>
              <option value="">Choose a method</option>
              {CONFIRMATION_METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            {fieldError("confirmationMethod")}
          </label>
          <label>
            <span>Authorization reference</span>
            <input type="text" autoComplete="off" maxLength={300} placeholder="For example: request letter dated 18 Nov 2026" value={reference}
              onChange={(event) => setReference(event.target.value)} {...field("reference")} />
            {fieldError("reference")}
          </label>
          <label>
            <span>Note (optional)</span>
            <textarea maxLength={500} rows={3} value={note} onChange={(event) => setNote(event.target.value)} {...field("note")} />
            {fieldError("note")}
          </label>
        </fieldset>

        <button type="submit" disabled={submitting}>
          {submitting ? "Sending invitation…" : "Record authorization and send invitation"}
        </button>
      </form>
    </section>
  );
}
