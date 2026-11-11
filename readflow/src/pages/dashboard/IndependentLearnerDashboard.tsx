import { BookOpenCheck, ChartNoAxesCombined, FilePlus2, Files, History, Mic2 } from "lucide-react";
import useAuthenticatedProfile from "../../hooks/useAuthenticatedProfile";
import { getProfileDisplayName } from "../../modules/module1/utils/profileFields";
import { useM3Content } from "../../modules/module3/context/M3ContentContext";
import { getComprehensionForReading } from "../../modules/module6/services/comprehensionService";
import { DashboardHero, DashboardSection, QuickActions, StatCard, useLoad, valueOf, type Load, type QuickAction } from "./DashboardKit";
import { RecentResults, RewardCards, latestReading, loadGamification, loadPersonal } from "./LearnerSections";

export default function IndependentLearnerDashboard() {
  const { profile } = useAuthenticatedProfile();
  // The catalog and the learner's own uploads already loaded by the Independent Learner workspace.
  const { modules, modulesLoading, modulesError, materials, materialsLoading, materialsError } = useM3Content();
  const personal = useLoad(loadPersonal, []);
  const gamification = useLoad(loadGamification, []);
  const published: Load<number> = modulesLoading ? { status: "loading" } : modulesError ? { status: "error", message: modulesError }
    : { status: "ready", data: modules.filter((module) => module.status === "published").length };
  const uploads: Load<number> = materialsLoading ? { status: "loading" } : materialsError ? { status: "error", message: materialsError }
    : { status: "ready", data: materials.length };
  const name = profile ? getProfileDisplayName(profile) : "";
  // Continue Comprehension: the saved M6 activity of the latest reading, from the same read-only lookup the
  // reading result page uses (it never starts an attempt). Shown only while that activity is unfinished.
  const latestId = personal.status === "ready" ? latestReading(personal.data)?.id ?? null : null;
  const linked = useLoad(latestId ? () => getComprehensionForReading(latestId) : null, [latestId]);
  const resume = linked.status === "ready" && linked.data?.status === "in_progress" ? linked.data : null;
  const actions: QuickAction[] = [
    { label: "Start Reading", to: "/m3/general/modules", icon: BookOpenCheck },
    { label: "Upload Reading Material", to: "/m3/general/materials/upload", icon: FilePlus2 },
    ...(resume ? [{ label: "Continue Comprehension", to: `/m3/general/comprehension/${encodeURIComponent(resume.id)}`, icon: Mic2 }] : []),
    { label: "View Reading History", to: "/m3/general/reading-history", icon: History, secondary: true },
    { label: "View Progress and Results", to: "/m3/general/progress", icon: ChartNoAxesCombined, secondary: true },
  ];

  return (
    <div className="rd-page">
      <DashboardHero eyebrow="My Reading Dashboard" title={name ? `Welcome back, ${name}!` : "Welcome back!"}>
        Pick a reading module or practise with your own reading materials.
      </DashboardHero>

      <div className="rd-stats" aria-label="Reading summary">
        <StatCard icon={BookOpenCheck} value={valueOf(published, (n) => n)} label="Reading modules available" to="/m3/general/modules" />
        <StatCard icon={Files} value={valueOf(uploads, (n) => n)} label="My reading materials" to="/m3/general/materials" />
        <RewardCards role="general_user" gamification={gamification} />
      </div>

      <div className="rd-grid">
        <DashboardSection title="Quick actions">
          <QuickActions actions={actions} />
          <p className="rd-note">Continue Comprehension appears when your latest reading has unfinished questions. Any reading result also shows Continue to Questions for its activity.</p>
        </DashboardSection>
        <RecentResults role="general_user" personal={personal} />
      </div>
    </div>
  );
}
