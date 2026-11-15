import { useState } from "react";
import useResponsiveSidebar from "../../../hooks/useResponsiveSidebar";
import "../../../styles/responsive-shell.css";
import {
  Award,
  BookOpenCheck,
  ChartNoAxesCombined,
  ClipboardList,
  FilePlus2,
  Files,
  House,
  LogOut,
  Menu,
  Mic2,
  PlusCircle,
  School,
  Settings,
  Trophy,
  Users,
  UserRound,
  UserPlus,
  X,
  Archive,
} from "lucide-react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import mascot from "../../../assets/mascot.png";
import useAuthenticatedProfile from "../../../hooks/useAuthenticatedProfile";
import { logout } from "../../../services/authService";
import { getRoleHomePath, isAppRole, ROLE_LABELS } from "../../module1/utils/authOnboarding";
import { getProfileDisplayName, getProfileInitials } from "../../module1/utils/profileFields";
import type { M3Role } from "../types/content";
import { getM3WorkspaceRoot } from "../utils/workspaceRoot";
import "../styles/module3.css";

// The System Admin (platform level, M1 account management only) shares this shell but has no M3 workspace.
type ShellRole = M3Role | "system_admin";

interface M3LayoutProps {
  role: ShellRole;
}

// Dashboard is every role's first item and landing page (the same path as the post-login redirect).
function getNavItems(role: ShellRole) {
  if (role === "system_admin") {
    // Appendix N M1 for the System Admin: F6/F7 (User Management), F8 (Create School Admin), F4/F5 (profile).
    return [
      { label: "User Management", to: "/system-admin/users", icon: Users, end: true },
      { label: "Create School Admin", to: "/system-admin/school-admins/new", icon: UserPlus, end: true },
      { label: "Profile Settings", to: "/system-admin/settings", icon: Settings, end: true },
    ];
  }
  return [{ label: "Dashboard", to: getRoleHomePath(role), icon: House, end: true }, ...getWorkspaceNavItems(role)];
}

function getWorkspaceNavItems(role: M3Role) {
  if (role === "admin") {
    return [
      { label: "Content Management", to: "/m3/admin", icon: Files, end: true },
      { label: "Create Module", to: "/m3/admin/modules/new", icon: PlusCircle, end: true },
      { label: "System Performance", to: "/admin/analytics", icon: ChartNoAxesCombined, end: true },
      { label: "Student Performance", to: "/admin/student-performance", icon: Users, end: true },
      { label: "Reports", to: "/admin/reports", icon: ClipboardList, end: true },
      { label: "User Management", to: "/admin/users", icon: Users, end: true },
      { label: "Teacher Invitations", to: "/admin/teacher-invitations", icon: UserRound, end: true },
      { label: "Oral Reading", to: "/admin/oral-reading", icon: Mic2, end: false },
      { label: "Reading History", to: "/admin/reading-history", icon: Mic2, end: true },
      { label: "Student Reading Assessments", to: "/admin/student-reading-assessments", icon: ClipboardList, end: true },
      {
        label: "Diagnostic Results",
        to: "/admin/diagnostic-results",
        icon: ClipboardList,
        end: true,
      },
      { label: "Learning Rooms", to: "/admin/learning-rooms", icon: School, end: false },
      { label: "Profile Settings", to: "/m3/admin/settings", icon: Settings, end: true },
    ];
  }

  const root = getM3WorkspaceRoot(role);

  const items = [
    { label: "Reading Modules", to: `${root}/modules`, icon: BookOpenCheck, end: false },
    { label: "Reading Materials", to: `${root}/materials`, icon: Files, end: true },
    { label: "Upload Material", to: `${root}/materials/upload`, icon: FilePlus2, end: true },
  ];

  if (role === "teacher") {
    // M3 Teacher F1–F5: create, organize, edit, delete and publish their own reading modules.
    items.splice(1, 0, { label: "My Reading Modules", to: "/m3/teacher/content", icon: FilePlus2, end: false });
    items.push({ label: "Learning Rooms", to: "/m3/teacher/learning-rooms", icon: School, end: true });
    items.push({
      label: "Reading Results",
      to: "/m3/teacher/oral-reading",
      icon: Mic2,
      end: false,
    });
    // M5/M6 Teacher reading practice (own read-alouds and comprehension), separate from Reading Results.
    items.push({ label: "Reading Practice", to: "/m3/teacher/practice", icon: Mic2, end: false });

    items.push({ label: "Student Support", to: "/m3/teacher/student-support", icon: ClipboardList, end: true });
    items.push({ label: "Analytics", to: "/m3/teacher/analytics", icon: ChartNoAxesCombined, end: true });
    items.push({ label: "Reports", to: "/m3/teacher/reports", icon: ClipboardList, end: true });
    items.push({ label: "Archived Classrooms", to: "/m3/teacher/archived-classrooms", icon: Archive, end: true });
  }

  if (role === "general_user") {
    items.push({ label: "Leaderboard", to: "/m3/general/leaderboard", icon: Trophy, end: true });
    items.push({ label: "Badges", to: "/m3/general/badges", icon: Award, end: true });
    items.push({ label: "Reading History", to: "/m3/general/reading-history", icon: Mic2, end: true });
    items.push({ label: "Progress & Result", to: "/m3/general/progress", icon: ChartNoAxesCombined, end: true });
  }

  items.push({ label: "Profile Settings", to: `${root}/settings`, icon: Settings, end: true });
  return items;
}

