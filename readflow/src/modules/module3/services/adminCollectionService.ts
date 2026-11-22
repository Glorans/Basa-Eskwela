import type { SupabaseClient } from "@supabase/supabase-js";
import { isAxiosError } from "axios";
import { supabase } from "../../../lib/supabaseClient";
import type { ProposedPassageDatabase } from "../types/proposedPassageDatabase";
import type { Json } from "../../../lib/database.types";
import type {
  ModuleCollectionDraft,
  PassageDraft,
} from "../types/modulePassages";
import { createModulePassageRepository } from "./modulePassageService";
import { getMaterialAuthHeaders } from "./materialService";
import api from "../../../services/api";
import { validateReviewableQuestions } from "../state/questionState";
import { requirePathLanguage } from "./moduleModel";
import { DEFAULT_PASSAGE_BANK_SIZE, SIX_ONLY, parsePassageBankSizes } from "../utils/passageBankSize.ts";

export interface BankQuestion {
  id: string;
  type: "literal" | "inferential" | "critical";
  questionText: string;
  options: string[];
  correctAnswer: string;
  scaffoldingHint: string;
  reviewStatus: string;
  answerExplanation?: string;
  supportingEvidence?: string;
}

export interface AdminPassage extends PassageDraft {
  displayOrder: number;
  questions: BankQuestion[];
}

export interface AdminCollection extends ModuleCollectionDraft {
  id: string;
  revision: number;
  status: string;
  publishedAt: string | null;
  language: "en" | "fil" | null;
  passages: AdminPassage[];
}

const client =
  supabase as unknown as SupabaseClient<ProposedPassageDatabase>;

export const passageRepository =
  createModulePassageRepository(client);

/**
 * Bank sizes the database supports. Until m3_variable_passage_banks is installed the
 * function does not exist, and any failure means six only: the selector stays hidden.
 */
export async function getPassageBankSizes(): Promise<readonly number[]> {
  try {
    const { data, error } = await client.rpc("m3_passage_bank_sizes");
    return error ? SIX_ONLY : parsePassageBankSizes(data);
  } catch {
    return SIX_ONLY;
  }
}

export async function loadCollection(
  id: string,
): Promise<AdminCollection> {
  const { data, error } = await client.rpc(
    "m3_admin_collection",
    { target_id: id },
  );

  if (error) throw error;

  const collection = data as unknown as AdminCollection;

  return {
    ...collection,
    language: requirePathLanguage(collection.language),
  };
}

export async function saveCollection(
  collection: AdminCollection,
  removed: string[],
) {
  const { data, error } = await client.rpc(
    "m3_save_collection",
    {
      target_id: collection.id,
      expected_revision: collection.revision,
      module_title: collection.title,
      target_path: collection.learningPathId,
      module_difficulty: collection.difficulty,
      passage_drafts: collection.passages.map(
        ({ id, title, passageText, sourceMaterialId }) => ({
          id,
          title,
          passageText,
          sourceMaterialId,
        }),
      ),
      removed_ids: removed,
    },
  );

  if (error) throw error;
  return data;
}

function normalizeEvidence(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export async function saveBank(
  collection: AdminCollection,
  passage: AdminPassage,
  action: "review" | "delete",
) {
  let bank: BankQuestion[] = [];

  if (action === "review") {
    const issues = validateReviewableQuestions(
      passage.questions.map((question) => ({
        ...question,
        options: question.options as [
          string,
          string,
          string,
          string,
        ],
        correctOptionIndex: question.options.indexOf(
          question.correctAnswer,
        ),
      })),
    );

    if (issues.length) {
      throw new Error(
        issues.flatMap((issue) => issue.messages).join(" "),
      );
    }

    const source = normalizeEvidence(passage.passageText);

    bank = passage.questions.map((question, index) => {
      const explanation =
        question.answerExplanation?.trim() ?? "";
      const evidence =
        question.supportingEvidence?.trim() ?? "";

      if (!explanation || explanation.length > 1500) {
        throw new Error(
          `Question ${index + 1}: add an answer explanation of 1 to 1500 characters.`,
        );
      }

      if (!evidence || evidence.length > 1000) {
        throw new Error(
          `Question ${index + 1}: add supporting evidence of 1 to 1000 characters.`,
        );
      }

      if (!source.includes(normalizeEvidence(evidence))) {
        throw new Error(
          `Question ${index + 1}: supporting evidence must be an exact excerpt from this passage.`,
        );
      }

      return {
        ...question,
        answerExplanation: explanation,
        supportingEvidence: evidence,
      };
    });
  }

  const { error } = await client.rpc(
    "m3_save_passage_bank",
    {
      target_id: collection.id,
      target_passage: passage.id,
      expected_revision: collection.revision,
      bank_action: action,
      bank: bank as unknown as Json,
    },
  );

  if (error) throw error;
}

// ==========================
// REVISE MODULE (proposed m3_module_revisions)
// ==========================
export interface ModuleRevision {
  id: string;
  title: string;
  status: string;
  revisionNumber: number;
  publishedAt: string | null;
  inTrash: boolean;
}

/** Versions of this module's family; null when revisions are not installed (Revise stays hidden). */
export async function getModuleRevisions(moduleId: string): Promise<ModuleRevision[] | null> {
  try {
    const { data, error } = await (client as unknown as { rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> })
      .rpc("m3_module_revisions", { target_id: moduleId });
    if (error || !Array.isArray(data)) return null;
    return data.map((row: Record<string, unknown>) => ({
      id: String(row.id), title: String(row.title ?? ""), status: String(row.status ?? ""),
      revisionNumber: Number(row.revision_number ?? 1), publishedAt: (row.published_at as string | null) ?? null,
      inTrash: row.in_trash === true,
    }));
  } catch {
    return null;
  }
}

/** Creates (or reopens) the editable draft revision of a published module; returns its ID. */
export async function reviseModule(moduleId: string): Promise<string> {
  const { data, error } = await (client as unknown as { rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }> })
    .rpc("m3_revise_module", { source_id: moduleId });
  if (error) {
    // 22023: the database's own refusal; PT422: the content check (categories and line only).
    throw new Error((error.code === "22023" || error.code === "PT422") && error.message ? error.message : "The revision could not be created. The published module was not changed.");
  }
  return String(data);
}

