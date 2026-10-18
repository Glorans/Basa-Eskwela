import type { MaterialLanguageCode, ModuleDifficulty, StudentReadingModule } from "../types/content";

/** Browsing filters only: input is the existing published student catalog. */
export function filterLearnerCatalog(modules: StudentReadingModule[], language: MaterialLanguageCode, difficulty: "All" | ModuleDifficulty) {
  return modules.filter(module => module.language === language && (difficulty === "All" || module.difficulty === difficulty));
}
