// M2 F7 + F10 — staff practice of a SPECIFIC package version (Try Assessment from the version editor).
//
// Who:   only staff who may view the package (assessmentPackagePolicy.canView), i.e. its managers:
//          Initial Diagnostic                     System Admin (F7)
//          central Independent Learner (F10)      System Admin
//          school reassessment (F10)              School Admin
//          Teacher private reassessment (F10)     the owning Teacher only
//        Anyone else gets 404 (invisible and missing look the same). School Admins and Teachers also keep practising
//        the built-in diagnostic (POST /api/diagnostic/practice with the code-defined id), exactly as before.
// What:  Initial Diagnostic: an AUTHORED version that is PUBLISHED, or the authored version learners take now.
//        Reassessment: the PUBLISHED version only. Drafts, submitted, approved-but-unpublished and retired versions are
//        refused (preview only). The reassessment switches are NOT required: this is staff practice, not delivery.
// Bound: receipts and scoring use the identity
//          assessment id      "m2-practice-version:<version id>"   (never a learner diagnostic or reassessment id)
//          assessment version the version label (e.g. "4.0")
//          passage hash       sha256 of this version's passage text
//        so a practice receipt can never be used for another version, language, assessment or account, and an
//        official or reassessment receipt can never be used here.
// Never: this module only READS. It writes no results, history, placement, XP, badges, streaks or analytics.
const { createHash } = require("node:crypto");
const policy = require("./assessmentPackagePolicy");
const { DiagnosticSubmissionError } = require("./diagnosticResultService");
const { getSupabaseAdmin } = require("./supabaseAdmin");

const PRACTICE_VERSION_PREFIX = "m2-practice-version:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHOICE_IDS = Object.freeze(["a", "b", "c", "d"]);
const NOT_INSTALLED = new Set(["42P01", "PGRST205", "PGRST202", "42883"]);

const isPracticeVersionAssessmentId = (value) => typeof value === "string" && value.startsWith(PRACTICE_VERSION_PREFIX)
  && UUID.test(value.slice(PRACTICE_VERSION_PREFIX.length));
const passageText = (paragraphs) => paragraphs.join(" ");
const fail = (status, code, message) => { throw new DiagnosticSubmissionError(status, code, message); };

