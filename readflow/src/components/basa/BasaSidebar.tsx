import { School, Home, BookOpen, Trophy, Award, Settings, LogOut, X } from "lucide-react";
import type useResponsiveSidebar from "../../hooks/useResponsiveSidebar";
import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import mascot from "../../assets/mascot.png";
import { logout } from "../../services/authService";
import "./BasaSidebar.css";

interface BasaSidebarProps {
  controller: ReturnType<typeof useResponsiveSidebar>;
  open: boolean;
  onClose: () => void;
}

const NAV_ITEMS = [
  { label: "Dashboard", to: "/dashboard", icon: Home },
  { label: "Learning Rooms", to: "/dashboard/join-classroom", icon: School },
  { label: "Reading Materials", to: "/dashboard/materials", icon: BookOpen },
  { label: "Leaderboard", to: "/dashboard/leaderboard", icon: Trophy },
  { label: "Badges", to: "/dashboard/badges", icon: Award },
  { label: "Progress & Result", to: "/dashboard/progress", icon: BookOpen },
  { label: "Reading History", to: "/dashboard/reading-history", icon: BookOpen },
  { label: "Settings", to: "/dashboard/settings", icon: Settings },
];

export default function BasaSidebar({ open, onClose, controller }: BasaSidebarProps) {
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    const signedOut = await logout();

    if (!signedOut) {
      setLoggingOut(false);
      return;
    }

    onClose();
    navigate("/login", { replace: true });
  }

  return (
    <>
      {open && <button type="button" tabIndex={-1} className="basa-sidebar-overlay rf-backdrop" onClick={onClose} aria-label="Close navigation" />}

      <aside id="basa-navigation" ref={controller.sidebarRef} className={`basa-sidebar rf-sidebar ${open ? "basa-sidebar--open" : ""}`}
        role={open ? "dialog" : undefined} aria-modal={open ? true : undefined} aria-label="Student navigation"
        aria-hidden={controller.mobile && !open ? true : undefined}>
        <div className="basa-sidebar-top rf-sidebar-main">
          <button type="button" className="rf-drawer-close" ref={controller.closeRef} onClick={onClose} aria-label="Close navigation"><X size={22} /></button>
          <Link className="basa-sidebar-brand" to="/dashboard" aria-label="Basa Eskwela, go to Dashboard" onClick={onClose}>
            <span className="basa-sidebar-logo-frame">
              <img className="basa-sidebar-logo" src={mascot} alt="" />
            </span>
            <span className="basa-sidebar-title rf-nav-label">Basa Eskwela</span>
          </Link>

          <nav className="basa-sidebar-nav rf-sidebar-scroll" aria-label="Student navigation">
            {NAV_ITEMS.map(({ label, to, icon: Icon }) => (
              <NavLink
                key={label}
                to={to}
                end
                aria-label={label}
                title={label}
                onClick={onClose}
                className={({ isActive }) =>
                  `basa-sidebar-item${isActive ? " basa-sidebar-item--active" : ""}`
                }
              >
                <Icon size={18} />
                <span className="rf-nav-label">{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="basa-sidebar-footer rf-sidebar-footer">
          <button
            className="basa-sidebar-item"
            type="button"
            disabled={loggingOut}
            aria-label={loggingOut ? "Signing out..." : "Logout"}
            title="Logout"
            onClick={() => void handleLogout()}
          >
            <LogOut size={18} />
            <span className="rf-nav-label">{loggingOut ? "Signing out..." : "Logout"}</span>
          </button>
        </div>
      </aside>
    </>
  );
}
