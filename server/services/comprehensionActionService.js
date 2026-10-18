const { getSupabaseAdmin } = require("./supabaseAdmin");
const {
  ComprehensionError,
  loadOwnedAttempt,
  getComprehensionAttempt,
} = require("./comprehensionAttemptService");

function requireUuid(value, label) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new ComprehensionError(`${label} is invalid.`, 400);
  }
}

async function applyComprehensionAction(
  requester,
  attemptId,
  body = {},
) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ComprehensionError("Invalid activity action.", 400);
  }

  if (!["answer", "hint", "complete"].includes(body.action)) {
    throw new ComprehensionError("Invalid activity action.", 400);
  }

  if (body.action !== "complete") {
    requireUuid(body.questionId, "Question ID");
  }

  if (body.action === "answer") {
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

  const { data, error } = await getSupabaseAdmin().rpc(
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

  if (error) {
    if (error.code === "22023") {
      throw new ComprehensionError(error.message, 400);
    }

    if (error.code === "P0002") {
      throw new ComprehensionError("Activity not found.", 404);
    }

    console.error("[M6 action failed]", {
      code: error.code,
      message: error.message,
    });

    throw new ComprehensionError(
      "Unable to save your activity. Please retry.",
    );
  }

  return {
    outcome: data,
    attempt: await getComprehensionAttempt(requester, attemptId),
  };
}

module.exports = { applyComprehensionAction };