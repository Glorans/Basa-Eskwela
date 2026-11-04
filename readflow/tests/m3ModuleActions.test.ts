import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("atomic deletion accepts permanent/soft confirmations and preserves actual failures", async () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let response: { data: unknown; error: null | { code: string; message: string } } = {data:"permanent",error:null};
  const calls: unknown[] = [];
  const filters: unknown[] = [];
  const client = {
    rpc: async (name: string, args: unknown) => { calls.push([name,args]); return response; },
    from: () => {
      const query = {
        select: () => query, eq: () => query,
        is: (key: string, value: unknown) => {filters.push([key,value]);return query;},
        order: async () => ({data:[],error:null}),
        maybeSingle: async () => ({data:null,error:null}),
      };
      return query;
    },
  };
  const globals = globalThis as typeof globalThis & { __m3ActionsClient?: typeof client };
  globals.__m3ActionsClient = client;
  const url = new URL("../src/modules/module3/services/moduleService.ts", import.meta.url).href;
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL === url) {
      if (specifier.endsWith("/supabaseClient")) return { url: "data:text/javascript,export const supabase=globalThis.__m3ActionsClient", shortCircuit: true };
      if (specifier === "./moduleModel") return { url: new URL("../src/modules/module3/services/moduleModel.ts", import.meta.url).href, shortCircuit: true };
    }
    return next(specifier, context);
  } });
  try {
    const service = await import(url);
    await assert.rejects(service.deleteModule("bad"), /unavailable/);
    assert.equal(calls.length,0);
    // The server is authoritative: both unused drafts with banks and unused
    // published modules use the same atomic operation, with no client cleanup.
    for (const fixture of ["unused draft with bank", "unused published"]) {
      assert.equal(await service.deleteModule(id),"permanent",fixture);
    }
    response.data="soft";
    assert.equal(await service.deleteModule(id),"soft","historical module retained by RPC");
    assert.deepEqual(calls,Array(3).fill(["m3_delete_module",{target_id:id}]));
    for (const error of [
      {code:"42501",message:"Admin access is required to delete reading modules"},
      {code:"PGRST202",message:"Could not find the function public.m3_delete_module"},
      {code:"40001",message:"could not serialize access due to concurrent update"},
    ]) {
      response={data:null,error};
      await assert.rejects(service.deleteModule(id),(e: Error)=>e.message.includes(error.code)&&e.message.includes(error.message));
    }
    for (const data of [null, false, "unknown"]) {
      response={data,error:null};await assert.rejects(service.deleteModule(id),/did not confirm deletion/);
    }
    await service.getModules();await service.getModuleById(id);
    assert.deepEqual(filters,Array(2).fill(["deleted_at",null]));
    const purgeError = {code:"P0001",message:"Deleted modules are retained for history and cannot be changed"};
    response={data:null,error:purgeError};
    await assert.rejects(service.purgeTrashedModule(id),(e: Error & {causeValue?:unknown}) => {
      assert.match(e.message,/question-bank cleanup.*remains in Trash and nothing was deleted/);
      assert.doesNotMatch(e.message,/P0001|Database check failed/);
      assert.equal(e.causeValue,purgeError);
      return true;
    });
    assert.deepEqual(calls.at(-1),["m3_purge_module",{target_id:id}]);
    for (const error of [
      {code:"23503",message:"This reading module has learner or classroom history, so it stays in the Trash and cannot be deleted permanently"},
      {code:"22023",message:"Move the reading module to the Trash before deleting it permanently"},
    ]) {
      response={data:null,error};
      await assert.rejects(service.purgeTrashedModule(id),{message:error.message});
    }
    response={data:null,error:{code:"P0001",message:"Unexpected database failure"}};
    await assert.rejects(service.purgeTrashedModule(id),/Unexpected database failure/);
    response={data:"deleted",error:null};
    assert.equal(await service.purgeTrashedModule(id),"deleted");
  } finally {hooks.deregister();delete globals.__m3ActionsClient;}
});

test("existing direct-write policies and foreign keys remain unchanged", async () => {
  const sql = async (file: string) => readFile(new URL(`../../supabase/${file}`, import.meta.url), "utf8");
  const rls = await sql("m3_content_rls.sql");
  const deletePolicy = rls.slice(rls.indexOf('create policy "M3 admins delete unused drafts"'), rls.indexOf("-- UPLOADED MATERIALS"));
  assert.match(deletePolicy, /m3_current_role\(\) = 'admin'/);
  assert.match(deletePolicy, /status = 'draft'/);
  assert.match(deletePolicy, /published_at is null/);
  assert.match(deletePolicy, /m3_module_is_unreferenced\(id\)/);
  assert.match(rls, /create policy "M3 admins update modules"[\s\S]*?with check \(public.m3_current_role\(\) = 'admin'\)/);
  for (const file of ["m3_content_schema.sql", "m3_module_passages_phase1.sql", "m5_oral_reading_schema.sql"]) {
    assert.match(await sql(file), /references public.modules\s*\(id\)\s*on delete restrict/);
  }
  assert.match(await sql("m3_student_published_module_access.sql"), /module_row.status = 'published'/);
});


test("proposed deletion migration keeps atomic Admin authorization and history safeguards", async () => {
  const sql = await readFile(new URL("../../supabase/m3_module_deletion.sql",import.meta.url),"utf8");
  assert.match(sql,/auth.uid\(\) is null or public.m3_current_role\(\) is distinct from 'admin'/);
  assert.match(sql,/revoke all on public.m3_deletion_context from public, anon, authenticated/);
  assert.match(sql,/for update/);
  assert.match(sql,/pg_catalog.pg_constraint/);
  assert.match(sql,/edge.source_columns=array\['passage_id','module_id'\] and edge.target_columns=array\['id','module_id'\]/);
  assert.match(sql,/exception when foreign_key_violation then/);
  assert.match(sql,/update public.modules set deleted_at=clock_timestamp/);
  assert.match(sql,/before insert or update of module_id on public.room_modules/);
  assert.doesNotMatch(sql,/delete from public\.(progress|room_modules|oral_reading_attempts|uploaded_materials)/i);
  assert.doesNotMatch(sql,/on delete cascade|disable trigger|create policy/i);
  const classroom = await readFile(new URL("../src/modules/module4/services/classroomService.ts",import.meta.url),"utf8");
  assert.match(classroom,/eq\("status", "published"\)\s*\.is\("deleted_at", null\)/);
});
