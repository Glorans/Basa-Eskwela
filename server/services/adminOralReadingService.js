const { getSupabaseAdmin } = require("./supabaseAdmin");
const {
  OralReadingAuthorizationError,
  OralReadingPersistenceError,
  normalizeLanguage,
} = require("./oralReadingAttemptService");

/** Published passages of modules this Admin created (Admin practice). Lists content only, never learner data. */
async function listAdminReadingPassages(requester, dependencies = {}) {
  if (requester.profile.role !== "admin") {
    throw new OralReadingAuthorizationError("Admin access is required.");
  }
  const db = dependencies.getSupabaseAdmin?.() ?? getSupabaseAdmin();

  async function all(table, columns, configure = (query) => query) {
    const rows = [];
    for (let start = 0; ; start += 100) {
      const { data, error } = await configure(db.from(table).select(columns))
        .order("id", { ascending: true })
        .range(start, start + 99);
      if (error) throw new OralReadingPersistenceError("Unable to load available reading passages.");
      rows.push(...(data ?? []));
      if (!data || data.length < 100) return rows;
    }
  }

  const modules = (await all("modules", "id,path_id,title,status,deleted_at,passage,created_by",
    (query) => query.eq("status", "published").eq("created_by", requester.user.id)))
    .filter((row) => !row.deleted_at && row.created_by === requester.user.id);
  const paths = new Map((await all("learning_paths", "id,language")).map((row) => [row.id, row.language]));
  const passages = await all("module_passages", "id,module_id,title,passage_text,display_order");

  return modules.flatMap((module) => {
    // Same language matching as oral-reading scoring; unsupported languages are skipped.
    let language;
    try {
      language = normalizeLanguage(paths.get(module.path_id));
    } catch {
      return [];
    }
    const selected = passages
      .filter((row) => row.module_id === module.id)
      .sort((a, b) => a.display_order - b.display_order || a.id.localeCompare(b.id));
    const sources = selected.length
      ? selected
      : [{ id: null, title: module.title, passage_text: module.passage }];
    return sources
      .filter((row) => row.passage_text?.trim())
      .map((row) => ({
        moduleId: module.id,
        moduleTitle: module.title,
        passageId: row.id,
        passageTitle: row.title,
        language,
      }));
  });
}

module.exports = { listAdminReadingPassages };
