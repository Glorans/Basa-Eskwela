export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      comprehension_question_answers: {
        Row: {
          correct_answer: string
          created_at: string
          question_id: string
          updated_at: string
        }
        Insert: {
          correct_answer: string
          created_at?: string
          question_id: string
          updated_at?: string
        }
        Update: {
          correct_answer?: string
          created_at?: string
          question_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comprehension_question_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: true
            referencedRelation: "comprehension_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      comprehension_questions: {
        Row: {
          created_at: string
          display_order: number
          generated_by_ai: boolean
          id: string
          material_id: string | null
          module_id: string | null
          options: Json
          passage_id: string | null
          question_text: string
          question_type: string
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          scaffolding_hint: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          generated_by_ai?: boolean
          id?: string
          material_id?: string | null
          module_id?: string | null
          options: Json
          passage_id?: string | null
          question_text: string
          question_type: string
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          scaffolding_hint: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          generated_by_ai?: boolean
          id?: string
          material_id?: string | null
          module_id?: string | null
          options?: Json
          passage_id?: string | null
          question_text?: string
          question_type?: string
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          scaffolding_hint?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comprehension_questions_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "uploaded_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comprehension_questions_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comprehension_questions_passage_parent_fkey"
            columns: ["passage_id", "module_id"]
            isOneToOne: false
            referencedRelation: "module_passages"
            referencedColumns: ["id", "module_id"]
          },
          {
            foreignKeyName: "comprehension_questions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnostic_results: {
        Row: {
          assessment_id: string | null
          assessment_type: string
          assessment_version: string | null
          completed_at: string
          comprehension_score: number
          created_at: string
          difficulty_tier: string
          id: string
          language: string
          oral_reading_metrics: Json | null
          orv_score: number
          reading_level: string
          reading_speed_wpm: number | null
          stt_confidence: number | null
          transcript: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          assessment_id?: string | null
          assessment_type?: string
          assessment_version?: string | null
          completed_at?: string
          comprehension_score: number
          created_at?: string
          difficulty_tier: string
          id?: string
          language?: string
          oral_reading_metrics?: Json | null
          orv_score: number
          reading_level: string
          reading_speed_wpm?: number | null
          stt_confidence?: number | null
          transcript?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          assessment_id?: string | null
          assessment_type?: string
          assessment_version?: string | null
          completed_at?: string
          comprehension_score?: number
          created_at?: string
          difficulty_tier?: string
          id?: string
          language?: string
          oral_reading_metrics?: Json | null
          orv_score?: number
          reading_level?: string
          reading_speed_wpm?: number | null
          stt_confidence?: number | null
          transcript?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      enrollments: {
        Row: {
          enrolled_at: string
          id: string
          room_id: string
          student_id: string
        }
        Insert: {
          enrolled_at?: string
          id?: string
          room_id: string
          student_id: string
        }
        Update: {
          enrolled_at?: string
          id?: string
          room_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_paths: {
        Row: {
          description: string | null
          difficulty_tier: string
          id: string
          language: string
          path_name: string
          reading_level: string
        }
        Insert: {
          description?: string | null
          difficulty_tier: string
          id?: string
          language: string
          path_name: string
          reading_level: string
        }
        Update: {
          description?: string | null
          difficulty_tier?: string
          id?: string
          language?: string
          path_name?: string
          reading_level?: string
        }
        Relationships: []
      }
      m3_pending_collection_delivery: {
        Row: {
          module_id: string
        }
        Insert: {
          module_id: string
        }
        Update: {
          module_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "m3_pending_collection_delivery_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: true
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      material_question_sets: {
        Row: {
          created_at: string
          created_by: string
          id: string
          material_id: string
          name: string
          revision: number
          sequence_number: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          material_id: string
          name: string
          revision?: number
          sequence_number: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          material_id?: string
          name?: string
          revision?: number
          sequence_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_question_sets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_question_sets_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "uploaded_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      module_passages: {
        Row: {
          created_at: string
          display_order: number
          id: string
          module_id: string
          passage_text: string
          source_material_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order: number
          id?: string
          module_id: string
          passage_text?: string
          source_material_id?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          module_id?: string
          passage_text?: string
          source_material_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_passages_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "module_passages_source_material_id_fkey"
            columns: ["source_material_id"]
            isOneToOne: false
            referencedRelation: "uploaded_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      modules: {
        Row: {
          collection_revision: number
          created_at: string
          created_by: string
          difficulty: string
          id: string
          passage: string | null
          path_id: string
          published_at: string | null
          source_material_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          collection_revision?: number
          created_at?: string
          created_by: string
          difficulty: string
          id?: string
          passage?: string | null
          path_id: string
          published_at?: string | null
          source_material_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          collection_revision?: number
          created_at?: string
          created_by?: string
          difficulty?: string
          id?: string
          passage?: string | null
          path_id?: string
          published_at?: string | null
          source_material_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "modules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modules_path_id_fkey"
            columns: ["path_id"]
            isOneToOne: false
            referencedRelation: "learning_paths"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modules_source_material_id_fkey"
            columns: ["source_material_id"]
            isOneToOne: false
            referencedRelation: "uploaded_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      oral_reading_attempts: {
        Row: {
          assignment_id: string | null
          completed_at: string
          created_at: string
          detected_error_count: number
          duration_seconds: number
          expected_word_count: number
          id: string
          language_snapshot: string | null
          module_id: string
          module_title_snapshot: string | null
          passage_id: string | null
          passage_snapshot: string
          passage_title_snapshot: string | null
          pronunciation_accuracy: number
          reading_speed_wpm: number
          room_id: string | null
          scoring_version: number
          stt_confidence: number | null
          submission_id: string | null
          transcript: string
          user_id: string
          word_metrics: Json
        }
        Insert: {
          assignment_id?: string | null
          completed_at?: string
          created_at?: string
          detected_error_count: number
          duration_seconds: number
          expected_word_count: number
          id?: string
          language_snapshot?: string | null
          module_id: string
          module_title_snapshot?: string | null
          passage_id?: string | null
          passage_snapshot: string
          passage_title_snapshot?: string | null
          pronunciation_accuracy: number
          reading_speed_wpm: number
          room_id?: string | null
          scoring_version?: number
          stt_confidence?: number | null
          submission_id?: string | null
          transcript: string
          user_id: string
          word_metrics: Json
        }
        Update: {
          assignment_id?: string | null
          completed_at?: string
          created_at?: string
          detected_error_count?: number
          duration_seconds?: number
          expected_word_count?: number
          id?: string
          language_snapshot?: string | null
          module_id?: string
          module_title_snapshot?: string | null
          passage_id?: string | null
          passage_snapshot?: string
          passage_title_snapshot?: string | null
          pronunciation_accuracy?: number
          reading_speed_wpm?: number
          room_id?: string | null
          scoring_version?: number
          stt_confidence?: number | null
          submission_id?: string | null
          transcript?: string
          user_id?: string
          word_metrics?: Json
        }
        Relationships: [
          {
            foreignKeyName: "oral_reading_attempts_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oral_reading_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          age: number | null
          teacher_status: "pending" | "approved" | "rejected" | null
          created_at: string
          full_name: string
          id: string
          nickname: string | null
          role: string | null
          status: string
        }
        Insert: {
          age?: number | null
          teacher_status?: "pending" | "approved" | "rejected" | null
          created_at?: string
          full_name: string
          id: string
          nickname?: string | null
          role?: string | null
          status?: string
        }
        Update: {
          age?: number | null
          teacher_status?: "pending" | "approved" | "rejected" | null
          created_at?: string
          full_name?: string
          id?: string
          nickname?: string | null
          role?: string | null
          status?: string
        }
        Relationships: []
      }
      progress: {
        Row: {
          id: string
          module_id: string
          score: number | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          id?: string
          module_id: string
          score?: number | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          id?: string
          module_id?: string
          score?: number | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "progress_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reading_activity_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string
          due_at: string | null
          id: string
          material_id: string
          question_set_id: string | null
          read_aloud_only: boolean
          room_id: string
          status: string
          student_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by: string
          due_at?: string | null
          id?: string
          material_id: string
          question_set_id?: string | null
          read_aloud_only?: boolean
          room_id: string
          status?: string
          student_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          due_at?: string | null
          id?: string
          material_id?: string
          question_set_id?: string | null
          read_aloud_only?: boolean
          room_id?: string
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reading_activity_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reading_activity_assignments_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "uploaded_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reading_activity_assignments_question_set_id_fkey"
            columns: ["question_set_id"]
            isOneToOne: false
            referencedRelation: "material_question_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reading_activity_assignments_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reading_activity_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      room_modules: {
        Row: {
          assigned_at: string
          assigned_by: string
          id: string
          module_id: string
          room_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by: string
          id?: string
          module_id: string
          room_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          id?: string
          module_id?: string
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_modules_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_modules_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_modules_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          created_at: string
          description: string | null
          id: string
          room_code: string
          room_name: string
          section: string | null
          teacher_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          room_code: string
          room_name: string
          section?: string | null
          teacher_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          room_code?: string
          room_name?: string
          section?: string | null
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      uploaded_materials: {
        Row: {
          content_text: string | null
          created_at: string
          extraction_status: string
          file_size_bytes: number
          id: string
          language: string
          mime_type: string
          ocr_confidence: number | null
          original_filename: string
          raw_extracted_text: string | null
          storage_path: string
          title: string
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          content_text?: string | null
          created_at?: string
          extraction_status?: string
          file_size_bytes: number
          id?: string
          language: string
          mime_type: string
          ocr_confidence?: number | null
          original_filename: string
          raw_extracted_text?: string | null
          storage_path: string
          title: string
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          content_text?: string | null
          created_at?: string
          extraction_status?: string
          file_size_bytes?: number
          id?: string
          language?: string
          mime_type?: string
          ocr_confidence?: number | null
          original_filename?: string
          raw_extracted_text?: string | null
          storage_path?: string
          title?: string
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "uploaded_materials_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_own_profile_age: { Args: { profile_id: string }; Returns: number | null }
      register_teacher_with_invite: { Args: { invite_code: string }; Returns: boolean }
      review_teacher_registration: { Args: { target_user: string; decision: string }; Returns: string }
      assign_own_role: { Args: { selected_role: string }; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      join_room_by_code: {
        Args: { p_room_code: string }
        Returns: {
          enrolled_at: string
          id: string
          room_id: string
          student_id: string
        }
        SetofOptions: {
          from: "*"
          to: "enrollments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      m3_admin_collection: { Args: { target_id: string }; Returns: Json }
      m3_can_read_module: {
        Args: { target_module_id: string }
        Returns: boolean
      }
      m3_collection_publish_issues: {
        Args: { target_id: string }
        Returns: string[]
      }
      m3_collection_publish_issues_phase1: {
        Args: { target_id: string }
        Returns: string[]
      }
      m3_create_collection_draft: {
        Args: {
          module_difficulty: string
          module_title: string
          passage_drafts: Json
          target_id: string
          target_path: string
        }
        Returns: string
      }
      m3_current_role: { Args: never; Returns: string }
      m3_lock_collection: {
        Args: { expected_revision: number; target_id: string }
        Returns: undefined
      }
      m3_material_file_is_absent: {
        Args: { target_material_id: string }
        Returns: boolean
      }
      m3_material_is_unreferenced: {
        Args: { target_material_id: string }
        Returns: boolean
      }
      m3_module_is_unreferenced: {
        Args: { target_module_id: string }
        Returns: boolean
      }
      m3_owns_material: {
        Args: { target_material_id: string }
        Returns: boolean
      }
      m3_save_collection: {
        Args: {
          expected_revision: number
          module_difficulty: string
          module_title: string
          passage_drafts: Json
          removed_ids?: string[]
          target_id: string
          target_path: string
        }
        Returns: number
      }
      m3_save_passage_bank: {
        Args: {
          bank: Json
          bank_action: string
          expected_revision: number
          target_id: string
          target_passage: string
        }
        Returns: number
      }
      m3_storage_object_is_deletable: {
        Args: { target_storage_path: string }
        Returns: boolean
      }
      m4_current_role: { Args: never; Returns: string }
      m6_is_enrolled_in_room: {
        Args: { target_room_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

export type ReadFlowDatabase = Database;
