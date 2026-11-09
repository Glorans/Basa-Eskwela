import { FormEvent, useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, User } from "lucide-react";
import { useAuth } from "../../../auth/useAuth";
import {
  updateFullName,
  updateNickname,
  type AuthProfile,
} from "../services/authProfile";
import { updatePassword } from "../../../services/authService";
import {
  FULL_NAME_MAX_LENGTH,
  getPasswordValidationError,
  getProfileNameValidationError,
  isAppRole,
  NICKNAME_MAX_LENGTH,
  PASSWORD_REQUIREMENTS,
  ROLE_LABELS,
} from "../utils/authOnboarding";
import {
  getEditableProfileField,
  getEditableProfileValue,
} from "../utils/profileFields";
import "./Settings.css";

interface LoadedAccount {
  userId: string;
  email: string;
  profile: AuthProfile;
}

export default function Settings() {
  const {
    user,
    profile,
    loading: authLoading,
    refreshProfile,
  } = useAuth();
  const [account, setAccount] = useState<LoadedAccount>();
  const [profileName, setProfileName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const passedChecks = useMemo(
    () => PASSWORD_REQUIREMENTS.filter((requirement) => requirement.test(password)).length,
    [password],
  );

  async function loadAccount(refresh = false) {
    setLoading(true);

    try {
      const currentProfile = refresh ? await refreshProfile() : profile;
      if (!user?.email || !currentProfile) {
        setError("We couldn't load your authenticated account. Please sign in again.");
        return;
      }

      const loaded = { userId: user.id, email: user.email, profile: currentProfile };
      setAccount(loaded);
      setProfileName(getEditableProfileValue(currentProfile));
    } catch {
      setError("We couldn't load your profile. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading) void loadAccount();
  }, [authLoading, profile, user?.email, user?.id]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!account) {
      setError("Your profile is not ready. Reload the page and try again.");
      return;
    }

    const normalizedName = profileName.trim();

    const editableProfileField = getEditableProfileField(account.profile.role);
    if (!editableProfileField) {
      setError("This account has an unsupported role.");
      return;
    }

    const editsNickname = editableProfileField === "nickname";
    const profileValidationError = getProfileNameValidationError(normalizedName, editsNickname);

    if (profileValidationError) {
      setError(profileValidationError);
      return;
    }

    if (password || confirmPassword) {
      const passwordError = getPasswordValidationError(password);
      if (passwordError) {
        setError(passwordError);
        return;
      }

      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
    }

    const savedDisplayName = editsNickname
      ? account.profile.nickname ?? ""
      : account.profile.full_name;
    const nameChanged = normalizedName !== savedDisplayName;
    if (!nameChanged && !password) {
      setSuccess("There are no changes to save.");
      return;
    }

    setSaving(true);
    let nameSaved = false;

    try {
      if (nameChanged) {
        if (editsNickname) {
          await updateNickname(account.userId, normalizedName);
        } else {
          await updateFullName(account.userId, normalizedName);
        }
        nameSaved = true;
      }

      if (password) {
        await updatePassword(password);
      }

      setPassword("");
      setConfirmPassword("");
      await loadAccount(true);
      const label = editsNickname ? "Nickname" : "Name";
      setSuccess(
        password && nameSaved
          ? `${label} saved and password changed.`
          : password
            ? "Your password was changed."
            : `${label} saved.`,
      );
    } catch (saveError) {
      await loadAccount(true);
      const message = saveError instanceof Error
        ? saveError.message
        : "We couldn't save your profile changes. Please try again.";
      setError(nameSaved ? `${message} Your ${editsNickname ? "nickname" : "name"} was saved.` : message);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    if (!account) return;
    setProfileName(getEditableProfileValue(account.profile));
    setPassword("");
    setConfirmPassword("");
    setError("");
    setSuccess("");
  }

  if (loading && !account) {
    return null;
  }

  const editsNickname = account
    ? getEditableProfileField(account.profile.role) === "nickname"
    : false;
  const roleLabel = account && isAppRole(account.profile.role)
    ? ROLE_LABELS[account.profile.role]
    : account?.profile.role || "\u2014";

  return (
    <>
      <div className="basa-settings-card">
        <h1 className="basa-page-title">Settings</h1>

        <div className="basa-settings-avatar-row">
          <span className="basa-settings-avatar">
            <User size={34} />
          </span>
          <p>Profile and Account</p>
        </div>

        {error && !account ? (
          <div>
            <p className="basa-settings-error" role="alert">{error}</p>
            <button type="button" className="basa-settings-save" onClick={() => { setError(""); void loadAccount(true); }}>
              Try Again
            </button>
          </div>
        ) : (
          <form onSubmit={handleSave}>
            <div className="basa-settings-columns">
              <div>
                <h2>Profile Information</h2>

                <label htmlFor="profileName">
                  {editsNickname ? "Nickname" : "Full Name"}
                </label>
                <input
                  id="profileName"
                  value={profileName}
                  maxLength={
                    editsNickname
                      ? NICKNAME_MAX_LENGTH
                      : FULL_NAME_MAX_LENGTH
                  }
                  disabled={saving}
                  onChange={(event) => setProfileName(event.target.value)}
                />

                <div className="basa-settings-readonly-field">
                  <span id="accountRoleLabel">Role</span>
                  <p aria-labelledby="accountRoleLabel">{roleLabel}</p>
                </div>

                <div className="basa-settings-readonly-field">
                  <span id="accountStatusLabel">Status</span>
                  <p aria-labelledby="accountStatusLabel">
                    {account?.profile.status || "\u2014"}
                  </p>
                </div>
              </div>

              <div>
                <h2>Account Information</h2>

                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  className="basa-settings-readonly-input"
                  value={account?.email ?? ""}
                  readOnly
                  aria-readonly="true"
                  aria-describedby="emailHelp"
                />
                <p id="emailHelp" className="basa-settings-help">
                  Your registered email address can't be changed here.
                </p>

                <label htmlFor="password">Change Password</label>
                <div className="basa-password-field">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    placeholder="New password"
                    disabled={saving}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label="Toggle password visibility"
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>

                <div className="basa-password-checks">
                  {PASSWORD_REQUIREMENTS.map((check) => (
                    <label key={check.label}>
                      <input type="checkbox" readOnly checked={check.test(password)} />
                      {check.label}
                    </label>
                  ))}
                </div>

                <label htmlFor="confirmPassword">Confirm Password</label>
                <div className="basa-password-field">
                  <input
                    id="confirmPassword"
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword}
                    placeholder="Confirm new password"
                    disabled={saving}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setShowConfirm((visible) => !visible)}
                    aria-label="Toggle password visibility"
                  >
                    {showConfirm ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>
            </div>

            {password && passedChecks < PASSWORD_REQUIREMENTS.length && (
              <p className="basa-settings-help">
                Complete all password requirements before saving.
              </p>
            )}

            {error && (
              <p className="basa-settings-error" role="alert">
                {error}
              </p>
            )}

            {success && (
              <p className="basa-settings-saved" role="status">
                {success}
              </p>
            )}

            <div className="basa-settings-actions">
              <button type="submit" className="basa-settings-save" disabled={saving}>
                {saving ? "Saving..." : "Save Changes"}
              </button>
              <button
                type="button"
                className="basa-settings-cancel"
                disabled={saving}
                onClick={handleCancel}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
