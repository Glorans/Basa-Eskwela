const { getSupabaseAdmin } = require("./supabaseAdmin");
const {
  MaterialAuthorizationError,
  MaterialPersistenceError,
  getAuthorizedMaterialRow,
  toQuestionDto,
  validateReviewedQuestions,
} = require("./materialPersistenceService");
const {
  MAX_QUESTION_CONTENT_LENGTH,
  validateQuestionCount,
} = require("./questionGenerationService");

const QUESTION_TYPES = ["literal", "inferential", "critical"];
const { checkEvidence } = require("./passageEvidence");

// New sets need at least 9 questions (3 of each type). Existing 3- and 6-question
// sets stay valid: they can still be edited, reviewed, assigned and regenerated.
const NEW_QUESTION_SET_COUNTS = Object.freeze([9, 12]);
const DEFAULT_NEW_QUESTION_SET_COUNT = 9;

function validateNewQuestionSetCount(value = DEFAULT_NEW_QUESTION_SET_COUNT) {
  if (!NEW_QUESTION_SET_COUNTS.includes(value)) {
    throw new MaterialPersistenceError(
      "New question sets need 9 or 12 questions.",
      400,
      "INVALID_QUESTION_COUNT",
    );
  }
  return value;
}

function client(deps) {
  return deps.getSupabaseAdmin?.() ?? getSupabaseAdmin();
}

async function authorize(
  requester,
  materialId,
  deps,
  generating = false,
) {
  if (
    !["teacher", "admin"].includes(requester.profile.role) ||
    (generating && requester.profile.role !== "teacher")
  ) {
    throw new MaterialAuthorizationError(
      "Question sets are available only to authorized Teachers and Admins.",
    );
  }

  return getAuthorizedMaterialRow(requester, materialId, deps);
}

const ASSIGNED_SET_MESSAGE =
  "This question set is assigned to a class activity. Remove the assignment first.";
const ANSWERED_SET_MESSAGE =
  "Students have already answered this question set in a class activity, so it cannot be changed. Generate a new set instead.";

function databaseError(error) {
  if (!error) return;

  // 23503: assignment NO ACTION FK; 23001: existing RESTRICT foreign keys.
  if (["23001", "23503"].includes(error.code)) {
    throw new MaterialPersistenceError(ASSIGNED_SET_MESSAGE, 409);
  }

  const status = {
    "42501": 403,
    P0002: 404,
    "40001": 409,
    "22023": 400,
  }[error.code];

  throw new MaterialPersistenceError(
    status
      ? error.message
      : "Unable to save the question set. Please try again.",
    status ?? 500,
  );
}

// Class activities that name each set of this material, and whether any
// student has started comprehension from one of those activities.
async function loadSetUsage(db, materialId) {
  const { data: assignments, error } = await db
    .from("reading_activity_assignments")
    .select("id, question_set_id")
    .eq("material_id", materialId);

  if (error) {
    throw new MaterialPersistenceError(
      "Unable to check where question sets are assigned.",
    );
  }

  const assigned = (assignments ?? []).filter(
    (assignment) => assignment.question_set_id,
  );
  const attempted = new Set();

  for (let offset = 0; offset < assigned.length; offset += 100) {
    const { data: attempts, error: attemptError } = await db
      .from("m6_comprehension_attempts")
      .select("activity_assignment_id")
      .in(
        "activity_assignment_id",
        assigned.slice(offset, offset + 100).map((assignment) => assignment.id),
      );

    if (attemptError) {
      throw new MaterialPersistenceError(
        "Unable to check student answers for question sets.",
      );
    }

    for (const attempt of attempts ?? []) {
      attempted.add(attempt.activity_assignment_id);
    }
  }

  const usage = new Map();

  for (const assignment of assigned) {
    const current = usage.get(assignment.question_set_id) ?? {
      assignedCount: 0,
      hasStudentAttempts: false,
    };
    current.assignedCount += 1;
    current.hasStudentAttempts ||= attempted.has(assignment.id);
    usage.set(assignment.question_set_id, current);
  }

  return usage;
}

