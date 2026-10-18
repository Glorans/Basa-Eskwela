import { useEffect, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import { useM3Content } from "../context/M3ContentContext";
import { getLearnerPlacement, type LearnerPlacement } from "../services/learnerPlacement";
import { getRecommendedStudentModules } from "./studentModuleState";
import type { MaterialLanguageCode } from "../types/content";

type PlacementState = LearnerPlacement | { status: "loading" | "error"; language: MaterialLanguageCode };
type Placements = Record<MaterialLanguageCode, PlacementState>;
const loadingPlacements = (): Placements => ({ en: { status: "loading", language: "en" }, fil: { status: "loading", language: "fil" } });

export function useLearnerRecommendations() {
  const { user } = useAuth();
  const { modules, studentModules } = useM3Content();
  const [selectedLanguage, setSelectedLanguage] = useState<MaterialLanguageCode>("en");
  const [loaded, setLoaded] = useState<{ userId: string; placements: Placements }>();
  useEffect(() => {
    let cancelled = false;
    const userId = user?.id;
    if (!userId) return;
    setLoaded({ userId, placements: loadingPlacements() });
    for (const language of ["en", "fil"] as const) {
      void getLearnerPlacement(language).catch(() => ({ status: "error", language } as const)).then(placement => {
        if (!cancelled) setLoaded(current => ({ userId,
          placements: { ...(current?.userId === userId ? current.placements : loadingPlacements()), [language]: placement } }));
      });
    }
    return () => { cancelled = true; };
  }, [user?.id]);
  const placements = loaded?.userId === user?.id && loaded ? loaded.placements : loadingPlacements();
  const selectedPlacement = placements[selectedLanguage];
  const recommendedModules = getRecommendedStudentModules(modules, selectedLanguage,
    selectedPlacement.status === "ready" || selectedPlacement.status === "missing" ? selectedPlacement : undefined);
  return { selectedLanguage, setSelectedLanguage, placements, selectedPlacement,
    recommendedModules, allPublishedModules: studentModules };
}
