// M2 F8 Independent Learner pilot allow-list (default OFF).
//
// M2_IL_PILOT_USER_IDS (backend environment, comma-separated account ids):
//   unset or blank -> no pilot: every eligible Independent Learner may start (the existing behaviour).
//   set            -> pilot: ONLY the listed Independent Learner accounts may START a reassessment. Everyone else is
//                     told reassessments are not open yet, and the server refuses the start (409).
//   malformed      -> fails CLOSED: nobody may start, rather than opening the pilot to everyone.
//
// Enforced on the server only (the browser never decides). The database stays the final check for every start: the
// Independent Learner switch, the initial diagnostic, the waiting interval and one active reassessment per language.
// Only the backend (service_role) can create reassessment assignments, so the allow-list cannot be bypassed from a
// browser. Nothing here touches results, scoring or placement.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseIndependentPilot(raw) {
  const text = raw === undefined || raw === null ? "" : String(raw).trim();
  if (!text) return Object.freeze({ enabled: false, malformed: false, size: 0, allows: () => true });
  const entries = text.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  const malformed = entries.length === 0 || entries.some((value) => !UUID.test(value));
  const ids = new Set(malformed ? [] : entries);
  return Object.freeze({
    enabled: true,
    malformed,
    size: ids.size,
    allows: (userId) => typeof userId === "string" && ids.has(userId.toLowerCase()),
  });
}

/** Startup log line: never prints account ids. */
function describeIndependentPilot(pilot) {
  if (!pilot.enabled) return "M2 Independent Learner pilot allow-list: off";
  if (pilot.malformed) return "M2 Independent Learner pilot allow-list: MALFORMED value; no Independent Learner can start a reassessment";
  return `M2 Independent Learner pilot allow-list: on (${pilot.size} account${pilot.size === 1 ? "" : "s"})`;
}

module.exports = { parseIndependentPilot, describeIndependentPilot };
