// Which server-verified INITIAL diagnostic results count as the learner's official initial diagnostic.
// Any version 3.0 or later of the language's initial lineage counts (the built-in 3.0 and any version a System Admin
// activates later, F6, which are always created after the 3.0 import),
// so a learner who completed one version is never asked to retake when another becomes active. The pre-verification,
// sentence-based version 2.0 has a different assessment id and is intentionally NOT part of the lineage.
// readflow/src/modules/module2/data/permanentInitialAssessments.ts must name the same lineage ids (a test checks).
const { DIAGNOSTIC_ASSESSMENTS } = require("./diagnosticAssessments");

const INITIAL_DIAGNOSTIC_LINEAGE = Object.freeze(Object.fromEntries(Object.entries(DIAGNOSTIC_ASSESSMENTS).map(([language, a]) => [language, a.id])));
// Kept for compatibility with earlier callers: the lineage as (language, id) pairs; the version is not restricted.
const PERMANENT_INITIAL_ASSESSMENTS = Object.freeze(Object.entries(INITIAL_DIAGNOSTIC_LINEAGE).map(([language, id]) => Object.freeze({ language, id })));

/** "major.minor" -> comparable number; anything else -> NaN (never official). */
const versionNumber = (label) => (typeof label === "string" && /^[0-9]{1,4}(\.[0-9]{1,4})?$/.test(label)
  ? Number(label.split(".")[0]) * 10000 + Number(label.split(".")[1] ?? 0) : Number.NaN);
const FIRST_OFFICIAL_VERSION = versionNumber("3.0");

function isOfficialInitialResult(row) {
  return Boolean(row && row.assessment_type === "initial" && row.verification_status === "server_verified"
    && Object.hasOwn(INITIAL_DIAGNOSTIC_LINEAGE, row.language) && row.assessment_id === INITIAL_DIAGNOSTIC_LINEAGE[row.language]
    && versionNumber(row.assessment_version) >= FIRST_OFFICIAL_VERSION);
}

module.exports = { INITIAL_DIAGNOSTIC_LINEAGE, PERMANENT_INITIAL_ASSESSMENTS, isOfficialInitialResult };
