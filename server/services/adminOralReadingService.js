const { getSupabaseAdmin } = require("./supabaseAdmin");
const {
  OralReadingAuthorizationError,
  OralReadingPersistenceError,
  isApprovedTeacher,
  normalizeLanguage,
} = require("./oralReadingAttemptService");

/** Published passages of modules this Admin created (Admin practice). Lists content only, never learner data. */
async function listAdminReadingPassages(requester, dependencies = {}) {
  if (requester.profile.role !== "admin") {
    throw new OralReadingAuthorizationError("Admin access is required.");
  }
  return listPublishedPassages(dependencies, requester.user.id);
}

/**
 * Reading practice list. Approved Teachers: every published, non-deleted module in the shared
 * catalog (any author). Admins: unchanged, only the published modules they created.
 * Content only: no attempt, result or learner data.
 */
async function listPracticeReadingPassages(requester, dependencies = {}) {
  if (requester?.profile?.role === "admin") return listAdminReadingPassages(requester, dependencies);
  if (!isApprovedTeacher(requester)) {
    throw new OralReadingAuthorizationError("Approved Teacher access is required.");
  }
  return listPublishedPassages(dependencies, null, requester);
}

/**
 * createdBy null = every author (the shared published catalog). With a requester (Teacher practice), modules whose
 * author belongs to ANOTHER school are left out (M1 multi-tenancy); platform modules stay in the catalog.
 */
async function listPublishedPassages(dependencies, createdBy, requester = null) {
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
    (query) => (createdBy ? query.eq("status", "published").eq("created_by", createdBy) : query.eq("status", "published"))))
    .filter((row) => row.status === "published" && !row.deleted_at && (!createdBy || row.created_by === createdBy));
  const foreign = requester
    ? await require("./schoolScope").foreignSchoolOwners(requester, modules.map((row) => row.created_by), dependencies)
    : new Set();
  const visible = modules.filter((row) => !foreign.has(row.created_by));
  const paths = new Map((await all("learning_paths", "id,language")).map((row) => [row.id, row.language]));
  const passages = await all("module_passages", "id,module_id,title,passage_text,display_order");

  return visible.flatMap((module) => {
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

module.exports = { listAdminReadingPassages, listPracticeReadingPassages };
