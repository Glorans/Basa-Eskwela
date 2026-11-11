import { BookOpenCheck, ClipboardList, Files, GraduationCap, School, UserCheck, UserRound, Users } from "lucide-react";
import useAuthenticatedProfile from "../../hooks/useAuthenticatedProfile";
import { supabase } from "../../lib/supabaseClient";
import { getManagedUsers, type ManagedUser } from "../../modules/module1/services/adminUsers";
import { getProfileDisplayName } from "../../modules/module1/utils/profileFields";
import { useM3Content } from "../../modules/module3/context/M3ContentContext";
import { isRoomArchived, type Classroom } from "../../modules/module4/services/classroomService";
import { DashboardHero, DashboardSection, EmptyState, LoadedList, QuickActions, StatCard, formatDate, useLoad, valueOf, type Load } from "./DashboardKit";

/** Same query and Admin RLS policy as the Admin Learning Rooms page. */
async function loadRooms(): Promise<Classroom[]> {
  const { data, error } = await supabase.from("rooms").select("*");
  if (error) throw error;
  return (data ?? []) as Classroom[];
}

const isPendingTeacher = (user: ManagedUser) => user.role === "teacher" && user.teacherStatus === "pending";

export default function AdminDashboard() {
  const { profile } = useAuthenticatedProfile();
  const { modules, modulesLoading, modulesError } = useM3Content();
  // Existing Admin sources: GET /api/admin/users (User Management) and rooms (Learning Rooms).
  const users = useLoad(getManagedUsers, []);
  const rooms = useLoad(loadRooms, []);
  const published: Load<number> = modulesLoading ? { status: "loading" } : modulesError ? { status: "error", message: modulesError }
    : { status: "ready", data: modules.filter((module) => module.status === "published").length };
  const count = (predicate: (user: ManagedUser) => boolean) => valueOf(users, (list) => list.filter(predicate).length);
  const pending: Load<ManagedUser[]> = users.status === "ready"
    ? { status: "ready", data: users.data.filter(isPendingTeacher).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 5) } : users;
  const name = profile ? getProfileDisplayName(profile) : "";

  return (
    <div className="rd-page">
      <DashboardHero eyebrow="System Overview" title={name ? `Welcome, ${name}` : "Welcome, Administrator"}>
        A summary of accounts, content and Learning Rooms across Basa Eskwela.
      </DashboardHero>

      <div className="rd-stats" aria-label="System summary">
        <StatCard icon={GraduationCap} value={count((u) => u.role === "student")} label="Students" to="/admin/users" />
        <StatCard icon={UserCheck} value={count((u) => u.role === "teacher" && u.teacherStatus === "approved")} label="Approved Teachers" to="/admin/users" />
        <StatCard icon={UserRound} value={count((u) => u.role === "general_user")} label="Independent Learners" to="/admin/users" />
        <StatCard icon={ClipboardList} value={count(isPendingTeacher)} label="Pending Teacher approvals" to="/admin/teacher-invitations?tab=pending" />
        <StatCard icon={BookOpenCheck} value={valueOf(published, (n) => n)} label="Published reading modules" to="/m3/admin" />
        <StatCard icon={School} value={valueOf(rooms, (list) => list.filter((room) => !isRoomArchived(room)).length)} label="Active Learning Rooms" to="/admin/learning-rooms" />
      </div>
      {users.status === "error" && <p className="rd-error" role="alert">Account totals could not be loaded. Open User Management to retry.</p>}

      <div className="rd-grid">
        <DashboardSection title="Quick actions">
          <QuickActions actions={[
            { label: "Manage Content", to: "/m3/admin", icon: Files },
            { label: "Manage Users", to: "/admin/users", icon: Users },
            { label: "Teacher Approvals", to: "/admin/teacher-invitations?tab=pending", icon: UserCheck },
            { label: "Learning Rooms", to: "/admin/learning-rooms", icon: School, secondary: true },
            { label: "View Reports", to: "/admin/reports", icon: ClipboardList, secondary: true },
          ]} />
        </DashboardSection>

        <DashboardSection title="Teachers awaiting approval">
          <LoadedList
            load={pending}
            errorText="Pending approvals could not be loaded."
            empty={<EmptyState>No Teachers are waiting for approval.</EmptyState>}
            render={(user) => (
              <li key={user.id}>
                <strong>{user.fullName?.trim() || "Name not provided"}</strong>
                <span className="rd-muted">Registered {formatDate(user.createdAt)}</span>
              </li>
            )}
          />
        </DashboardSection>
      </div>
    </div>
  );
}