function createPracticeVersionService({ getAdmin = getSupabaseAdmin, schoolFilter } = {}) {
  const db = () => getAdmin();
  // M1 multi-tenancy: the ids among ids in the requester's own school.
  schoolFilter ??= async (requester, ids) => {
    const scope = require("./schoolScope");
    return scope.filterSchoolMembers(await scope.requireRequesterSchool(requester, { getAdmin }), ids, { getAdmin });
  };

  async function read(query) {
    const { data, error } = await query;
    if (error) {
      if (NOT_INSTALLED.has(error.code)) fail(503, "PRACTICE_UNAVAILABLE", "Version practice is not available yet.");
      fail(500, "PRACTICE_FAILED", "We couldn't load this version. Please try again.");
    }
    return data;
  }

  /** The scoring assessment and receipt binding for a version this requester may practise now; otherwise an error. */
  async function load(requester, versionId) {
    if (typeof versionId !== "string" || !UUID.test(versionId)) fail(404, "VERSION_NOT_FOUND", "This version was not found.");
    const v = await read(db().from("m2_assessment_package_versions")
      .select("id, package_id, status, source, version_label, passage_title, paragraphs, questions").eq("id", versionId).maybeSingle());
    const pkg = v ? await read(db().from("m2_assessment_packages")
      .select("id, kind, audience, scope, owner_id, language, archived_at, legacy_assessment_id").eq("id", v.package_id).maybeSingle()) : null;
    // Invisible and missing look the same, as on the package pages.
    if (!v || !pkg || !policy.canView(requester?.profile, pkg)) fail(404, "VERSION_NOT_FOUND", "This version was not found.");
    // M1 multi-tenancy: a School Admin tries only their own school's packages.
    if (requester?.profile?.role === "admin" && !(await schoolFilter(requester, [pkg.owner_id])).has(pkg.owner_id)) {
      fail(404, "VERSION_NOT_FOUND", "This version was not found.");
    }
    const category = policy.categoryOf(pkg);
    let activeForLearners = false;
    if (category === "initial") {
      if (v.source !== "authored") fail(409, "USE_BUILT_IN_PRACTICE", "Practise the built-in version with Try Assessment on version 3.0.");
      const activation = await read(db().from("m2_initial_activation").select("package_version_id").eq("language", pkg.language).maybeSingle());
      activeForLearners = activation?.package_version_id === v.id;
    } else if (pkg.kind !== "reassessment") {
      fail(409, "VERSION_NOT_PRACTISABLE", "This version cannot be practised.");
    } else if (v.status !== "published") {
      // F10: only the published reassessment version; drafts and older versions are preview-only.
      fail(409, "VERSION_NOT_PRACTISABLE", v.status === "retired"
        ? "Retired versions cannot be practised. Try the published version."
        : "Publish this version to try it. Drafts can be previewed only.");
    }
    if (category === "initial" && v.status !== "published" && !activeForLearners) {
      fail(409, "VERSION_NOT_PRACTISABLE", v.status === "draft" || v.status === "in_review" || v.status === "approved"
        ? "Publish this version to practise it. Drafts can be previewed only."
        : "Only the published version, or the version learners take, can be practised.");
    }
    const paragraphs = Array.isArray(v.paragraphs) ? [...v.paragraphs] : [];
    const questions = Array.isArray(v.questions) ? v.questions : [];
    if (!paragraphs.length || !questions.length) fail(409, "VERSION_NOT_PRACTISABLE", "This version has no complete content to practise.");
    const assessment = {
      source: "practice-version",
      versionId: v.id,
      packageId: pkg.id,
      category,
      id: `${PRACTICE_VERSION_PREFIX}${v.id}`,
      version: v.version_label,
      language: pkg.language,
      title: v.passage_title,
      paragraphs,
      questions: questions.map((q) => ({ id: q.id, choiceIds: CHOICE_IDS, correctChoiceId: q.correctChoiceId, prompt: q.prompt, choices: q.choices })),
    };
    const binding = {
      assessmentId: assessment.id,
      assessmentVersion: assessment.version,
      passageHash: createHash("sha256").update(passageText(paragraphs)).digest("hex"),
    };
    return { assessment, binding, activeForLearners };
  }

  /** Content for the practice screens. Answer keys never leave the server. */
  async function getContent(requester, versionId) {
    const { assessment, activeForLearners } = await load(requester, versionId);
    return {
      packageId: assessment.packageId,
      packageCategory: assessment.category,
      versionId: assessment.versionId,
      activeForLearners,
      assessment: {
        id: assessment.id,
        version: assessment.version,
        language: assessment.language,
        title: assessment.title,
        passage: { language: assessment.language, title: assessment.title, paragraphs: assessment.paragraphs },
        questions: assessment.questions.map((q) => ({ id: q.id, prompt: q.prompt, choices: (q.choices ?? []).map((c) => ({ id: c.id, label: c.label })) })),
      },
    };
  }

  /** Speech paths: the binding for this requester's practice reading of this version, or null (no receipt is issued). */
  async function resolveBinding({ requester, language, assessmentId, assessmentVersion }) {
    if (!isPracticeVersionAssessmentId(assessmentId)) return null;
    try {
      const { assessment, binding } = await load(requester, assessmentId.slice(PRACTICE_VERSION_PREFIX.length));
      return assessment.language === language && assessment.version === assessmentVersion ? binding : null;
    } catch (error) {
      if (error instanceof DiagnosticSubmissionError) return null;
      throw error;
    }
  }

  return { getContent, load, resolveBinding, passageText };
}

module.exports = { PRACTICE_VERSION_PREFIX, createPracticeVersionService, isPracticeVersionAssessmentId };
