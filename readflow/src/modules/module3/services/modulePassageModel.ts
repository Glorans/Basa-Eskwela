import type { ModuleCollectionDraft, ModulePassage, PassageDraft, PassagePublicationPolicy, PassageQuestion } from "../types/modulePassages";
import { isUuid } from "./moduleModel.ts";

// Matches the existing generator's two questions per comprehension category.
// Passage count is a minimum, not a fixed three-passage requirement.
export const PASSAGE_PUBLICATION_POLICY: PassagePublicationPolicy = {
  minimumPassages: 1,
  minimumQuestionsByType: { literal: 2, inferential: 2, critical: 2 },
  maximumQuestionsByType: { literal: 2, inferential: 2, critical: 2 },
};

export function normalizeCollectionDraft(draft: ModuleCollectionDraft, validPathIds: readonly string[]): ModuleCollectionDraft {
  if (!draft.title.trim()) throw new Error("Enter a module title before saving.");
  if (!validPathIds.includes(draft.learningPathId)) throw new Error("Select a valid learning path before saving.");
  if (!["Easy", "Medium", "Hard"].includes(draft.difficulty)) throw new Error("Select a valid difficulty.");
  if (new Set(draft.passages.map(p => p.id)).size !== draft.passages.length) throw new Error("Passage IDs must be unique.");
  return {
    ...draft, title: draft.title.trim(),
    passages: draft.passages.map((p, index) => {
      if (!isUuid(p.id)) throw new Error(`Passage ${index + 1} has an invalid ID.`);
      if (p.sourceMaterialId && !isUuid(p.sourceMaterialId)) throw new Error(`Passage ${index + 1} has invalid source material provenance.`);
      if (p.title.trim().length > 200) throw new Error(`Passage ${index + 1} title exceeds 200 characters.`);
      // Incomplete title/text/questions are allowed while preparing a draft.
      return { ...p, title: p.title.trim(), passageText: p.passageText.trim() };
    }),
  };
}

export function getPassageQuestions(questions: readonly PassageQuestion[], passageId: string): PassageQuestion[] {
  return questions.filter(q => q.passageId === passageId).sort((a, b) => a.displayOrder - b.displayOrder);
}

export function getPassageSummaries(passages: readonly PassageDraft[], questions: readonly PassageQuestion[]) {
  return passages.map((p, index) => {
    const bank = getPassageQuestions(questions, p.id);
    return {
      id: p.id, title: p.title, displayOrder: index + 1, questionCount: bank.length,
      reviewStatus: bank.length === 0 ? "missing" : bank.every(q => q.reviewStatus === "reviewed") ? "reviewed" : "generated",
    };
  });
}

export function getCollectionQuestionCount(passages: readonly PassageDraft[], questions: readonly PassageQuestion[]) {
  return getPassageSummaries(passages, questions).reduce((total, p) => total + p.questionCount, 0);
}

export function getCollectionPublishIssues(
  draft: ModuleCollectionDraft, questions: readonly PassageQuestion[], validPathIds: readonly string[],
  policy: PassagePublicationPolicy = PASSAGE_PUBLICATION_POLICY,
): string[] {
  try { normalizeCollectionDraft(draft, validPathIds); }
  catch (error) { return [error instanceof Error ? error.message : "Invalid module."]; }
  const issues: string[] = [];
  if (draft.passages.length < policy.minimumPassages) issues.push(`At least ${policy.minimumPassages} passage is required.`);
  draft.passages.forEach((p, index) => {
    const label = `Passage ${index + 1}`;
    const bank = getPassageQuestions(questions, p.id);
    if (!p.title.trim()) issues.push(`${label} needs a title.`);
    if (!p.passageText.trim()) issues.push(`${label} needs reading text.`);
    if (!bank.length) { issues.push(`${label} has no reviewed comprehension questions.`); return; }
    if (bank.some(q => q.reviewStatus !== "reviewed")) issues.push(`${label} has questions that need review.`);
    for (const type of ["literal", "inferential", "critical"] as const) {
      if (bank.filter(q => q.type === type).length < policy.minimumQuestionsByType[type]) {
        issues.push(`${label} needs at least ${policy.minimumQuestionsByType[type]} ${type} questions.`);
      }
      if (policy.maximumQuestionsByType && bank.filter(q => q.type === type).length > policy.maximumQuestionsByType[type]) {
        issues.push(`${label} requires exactly ${policy.maximumQuestionsByType[type]} ${type} questions.`);
      }
    }
    if (new Set(bank.map(q => q.id)).size !== bank.length || new Set(bank.map(q => q.displayOrder)).size !== bank.length) {
      issues.push(`${label} has duplicate questions or ordering.`);
    }
    if (bank.some(q => !q.questionText.trim() || !q.scaffoldingHint.trim()
      || !["literal", "inferential", "critical"].includes(q.type)
      || !Number.isInteger(q.displayOrder) || q.displayOrder < 1
      || q.options.length !== 4 || q.options.some(o => !o.trim())
      || new Set(q.options.map(o => o.trim().toLowerCase())).size !== 4)) {
      issues.push(`${label} has invalid question content.`);
    }
  });
  return issues;
}

export function updatePassage(passages: readonly PassageDraft[], id: string, changes: Pick<PassageDraft, "title" | "passageText">) {
  if (!passages.some(p => p.id === id)) throw new Error("Passage not found.");
  return passages.map(p => p.id === id ? { ...p, title: changes.title, passageText: changes.passageText } : p);
}

export function movePassage(passages: readonly PassageDraft[], id: string, direction: -1 | 1) {
  const result = [...passages];
  const from = result.findIndex(p => p.id === id);
  if (from < 0) throw new Error("Passage not found.");
  const to = from + direction;
  if (to >= 0 && to < result.length) [result[from], result[to]] = [result[to], result[from]];
  return result;
}

export function removeEmptyPassage(passages: readonly PassageDraft[], id: string, questions: readonly PassageQuestion[]) {
  if (!passages.some(p => p.id === id)) throw new Error("Passage not found.");
  if (getPassageQuestions(questions, id).length) throw new Error("Remove the passage question bank before deleting this passage.");
  return passages.filter(p => p.id !== id);
}

export function legacyModulePassage(module: {
  id: string; title: string; passage: string | null; source_material_id: string | null; created_at: string; updated_at: string;
}): ModulePassage[] {
  if (!module.passage?.trim()) return [];
  return [{
    id: module.id, moduleId: module.id, title: module.title, passageText: module.passage,
    displayOrder: 1, sourceMaterialId: module.source_material_id,
    createdAt: module.created_at, updatedAt: module.updated_at,
  }];
}