function summary(row, questions, usage) {
  return {
    id: row.id,
    materialId: row.material_id,
    name: row.name,
    sequenceNumber: row.sequence_number,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    questionCount: questions.length,
    counts: Object.fromEntries(
      QUESTION_TYPES.map((type) => [
        type,
        questions.filter(
          (question) => question.question_type === type,
        ).length,
      ]),
    ),
    reviewStatus:
      questions.length > 0 &&
      questions.every(
        (question) => question.review_status === "reviewed",
      )
        ? "reviewed"
        : "generated",
    assignedCount: usage?.assignedCount ?? 0,
    hasStudentAttempts: usage?.hasStudentAttempts ?? false,
  };
}

async function listMaterialQuestionSets(
  requester,
  materialId,
  deps = {},
) {
  await authorize(requester, materialId, deps);

  const db = client(deps);

  const { data: sets, error } = await db
    .from("material_question_sets")
    .select("*")
    .eq("material_id", materialId)
    .order("sequence_number");

  if (error) {
    throw new MaterialPersistenceError(
      "Unable to load saved question sets.",
    );
  }

  const { data: questions, error: questionError } = await db
    .from("comprehension_questions")
    .select("question_set_id, question_type, review_status")
    .eq("material_id", materialId);

  if (questionError) {
    throw new MaterialPersistenceError(
      "Unable to load question set summaries.",
    );
  }

  const usage = await loadSetUsage(db, materialId);

  return (sets ?? []).map((row) =>
    summary(
      row,
      (questions ?? []).filter(
        (question) => question.question_set_id === row.id,
      ),
      usage.get(row.id),
    ),
  );
}

async function getMaterialQuestionSet(
  requester,
  materialId,
  setId,
  deps = {},
) {
  await authorize(requester, materialId, deps);

  const db = client(deps);

  const { data: set, error } = await db
    .from("material_question_sets")
    .select("*")
    .eq("material_id", materialId)
    .eq("id", setId)
    .maybeSingle();

  if (error) {
    throw new MaterialPersistenceError(
      "Unable to load the question set.",
    );
  }

  if (!set) {
    throw new MaterialPersistenceError(
      "Question set not found.",
      404,
    );
  }

  const { data: questions, error: questionError } = await db
    .from("comprehension_questions")
    .select("*")
    .eq("material_id", materialId)
    .eq("question_set_id", setId)
    .order("display_order");

  if (questionError) {
    throw new MaterialPersistenceError(
      "Unable to load questions.",
    );
  }

  const rows = questions ?? [];
  let answers = [];

  if (rows.length > 0) {
    const result = await db
      .from("comprehension_question_answers")
      .select(
        "question_id, correct_answer, answer_explanation, supporting_evidence",
      )
      .in(
        "question_id",
        rows.map((question) => question.id),
      );

    if (result.error) {
      throw new MaterialPersistenceError(
        "Unable to load answer keys and feedback.",
      );
    }

    answers = result.data ?? [];
  }

  const answerMap = new Map(
    answers.map((answer) => [answer.question_id, answer]),
  );
  const usage = await loadSetUsage(db, materialId);

  return {
    ...summary(set, rows, usage.get(setId)),
    questions: rows.map((question) => {
      const answer = answerMap.get(question.id);

      return toQuestionDto(
        question,
        answer?.correct_answer ?? "",
        answer ?? {},
      );
    }),
  };
}

function requireRevision(revision) {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new MaterialPersistenceError(
      "Reload the question set before changing it.",
      400,
    );
  }
}

function normalizeEvidence(value) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function validateSupportingEvidence(bank, contentText) {
  const source = normalizeEvidence(contentText ?? "");

  for (const question of bank) {
    if (question.supportingEvidence === undefined) {
      continue;
    }

    const evidence = normalizeEvidence(
      question.supportingEvidence,
    );

    if (!evidence || !source.includes(evidence)) {
      throw new MaterialPersistenceError(
        "Supporting evidence must be an exact excerpt from the saved reading material.",
        400,
      );
    }

    // Saved as the complete sentence(s) from the material when the match is
    // reliable; an incomplete fragment that cannot be completed is refused.
    const checked = checkEvidence(contentText ?? "", question.supportingEvidence);
    if (checked.incomplete) throw incompleteEvidence(bank.indexOf(question));
    question.supportingEvidence = checked.evidence;
  }
}

function incompleteEvidence(index) {
  return new MaterialPersistenceError(
    `Question ${index + 1}'s supporting evidence is an incomplete sentence. Quote the complete sentence from the reading material.`,
    400,
  );
}

