import type { ReadingModule, StudentReadingModule } from "../types/content";

import { toStudentReadingModule } from "../services/moduleModel.ts";
import type { LearnerPlacement } from "../services/learnerPlacement";
import type { MaterialLanguageCode } from "../types/content";

export function getRecommendedStudentModules(
  modules: ReadingModule[],
  language: MaterialLanguageCode,
  placement?: LearnerPlacement,
): StudentReadingModule[] {
  if (placement?.status !== "ready" || placement.language !== language) return [];
  return getPublishedStudentModules(modules).filter(module =>
    module.language === language && module.readingLevel === placement.readingLevel
    && module.difficultyTier === placement.difficultyTier);
}

// Supabase RLS is the authorization boundary. This status filter only shapes
// already-authorized rows for Student presentation.
export function getPublishedStudentModules(
  modules: ReadingModule[],
): StudentReadingModule[] {
  return modules
    .filter((module) => module.status === "published")
    .map(toStudentReadingModule);
}

export function getPublishedStudentModule(
  modules: ReadingModule[],
  moduleId: string | undefined,
) {
  if (!moduleId) return undefined;

  const module = modules.find(
    (candidate) => candidate.id === moduleId && candidate.status === "published",
  );
  return module ? toStudentReadingModule(module) : undefined;
}

export function getStudentModuleAction(moduleId: string) {
  return {
    label: "Read",
    to: `/dashboard/materials/${moduleId}`,
  } as const;
}
