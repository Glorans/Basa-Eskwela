const { reportRows } = require("./weeklyReportRows");
const { summarizeComprehension } = require("./comprehensionScoring");

// Teacher-only read model. Callers must pass oral attempts that the Teacher is
// already authorized to see; comprehension rows are matched only to those.
const ATTEMPT_COLUMNS = "id,user_id,module_id,passage_id,room_id,assignment_id,material_id,"
  + "activity_assignment_id,oral_reading_attempt_id,status,created_at,completed_at,question_snapshot";
const RESPONSE_COLUMNS = "attempt_id,question_id,first_option_index,first_answer_correct,"
  + "answer_history,hint_used,resolved";

class TeacherComprehensionLookupError extends Error {
  constructor(message) {
    super(message);
    this.name = "TeacherComprehensionLookupError";
  }
}

function sameValue(left, right) {
  return (left ?? null) === (right ?? null);
}

function isNewerComprehension(candidate, current) {
  if (!current) return true;
  if ((candidate.status === "completed") !== (current.status === "completed")) {
    return candidate.status === "completed";
  }
  return (candidate.created_at ?? "") > (current.created_at ?? "");
}

// Older module rows were saved without oral_reading_attempt_id. The student flow
// required the latest saved reading for the same context, so link each one to
// the latest matching oral attempt completed before the comprehension started.
function findLegacyOralAttempt(comprehension, oralAttempts) {
  if (comprehension.material_id) return undefined;
  return oralAttempts
    .filter((oral) => !oral.material_id
      && oral.user_id === comprehension.user_id
      && sameValue(oral.module_id, comprehension.module_id)
      && sameValue(oral.passage_id, comprehension.passage_id)
      && sameValue(oral.room_id, comprehension.room_id)
      && sameValue(oral.assignment_id, comprehension.assignment_id)
      && (oral.completed_at ?? "") <= (comprehension.created_at ?? ""))
    .sort((left, right) => (right.completed_at ?? "").localeCompare(left.completed_at ?? ""))[0];
}

function matchComprehensionAttempts(oralAttempts, comprehensions) {
  const byOralId = new Map(oralAttempts.map((oral) => [oral.id, oral]));
  const matches = new Map();
  for (const comprehension of comprehensions) {
    const linked = comprehension.oral_reading_attempt_id
      ? byOralId.get(comprehension.oral_reading_attempt_id)
      : findLegacyOralAttempt(comprehension, oralAttempts);
    if (!linked
      || linked.user_id !== comprehension.user_id
      || !sameValue(linked.room_id, comprehension.room_id)
      || !sameValue(linked.material_id, comprehension.material_id)
      || !sameValue(linked.activity_assignment_id, comprehension.activity_assignment_id)) continue;
    if (isNewerComprehension(comprehension, matches.get(linked.id))) {
      matches.set(linked.id, comprehension);
    }
  }
  return matches;
}

function emptyStatus(oral, readAloudOnlyIds) {
  if (oral.activity_assignment_id && readAloudOnlyIds.has(oral.activity_assignment_id)) {
    return "not_applicable";
  }
  // Assigned stories and classroom module assignments expect comprehension.
  // Independent module practice without a saved comprehension has none to show.
  return oral.material_id || oral.assignment_id ? "not_started" : "not_applicable";
}

function toSummary(comprehension, responses, includeDetail, strict = false) {
  const summary = summarizeComprehension(comprehension.question_snapshot, responses);
  if (strict && comprehension.status === "completed" &&
    (summary.answered !== summary.totalQuestions || !summary.allResolved || !comprehension.completed_at || !Number.isFinite(Date.parse(comprehension.completed_at)))) {
    throw new TeacherComprehensionLookupError("Completed quiz evidence is incomplete. Weekly report was not generated.");
  }
  const result = {
    status: comprehension.status === "completed" ? "completed" : "in_progress",
    firstCorrect: summary.firstCorrect,
    totalQuestions: summary.totalQuestions,
    firstAttemptPercentage: summary.firstAttemptPercentage,
    hintsUsed: summary.hintsUsed,
    completedAt: comprehension.completed_at ?? null,
  };
  if (!includeDetail) return result;

  const responseMap = new Map(responses.map((response) => [response.question_id, response]));
  return {
    ...result,
    answered: summary.answered,
    byType: summary.byType,
    // Saved order and answer key come from the snapshot the student was given.
    questions: comprehension.question_snapshot.map((question, index) => {
      const response = responseMap.get(question.id);
      const firstAnswer = Number.isInteger(response?.first_option_index)
        ? response.first_option_index
        : null;
      const history = Array.isArray(response?.answer_history) ? response.answer_history : [];
      const secondAnswer = history[1]?.optionIndex;
      return {
        order: index + 1,
        type: question.type,
        prompt: question.questionText,
        options: question.options,
        studentFirstAnswerIndex: firstAnswer,
        correctIndex: question.correctOptionIndex,
        firstAnswerCorrect: firstAnswer === null ? null : firstAnswer === question.correctOptionIndex,
        hintUsed: response?.hint_used === true,
        resolved: response?.resolved === true,
        ...(Number.isInteger(secondAnswer) ? { secondAnswerIndex: secondAnswer } : {}),
      };
    }),
  };
}

async function loadComprehensionForOralAttempts(supabase, oralAttempts, options = {}) {
  const results = new Map();
  if (oralAttempts.length === 0) return results;
  try {
    const userIds = [...new Set(oralAttempts.map((oral) => oral.user_id))];
    const activityIds = [...new Set(oralAttempts.map((oral) => oral.activity_assignment_id).filter(Boolean))];

    const [assignments, comprehensions] = await Promise.all([
      reportRows(supabase, "reading_activity_assignments", "id,student_id,read_aloud_only", {}, "id", activityIds),
      reportRows(supabase, "m6_comprehension_attempts", ATTEMPT_COLUMNS, {}, "user_id", userIds),
    ]);

    const readAloudOnlyIds = new Set(assignments
      .filter((assignment) => assignment.read_aloud_only === true
        && userIds.includes(assignment.student_id))
      .map((assignment) => assignment.id));
    const matches = matchComprehensionAttempts(oralAttempts, comprehensions);
    const matchedIds = [...new Set([...matches.values()].map((row) => row.id))];
    const responses = await reportRows(supabase, "m6_comprehension_responses", `id,${RESPONSE_COLUMNS}`, {}, "attempt_id", matchedIds);

    for (const oral of oralAttempts) {
      const comprehension = matches.get(oral.id);
      if (!comprehension || readAloudOnlyIds.has(oral.activity_assignment_id)) {
        results.set(oral.id, { status: emptyStatus(oral, readAloudOnlyIds) });
        continue;
      }
      try {
        const own = responses.filter((response) => response.attempt_id === comprehension.id);
        results.set(oral.id, toSummary(comprehension, own, options.includeDetail === true, options.strict === true));
      } catch (error) {
        if (options.strict) throw error;
        console.error("[Teacher comprehension summary failed]", { message: error?.message });
        results.set(oral.id, { status: "unavailable" });
      }
    }
  } catch (error) {
    if (options.strict) throw error;
    console.error("[Teacher comprehension lookup failed]", { message: error?.message });
    for (const oral of oralAttempts) results.set(oral.id, { status: "unavailable" });
  }
  return results;
}

module.exports = {
  loadComprehensionForOralAttempts,
  matchComprehensionAttempts,
};
