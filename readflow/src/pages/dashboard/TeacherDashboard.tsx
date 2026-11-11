import { ChartNoAxesCombined, ClipboardList, Mic2, School, TriangleAlert, Users } from "lucide-react";
import { Link } from "react-router-dom";
import useAuthenticatedProfile from "../../hooks/useAuthenticatedProfile";
import { getProfileDisplayName } from "../../modules/module1/utils/profileFields";
import { getTeacherClassrooms, isRoomArchived } from "../../modules/module4/services/classroomService";
import { getTeacherOralReadingAttempts } from "../../modules/module5/services/oralReadingService";
import { m7Request, type Student, type TeacherData } from "../../modules/module7/services/m7Service";
import { formatScore } from "../../modules/module7/services/scoreDisplay";
import { isActiveWarning } from "../../modules/module7/services/studentSupportClassification";
import { DashboardHero, DashboardSection, EmptyState, LoadedList, QuickActions, StatCard, formatDate, useLoad, valueOf, type Load } from "./DashboardKit";

const studentName = (student: Student) => student.nickname?.trim() || student.full_name?.trim() || "Student";

export default function TeacherDashboard() {
  const { profile } = useAuthenticatedProfile();
  const teacherId = profile?.id ?? null;
  // Only the Teacher's own rooms, and M7's existing Teacher scope (Students enrolled in those rooms).
  const rooms = useLoad(teacherId ? () => getTeacherClassrooms(teacherId) : null, [teacherId]);
  const analytics = useLoad(() => m7Request<TeacherData>("/teacher"), []);
  const readings = useLoad(getTeacherOralReadingAttempts, []);

  // Existing M7 classification only; no new risk calculation.
  const needingSupport: Load<Student[]> = analytics.status === "ready"
    ? { status: "ready", data: analytics.data.students.filter((s) => isActiveWarning(s.classification)).slice(0, 5) } : analytics;
  const recentReadings: Load<Awaited<ReturnType<typeof getTeacherOralReadingAttempts>>> = readings.status === "ready"
    ? { status: "ready", data: [...readings.data].sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt))).slice(0, 5) } : readings;
  const name = profile ? getProfileDisplayName(profile) : "";

  return (
    <div className="rd-page">
      <DashboardHero eyebrow="Classroom Overview" title={name ? `Welcome, ${name}` : "Welcome, Teacher"}>
        Your Learning Rooms, Students and recent reading results at a glance.
      </DashboardHero>

      <div className="rd-stats" aria-label="Classroom summary">
        <StatCard icon={School} value={valueOf(rooms, (list) => list.filter((room) => !isRoomArchived(room)).length)} label="Active Learning Rooms" to="/m3/teacher/learning-rooms" />
        <StatCard icon={Users} value={valueOf(analytics, (data) => data.students.length)} label="Enrolled Students" to="/m3/teacher/student-support" />
        <StatCard icon={TriangleAlert} value={valueOf(analytics, (data) => data.students.filter((s) => isActiveWarning(s.classification)).length)} label="Students needing support" to="/m3/teacher/student-support" />
        <StatCard icon={Mic2} value={valueOf(readings, (list) => list.length)} label="Saved oral readings" to="/m3/teacher/oral-reading" />
      </div>

      <div className="rd-grid">
        <DashboardSection title="Quick actions">
          <QuickActions actions={[
            { label: "Open Learning Rooms", to: "/m3/teacher/learning-rooms", icon: School },
            { label: "Assign Reading Activities", to: "/m3/teacher/learning-rooms", icon: ClipboardList },
            { label: "Review Oral Reading Assessments", to: "/m3/teacher/oral-reading", icon: Mic2 },
            { label: "View Student Performance", to: "/m3/teacher/analytics", icon: ChartNoAxesCombined, secondary: true },
          ]} />
          <p className="rd-note">Reading activities are assigned from inside each Learning Room.</p>
        </DashboardSection>

        <DashboardSection title="Students needing support">
          <LoadedList
            load={needingSupport}
            errorText="Student support information could not be loaded."
            empty={<EmptyState>No Students currently need support based on their saved comprehension results.</EmptyState>}
            render={(student) => (
              <li key={student.id}>
                <strong>{studentName(student)}</strong>
                <span className="rd-muted">{student.classification} · <Link to="/m3/teacher/student-support">Open support</Link></span>
              </li>
            )}
          />
        </DashboardSection>

        <DashboardSection title="Recent oral reading results">
          <LoadedList
            load={recentReadings}
            errorText="Recent reading results could not be loaded."
            empty={<EmptyState>No Student oral readings have been saved yet.</EmptyState>}
            render={(attempt) => (
              <li key={attempt.id}>
                <span><strong>{attempt.learnerName}</strong> <span className="rd-muted">{attempt.passageTitle || attempt.moduleTitle}</span></span>
                <span className="rd-muted">{formatScore(Math.round(attempt.pronunciationAccuracy))} · {formatDate(attempt.completedAt)} · <Link to={`/m3/teacher/oral-reading/${encodeURIComponent(attempt.id)}`}>Review</Link></span>
              </li>
            )}
          />
        </DashboardSection>
      </div>
    </div>
  );
}
