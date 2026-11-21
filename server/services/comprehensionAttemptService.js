const { activityKey, chooseActivityAttempt } = require("./comprehensionActivity");
const { loadMaterialReadingSource } = require("./personalMaterialService");
const { getSupabaseAdmin } = require("./supabaseAdmin");
const {
  authorizeReadingPracticeRequest,
  claimedSubject,
  isPracticeStaff,
  loadAccessiblePublishedModule,
} = require("./oralReadingAttemptService");
const {
  QUESTION_TYPES,
  summarizeComprehension,
} = require("./comprehensionScoring");
const { displayEvidence } = require("./passageEvidence");
const { ARCHIVED_CLASSROOM_MESSAGE, isArchivedRoomDatabaseError, isRoomArchived } = require("./roomArchive");

// One comprehension assessment per Student per passage across personal practice and classroom work (2026-11-17):
// an assessment of a module passage in one context (started or completed) means no new one in the other context.
// Classroom-to-classroom is unchanged (one per assignment). Also enforced at completion by the database
// (m6_assert_learner_completion_access in supabase/proposed/m6_student_personal_comprehension_PROPOSED.sql).
const STUDENT_CLASSROOM_ASSESSMENT_EXISTS =
  "You already have a comprehension assessment for this passage from a classroom. Open it from your Reading History.";
const STUDENT_PERSONAL_ASSESSMENT_EXISTS =
  "You already have a personal comprehension assessment for this passage. Open it from your Reading History.";

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

/**
 * M6 is open to Students, Independent Learners and, for self-practice only, staff: the System Admin, School Admins
 * and APPROVED Teachers. Pending/rejected Teachers and accounts without a role are refused.
 * Every read and action is scoped to the requester's own attempts (loadOwnedAttempt). Staff start an activity only
 * on a published module outside any classroom that their school may see (loadAccessiblePublishedModule: another
 * school's module is "not found"; the System Admin sees every published module).
 */
async function authorizeComprehensionRequest(req) {
  return authorizeReadingPracticeRequest(req);
}

const isPracticeRequester = (requester) => isPracticeStaff(requester);

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

/**
 * M6 F5 Preview comprehension assessment: the reviewed questions of ONE published module passage the requester may
 * open, under exactly the rule for starting it (loadAccessiblePublishedModule: a Student only a module assigned in
 * their classroom or open for personal practice; staff their school's and platform modules; another school's module is
 * "not found"), in the order an assessment presents them. Category, question text and choices only: never the
 * correct answer, explanation, supporting evidence or hint. Reads only: no attempt is created, resumed or consumed.
 */
async function previewComprehensionAssessment(requester, query = {}) {
  requireUuid(query.moduleId, "Module ID");
  for (const [key, label] of [["passageId", "Passage ID"], ["roomId", "Classroom ID"], ["assignmentId", "Assignment ID"]]) {
    if (query[key] != null && query[key] !== "") requireUuid(query[key], label);
  }
  const module = await loadAccessiblePublishedModule(requester, query.moduleId, {}, {
    passageId: query.passageId || undefined,
    roomId: query.roomId || undefined,
    assignmentId: query.assignmentId || undefined,
  }, { studentPersonal: true });
  if (!module.passageId) {
    throw new ComprehensionError("This passage has no comprehension questions to preview.", 422);
  }
  const questions = await loadReviewedQuestions(module.id, module.passageId, module.passage);
  return {
    moduleId: module.id,
    moduleTitle: module.title,
    passageId: module.passageId,
    passageTitle: module.passageTitle,
    language: module.language,
    // An allow-list, so an answer field can never be added to the preview by accident.
    questions: questions.map((question) => ({
      id: question.id,
      type: question.type,
      questionText: question.questionText,
      options: [...question.options],
    })),
  };
}

const ownedAttemptQuery = (attemptId, userId) => getSupabaseAdmin()
  .from("m6_comprehension_attempts")
  .select("*")
  .eq("id", attemptId)
  .eq("user_id", userId)
  .maybeSingle();

/**
 * Performance: starts the owned-attempt read while the login is still being verified (the route calls this
 * before authorizeComprehensionRequest). The read uses the same filters as loadOwnedAttempt, with the
 * token's UNVERIFIED subject as the owner; loadOwnedAttempt uses it only when the verified user is that
 * subject, so a forged token never reads another user's attempt. Null when there is nothing to start.
 */
function prefetchOwnedAttempt(req, attemptId) {
  const claimed = claimedSubject(req);
  if (!claimed || typeof attemptId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attemptId)) return null;
  const pending = Promise.resolve().then(() => ownedAttemptQuery(attemptId, claimed));
  pending.catch(() => {}); // Used after authentication, or discarded.
  return { attemptId, userId: claimed, pending };
}

