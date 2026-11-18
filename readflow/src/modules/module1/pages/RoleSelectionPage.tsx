import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, GraduationCap, Presentation } from "lucide-react";
import { useAuth } from "../../../auth/useAuth";
import AuthFormError from "../components/AuthFormError";
import RoleOption from "../components/RoleOption";
import TextField from "../components/TextField";
import {
  assignOwnRoleOnce,
  getPostAuthenticationPath,
} from "../services/authProfile";
import type { AssignableUserRole } from "../utils/authOnboarding";
import { getOwnSchoolAdminInvitation, isInvitedSchoolAdmin, type OwnInvitationState } from "../services/accountInvitation";
import "./RoleSelectionPage.css";

const roles = [
  {
    value: "student",
    title: "Student",
    description:
      "Learn through reading activities, assessments, and guided practice.",
    icon: GraduationCap,
  },
  {
    value: "teacher",
    title: "Teacher",
    description:
      "Manage reading activities and support your students' progress.",
    icon: Presentation,
  },
  {
    value: "general_user",
    title: "Independent Learner",
    description: "Practice reading and improve your skills at your own pace.",
    icon: BookOpen,
  },
] as const;

type Role = (typeof roles)[number]["value"] & AssignableUserRole;

export default function RoleSelectionPage() {
  const navigate = useNavigate();
  const { user, profile, loading: authLoading, profileError, refreshProfile } = useAuth();
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  // M1 F8: an invited School Admin who has not accepted has no role. The database refuses any self-selected role for
  // an invited account, so these screens only guide; they never grant access. Ordinary accounts make no request.
  const [confirmedInvitation, setConfirmedInvitation] = useState<OwnInvitationState | null>(null);
  const [statusCheck, setStatusCheck] = useState<"idle" | "checking" | "failed">("idle");
  const showInvitation = isInvitedSchoolAdmin(user) || (confirmedInvitation !== null && confirmedInvitation !== "none" && confirmedInvitation !== "accepted");

  async function checkInvitationStatus() {
    setStatusCheck("checking");
    try {
      setConfirmedInvitation(await getOwnSchoolAdminInvitation());
      setStatusCheck("idle");
    } catch {
      setStatusCheck("failed"); // a failed or timed-out check proves nothing and changes nothing
    }
  }

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    async function checkExistingRole() {
      try {
        if (profileError || !profile) {
          throw new Error("Profile unavailable");
        }

        const destination = await getPostAuthenticationPath(profile);
        if (destination !== "/select-role") {
          navigate(destination, { replace: true });
        }
      } catch {
        if (!cancelled) {
          setError("We couldn't check your account. Please try again.");
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    void checkExistingRole();

    return () => {
      cancelled = true;
    };
  }, [authLoading, navigate, profile, profileError]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedRole) return;

    setError("");
    setSaving(true);

    try {
      await assignOwnRoleOnce(selectedRole, inviteCode);
      const assignedProfile = await refreshProfile();
      if (!assignedProfile || assignedProfile.role === null) {
        throw new Error("Assigned profile unavailable");
      }
      navigate(await getPostAuthenticationPath(assignedProfile), { replace: true });
    } catch (assignmentError) {
      try {
        const currentProfile = await refreshProfile();
        if (currentProfile) {
          const destination = await getPostAuthenticationPath(currentProfile);
          if (destination !== "/select-role") {
            navigate(destination, { replace: true });
            return;
          }
        }
      } catch {
        // Show the role-assignment error below.
      }

      // Only when the DATABASE refused the role because the account is an invited School Admin (a rare unmarked
      // account) ask once (bounded); every other failure, such as an invalid Teacher code, makes no backend request.
      // Only a positive answer changes the screen; a failed check keeps the ordinary error and retry.
      const refusedAsInvited = /accepting a School Admin invitation/.test(String((assignmentError as { message?: unknown })?.message ?? ""));
      const invitation = refusedAsInvited ? await getOwnSchoolAdminInvitation().catch(() => null) : null;
      if (invitation && invitation !== "none" && invitation !== "accepted") {
        setConfirmedInvitation(invitation);
        setSaving(false);
        return;
      }
      setError(assignmentError instanceof Error && assignmentError.message === "Invalid Teacher invite code."
        ? assignmentError.message : "We couldn't save your role. Please try again.");
      setSaving(false);
    }
  };

  if (checking) return null;

  if (showInvitation) {
    const state = confirmedInvitation;
    return (
      <main className="role-selection-page">
        <section className="role-selection-card" aria-labelledby="school-admin-invitation-title">
          <header className="role-selection-header">
            <h1 id="school-admin-invitation-title">School Admin invitation</h1>
            <p role="status">
              {state === "expired"
                ? "Your School Admin invitation is no longer open. Ask your System Admin to resend it."
                : state === "cancelled"
                  ? "This School Admin invitation was cancelled and can no longer be used."
                  : "Your School Admin access starts after you accept the invitation: open the most recent setup link from your invitation email and set your password. Email links can expire sooner than the invitation itself; if yours has, use Forgot password on the login page or ask your System Admin to resend it."}
            </p>
            {statusCheck === "failed" && <p role="alert">We couldn&apos;t check your invitation right now. Nothing has changed; please try again.</p>}
          </header>
          <button type="button" className="role-selection-continue" disabled={statusCheck === "checking"} onClick={() => void checkInvitationStatus()}>
            {statusCheck === "checking" ? "Checking…" : "Check invitation status"}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="role-selection-page">
      <span className="role-selection-page__shape role-selection-page__shape--one" />
      <span className="role-selection-page__shape role-selection-page__shape--two" />

      <section className="role-selection-card" aria-labelledby="role-selection-title">
        <header className="role-selection-header">
          <p className="role-selection-eyebrow">Let&apos;s get started!</p>
          <h1 id="role-selection-title">Welcome to Basa Eskwela</h1>
          <p>How would you like to use Basa Eskwela?</p>
        </header>

        <form className="role-selection-form" onSubmit={handleSubmit}>
          <fieldset disabled={checking || saving}>
            <legend className="role-selection-form__legend">
              Choose your role
            </legend>

            <div className="role-selection-options">
              {roles.map((role) => (
                <RoleOption
                  description={role.description}
                  icon={role.icon}
                  id={`role-${role.value}`}
                  isSelected={selectedRole === role.value}
                  key={role.value}
                  name="readflow-role"
                  onSelect={(value) => setSelectedRole(value as Role)}
                  title={role.title}
                  value={role.value}
                />
              ))}
            </div>
          </fieldset>

          {selectedRole === "teacher" && (
            <div className="role-selection-invite">
              <TextField
                id="teacherInviteCode" label="School Teacher Invite Code" type="password"
                value={inviteCode} onChange={(event) => { setInviteCode(event.target.value); setError(""); }}
                autoComplete="off" maxLength={256} disabled={saving} required
                aria-describedby="teacher-invite-help"
              />
              <p id="teacher-invite-help">Enter the invitation code provided by your school administrator.</p>
            </div>
          )}
          <AuthFormError message={error} />

          <button
            className="role-selection-continue"
            disabled={checking || saving || !selectedRole}
            type="submit"
          >
            {saving ? "Saving..." : "Continue"}
          </button>

          <button
            className="role-selection-back"
            onClick={() => window.history.back()}
            type="button"
          >
            Back
          </button>
        </form>
      </section>
    </main>
  );
}
