import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../../auth/useAuth";
import {
  getPostAuthenticationPath,
  completeProfileSetup,
} from "../services/authProfile";
import {
  FULL_NAME_MAX_LENGTH,
  getProfileNameValidationError,
  isDiagnosticLearnerRole,
  NICKNAME_MAX_LENGTH,
} from "../utils/authOnboarding";
import "./ProfileSetupPage.css";

export default function ProfileSetupPage() {
  const navigate = useNavigate();
  const { profile, loading: authLoading, profileError, refreshProfile } = useAuth();
  const [profileValue, setProfileValue] = useState("");
  const [error, setError] = useState("");
  const [checkingProfile, setCheckingProfile] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    async function checkProfile() {
      try {
        if (profileError || !profile) {
          throw new Error("Profile unavailable");
        }

        const destination = await getPostAuthenticationPath(profile);
        if (destination !== "/setup-profile") {
          navigate(destination, { replace: true });
        }
      } catch {
        if (!cancelled) {
          setError("We couldn't load your profile. Please try again.");
        }
      } finally {
        if (!cancelled) setCheckingProfile(false);
      }
    }

    void checkProfile();

    return () => {
      cancelled = true;
    };
  }, [authLoading, navigate, profile, profileError]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!profile) {
      setError("We couldn't load your profile. Please try again.");
      return;
    }

    const normalizedValue = profileValue.trim();
    const isLearner = isDiagnosticLearnerRole(profile.role);
    const validationError = getProfileNameValidationError(normalizedValue, isLearner);
    setError(validationError);
    if (validationError) return;

    setError("");
    setSaving(true);

    try {
      await completeProfileSetup(profile.id, normalizedValue);

      const completedProfile = await refreshProfile();
      if (!completedProfile) throw new Error("Completed profile unavailable");
      navigate(await getPostAuthenticationPath(completedProfile), { replace: true });
    } catch {
      setError("We couldn't save your profile. Please try again.");
      setSaving(false);
    }
  }

  const loading = authLoading || checkingProfile;
  if (loading) return null;

  const isTeacher = profile?.role === "teacher";

  return (
    <main className="profile-setup-page">
      <section className="profile-setup-card" aria-labelledby="profile-setup-title">
        <Link className="profile-setup-back" to="/select-role">
          <span aria-hidden="true">←</span>
          Back
        </Link>

        <header className="profile-setup-header">
          <h1 id="profile-setup-title">Welcome to Basa Eskwela</h1>
        </header>

        <form className="profile-setup-form" onSubmit={handleSubmit} noValidate>
          <label className="profile-setup-prompt" htmlFor={isTeacher ? "fullName" : "nickname"}>
            {isTeacher ? "What is your full name?" : "What should we call you?"}
          </label>

          <input
            className="profile-setup-input"
            id={isTeacher ? "fullName" : "nickname"}
            type="text"
            aria-label={isTeacher ? "Full Name" : "What should we call you?"}
            placeholder={isTeacher ? "Enter your full name" : "Enter your nickname"}
            value={profileValue}
            onChange={(event) => {
              setProfileValue(event.target.value);
              setError("");
            }}
            maxLength={isTeacher ? FULL_NAME_MAX_LENGTH : NICKNAME_MAX_LENGTH}
            autoComplete={isTeacher ? "name" : "nickname"}
            disabled={loading || saving}
          />

          {error && (
            <p className="profile-setup-error" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="profile-setup-continue"
            disabled={loading || saving || !profile}
          >
            {saving ? "Saving..." : "Continue"}
          </button>
        </form>
      </section>
    </main>
  );
}
