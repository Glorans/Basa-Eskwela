import { supabase } from "../../../lib/supabaseClient";
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProposedPassageDatabase } from '../types/proposedPassageDatabase';
import { formatPublishIssues } from "../utils/publishIssues.ts";
import type { ModuleFormValues, ModuleStatus, ReadingModule } from "../types/content";
import {
  buildCreateModulePayload,
  buildUpdateModulePayload,
  isUuid,
  loadMappedModules,
  mapLearningPathRow,
  mapModuleRow,
  type ModuleQueryRow,
} from "./moduleModel";

const MODULE_SELECT = `
  id,
  path_id,
  title,
  difficulty,
  status,
  collection_revision,
  created_by,
  created_at,
  published_at,
  passage,
  source_material_id,
  updated_at,
  learning_paths!modules_path_id_fkey (
    id,
    path_name,
    language,
    reading_level,
    difficulty_tier,
    description
  ),
  comprehension_questions(count)
` as const;

/** The database content check's own message (categories and line only), or null for any other error. */
export function contentCheckMessage(error: unknown): string | null {
  const value = error as { code?: unknown; message?: unknown } | null;
  return value && value.code === "PT422" && typeof value.message === "string" && value.message.startsWith("Content check:")
    ? value.message
    : null;
}

export class ModuleServiceError extends Error {
  readonly causeValue?: unknown;

  constructor(message: string, causeValue?: unknown) {
    // The database content check (m3_content_screen_v1) explains what to edit; show it instead of the generic text.
    super(contentCheckMessage(causeValue) ?? message);
    this.name = "ModuleServiceError";
    this.causeValue = causeValue;
  }
}

function mapSingleModule(row: ModuleQueryRow | null, missingMessage: string): ReadingModule {
  if (!row) {
    throw new ModuleServiceError(missingMessage);
  }

  return mapModuleRow(row);
}

async function getAuthenticatedUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    throw new ModuleServiceError("You must be signed in to manage reading modules.", error);
  }

  return data.user.id;
}

export async function getLearningPaths() {
  const { data, error } = await supabase
    .from("learning_paths")
    .select("id, path_name, language, reading_level, difficulty_tier, description")
    .order("path_name", { ascending: true });

  if (error) {
    throw new ModuleServiceError("Unable to load learning paths.", error);
  }

  return data.map(mapLearningPathRow);
}

export async function getModules(): Promise<ReadingModule[]> {
  const { data, error } = await supabase
    .from("modules")
    .select(MODULE_SELECT)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    throw new ModuleServiceError("Unable to load reading modules.", error);
  }

  return loadMappedModules(async () => data);
}

export async function getModuleById(moduleId: string): Promise<ReadingModule | undefined> {
  if (!isUuid(moduleId)) {
    return undefined;
  }

  const { data, error } = await supabase
    .from("modules")
    .select(MODULE_SELECT)
    .eq("id", moduleId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new ModuleServiceError("Unable to load the reading module.", error);
  }

  return data ? mapModuleRow(data) : undefined;
}

export async function createModule(values: ModuleFormValues): Promise<ReadingModule> {
  const userId = await getAuthenticatedUserId();
  const path = await getSelectedLearningPath(values.learningPathId);
  const payload = buildCreateModulePayload(values, userId, path);
  const { data, error } = await supabase
    .from("modules")
    .insert(payload)
    .select(MODULE_SELECT)
    .single();

  if (error) {
    throw new ModuleServiceError("Unable to create the module. Check your access and try again.", error);
  }

  return mapSingleModule(data, "The created module could not be loaded.");
}

export async function updateModule(
  moduleId: string,
  values: ModuleFormValues,
): Promise<ReadingModule> {
  const path = await getSelectedLearningPath(values.learningPathId);
  const payload = buildUpdateModulePayload(values, path);
  const { data, error } = await supabase
    .from("modules")
    .update(payload)
    .eq("id", moduleId)
    .select(MODULE_SELECT)
    .maybeSingle();

  if (error) {
    throw new ModuleServiceError("Unable to update the module. Check your access and try again.", error);
  }

  return mapSingleModule(data, "Module not found or you do not have permission to update it.");
}

async function getSelectedLearningPath(pathId: string) {
  if (!isUuid(pathId)) {
    throw new ModuleServiceError("Select a valid learning path before saving.");
  }
  const { data, error } = await supabase
    .from("learning_paths")
    .select("id, path_name, language, reading_level, difficulty_tier, description")
    .eq("id", pathId)
    .maybeSingle();
  if (error) {
    throw new ModuleServiceError("Unable to verify the selected learning path. Please try again.", error);
  }
  if (!data) {
    throw new ModuleServiceError("Select a valid learning path before saving.");
  }
  return data;
}

async function updateModuleStatus(
  moduleId: string,
  status: ModuleStatus,
  failureMessage: string,
): Promise<ReadingModule> {
  const { data, error } = await supabase
    .from("modules")
    .update({ status })
    .eq("id", moduleId)
    .select(MODULE_SELECT)
    .maybeSingle();

  if (error) {
    throw new ModuleServiceError(failureMessage, error);
  }

  return mapSingleModule(data, failureMessage);
}

