// M2 F5 — View Reading Progress. Built ONLY from official, server-verified M2 results (the F3 history entries):
//   * the official initial diagnostic (any version of the initial lineage, 3.0 or later; never v2.0 or unverified);
//   * official reassessments (recorded through the protected F8 path).
// Never used: F7 Practice Mode (stores nothing), unverified rows, M5/M6 practice, M8 XP.
// The "current" classification follows the placement rule: switch OFF (default) = the initial diagnostic; switch ON
// (approved policy only) = the latest official assessment. English and Filipino are always separate.
// A change is described only between two official results ("since the initial diagnostic"), never as a trend.
const { isOfficialInitialResult } = require("./initialDiagnosticCompletion");

const LANGUAGES = Object.freeze(["en", "fil"]);
const RANK = Object.freeze({ Frustration: 0, Instructional: 1, Independent: 2 });

const isOfficial = (e) => e.verified === true && (
  (e.assessmentType === "initial" && isOfficialInitialResult({
    assessment_type: "initial", verification_status: "server_verified", language: e.language, assessment_id: e.assessmentId, assessment_version: e.assessmentVersion,
  }))
  || e.assessmentType === "reassessment");

const oldestFirst = (a, b) => String(a.completedAt).localeCompare(String(b.completedAt)) || String(a.id).localeCompare(String(b.id));

function point(e) {
  return {
    id: e.id,
    assessmentType: e.assessmentType,
    title: e.assessmentTitle ?? null,
    version: e.assessmentVersion ?? null,
    completedAt: e.completedAt,
    readingLevel: e.readingLevel,
    wordRecognitionScore: e.wordRecognitionScore,
    comprehensionScore: e.comprehensionScore,
  };
}

function languageProgress(entries, language, followsReassessment) {
  const official = entries.filter((e) => e.language === language && isOfficial(e)).sort(oldestFirst);
  const initials = official.filter((e) => e.assessmentType === "initial");
  const initial = initials[initials.length - 1] ?? null;
  const reassessments = official.filter((e) => e.assessmentType === "reassessment");
  const latest = official[official.length - 1] ?? null;
  const currentEntry = followsReassessment ? latest : initial;

  let change;
  if (!initial) change = { status: "none", message: "No official assessment yet." };
  else if (official.length < 2 || !latest || latest === initial) {
    change = { status: "insufficient", message: "Only one official assessment so far, so there is no change to show yet." };
  } else {
    const from = RANK[initial.readingLevel];
    const to = RANK[latest.readingLevel];
    const direction = to > from ? "higher" : to < from ? "lower" : "same";
    change = {
      status: "compared",
      direction,
      from: initial.readingLevel,
      to: latest.readingLevel,
      basedOn: official.length,
      message: direction === "same"
        ? `Same reading level as the initial diagnostic (${latest.readingLevel}), based on ${official.length} official assessments.`
        : `${direction === "higher" ? "Higher" : "Lower"} than the initial diagnostic: ${initial.readingLevel} to ${latest.readingLevel}, based on ${official.length} official assessments.`,
    };
  }
  return {
    language,
    current: currentEntry ? {
      readingLevel: currentEntry.readingLevel,
      source: currentEntry.assessmentType,
      completedAt: currentEntry.completedAt,
      rule: followsReassessment ? "latest-official" : "initial",
    } : null,
    initial: initial ? point(initial) : null,
    reassessments: reassessments.map(point),
    change,
    placementNote: !followsReassessment && reassessments.length
      ? "Reassessment scores are shown as history. Reading placement still uses the initial diagnostic until a reassessment-based rule is approved."
      : null,
  };
}

/** Progress for one learner from their F3 history entries. */
function buildReadingProgress(entries, { followsReassessment = false } = {}) {
  return Object.fromEntries(LANGUAGES.map((language) => [language, languageProgress(entries ?? [], language, followsReassessment)]));
}

module.exports = { buildReadingProgress, isOfficialProgressEntry: isOfficial };
