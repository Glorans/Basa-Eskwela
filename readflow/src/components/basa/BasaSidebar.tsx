import { School, Home, BookOpen, Trophy, Award, Settings, LogOut } from "lucide-react";
import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import mascot from "../../assets/mascot.png";
import { logout } from "../../services/authService";
import "./BasaSidebar.css";

interface BasaSidebarProps {
  open: boolean;
  onClose: () => void;
}

const NAV_ITEMS = [
  { label: "Dashboard", to: "/dashboard", icon: Home },
  { label: "Learning Rooms", to: "/dashboard/join-classroom", icon: School },
  { label: "My Materials", to: "/dashboard/materials", icon: BookOpen },
  { label: "Leaderboard", to: "/dashboard/leaderboard", icon: Trophy },
  { label: "My Badges", to: "/dashboard/badges", icon: Award },
  { label: "Reading History", to: "/dashboard/reading-history", icon: BookOpen },
  { label: "Settings", to: "/dashboard/settings", icon: Settings },
];

export default function BasaSidebar({ open, onClose }: BasaSidebarProps) {
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
      {open && <div className="basa-sidebar-overlay" onClick={onClose} aria-hidden="true" />}

      <aside className={`basa-sidebar ${open ? "basa-sidebar--open" : ""}`}>
        <div className="basa-sidebar-top">
          <div className="basa-sidebar-brand">
            <span className="basa-sidebar-logo-frame">
              <img className="basa-sidebar-logo" src={mascot} alt="Basa Eskwela mascot" />
            </span>
            <span className="basa-sidebar-title">Basa Eskwela</span>
          </div>

          <nav className="basa-sidebar-nav">
            {NAV_ITEMS.map(({ label, to, icon: Icon }) => (
              <NavLink
                key={label}
                to={to}
                end
                onClick={onClose}
                className={({ isActive }) =>
                  `basa-sidebar-item${isActive ? " basa-sidebar-item--active" : ""}`
                }
              >
                <Icon size={18} />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="basa-sidebar-footer">
          <button
            className="basa-sidebar-item"
            type="button"
            disabled={loggingOut}
            onClick={() => void handleLogout()}
          >
            <LogOut size={18} />
            {loggingOut ? "Signing out..." : "Logout"}
          </button>
        </div>
      </aside>
    </>
  );
}
