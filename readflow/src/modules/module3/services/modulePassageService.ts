import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProposedPassageDatabase } from "../types/proposedPassageDatabase";
import type { ModuleCollectionDraft, ModulePassage } from "../types/modulePassages";
import { normalizeCollectionDraft } from "./modulePassageModel.ts";

// Phase 2 supplies the existing authenticated client. These calls require the
// reviewed migration to be installed in the target environment; this repository
// never creates an elevated/service-role client.
export function createModulePassageRepository(client: SupabaseClient<ProposedPassageDatabase>) {
  return {
    async createDraft(id: string, draft: ModuleCollectionDraft, validPathIds: readonly string[]) {
      const normalized = normalizeCollectionDraft(draft, validPathIds);
      const { data, error } = await client.rpc("m3_create_collection_draft", {
        target_id: id, module_title: normalized.title, target_path: normalized.learningPathId,
        module_difficulty: normalized.difficulty,
        passage_drafts: normalized.passages.map(({ id, title, passageText, sourceMaterialId }) =>
          ({ id, title, passageText, sourceMaterialId })),
      });
      if (error) throw error;
      return data;
    },
    async getPassages(moduleId: string): Promise<ModulePassage[]> {
      const { data, error } = await client.from("module_passages")
        .select("id,module_id,title,passage_text,display_order,source_material_id,created_at,updated_at")
        .eq("module_id", moduleId).order("display_order", { ascending: true });
      if (error) throw error;
      return data.map(p => ({
        id: p.id, moduleId: p.module_id, title: p.title, passageText: p.passage_text,
        displayOrder: p.display_order, sourceMaterialId: p.source_material_id,
        createdAt: p.created_at, updatedAt: p.updated_at,
      }));
    },
    async getPublishIssues(moduleId: string) {
      const { data, error } = await client.rpc("m3_collection_publish_issues", { target_id: moduleId });
      if (error) throw error;
      return data;
    },
  };
}
