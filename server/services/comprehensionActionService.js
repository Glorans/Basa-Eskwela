const { getSupabaseAdmin } = require("./supabaseAdmin");
const {
  ComprehensionError,
  loadOwnedAttempt,
  getComprehensionAttempt,
} = require("./comprehensionAttemptService");

// M6 single-attempt rule: one comprehension question = one final submitted
// answer = one graded result. The backend enforces it, not only the page:
//  * an answer to a question that already has a saved answer is refused unless
//    it is a network retry of that same request (same request ID and option);
//  * the saved first answer is final, so a question is finished as soon as it
//    is answered, correct or not;
//  * there is no separate hint action: the scaffolding prompt is shown after an
//    incorrect answer and never changes the score.
// Scoring is unchanged: one point per correct saved (first) answer.
// supabase/proposed/m6_single_attempt_PROPOSED.sql moves the same rule into the
// locked m6_apply_action function; until it is applied, finishQuestions() below
// closes answered questions that the current function would leave open.

function requireUuid(value, label) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new ComprehensionError(`${label} is invalid.`, 400);
  }
}

async function loadResponses(db, attemptId, questionId = null) {
  let query = db
    .from("m6_comprehension_responses")
    .select("id,question_id,first_option_index,first_answer_correct,answer_history,resolved")
    .eq("attempt_id", attemptId);
  if (questionId) query = query.eq("question_id", questionId);
  const { data, error } = await query;
  if (error) {
    throw new ComprehensionError("Unable to save your activity. Please retry.");
  }
  return data ?? [];
}

/** Marks answered questions finished. Only closes them: never changes an answer or a score. */
async function finishQuestions(db, responses) {
  for (const response of responses) {
    if (response.resolved === true || !Number.isInteger(response.first_option_index)) continue;
    const { error } = await db
      .from("m6_comprehension_responses")
      .update({ resolved: true, updated_at: new Date().toISOString() })
      .eq("id", response.id)
      .eq("resolved", false);
    if (error) {
      throw new ComprehensionError("Unable to save your activity. Please retry.");
    }
  }
}

function rpcError(error) {
  if (error.code === "42501") {
    return new ComprehensionError("Access to this activity has been revoked or is not authorized.", 403);
  }
  if (error.code === "22023") {
    return new ComprehensionError(error.message, 400);
  }
  if (error.code === "P0002") {
    return new ComprehensionError("Activity not found.", 404);
  }
  console.error("[M6 action failed]", {
    code: error.code,
    message: error.message,
  });
  return new ComprehensionError("Unable to save your activity. Please retry.");
}

async function applyComprehensionAction(
  requester,
  attemptId,
  body = {},
) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ComprehensionError("Invalid activity action.", 400);
  }

  if (!["answer", "complete"].includes(body.action)) {
    throw new ComprehensionError("Invalid activity action.", 400);
  }

  if (body.action === "answer") {
    requireUuid(body.questionId, "Question ID");
    requireUuid(body.requestId, "Request ID");

    if (
      !Number.isInteger(body.optionIndex) ||
      body.optionIndex < 0 ||
      body.optionIndex > 3
    ) {
      throw new ComprehensionError("Choose a valid answer.", 400);
    }
  }

  // Checks ownership before calling the protected database function.
  await loadOwnedAttempt(requester, attemptId);
  const db = getSupabaseAdmin();

  if (body.action === "answer") {
    const [saved] = await loadResponses(db, attemptId, body.questionId);
    if (saved && Number.isInteger(saved.first_option_index)) {
      const history = Array.isArray(saved.answer_history) ? saved.answer_history : [];
      const retry = history.find((entry) => entry?.requestId === body.requestId);
      if (!retry) {
        // Refresh, back navigation, a second tab or a crafted request cannot replace the final answer.
        throw new ComprehensionError("This question already has a final answer.", 409);
      }
      if (retry.optionIndex !== body.optionIndex) {
        throw new ComprehensionError("Request ID already used for another answer", 400);
      }
      // The same request again (an uncertain network save): return the saved result.
      await finishQuestions(db, [saved]);
      return {
        outcome: { correct: saved.first_answer_correct === true, resolved: true, final: true },
        attempt: await getComprehensionAttempt(requester, attemptId),
      };
    }
  }

  if (body.action === "complete") {
    // Questions answered before this rule (or before the proposed SQL) may still be open.
    await finishQuestions(db, await loadResponses(db, attemptId));
  }

  const { data, error } = await db.rpc(
    "m6_apply_action",
    {
      target_attempt: attemptId,
      target_user: requester.user.id,
      target_question:
        body.action === "complete" ? null : body.questionId,
      action_name: body.action,
      selected_option:
        body.action === "answer" ? body.optionIndex : null,
      request_id:
        body.action === "answer" ? body.requestId : null,
    },
  );

  if (error) throw rpcError(error);

  let outcome = data;
  if (body.action === "answer") {
    // The first answer is final whether or not it was correct.
    await finishQuestions(db, await loadResponses(db, attemptId, body.questionId));
    outcome = { correct: data?.correct === true, resolved: true, final: true };
  }

  if (body.action === "complete") {
    // The DB trigger durably queues completion; this accelerates delivery when M7 is enabled.
    const riskWorker = require("./m7RiskWorker");
    if (riskWorker.isRiskWorkerEnabled()) void riskWorker.drainRiskQueue();
  }

  return {
    outcome,
    attempt: await getComprehensionAttempt(requester, attemptId),
  };
}

module.exports = { applyComprehensionAction };