export async function publishModule(moduleId: string): Promise<ReadingModule> {
  const { data: issues, error } = await (supabase as unknown as SupabaseClient<ProposedPassageDatabase>)
    .rpc('m3_collection_publish_issues', { target_id: moduleId });
  if (error) throw new ModuleServiceError('Unable to validate module publication.', error);
  if (issues.length) throw new ModuleServiceError(formatPublishIssues(issues), { issues });
  // The live trigger supplies the trusted database timestamp and preserves it
  // as first-publication history; the browser never writes published_at.
  return updateModuleStatus(
    moduleId,
    "published",
    "Unable to publish this module. Check the publication requirements and your access, then try again.",
  );
}

export function unpublishModule(moduleId: string): Promise<ReadingModule> {
  return updateModuleStatus(
    moduleId,
    "draft",
    "Unable to unpublish this module. Check your access and try again.",
  );
}

export function archiveModule(moduleId: string): Promise<ReadingModule> {
  return updateModuleStatus(
    moduleId,
    "archived",
    "Unable to archive this module. Check your access and try again.",
  );
}

export function restoreModule(moduleId: string): Promise<ReadingModule> {
  return updateModuleStatus(
    moduleId,
    "draft",
    "Unable to restore this module. Check your access and try again.",
  );
}

interface DeletionDatabaseError { code?: string; message?: string; }

function deletionDatabaseFailure(operation: string, error: DeletionDatabaseError) {
  const permission = error.code === "42501" || error.code === "PGRST301" || error.code === "PGRST303";
  return new ModuleServiceError(
    `${permission ? "Database permission denied" : "Database check failed"} while ${operation}${error.code ? ` (${error.code})` : ""}: ${error.message || "No database error detail was returned."}`,
    error,
  );
}

export async function deleteModule(moduleId: string): Promise<"permanent" | "soft"> {
  if (!isUuid(moduleId)) throw new ModuleServiceError("This module is unavailable. Reload the module list.");
  const { data, error } = await (supabase as unknown as SupabaseClient<ProposedPassageDatabase>)
    .rpc("m3_delete_module", { target_id: moduleId });
  if (error) throw deletionDatabaseFailure("deleting this module", error);
  if (data !== "permanent" && data !== "soft") {
    throw new ModuleServiceError("The database did not confirm deletion. Refresh the list before retrying.");
  }
  return data;
}

// ==========================
// TRASH (proposed m3_module_trash)
// ==========================
// "Delete Reading Module" moves a module to the Trash once m3_trashed_modules() exists. Until then
// getTrashedModules returns null and the existing m3_delete_module flow is used unchanged.

export interface TrashedModule {
  id: string;
  title: string;
  statusBefore: string;
  trashedAt: string;
  trashedByName: string;
  everPublished: boolean;
  hasHistory: boolean;
}

type TrashClient = { rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: DeletionDatabaseError | null }> };
const trashClient = () => supabase as unknown as TrashClient;

/** Null when the Trash is not installed (or cannot be read): callers keep the existing Delete. */
export async function getTrashedModules(): Promise<TrashedModule[] | null> {
  try {
    const { data, error } = await trashClient().rpc("m3_trashed_modules");
    if (error || !Array.isArray(data)) return null;
    return data.map((row: Record<string, unknown>) => ({
      id: String(row.id), title: String(row.title ?? "Untitled module"), statusBefore: String(row.status_before ?? ""),
      trashedAt: String(row.trashed_at ?? ""), trashedByName: String(row.trashed_by_name ?? "Admin"),
      everPublished: row.ever_published === true, hasHistory: row.has_history === true,
    }));
  } catch {
    return null;
  }
}

async function trashAction(name: "m3_trash_module" | "m3_restore_module" | "m3_purge_module" | "m3_republish_module", moduleId: string, operation: string) {
  if (!isUuid(moduleId)) throw new ModuleServiceError("This module is unavailable. Reload the module list.");
  const { data, error } = await trashClient().rpc(name, { target_id: moduleId });
  if (error) {
    if (name === "m3_purge_module" && error.code === "P0001"
        && error.message === "Deleted modules are retained for history and cannot be changed") {
      throw new ModuleServiceError(
        "Permanent deletion could not finish because a database protection blocked question-bank cleanup. The module remains in Trash and nothing was deleted. Ask an administrator to check the deletion setup.",
        error,
      );
    }
    // Refusals written for Admins (history, not in Trash) are shown as they are.
    if (error.code === "23503" || error.code === "22023") throw new ModuleServiceError(error.message || `Unable to ${operation}.`, error);
    // Publish Again refusals are written for Teachers (e.g. "archived by the School Admin") and publish-validation
    // failures list what to fix: show them as they are.
    if (name === "m3_republish_module" && error.message) throw new ModuleServiceError(error.message, error);
    throw deletionDatabaseFailure(operation, error);
  }
  return String(data);
}

export const trashModule = (moduleId: string) => trashAction("m3_trash_module", moduleId, "moving this module to the Trash");
/** Returns "draft" or "archived" (ever-published modules come back hidden and need a normal Publish). */
export const restoreTrashedModule = (moduleId: string) => trashAction("m3_restore_module", moduleId, "restoring this module");
export const purgeTrashedModule = (moduleId: string) => trashAction("m3_purge_module", moduleId, "permanently deleting this module");
/** Teacher Publish Again: the owner republishes a module they restored from their own Trash. Validated by the
 * database exactly like a first publication; never called automatically by Restore. Returns "published". */
export const republishModule = (moduleId: string) => trashAction("m3_republish_module", moduleId, "publishing this module again");

export function getModuleErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
