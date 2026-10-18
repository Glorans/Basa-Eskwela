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
  const { profile, loading: authLoading, profileError, refreshProfile } = useAuth();
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [inviteCode, setInviteCode] = useState("");

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

      setError(assignmentError instanceof Error && assignmentError.message === "Invalid Teacher invite code."
        ? assignmentError.message : "We couldn't save your role. Please try again.");
      setSaving(false);
    }
  };

  if (checking) return null;

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
