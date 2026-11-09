// Unsaved Create/Edit Reading Module work kept on this device so that leaving the
// page or refreshing does not destroy it. Only the editable text fields are stored:
// never files, tokens, question banks or learner data. Keys are scoped to the
// signed-in account and to one module ("new" for Create Reading Module).

const PREFIX = "basa:m3-module-draft:v1:";
export const DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export interface DraftPassage {
  id: string;
  title: string;
  passageText: string;
  sourceMaterialId: string | null;
}

export interface ModuleDraft {
  version: 1;
  userId: string;
  moduleKey: string;
  savedAt: number;
  /** Saved module revision the edits started from (edit mode only). */
  baseRevision: number | null;
  collectionId: string;
  title: string;
  learningPathId: string;
  difficulty: string;
  language: string | null;
  readingLevel: string | null;
  passages: DraftPassage[];
  removed: string[];
}

interface EditableCollection {
  id: string;
  title: string;
  learningPathId: string;
  difficulty: string;
  revision: number;
  passages: (DraftPassage & { displayOrder: number; questions: unknown[] })[];
}

export const draftModuleKey = (mode: "create" | "edit", moduleId?: string) =>
  mode === "create" ? "new" : moduleId ?? "";

const keyFor = (userId: string, moduleKey: string) => `${PREFIX}${userId}:${moduleKey}`;

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function buildDraft(input: {
  userId: string;
  moduleKey: string;
  mode: "create" | "edit";
  collection: EditableCollection;
  language: string | null;
  readingLevel: string | null;
  removed: string[];
  now?: number;
}): ModuleDraft {
  const { collection } = input;
  return {
    version: 1,
    userId: input.userId,
    moduleKey: input.moduleKey,
    savedAt: input.now ?? Date.now(),
    baseRevision: input.mode === "edit" ? collection.revision : null,
    collectionId: collection.id,
    title: collection.title,
    learningPathId: collection.learningPathId,
    difficulty: collection.difficulty,
    language: input.language,
    readingLevel: input.readingLevel,
    passages: collection.passages.map(({ id, title, passageText, sourceMaterialId }) => ({
      id, title, passageText, sourceMaterialId,
    })),
    removed: [...input.removed],
  };
}

function isDraft(value: unknown, userId: string, moduleKey: string): value is ModuleDraft {
  const draft = value as ModuleDraft | null;
  return Boolean(
    draft
      && draft.version === 1
      && draft.userId === userId
      && draft.moduleKey === moduleKey
      && typeof draft.savedAt === "number"
      && typeof draft.title === "string"
      && Array.isArray(draft.passages)
      && draft.passages.every((p) => p && typeof p.id === "string" && typeof p.passageText === "string" && typeof p.title === "string")
      && Array.isArray(draft.removed),
  );
}

export function writeDraft(draft: ModuleDraft): boolean {
  try {
    storage()?.setItem(keyFor(draft.userId, draft.moduleKey), JSON.stringify(draft));
    return true;
  } catch {
    return false; // Storage full or blocked: the page keeps working without recovery.
  }
}

/** The stored draft for this account and module, or null (expired/foreign/corrupt drafts are removed). */
export function readDraft(userId: string, moduleKey: string, now = Date.now()): ModuleDraft | null {
  const store = storage();
  if (!store || !userId || !moduleKey) return null;
  try {
    const raw = store.getItem(keyFor(userId, moduleKey));
    if (!raw) return null;
    const draft: unknown = JSON.parse(raw);
    if (!isDraft(draft, userId, moduleKey) || now - draft.savedAt > DRAFT_MAX_AGE_MS) {
      store.removeItem(keyFor(userId, moduleKey));
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function clearDraft(userId: string, moduleKey: string) {
  try {
    storage()?.removeItem(keyFor(userId, moduleKey));
  } catch {
    /* nothing to clear */
  }
}

/** Removes every stored module draft on this device (used on explicit logout). */
export function clearAllModuleDrafts() {
  const store = storage();
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    keys.forEach((key) => store.removeItem(key));
  } catch {
    /* storage unavailable */
  }
}

/** True when the draft holds something the loaded module does not. */
export function draftDiffers(draft: ModuleDraft, collection: EditableCollection) {
  const current = buildDraft({
    userId: draft.userId, moduleKey: draft.moduleKey, mode: "create", collection,
    language: draft.language, readingLevel: draft.readingLevel, removed: [], now: 0,
  });
  return (
    draft.title !== current.title
    || draft.learningPathId !== current.learningPathId
    || draft.difficulty !== current.difficulty
    || draft.removed.length > 0
    || JSON.stringify(draft.passages) !== JSON.stringify(current.passages)
  );
}

/** A Create draft has something worth recovering only if any field was filled in. */
export function draftHasContent(draft: ModuleDraft) {
  return Boolean(
    draft.title.trim()
      || draft.learningPathId
      || draft.passages.length > 1
      || draft.passages.some((p) => p.title.trim() || p.passageText.trim()),
  );
}

/**
 * Applies a draft to the module as loaded now. Saved passages keep their current
 * question banks; only titles, text and order come from the draft. When editing a
 * saved module, saved passages the draft does not know about (added elsewhere
 * later) are kept at the end. A Create form's blank starting passage is not saved
 * work, so it is replaced by the draft's passages.
 */
export function applyDraft<C extends EditableCollection>(
  draft: ModuleDraft,
  loaded: C,
  { keepUnlistedPassages }: { keepUnlistedPassages: boolean },
): { collection: C; removed: string[] } {
  const saved = new Map(loaded.passages.map((p) => [p.id, p]));
  const removed = draft.removed.filter((id) => saved.has(id));
  const draftIds = new Set(draft.passages.map((p) => p.id));
  const passages = [
    ...draft.passages.map((p) => {
      const existing = saved.get(p.id);
      return existing
        ? { ...existing, title: p.title, passageText: p.passageText }
        : { id: p.id, title: p.title, passageText: p.passageText, sourceMaterialId: p.sourceMaterialId, displayOrder: 0, questions: [] };
    }),
    ...(keepUnlistedPassages
      ? loaded.passages.filter((p) => !draftIds.has(p.id) && !removed.includes(p.id))
      : []),
  ].map((p, index) => ({ ...p, displayOrder: index + 1 }));

  return {
    collection: {
      ...loaded,
      title: draft.title,
      learningPathId: draft.learningPathId,
      difficulty: draft.difficulty,
      passages,
    } as C,
    removed,
  };
}
