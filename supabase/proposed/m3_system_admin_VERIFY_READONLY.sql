-- READ ONLY. Run before considering the separate proposal; no data or schema changes.
select current_database() as database_name, current_user as database_user;
select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       md5(pg_get_functiondef(p.oid)) as definition_hash, pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
 'm3_current_role','is_admin','is_system_admin','m3_can_manage_module','m3_can_read_module',
 'm3_create_collection_draft','m3_lock_collection','m3_admin_collection',
 'm3_collection_publish_issues_phase1','m3_delete_module','m3_require_admin',
 'm3_trash_manager','m3_trashed_modules','m3_revise_module','m3_module_revisions',
 'm3_guard_teacher_passage_source','m3_module_author_role','m3_write_material_question_set','m3_storage_object_is_deletable','m3_material_is_unreferenced') order by p.proname;
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where (schemaname='public' and tablename in
 ('modules','module_passages','learning_paths','uploaded_materials','material_question_sets',
  'comprehension_questions','comprehension_question_answers','m3_module_trash'))
 or (schemaname='storage' and tablename='objects') order by schemaname,tablename,policyname;
select table_name,column_name,privilege_type from information_schema.column_privileges
where grantee='authenticated' and table_schema='public' and table_name in
 ('modules','module_passages','learning_paths') order by table_name,column_name,privilege_type;
-- Confirm installed source-ownership and publication/history triggers before approving.
select c.relname, t.tgname, pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('modules','module_passages') and not t.tgisinternal;
