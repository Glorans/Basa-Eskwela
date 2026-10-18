import { useLearnerRecommendations } from "../modules/module3/state/useLearnerRecommendations";
import { Link } from "react-router-dom";
import { PlacementSummary, ReadingLanguageSelector, RecommendedStories } from "../modules/module3/components/LearnerReading";
import useAuthenticatedProfile from "../hooks/useAuthenticatedProfile";
import { useM3Content } from "../modules/module3/context/M3ContentContext";
import { getProfileDisplayName } from "../modules/module1/utils/profileFields";
import "./StudentDashboard.css";

export default function StudentDashboard() {
  const { modulesError, modulesLoading } = useM3Content();
  const { profile, loading } = useAuthenticatedProfile();
  const { selectedLanguage, setSelectedLanguage, selectedPlacement, recommendedModules, placements } = useLearnerRecommendations();
  const learnerName = !loading && profile ? getProfileDisplayName(profile) : "";

  return (
    <>
      <h1 className="basa-welcome">
        {learnerName ? `Welcome back, ${learnerName}!` : "Welcome back!"}
      </h1>

      <h2>Your Reading Levels</h2>
      <div className="m3-placement-grid">
        <PlacementSummary placement={placements.en} />
        <PlacementSummary placement={placements.fil} />
      </div>
      <ReadingLanguageSelector language={selectedLanguage} onChange={setSelectedLanguage} />
      <RecommendedStories placement={selectedPlacement} modules={recommendedModules.slice(0, 4)} loading={modulesLoading} failed={!!modulesError} />
      <Link className="basa-view-all" to="/dashboard/materials">View all reading materials &gt;</Link>
    </>
  );
}
