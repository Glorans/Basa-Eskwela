-- PROPOSAL ONLY. Rollback of m1_school_admin_learner_scope_PROPOSED.sql.
-- Restores the 13 policies exactly as they are on Staging today (copied verbatim from the 2026-11-15 Staging schema
-- backup) and removes the four helpers. No row is touched.
begin;
set local lock_timeout = '5s';

drop policy "M3 material owners and admins read materials" on public.uploaded_materials;
CREATE POLICY "M3 material owners and admins read materials" ON "public"."uploaded_materials" FOR SELECT TO "authenticated" USING ((("public"."m3_current_role"() = 'admin'::"text") OR (("public"."m3_current_role"() = ANY (ARRAY['teacher'::"text", 'general_user'::"text"])) AND ("uploaded_by" = "auth"."uid"()))));

drop policy "M3 material owners and admins delete safe materials" on public.uploaded_materials;
CREATE POLICY "M3 material owners and admins delete safe materials" ON "public"."uploaded_materials" FOR DELETE TO "authenticated" USING (((("public"."m3_current_role"() = 'admin'::"text") OR (("public"."m3_current_role"() = ANY (ARRAY['teacher'::"text", 'general_user'::"text"])) AND ("uploaded_by" = "auth"."uid"()))) AND "public"."m3_material_is_unreferenced"("id") AND "public"."m3_material_file_is_absent"("id")));

drop policy "M3 admins and owning teachers read saved sets" on public.material_question_sets;
CREATE POLICY "M3 admins and owning teachers read saved sets" ON "public"."material_question_sets" FOR SELECT TO "authenticated" USING ((("public"."m3_current_role"() = 'admin'::"text") OR (("public"."m3_current_role"() = 'teacher'::"text") AND "public"."m3_owns_material"("material_id"))));

drop policy "M3 role-aware safe question reads" on public.comprehension_questions;
CREATE POLICY "M3 role-aware safe question reads" ON "public"."comprehension_questions" FOR SELECT TO "authenticated" USING ((("public"."m3_current_role"() = 'admin'::"text") OR (("module_id" IS NOT NULL) AND ("review_status" = 'reviewed'::"text") AND "public"."m3_can_read_module"("module_id")) OR (("material_id" IS NOT NULL) AND "public"."m3_owns_material"("material_id") AND (("public"."m3_current_role"() = 'teacher'::"text") OR (("public"."m3_current_role"() = 'general_user'::"text") AND ("review_status" = 'reviewed'::"text"))))));

drop policy "M3 admins create questions" on public.comprehension_questions;
CREATE POLICY "M3 admins create questions" ON "public"."comprehension_questions" FOR INSERT TO "authenticated" WITH CHECK (("public"."m3_current_role"() = 'admin'::"text"));

drop policy "M3 admins update all questions" on public.comprehension_questions;
CREATE POLICY "M3 admins update all questions" ON "public"."comprehension_questions" FOR UPDATE TO "authenticated" USING (("public"."m3_current_role"() = 'admin'::"text")) WITH CHECK (("public"."m3_current_role"() = 'admin'::"text"));

drop policy "M3 admins delete questions" on public.comprehension_questions;
CREATE POLICY "M3 admins delete questions" ON "public"."comprehension_questions" FOR DELETE TO "authenticated" USING (("public"."m3_current_role"() = 'admin'::"text"));

drop policy "M3 admins and owning teachers read answer keys" on public.comprehension_question_answers;
CREATE POLICY "M3 admins and owning teachers read answer keys" ON "public"."comprehension_question_answers" FOR SELECT TO "authenticated" USING ((("public"."m3_current_role"() = 'admin'::"text") OR (("public"."m3_current_role"() = 'teacher'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."comprehension_questions" "question"
  WHERE (("question"."id" = "comprehension_question_answers"."question_id") AND "question"."generated_by_ai" AND ("question"."material_id" IS NOT NULL) AND "public"."m3_owns_material"("question"."material_id")))))));

drop policy "M3 admins create answer keys" on public.comprehension_question_answers;
CREATE POLICY "M3 admins create answer keys" ON "public"."comprehension_question_answers" FOR INSERT TO "authenticated" WITH CHECK (("public"."m3_current_role"() = 'admin'::"text"));

drop policy "M3 admins update all answer keys" on public.comprehension_question_answers;
CREATE POLICY "M3 admins update all answer keys" ON "public"."comprehension_question_answers" FOR UPDATE TO "authenticated" USING (("public"."m3_current_role"() = 'admin'::"text")) WITH CHECK (("public"."m3_current_role"() = 'admin'::"text"));

drop policy "M3 admins delete answer keys" on public.comprehension_question_answers;
CREATE POLICY "M3 admins delete answer keys" ON "public"."comprehension_question_answers" FOR DELETE TO "authenticated" USING (("public"."m3_current_role"() = 'admin'::"text"));

drop policy "M3 owners and admins read reading material objects" on storage.objects;
CREATE POLICY "M3 owners and admins read reading material objects" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'reading-materials'::"text") AND (("public"."m3_current_role"() = 'admin'::"text") OR (("public"."m3_current_role"() = ANY (ARRAY['teacher'::"text", 'general_user'::"text"])) AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")))));

drop policy "M3 owners and admins delete reading material objects" on storage.objects;
CREATE POLICY "M3 owners and admins delete reading material objects" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'reading-materials'::"text") AND (("public"."m3_current_role"() = 'admin'::"text") OR (("public"."m3_current_role"() = ANY (ARRAY['teacher'::"text", 'general_user'::"text"])) AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text"))) AND "public"."m3_storage_object_is_deletable"("name")));

drop function public.m1_school_admin_sees_owner(uuid);
drop function public.m1_school_admin_sees_material(uuid);
drop function public.m1_school_admin_sees_question(uuid);
drop function public.m1_school_admin_sees_storage_owner(text);
commit;
