/*
 * One comprehension assessment per learning activity: the single rule shared by M6 and M7.
 * M5 readings may be repeated, but every reading of the same activity leads to the same M6 assessment:
 *   - a module passage in its context: (module, passage, classroom, room assignment); an
 *     Admin's or Independent Learner's own practice has no classroom or assignment;
 *   - an assigned classroom material: (material, activity assignment).
 * Different classrooms, assignments or passages are different activities.
 * Pure functions; nothing here reads or changes saved attempts.
 */
function activityKey(row) {
  return row.material_id
    ? { material_id: row.material_id, activity_assignment_id: row.activity_assignment_id ?? null }
    : {
      material_id: null,
      module_id: row.module_id ?? null,
      passage_id: row.passage_id ?? null,
      room_id: row.room_id ?? null,
      assignment_id: row.assignment_id ?? null,
    };
}

/**
 * The activity's assessment. Attempts saved before this rule may include extra attempts for
 * one activity (each from a repeated reading); they are kept unchanged, and the one that counts
 * is the first completed attempt, otherwise the first one started.
 */
function chooseActivityAttempt(rows) {
  const time = (row) => String((row.status === "completed" ? row.completed_at : row.created_at) ?? "");
  return [...rows].sort((a, b) => {
    const aDone = a.status === "completed";
    const bDone = b.status === "completed";
    if (aDone !== bDone) return aDone ? -1 : 1;
    return time(a).localeCompare(time(b)) || String(a.id).localeCompare(String(b.id));
  })[0] ?? null;
}

/** Whether a saved row names its learning activity. Rows that do not are never grouped together. */
function hasActivity(row) {
  return Boolean(row.material_id || (row.module_id && row.passage_id));
}

const groupKey = (row) => `${row.user_id}|${hasActivity(row) ? JSON.stringify(activityKey(row)) : row.id}`;

/** Splits completed attempts into those that count (one per learner and activity) and the rest. */
function splitCanonicalCompleted(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (row.status !== "completed") continue;
    const key = groupKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const canonicalIds = new Set([...groups.values()].map((group) => chooseActivityAttempt(group).id));
  const completed = rows.filter((row) => row.status === "completed");
  return {
    canonical: completed.filter((row) => canonicalIds.has(row.id)),
    extra: completed.filter((row) => !canonicalIds.has(row.id)),
  };
}

module.exports = { activityKey, chooseActivityAttempt, hasActivity, splitCanonicalCompleted };
