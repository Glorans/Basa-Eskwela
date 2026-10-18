import { Navigate, Outlet, useLocation } from "react-router-dom";
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

export default function RequireAuth({
  allowedRoles,
  allowUnassignedRole = false,
}: RequireAuthProps) {
  const location = useLocation();
  const { user, profile, loading, profileError } = useAuth();

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

  if (isUnapprovedTeacher(profile.role, profile.teacher_status)
    && !(onboardingPath === "/setup-profile" && location.pathname === "/setup-profile")
    && location.pathname !== "/teacher-verification") {
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
