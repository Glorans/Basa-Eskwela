import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { showReadFlowDialog } from "../../../../components/ReadFlowDialog";
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

const SCHOOL_ACCOUNTS_PATH = "/system-admin/users?section=school";
const INVITATION_SENT_TITLE = "Invitation sent";
const INVITATION_SENT_MESSAGE = "The authorization was recorded and the invitation has been sent. The account will receive School Admin access only after the invitee accepts the invitation.";

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
  const navigate = useNavigate();
  // Set from the first submit until the success modal closes: blocks a second send even within the same tick.
  const busy = useRef(false);
  const fullNameInput = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || busy.current) return;
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
    if (Object.values(nextErrors).some(Boolean)) return;

    busy.current = true;
    setSubmitting(true);
    let sent = false;
    try {
      await createSchoolAdmin({
        email: normalizeAuthEmail(email),
        fullName: fullName.trim(),
        authorization: { reference: ref, confirmationMethod, authorizingPosition: position, note: note.trim() || undefined },
      });
      sent = true;
      setEmail(""); setFullName(""); setReference(""); setConfirmationMethod(""); setAuthorizingPosition(""); setNote("");
    } catch (createError) {
      setError(getAdminUserError(createError));
    } finally {
      setSubmitting(false);
    }
    if (!sent) { busy.current = false; return; }
    // Centered modal (shared native <dialog>: focus moves in, the page behind is inert, Escape = Close).
    let viewAccounts = false;
    try {
      viewAccounts = await showReadFlowDialog(INVITATION_SENT_MESSAGE, "confirmation",
        { title: INVITATION_SENT_TITLE, confirm: "View School Accounts", cancel: "Close" });
    } finally {
      busy.current = false;
    }
    if (viewAccounts) navigate(SCHOOL_ACCOUNTS_PATH);
    else fullNameInput.current?.focus(); // Close or Escape: ready for the next invitation.
  }

  const field = (name: keyof FieldErrors) => ({
    "aria-invalid": Boolean(errors[name]),
    "aria-describedby": errors[name] ? `schoolAdmin-${name}-error` : undefined,
    disabled: submitting,
  });
  const fieldError = (name: keyof FieldErrors) => errors[name] && <small id={`schoolAdmin-${name}-error`} role="alert">{errors[name]}</small>;

  return (
    <section className="admin-users-page create-school-admin-page">
      <Link to={SCHOOL_ACCOUNTS_PATH}>Back to School Accounts</Link>
      <header className="admin-users-header">
        <div>
          <h1>Create School Admin</h1>
          <p>
            The new School Admin will receive an email to set up their account. Access will be granted only after the
            invitation is accepted.
          </p>
        </div>
      </header>

      {error && <p className="admin-users-message admin-users-message--error" role="alert">{error}</p>}

      <form className="create-school-admin-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <fieldset>
          <legend>Invitee</legend>
          <label>
            <span>Full name</span>
            <input ref={fullNameInput} type="text" autoComplete="off" maxLength={FULL_NAME_MAX_LENGTH} value={fullName}
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
            Record the basis for approving this School Admin invitation. This is an internal record of the System Admin’s
            decision. The invitee will receive School Admin access only after accepting the invitation.
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
