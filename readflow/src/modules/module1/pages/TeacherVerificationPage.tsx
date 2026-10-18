import "./TeacherVerificationPage.css";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../../auth/useAuth";
import { logout } from "../../../services/authService";
import AuthLayout from "../components/AuthLayout";
import AuthFormError from "../components/AuthFormError";
import "../components/AuthSubmitButton.css";
import { getRoleHomePath, isAppRole, isUnapprovedTeacher } from "../utils/authOnboarding";

export default function TeacherVerificationPage() {
  const { profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!profile || !isAppRole(profile.role)) return <Navigate to="/select-role" replace />;
  if (!isUnapprovedTeacher(profile.role, profile.teacher_status)) {
    return <Navigate to={getRoleHomePath(profile.role)} replace />;
  }
  const rejected = profile.teacher_status === "rejected";
  async function run(action: "refresh" | "logout") {
    setBusy(true);
    setError("");
    try {
      if (action === "logout") {
        await logout();
        navigate("/login", { replace: true });
      } else {
        await refreshProfile();
      }
    } catch {
      setError("We couldn't complete your request. Please try again.");
    } finally { setBusy(false); }
  }
  return (
    <AuthLayout className="teacher-verification" title={rejected ? "Teacher Account Not Approved" : "Teacher Account Pending Approval"}>
      <p role="status">{rejected
        ? "Your Teacher registration was rejected. Please contact your school administrator."
        : "Your Teacher account is waiting for administrator approval."}</p>
      <AuthFormError message={error} />
      <div className="auth-form teacher-verification-actions">
        <button type="button" className="auth-submit" disabled={busy} onClick={() => void run("logout")}>Sign Out</button>
      </div>
    </AuthLayout>
  );
}
