import type { Difficulty, ReadingLevel } from "../../data/dashboardData";
import type { AdminDiagnosticResult } from "../../services/adminDiagnosticResults";

export type ReadingLevelFilter = "" | ReadingLevel;
export type DifficultyFilter = "" | Difficulty;

interface DiagnosticResultFilters {
  searchQuery: string;
  readingLevel: ReadingLevelFilter;
  difficulty: DifficultyFilter;
}

export function filterAdminDiagnosticResults(
  results: AdminDiagnosticResult[],
  filters: DiagnosticResultFilters,
) {
  const normalizedQuery = filters.searchQuery.trim().toLocaleLowerCase();

  return results.filter((result) => {
    const matchesSearch = !normalizedQuery
      || result.learnerName.toLocaleLowerCase().includes(normalizedQuery)
      || (result.email ?? "").toLocaleLowerCase().includes(normalizedQuery);
    const matchesReadingLevel = !filters.readingLevel
      || result.readingLevel === filters.readingLevel;
    const matchesDifficulty = !filters.difficulty
      || result.difficultyTier === filters.difficulty;

    return matchesSearch && matchesReadingLevel && matchesDifficulty;
  });
}
