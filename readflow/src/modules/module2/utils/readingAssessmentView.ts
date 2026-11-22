/**
 * Pure display helpers for the learner "My Reading Assessment" page (M2 F3/F4/F5). Nothing here classifies or
 * recalculates a reading level: every level, message and note comes from the server's progress and history data.
 */
import type { LanguageProgress, ProgressPoint } from "../services/readingProgress";

export type AssessmentLanguage = "en" | "fil";

export const ASSESSMENT_LANGUAGES: readonly { code: AssessmentLanguage; label: string }[] = [
  { code: "en", label: "English" },
  { code: "fil", label: "Filipino" },
];

export const READING_ASSESSMENT_TABS = ["Reading Level", "Reading Progress", "Assessment History"] as const;

export function languageLabel(code: AssessmentLanguage) {
  return code === "fil" ? "Filipino" : "English";
}

/** Short, child-friendly meaning of each level (same wording as the diagnostic result page). */
export const LEVEL_DETAILS: Record<string, { title: string; summary: string }> = {
  Independent: { title: "Independent Reader", summary: "You can read and understand the story mostly by yourself." },
  Instructional: { title: "Instructional Reader", summary: "You can read the story with a little help and practice." },
  Frustration: {
    title: "Let's Practice Together",
    summary: "The story is difficult right now, so an easier story and extra support may help.",
  },
};

/** The saved result the official classification comes from (the server names its type and date). */
export function officialSource(progress: LanguageProgress): ProgressPoint | null {
  const current = progress.current;
  if (!current) return null;
  if (current.source === "initial") return progress.initial ?? null;
  const matches = progress.reassessments.filter((point) => point.completedAt === current.completedAt);
  return matches[matches.length - 1] ?? progress.reassessments[progress.reassessments.length - 1] ?? null;
}

export function sourceLabel(point: Pick<ProgressPoint, "assessmentType">) {
  return point.assessmentType === "reassessment" ? "Reassessment" : "Initial diagnostic";
}

/**
 * The newest official reassessment, but only when it is NOT the source of the official level and its level differs
 * from the official one (e.g. the placement switch is OFF). Otherwise null, so nothing suggests the level changed.
 */
export function differingLatestReassessment(progress: LanguageProgress): ProgressPoint | null {
  const current = progress.current;
  const latest = progress.reassessments[progress.reassessments.length - 1];
  if (!current || !latest) return null;
  const source = officialSource(progress);
  if (source && source.id === latest.id) return null;
  return latest.readingLevel !== current.readingLevel ? latest : null;
}

/** Initial diagnostic first, then reassessments in the order the server returns them (oldest first). */
export function progressTimeline(progress: LanguageProgress) {
  const points: { point: ProgressPoint; label: string }[] = [];
  if (progress.initial) points.push({ point: progress.initial, label: "Initial diagnostic" });
  progress.reassessments.forEach((point, index) => points.push({ point, label: `Reassessment ${index + 1}` }));
  return points;
}

const MEMORY_KEY = "basa:m2-reading-assessment";

/** The chosen tab and language survive a visit to another page (this browser tab only; nothing is saved elsewhere). */
export function readViewMemory(): { tab: number; language: AssessmentLanguage } {
  try {
    const saved = JSON.parse(sessionStorage.getItem(MEMORY_KEY) || "{}") as { tab?: unknown; language?: unknown };
    const tab = typeof saved.tab === "number" && saved.tab >= 0 && saved.tab < READING_ASSESSMENT_TABS.length ? saved.tab : 0;
    return { tab, language: saved.language === "fil" ? "fil" : "en" };
  } catch {
    return { tab: 0, language: "en" };
  }
}

export function saveViewMemory(view: { tab: number; language: AssessmentLanguage }) {
  try {
    sessionStorage.setItem(MEMORY_KEY, JSON.stringify(view));
  } catch {
    /* optional convenience */
  }
}
