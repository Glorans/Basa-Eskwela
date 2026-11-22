import { BookOpenCheck, ChartNoAxesCombined, Files, GraduationCap, School, UserCheck, UserRound, Users } from "lucide-react";
import useAuthenticatedProfile from "../../hooks/useAuthenticatedProfile";
import { listSchools, type School as SchoolRow } from "../../modules/module1/services/schools";
import { getProfileDisplayName } from "../../modules/module1/utils/profileFields";
import { m7Request, type PlatformOverview } from "../../modules/module7/services/m7Service";
import { DashboardHero, DashboardSection, EmptyState, LoadedList, QuickActions, StatCard, useLoad, valueOf, type Load } from "./DashboardKit";
import "./systemAdminDashboard.css";

// Existing System Admin sources only, both re-checked as System Admin on the server:
// GET /api/admin/schools (Schools page) and GET /api/analytics/system-admin/overview (Platform Analytics).
// Platform-level totals only: no individual Student records are loaded here.
const loadOverview = () => m7Request<PlatformOverview>("/system-admin/overview");

export default function SystemAdminDashboard() {
  const { profile } = useAuthenticatedProfile();
  const schools = useLoad(listSchools, []);
  const overview = useLoad(loadOverview, []);
  const name = profile ? getProfileDisplayName(profile) : "";
  const recentSchools: Load<SchoolRow[]> = schools.status === "ready"
    ? { status: "ready", data: [...schools.data].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5) } : schools;

  return (
    <div className="rd-page">
      <DashboardHero eyebrow="Platform Overview" title={name ? `Welcome, ${name}` : "Welcome, System Admin"}>
        A summary of schools, accounts and reading content across Basa Eskwela.
      </DashboardHero>

      <div className="rd-stats" aria-label="Platform summary">
        <StatCard icon={School} value={valueOf(schools, (list) => list.length)} label="Schools" to="/system-admin/schools" />
        <StatCard icon={UserCheck} value={valueOf(overview, (o) => o.users.teachers)} label="Teachers" to="/system-admin/users" />
        <StatCard icon={GraduationCap} value={valueOf(overview, (o) => o.users.students)} label="Students" to="/system-admin/users" />
        <StatCard icon={UserRound} value={valueOf(overview, (o) => o.users.independentLearners)} label="Independent Learners" to="/system-admin/independent-learners" />
        <StatCard icon={BookOpenCheck} value={valueOf(overview, (o) => o.modules.published)} label="Published reading modules" to="/system-admin/content" />
        <StatCard icon={ChartNoAxesCombined} value={valueOf(overview, (o) => o.activity.activeLearners7Days)} label="Learners active in the last 7 days" to="/system-admin/analytics" />
      </div>
      {overview.status === "error" && <p className="rd-error" role="alert">Platform totals could not be loaded. Open Platform Analytics to retry.</p>}
      {schools.status === "error" && <p className="rd-error" role="alert">Schools could not be loaded. Open Schools to retry.</p>}

      <div className="rd-grid">
        <DashboardSection title="Quick actions">
          <QuickActions actions={[
            { label: "Manage Schools", to: "/system-admin/schools", icon: School },
            { label: "Manage Users", to: "/system-admin/users", icon: Users },
            { label: "Reading Modules", to: "/system-admin/content", icon: Files },
            { label: "Platform Reports", to: "/system-admin/analytics", icon: ChartNoAxesCombined, secondary: true },
            { label: "Independent Learners", to: "/system-admin/independent-learners", icon: UserRound, secondary: true },
          ]} />
        </DashboardSection>

        <DashboardSection title="Schools">
          <LoadedList
            load={recentSchools}
            errorText="Schools could not be loaded."
            empty={<EmptyState actions={[{ label: "Create School", to: "/system-admin/schools", icon: School }]}>No schools yet.</EmptyState>}
            render={(school) => (
              <li key={school.id}>
                <strong>{school.name}</strong>
                <span className="rd-muted">
                  {school.status === "active" ? "Active" : "Inactive"} · {school.teachers} Teacher{school.teachers === 1 ? "" : "s"} · {school.students} Student{school.students === 1 ? "" : "s"}
                </span>
              </li>
            )}
          />
        </DashboardSection>
      </div>
    </div>
  );
}