function getProfileRoute(role: ShellRole) {
  if (role === "system_admin") return "/system-admin/settings";
  if (role === "admin") return "/m3/admin/settings";
  if (role === "teacher") return "/m3/teacher/settings";
  return "/m3/general/settings";
}

export default function M3Layout({ role }: M3LayoutProps) {
  const sidebar = useResponsiveSidebar();
  const sidebarOpen = sidebar.drawerOpen;
  const [loggingOut, setLoggingOut] = useState(false);
  const navigate = useNavigate();
  const { profile, loading } = useAuthenticatedProfile();
  const navItems = getNavItems(role);
  const showIdentity = !loading && !!profile;
  const shouldShowRole = profile?.role === "teacher" || profile?.role === "admin" || profile?.role === "system_admin";
  const displayName = getProfileDisplayName(profile);
  const roleLabel = profile && isAppRole(profile.role)
    ? ROLE_LABELS[profile.role]
    : profile?.role || "\u2014";
  const initials = getProfileInitials(profile);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    const signedOut = await logout();

    if (!signedOut) {
      setLoggingOut(false);
      return;
    }

    sidebar.close();
    navigate("/login", { replace: true });
  }

  const shellClassName = [
    "m3-shell",
    sidebar.shellClasses,
    role === "admin" || role === "system_admin" ? "m3-shell--admin" : "",
    role === "general_user" ? "m3-shell--general" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={shellClassName}>
      {sidebarOpen && (
        <button
          className="m3-sidebar-overlay rf-backdrop"
          tabIndex={-1}
          type="button"
          aria-label="Close navigation"
          onClick={() => sidebar.close()}
        />
      )}

      <aside id="m3-navigation" ref={sidebar.sidebarRef} className={`m3-sidebar rf-sidebar ${sidebarOpen ? "m3-sidebar--open" : ""}`}
        role={sidebarOpen ? "dialog" : undefined} aria-modal={sidebarOpen ? true : undefined} aria-label={`${ROLE_LABELS[role]} navigation`}
        aria-hidden={sidebar.mobile && !sidebarOpen ? true : undefined}>
        <div className="rf-sidebar-main">
          <div className="m3-sidebar-brand">
            <Link className="m3-sidebar-home" to={getRoleHomePath(role)} aria-label="Basa Eskwela, go to Dashboard" onClick={() => sidebar.close()}>
              <span className="m3-brand-logo">
                <img src={mascot} alt="" />
              </span>
              <span className="rf-nav-label">
                <strong>Basa Eskwela</strong>
              </span>
            </Link>
            {/* Desktop only (CSS): collapse/expand the rail from inside the sidebar. Phones and tablets keep
                the header button, which opens the drawer. */}
            <button
              className="rf-rail-toggle"
              type="button"
              aria-label={sidebar.toggleLabel}
              title={sidebar.toggleLabel}
              aria-expanded={sidebar.expanded}
              aria-controls="m3-navigation"
              onClick={sidebar.toggle}
            >
              <Menu size={22} aria-hidden="true" />
            </button>
            <button
              className="m3-sidebar-close rf-drawer-close"
              ref={sidebar.closeRef}
              type="button"
              aria-label="Close navigation"
              onClick={() => sidebar.close()}
            >
              <X size={20} />
            </button>
          </div>

          <nav className="m3-sidebar-nav rf-sidebar-scroll" aria-label={`${ROLE_LABELS[role]} navigation`}>
            {navItems.map(({ label, to, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                aria-label={label}
                title={label}
                onClick={() => sidebar.close()}
                className={({ isActive }) => `m3-nav-item${isActive ? " m3-nav-item--active" : ""}`}
              >
                <Icon size={19} />
                <span className="rf-nav-label">{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="m3-sidebar-footer rf-sidebar-footer">
          <button
            className="m3-sidebar-quiet-link"
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

      <div className="m3-workspace rf-workspace" ref={sidebar.workspaceRef}>
        <header className="m3-topbar">
          <div className="m3-topbar-title">
            <button
              className="m3-menu-button"
              type="button"
              aria-label={sidebar.toggleLabel}
              title={sidebar.toggleLabel}
              aria-expanded={sidebar.expanded}
              aria-controls="m3-navigation"
              ref={sidebar.triggerRef}
              onClick={sidebar.toggle}
            >
              <Menu size={22} />
            </button>
          </div>

          <NavLink className="m3-topbar-user" to={getProfileRoute(role)} aria-label="Profile and Account">
            <span className="m3-user-avatar" aria-hidden="true">
              {showIdentity ? initials : <UserRound size={20} />}
            </span>
            {showIdentity && (
              <span className="m3-user-copy">
                <strong>{displayName}</strong>
                {shouldShowRole && <small>{roleLabel}</small>}
              </span>
            )}
          </NavLink>
        </header>

        <div className="rf-content-scroll" tabIndex={0} role="region" aria-label="Main content"><main className="m3-content">
          <Outlet />
        </main></div>
      </div>
    </div>
  );
}
