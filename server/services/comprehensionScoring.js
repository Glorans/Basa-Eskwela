const QUESTION_TYPES = ["literal", "inferential", "critical"];

function percentage(correct, total) {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

function checkAnswer(question, optionIndex) {
  if (
    !question ||
    !Array.isArray(question.options) ||
    question.options.length !== 4 ||
    !Number.isInteger(question.correctOptionIndex) ||
    question.correctOptionIndex < 0 ||
    question.correctOptionIndex > 3
  ) {
    throw new Error("Invalid saved question.");
  }

  if (
    !Number.isInteger(optionIndex) ||
    optionIndex < 0 ||
    optionIndex > 3
  ) {
    throw new Error("Choose a valid answer option.");
  }

  return optionIndex === question.correctOptionIndex;
}

function summarizeComprehension(questions, responses) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("The activity has no questions.");
  }

  if (!Array.isArray(responses)) {
    throw new Error("Invalid activity responses.");
  }

  const questionIds = new Set();

  for (const question of questions) {
    if (
      !question.id ||
      questionIds.has(question.id) ||
      !QUESTION_TYPES.includes(question.type)
    ) {
      throw new Error("Invalid activity question bank.");
    }

    questionIds.add(question.id);
  }

  const responseMap = new Map();

  for (const response of responses) {
    if (
      !questionIds.has(response.question_id) ||
      responseMap.has(response.question_id)
    ) {
      throw new Error("Invalid or duplicate question response.");
    }

    responseMap.set(response.question_id, response);
  }

  const byType = Object.fromEntries(
    QUESTION_TYPES.map((type) => [
      type,
      {
        total: 0,
        answered: 0,
        firstCorrect: 0,
        resolved: 0,
        hintsUsed: 0,
        firstAttemptPercentage: 0,
      },
    ]),
  );

  let answered = 0;
  let firstCorrect = 0;
  let resolved = 0;
  let hintsUsed = 0;

  for (const question of questions) {
    const response = responseMap.get(question.id);
    const group = byType[question.type];

    group.total += 1;

    if (
      response &&
      Number.isInteger(response.first_option_index)
    ) {
      answered += 1;
      group.answered += 1;

      // Recompute from the protected saved answer key.
      if (checkAnswer(question, response.first_option_index)) {
        firstCorrect += 1;
        group.firstCorrect += 1;
      }
    }

    if (response?.resolved === true) {
      resolved += 1;
      group.resolved += 1;
    }

    if (response?.hint_used === true) {
      hintsUsed += 1;
      group.hintsUsed += 1;
    }
  }

  for (const type of QUESTION_TYPES) {
    const group = byType[type];

    group.firstAttemptPercentage = percentage(
      group.firstCorrect,
      group.total,
    );
  }

  return {
    totalQuestions: questions.length,
    answered,
    firstCorrect,
    firstAttemptPercentage: percentage(
      firstCorrect,
      questions.length,
    ),
    resolved,
    hintsUsed,
    allResolved: resolved === questions.length,
    byType,
  };
}

module.exports = {
  QUESTION_TYPES,
  checkAnswer,
  summarizeComprehension,
};