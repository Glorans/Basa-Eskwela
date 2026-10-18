import type { ReadingModule, StudentReadingModule } from "../types/content";
import type { ModulePassage } from "../types/modulePassages";
import { toStudentReadingModule } from "./moduleModel.ts";

export interface StudentModuleDetail extends StudentReadingModule {
  passages: ModulePassage[];
}

interface DetailSource {
  getModuleById(id: string): Promise<ReadingModule | undefined>;
  getPassages(id: string): Promise<ModulePassage[]>;
}

export async function loadStudentModuleDetail(
  moduleId: string | undefined,
  source: DetailSource,
): Promise<StudentModuleDetail | undefined> {
  if (!moduleId) return undefined;
  const module = await source.getModuleById(moduleId);
  if (!module || module.id !== moduleId || module.status !== "published") return undefined;
  // Both reads use the learner's authenticated client and existing RLS.
  // Errors must propagate: a failed child read is not a legacy module.
  const passages = await source.getPassages(moduleId);
  if (passages.some(passage => passage.moduleId !== moduleId)) {
    throw new Error("The passage does not belong to this module.");
  }
  return {
    ...toStudentReadingModule(module),
    passages: [...passages].sort((a, b) => a.displayOrder - b.displayOrder),
  };
}

export function adjacentPassageId(
  passages: readonly ModulePassage[],
  activePassageId: string | undefined,
  direction: -1 | 1,
): string | undefined {
  const index = passages.findIndex(passage => passage.id === activePassageId);
  if (index < 0) return undefined;
  return passages[index + direction]?.id;
}