/**
 * Before approval: stored evidence must be complete sentences, or a fragment
 * that can be completed reliably from the material for display. Nothing is
 * rewritten here; approval never edits a set.
 */
function requireCompleteEvidence(questions, contentText) {
  questions.forEach((question, index) => {
    if (typeof question.supportingEvidence !== "string" || !question.supportingEvidence.trim()) return;
    if (checkEvidence(contentText ?? "", question.supportingEvidence).incomplete) throw incompleteEvidence(index);
  });
}

async function write(
  requester,
  materialId,
  setId,
  operation,
  revision,
  bank,
  deps,
  legacyReviewBank,
) {
  let { data, error } = await client(deps).rpc(
    "m3_write_material_question_set",
    {
      actor_id: requester.user.id,
      target_material: materialId,
      target_set: setId,
      operation,
      expected_revision: revision,
      bank,
    },
  );

  const unsupportedOperation = error?.code === "22023"
    && error.message === "Invalid question set operation";
  if (unsupportedOperation && operation === "approve" && legacyReviewBank) {
    // Older installations already support atomic review. Never retry saves this way:
    // that operation also approves edits. This bank comes only from persisted data.
    // The legacy function trims these two fields, so fail rather than alter content.
    if (legacyReviewBank.some(q => q.questionText !== q.questionText.trim()
      || q.scaffoldingHint !== q.scaffoldingHint.trim())) {
      throw new MaterialPersistenceError(
        "This set needs the separate-review database function to approve without changing its saved text. Contact your administrator.", 409);
    }
    const current = await getMaterialQuestionSet(requester, materialId, setId, deps);
    if (current.hasStudentAttempts) throw new MaterialPersistenceError(ANSWERED_SET_MESSAGE, 409);
    if (current.revision !== revision) {
      throw new MaterialPersistenceError("This question set changed. Reload it before approving.", 409);
    }
    ({ data, error } = await client(deps).rpc("m3_write_material_question_set", {
      actor_id: requester.user.id,
      target_material: materialId,
      target_set: setId,
      operation: "review",
      expected_revision: revision,
      bank: legacyReviewBank,
    }));
  } else if (unsupportedOperation && operation === "save") {
    throw new MaterialPersistenceError(
      "Saving edits separately from approval is not supported by this database version. Contact your administrator to enable the separate-review function. No edits were saved.", 409);
  }
  databaseError(error);

  return getMaterialQuestionSet(
    requester,
    materialId,
    data,
    deps,
  );
}

async function generateMaterialQuestionSet(
  requester,
  materialId,
  setId,
  revision,
  generate,
  deps = {},
  requestedCount = DEFAULT_NEW_QUESTION_SET_COUNT,
) {
  const material = await authorize(
    requester,
    materialId,
    deps,
    true,
  );

  // Regeneration keeps the saved set's own size; only new sets use 9 or 12.
  let questionCount = setId ? undefined : validateNewQuestionSetCount(requestedCount);

  if (setId) {
    requireRevision(revision);

    const set = await getMaterialQuestionSet(
      requester,
      materialId,
      setId,
      deps,
    );

    questionCount = validateQuestionCount(set.questionCount);

    if (set.hasStudentAttempts) {
      throw new MaterialPersistenceError(ANSWERED_SET_MESSAGE, 409);
    }

    if (set.revision !== revision) {
      throw new MaterialPersistenceError(
        "This question set changed. Reload it before regenerating.",
        409,
      );
    }
  }

  if (
    material.extraction_status !== "completed" ||
    !material.content_text?.trim()
  ) {
    throw new MaterialPersistenceError(
      "Completed reviewed material text is required before generating questions.",
      409,
    );
  }

  if (
    material.content_text.length > MAX_QUESTION_CONTENT_LENGTH
  ) {
    throw new MaterialPersistenceError(
      "This material is too long to generate questions from safely (maximum 30,000 characters). Please shorten the reading material. Your complete saved text has not been truncated.",
      413,
    );
  }

  if (!["en", "fil"].includes(material.language)) {
    throw new MaterialPersistenceError(
      "The saved material language must be English or Filipino before generating questions.",
      409,
    );
  }

  const input = {
    contentText: material.content_text,
    language: material.language,
    questionCount,
    previousQuestions: [],
  };

  if (!setId) {
    const previousQuestions = [];
    const pageSize = 500;

    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await client(deps)
        .from("comprehension_questions")
        .select("id, question_type, question_text")
        .eq("material_id", materialId)
        .order("id")
        .range(offset, offset + pageSize - 1);

      if (error || !Array.isArray(data)) {
        throw new MaterialPersistenceError(
          "Unable to load previous questions. Please try again.",
        );
      }

      previousQuestions.push(
        ...data.map((question) => ({
          type: question.question_type,
          questionText: question.question_text,
        })),
      );

      if (data.length < pageSize) {
        break;
      }
    }

    input.previousQuestions = previousQuestions;
  }

  const bank = await generate(input);

  validateSupportingEvidence(bank, material.content_text);

  return write(
    requester,
    materialId,
    setId,
    setId ? "regenerate" : "create",
    setId ? revision : null,
    bank,
    deps,
  );
}

