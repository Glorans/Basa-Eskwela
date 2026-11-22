import { Archive, School, Home, BookOpen, Trophy, Award, Menu, X, ClipboardList } from "lucide-react";
import type useResponsiveSidebar from "../../hooks/useResponsiveSidebar";
import { Link, NavLink } from "react-router-dom";
import mascot from "../../assets/mascot.png";
import SidebarLogout from "./SidebarLogout";
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
  { label: "Reading Assessment", to: "/dashboard/assessment-history", icon: ClipboardList },
  // M2 F8: reassessments assigned by the Student's teacher.
  { label: "My Reassessments", to: "/dashboard/reassessments", icon: ClipboardList },
  { label: "Reading History", to: "/dashboard/reading-history", icon: BookOpen },
  { label: "Archived Rooms", to: "/dashboard/archived-learning-rooms", icon: Archive },
];

export default function BasaSidebar({ open, onClose, controller }: BasaSidebarProps) {
  return (
    <>
      {open && <button type="button" tabIndex={-1} className="basa-sidebar-overlay rf-backdrop" onClick={onClose} aria-label="Close navigation" />}

      <aside id="basa-navigation" ref={controller.sidebarRef} className={`basa-sidebar rf-sidebar ${open ? "basa-sidebar--open" : ""}`}
        role={open ? "dialog" : undefined} aria-modal={open ? true : undefined} aria-label="Student navigation"
        aria-hidden={controller.mobile && !open ? true : undefined}>
        <div className="basa-sidebar-top rf-sidebar-main">
          <button type="button" className="rf-drawer-close" ref={controller.closeRef} onClick={onClose} aria-label="Close navigation"><X size={22} /></button>
          <div className="basa-sidebar-head">
            <Link className="basa-sidebar-brand" to="/dashboard" aria-label="Basa Eskwela, go to Dashboard" onClick={onClose}>
              <span className="basa-sidebar-logo-frame">
                <img className="basa-sidebar-logo" src={mascot} alt="" />
              </span>
              <span className="basa-sidebar-title rf-nav-label">Basa Eskwela</span>
            </Link>
            {/* Desktop only (CSS): collapse/expand the rail from inside the sidebar. Phones and tablets keep
                the header button, which opens the drawer. */}
            <button type="button" className="rf-rail-toggle" aria-controls="basa-navigation" aria-expanded={controller.expanded}
              aria-label={controller.toggleLabel} title={controller.toggleLabel} onClick={controller.toggle}>
              <Menu size={22} aria-hidden="true" />
            </button>
          </div>

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

        <SidebarLogout footerClassName="basa-sidebar-footer" buttonClassName="basa-sidebar-item" onSignedOut={onClose} />
      </aside>
    </>
  );
}
