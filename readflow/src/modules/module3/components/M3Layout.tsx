import AssessmentNavigation from "../../module2/components/AssessmentNavigation";
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
  Menu,
  Mic2,
  School,
  Trophy,
  Users,
  UserRound,
  X,
  Archive,
  History,
} from "lucide-react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import mascot from "../../../assets/mascot.png";
import ProfileDropdown from "../../../components/basa/ProfileDropdown";
import SidebarLogout from "../../../components/basa/SidebarLogout";
import { getRoleHomePath, ROLE_LABELS } from "../../module1/utils/authOnboarding";
import type { M3Role } from "../types/content";
import { getM3WorkspaceRoot } from "../utils/workspaceRoot";
import "../styles/module3.css";
import "../../system-admin/systemAdmin.css";

type ShellRole = M3Role;

interface M3LayoutProps {
  role: ShellRole;
}

// Dashboard is every role's first item and landing page (the same path as the post-login redirect).
function getNavItems(role: ShellRole): NavItem[] {
  if (role === "system_admin") {
    // Appendix N M1 for the System Admin: F6/F7 (User Management), F8 (Create School Admin), F4/F5 (profile).
    return [
      { label: "Dashboard", to: getRoleHomePath(role), icon: House, end: true },
      // Create Module and Upload Material open from the buttons on these two pages (their routes are unchanged).
      { label: "Content Management", to: "/system-admin/content", icon: Files, end: true, alsoActive: ["/system-admin/content/modules/new"] },
      { label: "Reading Materials", to: "/system-admin/content/materials", icon: Files, end: true, alsoActive: ["/system-admin/content/materials/upload"] },
      // Appendix N M5 F1-F7 / M6 F1-F5 for the System Admin: try published modules (own practice results only).
      { label: "Reading Practice", to: "/system-admin/practice", icon: Mic2, end: false },
      { label: "Practice History", to: "/system-admin/practice/history", icon: History, end: true },
      { label: "User Management", to: "/system-admin/users", icon: Users, end: true },
      // Appendix N M1 F8: Create School and the list of schools.
      { label: "Schools", to: "/system-admin/schools", icon: School, end: true },
      // Appendix N M7 for the System Admin: F2 (system-wide dashboard) and F4 (Independent Learner performance).
      { label: "Platform Analytics", to: "/system-admin/analytics", icon: ChartNoAxesCombined, end: true },
      { label: "Independent Learners", to: "/system-admin/independent-learners", icon: UserRound, end: true },
      // Appendix N M2 F6/F7/F10: the expandable Assessment group (AssessmentNavigation) follows these items.
      // F7 Try Assessment is opened from the Initial Diagnostic's built-in version 3.0.

    ];
  }
  return [{ label: "Dashboard", to: getRoleHomePath(role), icon: House, end: true }, ...getWorkspaceNavItems(role)];
}

/** A sidebar link. `alsoActive`: exact paths of pages opened from this one (e.g. Create Module from Content
 * Management) that keep it highlighted, since they no longer have their own sidebar entry. */
type NavItem = { label: string; to: string; icon: typeof Files; end: boolean; alsoActive?: string[] };

/** Marks where the expandable M2 Assessment group is rendered (School Admin and Teacher). Never a route. */
const ASSESSMENT_GROUP = "m2:assessment-group";

