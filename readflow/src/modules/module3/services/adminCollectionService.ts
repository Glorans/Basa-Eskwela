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

export async function generateBank(
  collection: AdminCollection,
  passageId: string,
) {
  const headers = await getMaterialAuthHeaders();

  try {
    await api.post(
      `/api/admin/modules/${collection.id}/passages/${passageId}/generate`,
      { revision: collection.revision },
      { headers, timeout: 60_000 },
    );
  } catch (error) {
    if (isAxiosError(error) && !error.response) {
      if (
        error.code === "ECONNABORTED" ||
        error.code === "ETIMEDOUT"
      ) {
        throw new Error(
          "Question generation timed out. Reload the module to check whether the questions were saved before trying again.",
        );
      }

      throw new Error(
        `Cannot reach the question-generation server at ${api.defaults.baseURL}. Check that the Express server is running and VITE_API_URL points to it. If it is running, check your network and the server CORS configuration.`,
      );
    }

    throw error;
  }
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