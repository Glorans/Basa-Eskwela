import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { getPolicyStatus } from "../../modules/module1/services/policyAcknowledgment";
import { useAuth } from "../../auth/useAuth";
import {
  getOnboardingPath,
  getRoleHomePath,
  isAppRole,
  isUnapprovedTeacher,
  type AppRole,
} from "../../modules/module1/utils/authOnboarding";
import "./RequireAuth.css";

interface RequireAuthProps {
  allowedRoles?: readonly AppRole[];
  allowUnassignedRole?: boolean;
}

const ACK_PATH = "/acknowledge-policy";

/**
 * One-time Terms of Use and Privacy Notice acknowledgment: "required" until the signed-in user pressed I Agree for
 * the current version. If the check is not installed or fails, sign-in continues as before (the step never locks
 * anyone out of learning).
 */
function usePolicyGate(userId: string | null): "loading" | "required" | "ok" {
  const [result, setResult] = useState<{ userId: string; gate: "required" | "ok" } | null>(null);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    getPolicyStatus(userId)
      .then((status) => { if (active) setResult({ userId, gate: status.state === "required" ? "required" : "ok" }); })
      .catch(() => { if (active) setResult({ userId, gate: "ok" }); });
    return () => { active = false; };
  }, [userId]);
  if (!userId) return "ok";
  return result?.userId === userId ? result.gate : "loading";
}

export default function RequireAuth({
  allowedRoles,
  allowUnassignedRole = false,
}: RequireAuthProps) {
  const location = useLocation();
  const { user, profile, loading, profileError } = useAuth();
  const policyGate = usePolicyGate(user?.id ?? null);

  if (loading) {
    return null;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (profileError || !profile) {
    return (
      <div className="auth-route-status" role="alert">
        We couldn&apos;t verify your account profile. Please sign in again.
      </div>
    );
  }

  const onboardingPath = getOnboardingPath(
    profile.role,
    profile.nickname,
    profile.full_name,
  );

  if (onboardingPath === "/select-role") {
    return allowUnassignedRole
      ? <Outlet />
      : <Navigate to="/select-role" replace />;
  }

  if (!isAppRole(profile.role)) {
    return (
      <div className="auth-route-status" role="alert">
        We couldn&apos;t verify your account profile. Please sign in again.
      </div>
    );
  }

  if (onboardingPath === "/setup-profile" && location.pathname !== "/setup-profile") {
    return <Navigate to="/setup-profile" replace />;
  }

  // After profile setup: the one-time Terms of Use and Privacy Notice acknowledgment.
  if (onboardingPath === null && location.pathname !== ACK_PATH) {
    if (policyGate === "loading") return null;
    if (policyGate === "required") return <Navigate to={ACK_PATH} replace state={{ from: location.pathname }} />;
  }

  if (isUnapprovedTeacher(profile.role, profile.teacher_status)
    && !(onboardingPath === "/setup-profile" && location.pathname === "/setup-profile")
    && location.pathname !== "/teacher-verification" && location.pathname !== ACK_PATH) {
    return <Navigate to="/teacher-verification" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return <Navigate to={getRoleHomePath(profile.role)} replace />;
  }

  return <Outlet />;
}

export function RequireRole({ allowedRoles }: { allowedRoles: readonly AppRole[] }) {
  return <RequireAuth allowedRoles={allowedRoles} />;
}