function getWorkspaceNavItems(role: M3Role): NavItem[] {
  if (role === "admin") {
    return [
      // Create Module opens from the Content Management button (route unchanged).
      { label: "Content Management", to: "/m3/admin", icon: Files, end: true, alsoActive: ["/m3/admin/modules/new"] },
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
      // M2: expandable Assessment group (AssessmentNavigation): Packages (F10) and Assignments (F9). F7 Try the
      // Initial Diagnostic is opened from Diagnostic Results.
      { label: "Assessment", to: ASSESSMENT_GROUP, icon: ClipboardList, end: true },
      { label: "Learning Rooms", to: "/admin/learning-rooms", icon: School, end: false },
    ];
  }

  const root = getM3WorkspaceRoot(role);

  const items: NavItem[] = role === "teacher"
    // Teacher: Upload Material opens from the Reading Materials button (route unchanged).
    ? [
      { label: "Reading Modules", to: `${root}/modules`, icon: BookOpenCheck, end: false },
      { label: "Reading Materials", to: `${root}/materials`, icon: Files, end: true, alsoActive: [`${root}/materials/upload`] },
    ]
    : [
      { label: "Reading Modules", to: `${root}/modules`, icon: BookOpenCheck, end: false },
      { label: "Reading Materials", to: `${root}/materials`, icon: Files, end: true },
      { label: "Upload Material", to: `${root}/materials/upload`, icon: FilePlus2, end: true },
    ];

  if (role === "teacher") {
    // M3 Teacher F1–F5: create, organize, edit, delete and publish their own reading modules. Create Module opens from
    // the button on My Reading Modules (route unchanged), which stays highlighted there.
    items.splice(1, 0,
      { label: "My Reading Modules", to: "/m3/teacher/content", icon: FilePlus2, end: true, alsoActive: ["/m3/teacher/content/new"] });
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
    // M2 F3: diagnostic results of Students enrolled in this Teacher's Learning Rooms.
    items.push({ label: "Diagnostic Results", to: "/m3/teacher/diagnostic-results", icon: ClipboardList, end: true });
    // M2: expandable Assessment group (AssessmentNavigation): own Packages (F10) and Assignments (F9). F7 Try the
    // Initial Diagnostic is opened from Diagnostic Results.
    items.push({ label: "Assessment", to: ASSESSMENT_GROUP, icon: ClipboardList, end: true });
    items.push({ label: "Analytics", to: "/m3/teacher/analytics", icon: ChartNoAxesCombined, end: true });
    items.push({ label: "Reports", to: "/m3/teacher/reports", icon: ClipboardList, end: true });
    items.push({ label: "Archived Classrooms", to: "/m3/teacher/archived-classrooms", icon: Archive, end: true });
  }

  if (role === "general_user") {
    items.push({ label: "Leaderboard", to: "/m3/general/leaderboard", icon: Trophy, end: true });
    items.push({ label: "Badges", to: "/m3/general/badges", icon: Award, end: true });
    items.push({ label: "Reading History", to: "/m3/general/reading-history", icon: Mic2, end: true });
    items.push({ label: "Progress & Result", to: "/m3/general/progress", icon: ChartNoAxesCombined, end: true });
    // M2 F3: own diagnostic results and history.
    items.push({ label: "Assessment History", to: "/m3/general/assessment-history", icon: ClipboardList, end: true });
    // M2 F8: centrally approved reassessments the Independent Learner can start.
    items.push({ label: "My Reassessments", to: "/m3/general/reassessments", icon: ClipboardList, end: true });
  }

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
  const navItems = getNavItems(role);
  const { pathname } = useLocation();

  const shellClassName = [
    "m3-shell",
    role === "system_admin" ? "system-admin-ui" : "",
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
                {role === "system_admin" && <small className="sa-brand-caption">Administration</small>}
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
            {navItems.map(({ label, to, icon: Icon, end, alsoActive }: NavItem) => to === ASSESSMENT_GROUP ? (
              <AssessmentNavigation key={to} role={role === "admin" ? "admin" : "teacher"}
                onExpand={() => { if (!sidebar.expanded) sidebar.toggle(); }} onNavigate={() => sidebar.close()} />
            ) : (
              <NavLink
                key={to}
                to={to}
                end={end}
                aria-label={label}
                title={label}
                onClick={() => sidebar.close()}
                className={({ isActive }) => `m3-nav-item${isActive || alsoActive?.includes(pathname) ? " m3-nav-item--active" : ""}`}
              >
                <Icon size={19} />
                <span className="rf-nav-label">{label}</span>
              </NavLink>
            ))}
            {role === "system_admin" && <AssessmentNavigation onExpand={() => { if (!sidebar.expanded) sidebar.toggle(); }} onNavigate={() => sidebar.close()} />}
          </nav>
        </div>

        <SidebarLogout footerClassName="m3-sidebar-footer" buttonClassName="m3-sidebar-quiet-link" onSignedOut={() => sidebar.close()} />
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

          <ProfileDropdown settingsPath={getProfileRoute(role)} onOpen={sidebar.close} />
        </header>

        <div className="rf-content-scroll" tabIndex={0} role="region" aria-label="Main content"><main className="m3-content">
          <Outlet />
        </main></div>
      </div>
    </div>
  );
}
