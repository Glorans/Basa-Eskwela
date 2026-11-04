const { loadAssignedReadingSource } = require("./assignedReadingSource");
const { getSupabaseAdmin } = require("./supabaseAdmin");
const {
  authorizeOralReadingRequest,
  loadAccessiblePublishedModule,
} = require("./oralReadingAttemptService");
const {
  QUESTION_TYPES,
  summarizeComprehension,
} = require("./comprehensionScoring");
const { displayEvidence } = require("./passageEvidence");

class ComprehensionError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "ComprehensionError";
    this.statusCode = statusCode;
  }
}

function requireUuid(value, label) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new ComprehensionError(`${label} is invalid.`, 400);
  }

  return value;
}

function databaseError(error, message) {
  console.error("[M6 database error]", {
    code: error?.code,
    message: error?.message,
  });

  return new ComprehensionError(message);
}

function optionalText(value) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function normalizedText(value) {
  return typeof value === "string" ? value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() : "";
}

function normalizeEvidence(value) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

async function authorizeComprehensionRequest(req) {
  return authorizeOralReadingRequest(req);
}

async function requireAssignedQuestionSet(db, materialId, questionSetId) {
  const { data, error } = await db
    .from("material_question_sets")
    .select("id")
    .eq("id", questionSetId)
    .eq("material_id", materialId)
    .maybeSingle();

  if (error) {
    throw databaseError(error, "Unable to load the assigned question set.");
  }

  if (!data) {
    throw new ComprehensionError(
      "The assigned question set does not belong to this story. Ask your teacher to assign it again.",
      422,
    );
  }
}

async function loadReviewedQuestions(
  moduleId,
  passageId,
  passageText,
  materialId = null,
  questionSetId = null,
) {
  const db = getSupabaseAdmin();

  if (questionSetId) {
    await requireAssignedQuestionSet(db, materialId, questionSetId);
  }

  let questionQuery = db
    .from("comprehension_questions")
    .select(
      "id,question_type,question_text,options,scaffolding_hint,display_order,review_status",
    );
  if (questionSetId) {
    // An assigned set is used whole, in its saved order, or not at all.
    questionQuery = questionQuery.eq("material_id", materialId).eq("question_set_id", questionSetId);
  } else {
    questionQuery = questionQuery.eq("review_status", "reviewed");
    questionQuery = materialId
      ? questionQuery.eq("material_id", materialId).is("module_id", null).is("passage_id", null)
      : questionQuery.eq("module_id", moduleId).eq("passage_id", passageId).is("material_id", null);
  }
  const { data: questions, error } = await questionQuery.order("display_order", { ascending: true });

  if (error) {
    throw databaseError(
      error,
      "Unable to load comprehension questions.",
    );
  }

  if (!questions?.length) {
    throw new ComprehensionError(
      "Comprehension is not available yet. No reviewed questions are available for this story.",
      422,
    );
  }

  if (questionSetId && questions.some((question) => question.review_status !== "reviewed")) {
    throw new ComprehensionError(
      "The assigned question set is not reviewed yet. Ask your teacher to review it.",
      422,
    );
  }

  const { data: answers, error: answerError } = await db
    .from("comprehension_question_answers")
    .select(
      "question_id,correct_answer,answer_explanation,supporting_evidence",
    )
    .in(
      "question_id",
      questions.map((question) => question.id),
    );

  if (answerError) {
    throw databaseError(
      answerError,
      "Unable to load the answer keys and feedback.",
    );
  }

  const answerMap = new Map(
    (answers ?? []).map((answer) => [
      answer.question_id,
      answer,
    ]),
  );

  const source = normalizeEvidence(passageText ?? "");

  const snapshot = questions.map((question) => {
    const options = question.options;
    const answer = answerMap.get(question.id);

    if (
      !QUESTION_TYPES.includes(question.question_type) ||
      typeof question.question_text !== "string" ||
      !question.question_text.trim() ||
      typeof question.scaffolding_hint !== "string" ||
      !question.scaffolding_hint.trim() ||
      !Array.isArray(options) ||
      options.length !== 4 ||
      options.some(
        (option) =>
          typeof option !== "string" || !option.trim(),
      ) ||
      new Set(
        options.map((option) => option.trim().toLowerCase()),
      ).size !== 4
    ) {
      throw new ComprehensionError(
        "This passage has an invalid question. Ask for its question bank to be reviewed.",
        422,
      );
    }

    const correctOptionIndex = options.indexOf(
      answer?.correct_answer,
    );

    if (correctOptionIndex === -1) {
      throw new ComprehensionError(
        "A question is missing a valid answer key.",
        422,
      );
    }

    const answerExplanation = optionalText(
      answer?.answer_explanation,
    );
    const supportingEvidence = optionalText(
      answer?.supporting_evidence,
    );

    if (
      answerExplanation &&
      answerExplanation.length > 1500
    ) {
      throw new ComprehensionError(
        "A question explanation needs to be reviewed.",
        422,
      );
    }

    if (
      supportingEvidence &&
      (
        supportingEvidence.length > 1000 ||
        !source.includes(
          normalizeEvidence(supportingEvidence),
        )
      )
    ) {
      throw new ComprehensionError(
        "A question's supporting evidence does not match this passage. Ask for its question bank to be reviewed.",
        422,
      );
    }

    return {
      id: question.id,
      type: question.question_type,
      questionText: question.question_text,
      options,
      scaffoldingHint: question.scaffolding_hint,
      correctOptionIndex,
      answerExplanation,
      supportingEvidence,
    };
  });

  if (
    QUESTION_TYPES.some(
      (type) =>
        !snapshot.some((question) => question.type === type),
    )
  ) {
    throw new ComprehensionError(
      "The passage needs literal, inferential, and critical questions.",
      422,
    );
  }

  // New attempts present Literal, then Inferential, then Critical questions,
  // each group in its saved order. Only the new snapshot is ordered; saved
  // questions and earlier attempts' snapshots are unchanged.
  return QUESTION_TYPES.flatMap((type) => snapshot.filter((question) => question.type === type));
}