export type GenerationStage = "generating" | "saving" | "checking" | "saved";
export class GenerationPendingError extends Error {}
type PendingBank = { revision: number; ids: string[]; size?: number };
const pendingBanks = new Map<string, PendingBank>();
const inFlight = new Map<string, Promise<void>>();
const bankKey = (collection: AdminCollection, passageId: string) => `m3-generation:${collection.id}:${passageId}`;
function readPending(key: string): PendingBank | undefined {
  if (pendingBanks.has(key)) return pendingBanks.get(key);
  try { const value = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(key) : null; return value ? JSON.parse(value) : undefined; }
  catch { return undefined; }
}
function remember(key: string, pending?: PendingBank) {
  if (pending) pendingBanks.set(key, pending); else pendingBanks.delete(key);
  try { if (typeof sessionStorage !== "undefined") { if (pending) sessionStorage.setItem(key, JSON.stringify(pending)); else sessionStorage.removeItem(key); } } catch { /* memory guard remains */ }
}
const generationUrl = (collection: AdminCollection, passageId: string) => `/api/admin/modules/${collection.id}/passages/${passageId}`;

/** Read-only recovery. A missing status is uncertain, never permission to bill again. */
export async function checkGeneratedBank(collection: AdminCollection, passageId: string): Promise<"saved" | "failed"> {
  const key = bankKey(collection, passageId);
  const pending = readPending(key) ?? { revision: collection.revision, ids: collection.passages.find(p => p.id === passageId)?.questions.map(q => q.id) ?? [] };
  try {
    const fresh = await loadCollection(collection.id);
    const questions = fresh.passages.find(p => p.id === passageId)?.questions ?? [];
    // Markers saved before 9/12 support have no size and were always six.
    const size = pending.size ?? DEFAULT_PASSAGE_BANK_SIZE;
    if (fresh.revision > pending.revision && questions.length === size &&
      questions.some(q => !pending.ids.includes(q.id))) {
      remember(key); return "saved";
    }
    const headers = await getMaterialAuthHeaders();
    const { data } = await api.get(`${generationUrl(collection, passageId)}/generation-status`, {
      headers, params: { revision: pending.revision }, timeout: 10_000,
    });
    if (data.state === "failed") { remember(key); return "failed"; }
  } catch { /* Do not turn failed verification into a retry. */ }
  throw new GenerationPendingError("We cannot yet confirm whether the questions were saved. Use Check saved questions; no new generation request will be sent.");
}

export function generateBank(
  collection: AdminCollection,
  passageId: string,
  onStage?: (stage: GenerationStage) => void,
  questionCount: number = DEFAULT_PASSAGE_BANK_SIZE,
): Promise<void> {
  const key = bankKey(collection, passageId);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const work = async () => {
    if (readPending(key)) {
      onStage?.("checking");
      const result = await checkGeneratedBank(collection, passageId);
      if (result === "saved") { onStage?.("saved"); return; }
      throw new Error("No new questions were saved. Review the passage, then choose Generate again when you are ready.");
    }
    const headers = await getMaterialAuthHeaders();
    remember(key, { revision: collection.revision, ids: collection.passages.find(p => p.id === passageId)?.questions.map(q => q.id) ?? [], size: questionCount });
    onStage?.("generating");
    let poll: ReturnType<typeof setInterval> | undefined;
    let polling = false;
    let finished = false;
    if (onStage) poll = setInterval(async () => {
      if (polling || finished) return;
      polling = true;
      try {
        const { data } = await api.get(`${generationUrl(collection, passageId)}/generation-status`, { headers, params: { revision: collection.revision }, timeout: 5_000 });
        if (!finished && data.state === "saving") onStage("saving");
      } catch { /* The POST and recovery check determine the outcome. */ }
      finally { polling = false; }
    }, 1000);
    try {
      await api.post(`${generationUrl(collection, passageId)}/generate`, { revision: collection.revision, questionCount }, { headers, timeout: 90_000 });
      remember(key); onStage?.("saved");
    } catch (error) {
      finished = true;
      onStage?.("checking");
      // Always read saved state before enabling another potentially billable request.
      const result = await checkGeneratedBank(collection, passageId);
      if (result === "saved") { onStage?.("saved"); return; }
      const timedOut = isAxiosError(error) && ["ECONNABORTED", "ETIMEDOUT"].includes(error.code ?? "");
      throw new Error(timedOut
        ? "This request took longer than expected. We checked: no new questions were saved. You can choose Generate again."
        : "No new questions were saved. Please review the passage and try again when you are ready.");
    } finally { finished = true; if (poll) clearInterval(poll); }
  };
  const promise = work().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

export function collectionError(error: unknown): string {
  const value = error as {
    message?: string;
    response?: { data?: { message?: string } };
  };

  return (
    value?.response?.data?.message ||
    value?.message ||
    "Unable to save. Reload and try again."
  );
}
