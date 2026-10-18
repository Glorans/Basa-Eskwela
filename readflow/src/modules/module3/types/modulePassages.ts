import type { ModuleDifficulty, QuestionType } from "./content";

// Proposed passage schema contracts. Keep database.types.ts tied to the live schema
// until the reviewed migration is applied and types can be regenerated.
export interface ModulePassage {
  id: string;
  moduleId: string;
  title: string;
  passageText: string;
  displayOrder: number;
  sourceMaterialId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PassageDraft {
  id: string;
  title: string;
  passageText: string;
  sourceMaterialId: string | null;
}

export interface ModuleCollectionDraft {
  title: string;
  learningPathId: string;
  difficulty: ModuleDifficulty;
  passages: PassageDraft[];
}

// Deliberately answer-free. Admin review uses a separate privileged contract.
export interface PassageQuestion {
  id: string;
  passageId: string;
  type: QuestionType;
  questionText: string;
  options: [string, string, string, string];
  scaffoldingHint: string;
  displayOrder: number;
  reviewStatus: "generated" | "reviewed";
}

export interface PassagePublicationPolicy {
  minimumPassages: number;
  minimumQuestionsByType: Record<QuestionType, number>;
  maximumQuestionsByType?: Record<QuestionType, number>;
}
