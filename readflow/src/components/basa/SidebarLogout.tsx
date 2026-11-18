import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { logout } from "../../services/authService";
import "./SidebarLogout.css";

export const SIGN_OUT_ERROR = "Could not sign out. Please try again.";

interface SidebarLogoutProps {
  /** Footer class of the layout's sidebar (keeps that sidebar's spacing and divider). */
  footerClassName: string;
  /** The layout's existing footer button style. */
  buttonClassName: string;
  /** Closes the phone/tablet drawer once signed out. */
  onSignedOut?: () => void;
}

/**
 * Logout at the bottom of every role's sidebar. Uses the existing sign-out (authService.logout, which clears the
 * Supabase session and cached account data) and the existing redirect to /login. The footer sits outside the
 * scrolling navigation, so it stays at the bottom and is never hidden by a long menu.
 */
export default function SidebarLogout({ footerClassName, buttonClassName, onSignedOut }: SidebarLogoutProps) {
  const navigate = useNavigate();
  const busy = useRef(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    if (busy.current) return;
    busy.current = true;
    setLoggingOut(true);
    setError("");
    try {
      if (await logout()) {
        onSignedOut?.();
        navigate("/login", { replace: true });
      } else setError(SIGN_OUT_ERROR);
    } catch { setError(SIGN_OUT_ERROR); }
    finally { busy.current = false; setLoggingOut(false); }
  }

  const label = loggingOut ? "Signing out..." : "Logout";
  return <div className={`${footerClassName} rf-sidebar-footer`}>
    <button className={buttonClassName} type="button" disabled={loggingOut} aria-label={label} title="Logout"
      onClick={() => void signOut()}>
      <LogOut size={18} aria-hidden="true" />
      <span className="rf-nav-label">{label}</span>
    </button>
    {error && <p className="sidebar-logout-error" role="alert">{error}</p>}
  </div>;
}
