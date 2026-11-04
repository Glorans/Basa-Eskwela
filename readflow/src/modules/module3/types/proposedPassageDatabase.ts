import type { Database } from "../../../lib/database.types";

// Contract for staged Phase 1/2 migrations, not a claim about live Supabase.
// Replace this overlay with regenerated database.types.ts after controlled rollout.
export type ProposedPassageDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Omit<Database["public"]["Tables"], "comprehension_questions"> & {
      module_passages: {
        Row: {
          id: string; module_id: string; title: string; passage_text: string;
          display_order: number; source_material_id: string | null; created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; module_id: string; title?: string; passage_text?: string;
          display_order: number; source_material_id?: string | null; created_at?: string; updated_at?: string;
        };
        Update: { title?: string; passage_text?: string; display_order?: number; source_material_id?: string | null };
        Relationships: [];
      };
      comprehension_questions: Omit<Database["public"]["Tables"]["comprehension_questions"], "Row"> & {
        Row: Database["public"]["Tables"]["comprehension_questions"]["Row"] & { passage_id: string | null };
      };
    };
    Functions: Database["public"]["Functions"] & {
      m3_delete_module: { Args: { target_id: string }; Returns: string };
      m3_admin_collection: { Args: { target_id: string }; Returns: import("../../../lib/database.types").Json };
      m3_save_collection: { Args: { target_id: string; expected_revision: number; module_title: string; target_path: string; module_difficulty: string; passage_drafts: import("../../../lib/database.types").Json; removed_ids: string[] }; Returns: number };
      m3_save_passage_bank: { Args: { target_id: string; target_passage: string; expected_revision: number; bank: import("../../../lib/database.types").Json; bank_action: string }; Returns: number };
      m3_create_collection_draft: {
        Args: { target_id: string; module_title: string; target_path: string; module_difficulty: string; passage_drafts: import("../../../lib/database.types").Json };
        Returns: string;
      };
      m3_collection_publish_issues: { Args: { target_id: string }; Returns: string[] };
      // Only exists once supabase/proposed/m3_variable_passage_banks_PROPOSED.sql is installed.
      m3_passage_bank_sizes: { Args: Record<string, never>; Returns: number[] };
    };
  };
};
