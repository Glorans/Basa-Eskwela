// M2 F6: which INITIAL diagnostic learners take, per language, and which versions the server still accepts.
//   * Built-in (default): the code-defined version 3.0 (DIAGNOSTIC_ASSESSMENTS). Nothing changes until a System Admin
//     explicitly activates a published version (m2_initial_activation_PROPOSED; no educator endorsement needed since
//     m2_initial_activation_no_endorsement_PROPOSED).
//   * Activated: a version of the language's initial lineage (the package holding the imported 3.0). Its results are
//     stored with the lineage id (e.g. grade5-en-passage-v3) and the version label (e.g. 4.0).
//   * A version replaced less than 24 hours ago (the reading-receipt lifetime) is still accepted, so a learner who was
//     already reading it finishes on the SAME content; new sessions get the active version.
// Scoring and reading receipts always use the exact version delivered. Answer keys never leave the server.
const { createHash } = require("node:crypto");
const { DIAGNOSTIC_ASSESSMENTS, getDiagnosticAssessmentBinding } = require("./diagnosticAssessments");
const { RECEIPT_TTL_MS } = require("./diagnosticTranscriptReceipts");
const { getSupabaseAdmin } = require("./supabaseAdmin");

const CHOICE_IDS = Object.freeze(["a", "b", "c", "d"]);
const NOT_INSTALLED = new Set(["42P01", "PGRST205", "PGRST202", "42883"]);
const LINEAGE = Object.freeze(Object.fromEntries(Object.entries(DIAGNOSTIC_ASSESSMENTS).map(([language, a]) => [language, a.id])));

class InitialDiagnosticUnavailableError extends Error {
  constructor() {
    super("The diagnostic is temporarily unavailable. Please try again.");
    this.name = "InitialDiagnosticUnavailableError";
    this.statusCode = 503;
    this.code = "DIAGNOSTIC_UNAVAILABLE";
  }
}

const passageHash = (paragraphs) => createHash("sha256").update(paragraphs.join(" ")).digest("hex");

/** The code-defined diagnostic as a scoring assessment (server copy: identity, passage and keys). */
function codeAssessment(language) {
  const a = DIAGNOSTIC_ASSESSMENTS[language];
  return a ? { source: "code", id: a.id, version: a.version, language, title: a.title, paragraphs: [...a.paragraphs], questions: a.questions } : null;
}

function bindingFor(assessment) {
  return { assessmentId: assessment.id, assessmentVersion: assessment.version, passageHash: passageHash(assessment.paragraphs) };
}

/** Code-only behaviour (no activation installed): exactly the previous checks. */
function createCodeOnlyInitialDiagnostics() {
  return {
    async resolve(language, assessmentId, assessmentVersion) {
      const binding = getDiagnosticAssessmentBinding(language, assessmentId, assessmentVersion);
      return binding ? codeAssessment(language) : null;
    },
    binding: bindingFor,
    async hasOtherOfficialInitial() { return false; },
    async delivery(language) {
      const a = codeAssessment(language);
      return a ? { active: { source: "code", id: a.id, version: a.version }, accepted: [{ id: a.id, version: a.version }] } : null;
    },
  };
}

