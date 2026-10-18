import { useEffect, useState } from "react";
import { ReadingLanguageSelector, PlacementSummary, RecommendedStories, LearnerModuleCards } from "../modules/module3/components/LearnerReading";
import { filterLearnerCatalog } from "../modules/module3/state/learnerCatalog";
import { useM3Content } from "../modules/module3/context/M3ContentContext";
import type { ModuleDifficulty } from "../modules/module3/types/content";
import "./MyMaterials.css";
import { useLearnerRecommendations } from "../modules/module3/state/useLearnerRecommendations";

const FILTERS: ("All" | ModuleDifficulty)[] = ["All", "Easy", "Medium", "Hard"];

export default function MyMaterials() {
  const { modulesError, modulesLoading, refreshModules } = useM3Content();
  useEffect(() => { void refreshModules(); }, [refreshModules]);
  const { selectedLanguage, setSelectedLanguage, selectedPlacement, recommendedModules, allPublishedModules } = useLearnerRecommendations();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");

  const visibleModules = filterLearnerCatalog(allPublishedModules, selectedLanguage, filter);

  return (
    <>
      <h1 className="basa-page-title">My Materials</h1>
      <ReadingLanguageSelector language={selectedLanguage} onChange={setSelectedLanguage} />
      <PlacementSummary placement={selectedPlacement} />
      <RecommendedStories placement={selectedPlacement} modules={recommendedModules} loading={modulesLoading} failed={!!modulesError} />

      <section className="m3-reading-section" aria-label="All Reading Materials">
      <h2>All Reading Materials</h2>
      <div className="basa-filter-row m3-catalog-filters" role="group" aria-label="Story difficulty">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`basa-filter-pill ${filter === f ? "basa-filter-pill--active" : ""}`}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      {modulesLoading ? (
        <p className="basa-empty-note" role="status">Loading published modules...</p>
      ) : modulesError ? (
        <p className="basa-empty-note" role="alert">We couldn't load the stories. Please reload the page to try again.</p>
      ) : (
        <>
          <LearnerModuleCards modules={visibleModules} />

          {visibleModules.length === 0 && (
            <p className="basa-empty-note">No published modules match this filter yet.</p>
          )}
        </>
      )}
      </section>
    </>
  );
}