async function loadOwnedAttempt(requester, attemptId) {
  requireUuid(attemptId, "Activity ID");

  const { data, error } = await getSupabaseAdmin()
    .from("m6_comprehension_attempts")
    .select("*")
    .eq("id", attemptId)
    .eq("user_id", requester.user.id)
    .maybeSingle();

  if (error) {
    throw databaseError(
      error,
      "Unable to load the comprehension activity.",
    );
  }

  if (!data) {
    throw new ComprehensionError(
      "Comprehension activity not found.",
      404,
    );
  }

  return data;
}

async function getComprehensionAttempt(requester, attemptId) {
  const attempt = await loadOwnedAttempt(requester, attemptId);

  const { data: responses, error } = await getSupabaseAdmin()
    .from("m6_comprehension_responses")
    .select(
      "question_id,first_option_index,first_answer_correct,answer_history,hint_used,resolved",
    )
    .eq("attempt_id", attempt.id);

  if (error) {
    throw databaseError(error, "Unable to load your answers.");
  }

  // Single attempt: a saved answer is final, so an answered question counts as
  // finished even if it was saved before the answer rule closed it in the database.
  const finalResponses = (responses ?? []).map((response) => ({
    ...response,
    resolved: response.resolved === true || Number.isInteger(response.first_option_index),
  }));
  const responseMap = new Map(
    finalResponses.map((response) => [
      response.question_id,
      response,
    ]),
  );

  return {
    id: attempt.id,
    moduleId: attempt.module_id,
    materialId: attempt.material_id ?? null,
    roomId: attempt.room_id ?? null,
    activityAssignmentId: attempt.activity_assignment_id ?? null,
    oralReadingAttemptId: attempt.oral_reading_attempt_id ?? null,
    passageId: attempt.passage_id,
    passageTitle: attempt.passage_title,
    passageText: attempt.passage_text,
    language: attempt.language,
    status: attempt.status,
    createdAt: attempt.created_at,
    completedAt: attempt.completed_at,

    // Never return the raw snapshot.
    // Reveal answer feedback only after the question has its final answer.
    questions: attempt.question_snapshot.map((question) => {
      const response = responseMap.get(question.id);
      const resolved = response?.resolved === true;
      const answerExplanation = resolved ? optionalText(question.answerExplanation) : null;

      return {
        id: question.id,
        type: question.type,
        questionText: question.questionText,
        options: question.options,
        firstOptionIndex: response?.first_option_index ?? null,
        firstAnswerCorrect:
          response?.first_answer_correct ?? null,
        answerHistory: response?.answer_history ?? [],
        hintUsed: response?.hint_used ?? false,
        hint: response?.hint_used
          ? question.scaffoldingHint
          : null,
        resolved,
        correctOptionIndex: resolved
          ? question.correctOptionIndex
          : null,
        answerExplanation,
        // F2 scaffolding prompt: the question's saved guiding hint, shown only
        // after an incorrect final answer. It helps understanding, does not
        // reopen the question and never changes the score. It is left out when
        // it would only repeat the explanation (F3 contextualized feedback).
        scaffoldingPrompt: resolved && response?.first_answer_correct === false
          && optionalText(question.scaffoldingHint)
          && normalizedText(question.scaffoldingHint) !== normalizedText(answerExplanation)
          ? optionalText(question.scaffoldingHint)
          : null,
        // Display only: a stored fragment is shown as the complete sentence(s)
        // from this attempt's saved passage when the match is reliable; the
        // stored question and answer are never changed.
        supportingEvidence: resolved
          ? optionalText(displayEvidence(attempt.passage_text, question.supportingEvidence))
          : null,
      };
    }),

    summary: summarizeComprehension(
      attempt.question_snapshot,
      finalResponses,
    ),
  };
}