function createInitialDiagnosticService({ getAdmin = getSupabaseAdmin, now = Date.now, graceMs = RECEIPT_TTL_MS } = {}) {
  const db = () => getAdmin();

  /** Active version id (null = built-in) and versions replaced within the grace window. */
  async function state(language) {
    const { data, error } = await db().from("m2_initial_activation").select("package_version_id").eq("language", language).maybeSingle();
    if (error) {
      if (NOT_INSTALLED.has(error.code)) return { installed: false, activeId: null, graceIds: [] };
      throw new InitialDiagnosticUnavailableError();
    }
    const since = new Date(now() - graceMs).toISOString();
    const events = await db().from("m2_initial_activation_events").select("from_version_id, changed_at").eq("language", language).gte("changed_at", since);
    if (events.error) throw new InitialDiagnosticUnavailableError();
    // null in from_version_id means the built-in version was the one replaced.
    return { installed: true, activeId: data?.package_version_id ?? null, graceIds: (events.data ?? []).map((e) => e.from_version_id ?? null) };
  }

  async function packageVersion(versionId) {
    const { data: v, error } = await db().from("m2_assessment_package_versions")
      .select("id, package_id, version_label, passage_title, paragraphs, questions").eq("id", versionId).maybeSingle();
    if (error || !v) throw new InitialDiagnosticUnavailableError();
    const { data: p, error: pe } = await db().from("m2_assessment_packages").select("id, language, legacy_assessment_id").eq("id", v.package_id).maybeSingle();
    if (pe || !p) throw new InitialDiagnosticUnavailableError();
    return {
      source: "package", versionId: v.id, id: p.legacy_assessment_id, version: v.version_label, language: p.language, title: v.passage_title,
      paragraphs: [...v.paragraphs],
      questions: v.questions.map((q) => ({ id: q.id, choiceIds: CHOICE_IDS, correctChoiceId: q.correctChoiceId, prompt: q.prompt, choices: q.choices })),
    };
  }

  const assessmentFor = (language, versionId) => (versionId ? packageVersion(versionId) : Promise.resolve(codeAssessment(language)));

  /** The scoring assessment for (id, version) if the server accepts it now (active or within the grace window). */
  async function resolve(language, assessmentId, assessmentVersion) {
    if (!Object.hasOwn(LINEAGE, language) || assessmentId !== LINEAGE[language] || typeof assessmentVersion !== "string") return null;
    const s = await state(language);
    for (const versionId of [s.activeId, ...s.graceIds.filter((g) => g !== s.activeId)]) {
      const candidate = await assessmentFor(language, versionId);
      if (candidate && candidate.id === assessmentId && candidate.version === assessmentVersion) return candidate;
    }
    return null;
  }

  /** Learner delivery: what to take now, and which versions are still accepted (to finish an in-progress session). */
  async function delivery(language, { version } = {}) {
    if (!Object.hasOwn(LINEAGE, language)) return null;
    const s = await state(language);
    const active = await assessmentFor(language, s.activeId);
    const accepted = [];
    for (const versionId of [s.activeId, ...s.graceIds.filter((g) => g !== s.activeId)]) {
      const a = await assessmentFor(language, versionId);
      if (a && !accepted.some((x) => x.version === a.version)) accepted.push({ id: a.id, version: a.version });
    }
    const chosen = version && version !== active.version
      ? await resolve(language, LINEAGE[language], version)
      : active;
    if (!chosen) return null;
    const summary = { id: chosen.id, version: chosen.version, source: chosen.source };
    // The built-in version's prompts and choices ship with the app; a package version is sent without answer keys.
    return {
      active: { source: active.source, id: active.id, version: active.version },
      accepted,
      delivered: chosen.source === "code" ? summary : {
        ...summary,
        assessment: {
          id: chosen.id, version: chosen.version, language, title: chosen.title,
          passage: { language, title: chosen.title, paragraphs: chosen.paragraphs },
          questions: chosen.questions.map((q) => ({ id: q.id, prompt: q.prompt, choices: q.choices.map((c) => ({ id: c.id, label: c.label })) })),
        },
      },
    };
  }

  /** True when the learner already has an official initial result in this language for ANOTHER version (no retakes). */
  async function hasOtherOfficialInitial(supabase, userId, language, assessment) {
    const { data, error } = await supabase.from("diagnostic_results").select("assessment_id, assessment_version")
      .eq("user_id", userId).eq("language", language).eq("assessment_type", "initial").eq("verification_status", "server_verified");
    if (error) throw new InitialDiagnosticUnavailableError();
    return (data ?? []).some((r) => r.assessment_id === LINEAGE[language] && r.assessment_version !== assessment.version);
  }

  return { binding: bindingFor, delivery, hasOtherOfficialInitial, resolve, state };
}

module.exports = {
  INITIAL_LINEAGE: LINEAGE,
  InitialDiagnosticUnavailableError,
  createCodeOnlyInitialDiagnostics,
  createInitialDiagnosticService,
};