async function loadOwnedAttempt(requester, attemptId, prefetched = null) {
  requireUuid(attemptId, "Activity ID");

  const usable = prefetched && prefetched.attemptId === attemptId && prefetched.userId === requester.user.id;
  const { data, error } = usable
    ? await prefetched.pending
    : await ownedAttemptQuery(attemptId, requester.user.id);

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

// `verified` (optional): this attempt's row as loaded and ownership-checked earlier in the same request
// (applyComprehensionAction). Only its fixed identity fields (id, user, material, room, activity) are used,
// to start the read-only lookups while the attempt is reloaded; the reloaded row is always the one returned.
async function getComprehensionAttempt(requester, attemptId, { verified = null, prefetched = null } = {}) {
  const db = getSupabaseAdmin();
  const lookups = (row) => {
    const personalSource = Boolean(row.material_id && !row.activity_assignment_id && !row.room_id);
    return Promise.allSettled([
      // The learning activity's assessment: this attempt, or (for an extra attempt saved before the
      // one-per-activity rule) the activity's assessment, which the page opens instead.
      findActivityAttempt(db, requester.user.id, activityKey(row)),
      db
        .from("m6_comprehension_responses")
        .select(
          "question_id,first_option_index,first_answer_correct,answer_history,hint_used,resolved",
        )
        .eq("attempt_id", row.id),
      // Display only: an unfinished assessment of an archived classroom opens read-only. Answers are refused on
      // the server either way (applyComprehensionAction and the database), so a failed check shows it as open.
      row.room_id ? isRoomArchived(db, row.room_id).catch(() => false) : false,
      personalSource
        ? require("./personalMaterialService").deletedPersonalIds(db, [row.material_id])
        : new Set(),
    ]);
  };
  // Performance: the read-only lookups depend only on the owned attempt, so they run together (one database
  // round trip instead of four in a row). After an action, the attempt was already verified in this request,
  // so they also run alongside the reload; a row whose identity differs falls back to a fresh lookup.
  const early = verified && verified.id === attemptId && verified.user_id === requester.user.id ? lookups(verified) : null;
  early?.catch(() => {});
  // `prefetched` is used only for a first read in a request (opening an attempt); a reload after an action
  // passes `verified` instead and always reads the row again.
  const attempt = await loadOwnedAttempt(requester, attemptId, verified ? null : prefetched);
  const sameIdentity = early && ["id", "user_id", "material_id", "activity_assignment_id", "module_id", "passage_id", "room_id", "assignment_id"]
    .every((key) => (attempt[key] ?? null) === (verified[key] ?? null));
  const [activityResult, responsesResult, archivedResult, deletedResult] = await (sameIdentity ? early : lookups(attempt));
  // Evaluated in the original order, so the same error wins whichever lookup finished first.
  const settled = (result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  };
  const activityAttempt = settled(activityResult);
  const { data: responses, error } = settled(responsesResult);

  if (error) {
    throw databaseError(error, "Unable to load your answers.");
  }
  const roomArchived = attempt.status !== "completed" && Boolean(settled(archivedResult));
  const personalSource = Boolean(attempt.material_id && !attempt.activity_assignment_id && !attempt.room_id);
  const deletedPersonal = settled(deletedResult);

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
    roomArchived,
    materialDeleted: Boolean(personalSource && deletedPersonal.has(attempt.material_id)),
    moduleId: attempt.module_id,
    materialId: attempt.material_id ?? null,
    roomId: attempt.room_id ?? null,
    activityAssignmentId: attempt.activity_assignment_id ?? null,
    oralReadingAttemptId: attempt.oral_reading_attempt_id ?? null,
    activityAttemptId: activityAttempt?.id ?? attempt.id,
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

// One comprehension assessment per learning activity: see comprehensionActivity.js.
const ACTIVITY_COLUMNS =
  "id,status,created_at,completed_at,module_id,passage_id,room_id,assignment_id,material_id,activity_assignment_id,oral_reading_attempt_id";

async function findActivityAttempt(db, userId, key) {
  // The key's non-empty columns filter in the database; its empty ones (no classroom or
  // assignment) are matched here, so an empty column never matches a filled one.
  let query = db.from("m6_comprehension_attempts").select(ACTIVITY_COLUMNS).eq("user_id", userId);
  for (const [column, value] of Object.entries(key)) if (value != null) query = query.eq(column, value);
  const { data, error } = await query;
  if (error) throw databaseError(error, "Unable to check your comprehension activity.");
  const rows = (Array.isArray(data) ? data : data ? [data] : []).filter((row) =>
    row.user_id === undefined || row.user_id === userId).filter((row) =>
    Object.entries(key).every(([column, value]) => (row[column] ?? null) === (value ?? null)));
  return chooseActivityAttempt(rows);
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
  const personal = Boolean(materialId && requester.profile.role === "general_user");
  if (personal) require("./personalMaterialService").personalContext(requester, body);
  if (materialId) {
    requireUuid(materialId, "Material ID");
    if (!personal) requireUuid(body.activityAssignmentId, "Reading assignment ID");
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

  if (isPracticeRequester(requester) && (materialId || body.roomId != null || body.assignmentId != null)) {
    throw new ComprehensionError("Staff comprehension practice is available only for published reading modules.", 403);
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

  // Opens the learning activity's assessment for a saved attempt row. An extra attempt saved
  // before the one-per-activity rule opens the activity's assessment instead.
  const openActivity = async (row) => {
    const current = await findActivityAttempt(db, requester.user.id, activityKey(row));
    return getComprehensionAttempt(requester, current?.id ?? row.id);
  };

  if (existing) {
    verifySameRequest(existing);
    return openActivity(existing);
  }

  // Reopen this exact saved assessment even if its source was later edited.
  if (body.oralReadingAttemptId) {
    const { data: resumed, error: resumeError } = await db.from("m6_comprehension_attempts")
      .select("id,module_id,passage_id,room_id,assignment_id,material_id,activity_assignment_id,oral_reading_attempt_id")
      .eq("user_id", requester.user.id).eq("oral_reading_attempt_id", body.oralReadingAttemptId).maybeSingle();
    if (resumeError) throw databaseError(resumeError, "Unable to reopen comprehension.");
    if (resumed) { verifySameRequest(resumed); return openActivity(resumed); }
  }

  // Check publication, enrollment, assignment, and passage access. A Student may also take the comprehension of a
  // published module outside any classroom (personal practice, like M5): an assigned module keeps the classroom
  // path, and classroom restrictions are never bypassed (see loadAccessiblePublishedModule).
  const module = materialId ? await loadMaterialReadingSource(requester, materialId, body) : await loadAccessiblePublishedModule(
    requester,
    body.moduleId,
    {},
    {
      passageId: body.passageId,
      roomId: body.roomId,
      assignmentId: body.assignmentId,
    },
    { studentPersonal: true },
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
    ? (personal ? readingQuery.eq("material_id", materialId).is("activity_assignment_id", null) : readingQuery.eq("material_id", materialId).eq("activity_assignment_id", module.activityAssignmentId))
    : readingQuery.eq("module_id", module.id).eq("passage_id", module.passageId);
  if (body.oralReadingAttemptId) readingQuery = readingQuery.eq("id", body.oralReadingAttemptId);

  readingQuery = module.roomId
    ? readingQuery.eq("room_id", module.roomId)
    : readingQuery.is("room_id", null);

  readingQuery = module.assignmentId
    ? readingQuery.eq("assignment_id", module.assignmentId)
    : readingQuery.is("assignment_id", null);

  // Performance: the reading check, the activity's existing assessment, the archive state and the question
  // bank are read-only and depend only on the activity, so they are fetched together (one round trip instead
  // of four in a row). They are evaluated below in the original order, so the same outcome and error win,
  // and nothing is written until every check has passed. Questions (with keys) stay on the server.
  const activity = activityKey({
    module_id: module.id ?? null,
    passage_id: module.passageId ?? null,
    room_id: module.roomId ?? null,
    assignment_id: module.assignmentId ?? null,
    material_id: materialId,
    activity_assignment_id: module.activityAssignmentId ?? null,
  });
  const [readingResult, currentResult, archivedResult, bankResult] = await Promise.allSettled([
    readingQuery.order("completed_at", { ascending: false }).limit(1),
    findActivityAttempt(db, requester.user.id, activity),
    isRoomArchived(db, module.roomId),
    (personal ? require("./personalMaterialService").loadPersonalBank(requester, materialId) : Promise.resolve(null))
      .then(async (bank) => bank
        ? { bank, questions: bank.questions }
        : { bank: null, questions: await loadReviewedQuestions(module.id, module.passageId, module.passage, materialId, module.questionSetId ?? null) }),
  ]);
  const settled = (result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  };
  const {
    data: completedReadings,
    error: readingError,
  } = settled(readingResult);

  if (readingError) {
    throw databaseError(
      readingError,
      "Unable to verify your completed reading activity.",
    );
  }

  if (!completedReadings?.length || completedReadings[0].passage_snapshot !== module.passage
    || (completedReadings[0].language_snapshot && completedReadings[0].language_snapshot !== module.language)) {
    // In an archived classroom no reading can be saved any more: say why, instead of asking for one.
    if (settled(archivedResult)) throw new ComprehensionError(ARCHIVED_CLASSROOM_MESSAGE, 409);
    throw new ComprehensionError(
      "Complete and save oral reading for the current story first. If the story changed, please read it aloud again.",
      403,
    );
  }

  // One assessment per learning activity: a repeated reading (or an old link without the
  // oral-reading ID) reopens the activity's existing assessment, in progress or completed,
  // with its original answers, score and reading. Nothing new is created.
  const oralReadingAttemptId = body.oralReadingAttemptId ?? completedReadings[0].id;
  const current = settled(currentResult);
  if (current) return getComprehensionAttempt(requester, current.id);

  // A saved assessment reopens above (read-only results); an archived room starts no new one.
  if (settled(archivedResult)) throw new ComprehensionError(ARCHIVED_CLASSROOM_MESSAGE, 409);

  // Student module assessments: personal practice and classroom work are separate activities, but one passage is
  // assessed once across them. This activity's own assessment already reopened above (resume or read-only result);
  // here an assessment of the same passage in the OTHER context (started or completed) blocks a new one. Nothing is
  // converted: the existing assessment stays where it is, in Reading History.
  if (requester.profile.role === "student" && !materialId) {
    const { data: passageAttempts, error: passageError } = await db.from("m6_comprehension_attempts")
      .select("id,room_id,material_id").eq("user_id", requester.user.id).eq("module_id", module.id).eq("passage_id", module.passageId);
    if (passageError) throw databaseError(passageError, "Unable to check your comprehension activity.");
    const rows = passageAttempts ?? [];
    if (module.personalPractice === true && rows.some((row) => row.room_id != null)) {
      throw new ComprehensionError(STUDENT_CLASSROOM_ASSESSMENT_EXISTS, 409);
    }
    if (module.roomId && rows.some((row) => row.room_id == null && row.material_id == null)) {
      throw new ComprehensionError(STUDENT_PERSONAL_ASSESSMENT_EXISTS, 409);
    }
  }

  const { bank: privateBank, questions } = settled(bankResult);

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
      ...(privateBank ? { personal_question_set_id: privateBank.id } : {}),
    })
    .select("id")
    .single();

  if (isArchivedRoomDatabaseError(saveError)) throw new ComprehensionError(ARCHIVED_CLASSROOM_MESSAGE, 409);

  // Handle identical start requests arriving together.
  if (saveError?.code === "23505") {
    // Another request created this learning activity's assessment first (the proposed
    // one-per-activity guard), or took this reading's or this submission's key.
    const first = await findActivityAttempt(db, requester.user.id, activity);
    if (first) return getComprehensionAttempt(requester, first.id);
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
    return openActivity(duplicate);
  }

  if (saveError) {
    throw databaseError(
      saveError,
      "Unable to start the comprehension activity.",
    );
  }

  return getComprehensionAttempt(requester, saved.id);
}

/**
 * The learner's own M6 activity for one saved reading, if any: its ID and
 * whether it is completed. Read-only. The M5 result page uses it to show
 * "Continue to Questions" or "View Comprehension Result"; it never opens,
 * starts or changes an activity. Only the requester's rows are searched, and
 * the database allows at most one activity per (user, reading).
 */
async function findComprehensionForReading(requester, oralReadingAttemptId) {
  requireUuid(oralReadingAttemptId, "Oral reading result ID");
  const db = getSupabaseAdmin();
  // The requester's own reading, and through it its learning activity: every reading of the
  // same activity (a first reading or a repeat) finds the activity's one assessment.
  const { data: reading, error: readingError } = await db
    .from("oral_reading_attempts")
    .select("id,module_id,passage_id,room_id,assignment_id,material_id,activity_assignment_id")
    .eq("id", oralReadingAttemptId)
    .eq("user_id", requester.user.id)
    .maybeSingle();
  if (readingError) throw databaseError(readingError, "Unable to check your comprehension activity.");
  let found = reading ? await findActivityAttempt(db, requester.user.id, activityKey(reading)) : null;
  if (!found) {
    const { data, error } = await db
      .from("m6_comprehension_attempts")
      .select(ACTIVITY_COLUMNS)
      .eq("user_id", requester.user.id)
      .eq("oral_reading_attempt_id", oralReadingAttemptId)
      .maybeSingle();
    if (error) throw databaseError(error, "Unable to check your comprehension activity.");
    found = data ? (await findActivityAttempt(db, requester.user.id, activityKey(data))) ?? data : null;
  }
  return found ? { id: found.id, status: found.status === "completed" ? "completed" : "in_progress" } : null;
}

module.exports = {
  ComprehensionError,
  authorizeComprehensionRequest,
  startComprehensionAttempt,
  getComprehensionAttempt,
  prefetchOwnedAttempt,
  findComprehensionForReading,
  findActivityAttempt,
  activityKey,
  loadOwnedAttempt,
  loadReviewedQuestions,
  previewComprehensionAssessment,
};
