// Supabase (service role) data access for M2 assessment packages. The backend authorizes every call
// (assessmentPackageService + assessmentPackagePolicy); browser roles have no access to these tables at all.
// Database errors are thrown with their Postgres code so the service can turn guard refusals into 4xx answers.
const { getSupabaseAdmin } = require("./supabaseAdmin");

const PACKAGE_COLUMNS = "id, kind, audience, scope, owner_id, language, title, legacy_assessment_id, created_at, updated_at, archived_at";
const VERSION_COLUMNS = [
  "id", "package_id", "version_number", "version_label", "status", "source", "based_on_version_id", "passage_title",
  "paragraphs", "questions", "content_sha256", "created_by", "created_at", "updated_at", "submitted_by", "submitted_at",
  "reviewed_by", "reviewed_at", "review_note", "educator_review_attestation", "published_by", "published_at",
  "retired_by", "retired_at",
].join(", ");
const REVIEW_COLUMNS = [
  "id", "version_id", "reviewer_name", "reviewer_qualification", "reviewed_on", "passage_suitable", "questions_sound",
  "answer_keys_correct", "language_accurate", "outcome", "notes", "recorded_by", "recorded_at",
].join(", ");
const BATCH = 100;

function raise(error) {
  throw Object.assign(new Error(error?.message || "Database request failed."), { code: error?.code });
}
async function rows(query) {
  const { data, error } = await query;
  if (error) raise(error);
  return data ?? [];
}
async function one(query) {
  const { data, error } = await query;
  if (error) raise(error);
  return data ?? null;
}

function createSupabaseAssessmentPackageRepository({ getAdmin = getSupabaseAdmin } = {}) {
  const db = () => getAdmin();
  return {
    async listPackages({ scopes, ownerId }) {
      let query = db().from("m2_assessment_packages").select(PACKAGE_COLUMNS).in("scope", scopes);
      if (ownerId) query = query.eq("owner_id", ownerId);
      return rows(query);
    },
    getPackage: (id) => one(db().from("m2_assessment_packages").select(PACKAGE_COLUMNS).eq("id", id).maybeSingle()),
    findPackageByLegacyId: (legacyId) => one(db().from("m2_assessment_packages").select(PACKAGE_COLUMNS)
      .eq("legacy_assessment_id", legacyId).maybeSingle()),
    insertPackage: (row) => one(db().from("m2_assessment_packages").insert(row).select(PACKAGE_COLUMNS).single()),
    updatePackage: (id, patch) => one(db().from("m2_assessment_packages").update(patch).eq("id", id).select(PACKAGE_COLUMNS).single()),
    async listVersions(packageIds) {
      const out = [];
      for (let i = 0; i < packageIds.length; i += BATCH) {
        out.push(...await rows(db().from("m2_assessment_package_versions").select(VERSION_COLUMNS)
          .in("package_id", packageIds.slice(i, i + BATCH))));
      }
      return out;
    },
    getVersion: (id) => one(db().from("m2_assessment_package_versions").select(VERSION_COLUMNS).eq("id", id).maybeSingle()),
    insertVersion: (row) => one(db().from("m2_assessment_package_versions").insert(row).select(VERSION_COLUMNS).single()),
    updateVersion: (id, patch) => one(db().from("m2_assessment_package_versions").update(patch).eq("id", id)
      .select(VERSION_COLUMNS).single()),
    async deleteVersion(id) {
      const { error } = await db().from("m2_assessment_package_versions").delete().eq("id", id);
      if (error) raise(error);
    },
    async publishVersion(id, actor) {
      const { error } = await db().rpc("m2_publish_assessment_version", { p_version: id, p_actor: actor });
      if (error) raise(error);
    },
    async contentIssues(title, paragraphs, questions) {
      const { data, error } = await db().rpc("m2_assessment_content_issues", {
        p_title: title, p_paragraphs: paragraphs, p_questions: questions,
      });
      if (error) raise(error);
      return Array.isArray(data) ? data : [];
    },
    async listReviews(versionIds) {
      const out = [];
      for (let i = 0; i < versionIds.length; i += BATCH) {
        out.push(...await rows(db().from("m2_assessment_educator_reviews").select(REVIEW_COLUMNS)
          .in("version_id", versionIds.slice(i, i + BATCH))));
      }
      return out;
    },
    insertReview: (row) => one(db().from("m2_assessment_educator_reviews").insert(row).select(REVIEW_COLUMNS).single()),
    /** F6 activation: the active initial version for a language (null = built-in 3.0); not installed -> built-in. */
    async getActivation(language) {
      const { data, error } = await db().from("m2_initial_activation").select("package_version_id").eq("language", language).maybeSingle();
      if (error) {
        if (["42P01", "PGRST205"].includes(error.code)) return { installed: false, activeVersionId: null };
        raise(error);
      }
      return { installed: true, activeVersionId: data?.package_version_id ?? null };
    },
    async activateInitialVersion(language, versionId, expected, actor) {
      const { error } = await db().rpc("m2_activate_initial_version", { p_language: language, p_version: versionId, p_expected: expected, p_actor: actor });
      if (error) raise(error);
    },
    loadProfiles: (ids) => rows(db().from("profiles").select("id, role, full_name, nickname").in("id", ids)),
  };
}

module.exports = { createSupabaseAssessmentPackageRepository };
