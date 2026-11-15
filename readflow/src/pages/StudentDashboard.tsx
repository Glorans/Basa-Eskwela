import { useLearnerRecommendations } from "../modules/module3/state/useLearnerRecommendations";
import { Link } from "react-router-dom";
import { BookOpen, ChartNoAxesCombined, ClipboardList, History, School } from "lucide-react";
import { PlacementSummary, ReadingLanguageSelector, RecommendedStories } from "../modules/module3/components/LearnerReading";
import useAuthenticatedProfile from "../hooks/useAuthenticatedProfile";
import { useM3Content } from "../modules/module3/context/M3ContentContext";
import { getProfileDisplayName } from "../modules/module1/utils/profileFields";
import { getStudentClassrooms, isRoomArchived } from "../modules/module4/services/classroomService";
import { getMyArchivedRooms, type StudentRoomArchives } from "../modules/module4/services/studentRoomArchive";
import { DashboardHero, DashboardSection, EmptyState, LoadedList, QuickActions, StatCard, useLoad, valueOf, type Load } from "./dashboard/DashboardKit";
import { RecentResults, RewardCards, loadGamification, loadPersonal } from "./dashboard/LearnerSections";
import type { ActivityProgress } from "../modules/module7/services/m7Service";
import "./StudentDashboard.css";

// Rooms the Student archived for themselves (M4). A failed lookup or a database without the migration hides
// nothing, exactly like the Learning Rooms page.
const NO_OWN_ARCHIVE: StudentRoomArchives = { supported: false, roomIds: new Set() };
function loadOwnArchive() {
  return getMyArchivedRooms().catch(() => NO_OWN_ARCHIVE);
}

export default function StudentDashboard() {
  const { modulesError, modulesLoading } = useM3Content();
  const { profile, loading } = useAuthenticatedProfile();
  const { selectedLanguage, setSelectedLanguage, selectedPlacement, recommendedModules, placements } = useLearnerRecommendations();
  const learnerName = !loading && profile ? getProfileDisplayName(profile) : "";
  const studentId = profile?.id ?? null;
  // The Student's own enrolled rooms and records; the same sources as Learning Rooms and Progress & Result.
  const rooms = useLoad(studentId ? () => getStudentClassrooms(studentId) : null, [studentId]);
  const personal = useLoad(loadPersonal, []);
  const gamification = useLoad(loadGamification, []);
  const ownArchive = useLoad(loadOwnArchive, []);
  // Active rooms only: not archived by the Teacher and not archived by the Student for themselves (the same rule
  // as the Learning Rooms list). Enrollments are unchanged; this is only what the count shows.
  const activeRooms: Load<number> = rooms.status !== "ready" ? rooms
    : ownArchive.status !== "ready" ? { status: "loading" }
    : { status: "ready", data: rooms.data.filter((room) => !isRoomArchived(room)
        && !(ownArchive.data.supported && ownArchive.data.roomIds.has(room.id))).length };
  // Unfinished assigned activities in the Student's active rooms; archived rooms are read-only.
  const toDo: Load<ActivityProgress[]> = personal.status !== "ready" ? personal : rooms.status !== "ready" ? rooms
    : { status: "ready", data: (personal.data.activities ?? []).filter((activity) => activity.status !== "Completed"
        && rooms.data.some((room) => room.id === activity.roomId && !isRoomArchived(room))) };
  const noRooms = activeRooms.status === "ready" && activeRooms.data === 0;

  return (
    <div className="rd-page">
      <DashboardHero eyebrow="My Learning Dashboard" title={learnerName ? `Welcome back, ${learnerName}!` : "Welcome back!"}>
        Your Learning Rooms, reading activities and latest results.
      </DashboardHero>

      <div className="rd-stats" aria-label="Learning summary">
        <StatCard icon={School} value={valueOf(activeRooms, (n) => n)} label="My Learning Rooms" to="/dashboard/join-classroom" />
        <StatCard icon={ClipboardList} value={valueOf(toDo, (list) => list.length)} label="Assigned activities to do" to="/dashboard/join-classroom" />
        <RewardCards role="student" gamification={gamification} />
      </div>

      <div className="rd-grid">
        <DashboardSection title="Quick actions">
          <QuickActions actions={[
            { label: "Continue Reading", to: "/dashboard/materials", icon: BookOpen },
            { label: "Open Learning Rooms", to: "/dashboard/join-classroom", icon: School },
            { label: "View Reading History", to: "/dashboard/reading-history", icon: History, secondary: true },
            { label: "View Progress and Results", to: "/dashboard/progress", icon: ChartNoAxesCombined, secondary: true },
          ]} />
        </DashboardSection>

        <DashboardSection title="Assigned reading activities">
          {noRooms ? (
            <EmptyState actions={[{ label: "Join Learning Room", to: "/dashboard/join-classroom", icon: School }]}>
              You have not joined a Learning Room yet. Ask your Teacher for a room code to see your assigned activities.
            </EmptyState>
          ) : (
            <LoadedList
              load={toDo.status === "ready" ? { status: "ready", data: toDo.data.slice(0, 4) } : toDo}
              errorText="Your assigned activities could not be loaded. Open your Learning Rooms to see them."
              empty={<EmptyState>You are all caught up. No assigned activities are waiting.</EmptyState>}
              render={(activity) => (
                <li key={activity.id}>
                  <strong>{activity.title}</strong>
                  <span className="rd-muted">{activity.status} · <Link to={`/dashboard/learning-rooms/${encodeURIComponent(activity.roomId)}`}>Open</Link></span>
                </li>
              )}
            />
          )}
        </DashboardSection>

        <RecentResults role="student" personal={personal} />
      </div>

      <h2>Your Reading Levels</h2>
      <div className="m3-placement-grid">
        <PlacementSummary placement={placements.en} />
        <PlacementSummary placement={placements.fil} />
      </div>
      <ReadingLanguageSelector language={selectedLanguage} onChange={setSelectedLanguage} />
      <RecommendedStories placement={selectedPlacement} modules={recommendedModules.slice(0, 4)} loading={modulesLoading} failed={!!modulesError} />
      <Link className="basa-view-all" to="/dashboard/materials">View all reading materials &gt;</Link>
    </div>
  );
}
