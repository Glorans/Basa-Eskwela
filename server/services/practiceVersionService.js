// M2 F7 — staff practice of a SPECIFIC authored Initial Diagnostic version (Try Assessment from the version editor).
//
// Who:   only staff who may view the package (assessmentPackagePolicy.canView): for Initial Diagnostic packages that is
//        the System Admin. School Admins and Teachers keep practising the built-in diagnostic (POST /api/diagnostic/practice
//        with the code-defined id), exactly as before.
// What:  an AUTHORED version of an Initial Diagnostic package that is PUBLISHED in the library, or the authored version
//        learners take now. Drafts, versions in review, approved-but-unpublished and other retired versions are refused
//        (preview only). The built-in 3.0 keeps its existing code path.
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

function createPracticeVersionService({ getAdmin = getSupabaseAdmin } = {}) {
  const db = () => getAdmin();

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
    if (policy.categoryOf(pkg) !== "initial") fail(409, "VERSION_NOT_PRACTISABLE", "Only Initial Diagnostic versions can be practised here.");
    if (v.source !== "authored") fail(409, "USE_BUILT_IN_PRACTICE", "Practise the built-in version with Try Assessment on version 3.0.");
    const activation = await read(db().from("m2_initial_activation").select("package_version_id").eq("language", pkg.language).maybeSingle());
    const activeForLearners = activation?.package_version_id === v.id;
    if (v.status !== "published" && !activeForLearners) {
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