async function startComprehensionAttempt(requester, body = {}) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    throw new ComprehensionError(
      "Invalid activity request.",
      400,
    );
  }

  const materialId = body.materialId ?? null;
  if (materialId) {
    requireUuid(materialId, "Material ID");
    requireUuid(body.activityAssignmentId, "Reading assignment ID");
    requireUuid(body.oralReadingAttemptId, "Oral reading result ID");
    if (body.moduleId || body.passageId || body.assignmentId) {
      throw new ComprehensionError("Material and module references cannot be combined.", 400);
    }
  } else {
    requireUuid(body.moduleId, "Module ID");
    requireUuid(body.passageId, "Passage ID");
    if (body.activityAssignmentId) throw new ComprehensionError("Invalid module context.", 400);
  }
  if (body.oralReadingAttemptId) requireUuid(body.oralReadingAttemptId, "Oral reading result ID");
  requireUuid(body.submissionId, "Submission ID");

  if (body.roomId != null) {
    requireUuid(body.roomId, "Classroom ID");
  }

  if (body.assignmentId != null) {
    requireUuid(body.assignmentId, "Assignment ID");
  }

  const db = getSupabaseAdmin();

  const { data: existing, error: existingError } = await db
    .from("m6_comprehension_attempts")
    .select("id,module_id,passage_id,room_id,assignment_id,material_id,activity_assignment_id,oral_reading_attempt_id")
    .eq("user_id", requester.user.id)
    .eq("submission_id", body.submissionId)
    .maybeSingle();

  if (existingError) {
    throw databaseError(
      existingError,
      "Unable to check your saved activity.",
    );
  }

  function verifySameRequest(saved) {
    if (
      (saved.module_id ?? null) !== (body.moduleId ?? null) ||
      (saved.passage_id ?? null) !== (body.passageId ?? null) ||
      (saved.material_id ?? null) !== materialId ||
      (saved.activity_assignment_id ?? null) !== (body.activityAssignmentId ?? null) ||
      // A module request without the oral-reading ID is bound to the verified reading below.
      (body.oralReadingAttemptId != null && (saved.oral_reading_attempt_id ?? null) !== body.oralReadingAttemptId) ||
      (saved.room_id ?? null) !== (body.roomId ?? null) ||
      (saved.assignment_id ?? null) !==
        (body.assignmentId ?? null)
    ) {
      throw new ComprehensionError(
        "This submission ID already belongs to another activity.",
        409,
      );
    }
  }

  if (existing) {
    verifySameRequest(existing);
    return getComprehensionAttempt(requester, existing.id);
  }

  // Reopen this exact saved assessment even if its source was later edited.
  if (body.oralReadingAttemptId) {
    const { data: resumed, error: resumeError } = await db.from("m6_comprehension_attempts")
      .select("id,module_id,passage_id,room_id,assignment_id,material_id,activity_assignment_id,oral_reading_attempt_id")
      .eq("user_id", requester.user.id).eq("oral_reading_attempt_id", body.oralReadingAttemptId).maybeSingle();
    if (resumeError) throw databaseError(resumeError, "Unable to reopen comprehension.");
    if (resumed) { verifySameRequest(resumed); return getComprehensionAttempt(requester, resumed.id); }
  }

  // Check publication, enrollment, assignment, and passage access.
  const module = materialId ? await loadAssignedReadingSource(requester, materialId, body) : await loadAccessiblePublishedModule(
    requester,
    body.moduleId,
    {},
    {
      passageId: body.passageId,
      roomId: body.roomId,
      assignmentId: body.assignmentId,
    },
  );

  if (materialId && module.readAloudOnly === true) {
    throw new ComprehensionError("This activity is read-aloud only. Open your oral-reading result.", 422);
  }
  if (!materialId && !module.passageId) {
    throw new ComprehensionError(
      "This activity requires a passage with reviewed questions.",
      422,
    );
  }

  // Require a saved Read-Aloud activity for this exact context.
  let readingQuery = db
    .from("oral_reading_attempts")
    .select("id,passage_snapshot,language_snapshot")
    .eq("user_id", requester.user.id);
  readingQuery = materialId
    ? readingQuery.eq("material_id", materialId).eq("activity_assignment_id", module.activityAssignmentId)
    : readingQuery.eq("module_id", module.id).eq("passage_id", module.passageId);
  if (body.oralReadingAttemptId) readingQuery = readingQuery.eq("id", body.oralReadingAttemptId);

  readingQuery = module.roomId
    ? readingQuery.eq("room_id", module.roomId)
    : readingQuery.is("room_id", null);

  readingQuery = module.assignmentId
    ? readingQuery.eq("assignment_id", module.assignmentId)
    : readingQuery.is("assignment_id", null);

  const {
    data: completedReadings,
    error: readingError,
  } = await readingQuery.order("completed_at", { ascending: false }).limit(1);

  if (readingError) {
    throw databaseError(
      readingError,
      "Unable to verify your completed reading activity.",
    );
  }

  if (!completedReadings?.length || completedReadings[0].passage_snapshot !== module.passage
    || (completedReadings[0].language_snapshot && completedReadings[0].language_snapshot !== module.language)) {
    throw new ComprehensionError(
      "Complete and save oral reading for the current story first. If the story changed, please read it aloud again.",
      403,
    );
  }

  // Every new attempt belongs to one saved reading, so opening a module's
  // comprehension without the oral-reading ID (an old link or bookmark)
  // reopens that reading's activity instead of starting a duplicate.
  const oralReadingAttemptId = body.oralReadingAttemptId ?? completedReadings[0].id;
  if (!body.oralReadingAttemptId) {
    const { data: resumed, error: resumeError } = await db.from("m6_comprehension_attempts")
      .select("id,module_id,passage_id,room_id,assignment_id,material_id,activity_assignment_id,oral_reading_attempt_id")
      .eq("user_id", requester.user.id).eq("oral_reading_attempt_id", oralReadingAttemptId).maybeSingle();
    if (resumeError) throw databaseError(resumeError, "Unable to reopen comprehension.");
    if (resumed) { verifySameRequest(resumed); return getComprehensionAttempt(requester, resumed.id); }
  }

  const questions = await loadReviewedQuestions(
    module.id,
    module.passageId,
    module.passage,
    materialId,
    module.questionSetId ?? null,
  );

  const { data: saved, error: saveError } = await db
    .from("m6_comprehension_attempts")
    .insert({
      user_id: requester.user.id,
      submission_id: body.submissionId,
      module_id: module.id,
      ...(materialId ? { material_id: materialId, activity_assignment_id: module.activityAssignmentId } : {}),
      oral_reading_attempt_id: oralReadingAttemptId,
      passage_id: module.passageId,
      room_id: module.roomId,
      assignment_id: module.assignmentId,
      passage_title: module.passageTitle,
      passage_text: module.passage,
      language: module.language,
      question_snapshot: questions,
    })
    .select("id")
    .single();

  // Handle identical start requests arriving together.
  if (saveError?.code === "23505") {
    // Either unique key may have been taken: this reading's activity, or this submission.
    const findBy = (column, value) => db
      .from("m6_comprehension_attempts")
      .select("id,module_id,passage_id,room_id,assignment_id,material_id,activity_assignment_id,oral_reading_attempt_id")
      .eq("user_id", requester.user.id)
      .eq(column, value)
      .maybeSingle();
    let { data: duplicate, error: duplicateError } = await findBy("oral_reading_attempt_id", oralReadingAttemptId);
    if (!duplicate && !duplicateError) ({ data: duplicate, error: duplicateError } = await findBy("submission_id", body.submissionId));

    if (duplicateError || !duplicate) {
      throw databaseError(
        duplicateError ?? saveError,
        "Unable to reopen the saved activity.",
      );
    }

    verifySameRequest(duplicate);
    return getComprehensionAttempt(requester, duplicate.id);
  }

  if (saveError) {
    throw databaseError(
      saveError,
      "Unable to start the comprehension activity.",
    );
  }

  return getComprehensionAttempt(requester, saved.id);
}

module.exports = {
  ComprehensionError,
  authorizeComprehensionRequest,
  startComprehensionAttempt,
  getComprehensionAttempt,
  loadOwnedAttempt,
  loadReviewedQuestions,
};
