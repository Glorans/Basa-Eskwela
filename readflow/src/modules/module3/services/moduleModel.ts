import type { Tables, TablesInsert, TablesUpdate } from "../../../lib/database.types";
import type {
  LearningPath,
  ModuleDifficulty,
  ModuleFormValues,
  ModuleStatus,
  ReadingModule,
  StudentReadingModule,
} from "../types/content";

export type LearningPathRow = Tables<"learning_paths">;
export type ModuleRow = Tables<"modules">;

export type ModuleQueryRow = ModuleRow & {
  learning_paths: LearningPathRow | null;
  comprehension_questions: Array<{ count: number }>;
};

const MODULE_DIFFICULTIES: readonly ModuleDifficulty[] = ["Easy", "Medium", "Hard"];
const MODULE_STATUSES: readonly ModuleStatus[] = ["draft", "published", "archived"];

export class ModuleDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModuleDataError";
  }
}

function requireModuleDifficulty(value: string): ModuleDifficulty {
  if (MODULE_DIFFICULTIES.includes(value as ModuleDifficulty)) {
    return value as ModuleDifficulty;
  }

  throw new ModuleDataError("A module contains an unsupported difficulty value.");
}

function requireModuleStatus(value: string): ModuleStatus {
  if (MODULE_STATUSES.includes(value as ModuleStatus)) {
    return value as ModuleStatus;
  }

  throw new ModuleDataError("A module contains an unsupported status value.");
}

function normalizeModuleValues(values: ModuleFormValues): ModuleFormValues {
  const title = values.title.trim();
  const passage = values.passage.trim();

  if (!title) {
    throw new ModuleDataError("Enter a module title before saving.");
  }

  if (!values.learningPathId) {
    throw new ModuleDataError("Select a valid learning path before saving.");
  }

  if (!MODULE_DIFFICULTIES.includes(values.difficulty)) {
    throw new ModuleDataError("Select Easy, Medium, or Hard difficulty.");
  }

  if (!passage) {
    throw new ModuleDataError("Enter a reading passage before saving.");
  }

  return { ...values, title, passage };
}

// Learning-path language aliases, shared with adminModuleExtraction.
export function normalizeLanguageAlias(value: unknown): LearningPath["language"] | null {
  switch (typeof value === 'string' ? value.trim().toLowerCase() : '') {
    case "en": case "english": return "en";
    case "fil": case "filipino": case "tagalog": return "fil";
    default: return null;
  }
}

export function requirePathLanguage(value: unknown): LearningPath["language"] {
  const language = normalizeLanguageAlias(value);
  if (!language) throw new ModuleDataError("A learning path contains an unsupported language value.");
  return language;
}

function requirePathReadingLevel(value: string): LearningPath["readingLevel"] {
  if (value === "Independent" || value === "Instructional" || value === "Frustration") return value;
  throw new ModuleDataError("A learning path contains an unsupported reading-level value.");
}

function requirePathDifficultyTier(value: string): ModuleDifficulty {
  if (value === "Easy" || value === "Medium" || value === "Hard") return value;
  throw new ModuleDataError("A learning path contains an unsupported difficulty-tier value.");
}

export function mapLearningPathRow(row: LearningPathRow): LearningPath {
  return {
    id: row.id,
    name: row.path_name,
    language: requirePathLanguage(row.language),
    readingLevel: requirePathReadingLevel(row.reading_level),
    difficultyTier: requirePathDifficultyTier(row.difficulty_tier),
  };
}

export function mapModuleRow(row: ModuleQueryRow): ReadingModule {
  if (!row.learning_paths) {
    throw new ModuleDataError("A module references an unavailable learning path.");
  }

  const path = mapLearningPathRow(row.learning_paths);
  return {
    id: row.id,
    title: row.title,
    difficulty: requireModuleDifficulty(row.difficulty),
    learningPathId: row.path_id,
    learningPath: path.name,
    language: path.language,
    readingLevel: path.readingLevel,
    difficultyTier: path.difficultyTier,
    status: requireModuleStatus(row.status),
    createdAt: row.created_at,
    publishedAt: row.published_at ?? undefined,
    passage: row.passage ?? "",
    questionCount: row.comprehension_questions[0]?.count ?? 0,
    sourceMaterialId: row.source_material_id ?? undefined,
  };
}

export function mapModuleRows(rows: ModuleQueryRow[]): ReadingModule[] {
  return rows.map(mapModuleRow);
}

export async function loadMappedModules(
  loadRows: () => Promise<ModuleQueryRow[]>,
): Promise<ReadingModule[]> {
  return mapModuleRows(await loadRows());
}

export function toStudentReadingModule(module: ReadingModule): StudentReadingModule {
  return {
    id: module.id,
    title: module.title,
    difficulty: module.difficulty,
    learningPath: module.learningPath,
    language: module.language,
    readingLevel: module.readingLevel,
    difficultyTier: module.difficultyTier,
    passage: module.passage,
  };
}

export function buildCreateModulePayload(
  values: ModuleFormValues,
  createdBy: string,
  selectedPath: LearningPathRow | null,
): TablesInsert<"modules"> {
  validateSelectedPath(values.learningPathId, selectedPath);
  const normalized = normalizeModuleValues(values);

  return {
    title: normalized.title,
    path_id: normalized.learningPathId,
    difficulty: normalized.difficulty,
    passage: normalized.passage,
    status: "draft",
    created_by: createdBy,
  };
}

export function buildUpdateModulePayload(
  values: ModuleFormValues,
  selectedPath: LearningPathRow | null,
): TablesUpdate<"modules"> {
  validateSelectedPath(values.learningPathId, selectedPath);
  const normalized = normalizeModuleValues(values);

  return {
    title: normalized.title,
    path_id: normalized.learningPathId,
    difficulty: normalized.difficulty,
    passage: normalized.passage,
  };
}

function validateSelectedPath(pathId: string, row: LearningPathRow | null): void {
  if (!row || row.id !== pathId) {
    throw new ModuleDataError("Select a valid learning path before saving.");
  }
  mapLearningPathRow(row);
  // Persist only the relation, never redundant client-supplied placement metadata.
  // Module difficulty remains the independent content/catalog difficulty.
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