async function deleteMaterialQuestionSet(
  requester,
  materialId,
  setId,
  revision,
  deps = {},
) {
  await authorize(requester, materialId, deps, true);
  requireRevision(revision);

  // The foreign key also blocks this; checking first gives a clear message.
  if ((await loadSetUsage(client(deps), materialId)).get(setId)?.assignedCount) {
    throw new MaterialPersistenceError(ASSIGNED_SET_MESSAGE, 409);
  }

  const { error } = await client(deps).rpc(
    "m3_write_material_question_set",
    {
      actor_id: requester.user.id,
      target_material: materialId,
      target_set: setId,
      operation: "delete",
      expected_revision: revision,
      bank: null,
    },
  );

  databaseError(error);
}

async function saveMaterialQuestionSet(
  requester,
  materialId,
  setId,
  revision,
  questions,
  deps = {},
) {
  const material = await authorize(
    requester,
    materialId,
    deps,
  );

  requireRevision(revision);

  if ((await loadSetUsage(client(deps), materialId)).get(setId)?.hasStudentAttempts) {
    throw new MaterialPersistenceError(ANSWERED_SET_MESSAGE, 409);
  }

  // The RPC checks membership and preserves the saved correct option.
  const bank = validateReviewedQuestions(questions);
  const count = validateQuestionCount(bank.length);

  if (
    QUESTION_TYPES.some(
      (type) =>
        bank.filter((question) => question.type === type)
          .length !==
        count / 3,
    )
  ) {
    throw new MaterialPersistenceError(
      "Distribute questions evenly across Literal, Inferential and Critical.",
      400,
    );
  }

  validateSupportingEvidence(bank, material.content_text);

  return write(
    requester,
    materialId,
    setId,
    "save",
    revision,
    bank,
    deps,
  );
}

async function reviewMaterialQuestionSet(requester, materialId, setId, revision, deps = {}) {
  const material = await authorize(requester, materialId, deps);
  requireRevision(revision);
  const set = await getMaterialQuestionSet(requester, materialId, setId, deps);
  if (set.revision !== revision) {
    throw new MaterialPersistenceError("This question set changed. Reload it before approving.", 409);
  }
  if (set.hasStudentAttempts) throw new MaterialPersistenceError(ANSWERED_SET_MESSAGE, 409);
  // Validate persisted content and keys; approval never accepts edits from the client.
  const bank = validateReviewedQuestions(set.questions);
  requireCompleteEvidence(set.questions, material.content_text);
  const count = validateQuestionCount(bank.length);
  if (QUESTION_TYPES.some(type => bank.filter(q => q.type === type).length !== count / 3)) {
    throw new MaterialPersistenceError("Distribute questions evenly across Literal, Inferential and Critical.", 400);
  }
  // Preserve exact stored values for legacy review, including option whitespace.
  // Validation above must not silently normalize content during approval.
  const savedBank = set.questions.map(({ id, type, questionText, options, scaffoldingHint }) =>
    ({ id, type, questionText, options: [...options], scaffoldingHint }));
  return write(requester, materialId, setId, "approve", revision, bank, deps, savedBank);
}

module.exports = {
  DEFAULT_NEW_QUESTION_SET_COUNT,
  NEW_QUESTION_SET_COUNTS,
  validateNewQuestionSetCount,
  listMaterialQuestionSets,
  getMaterialQuestionSet,
  generateMaterialQuestionSet,
  saveMaterialQuestionSet,
  reviewMaterialQuestionSet,
  deleteMaterialQuestionSet,
};
