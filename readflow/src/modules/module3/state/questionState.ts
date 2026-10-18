import type {
  GeneratedComprehensionQuestion,
  GeneratedQuestionsByMaterial,
  GeneratedQuestionsReviewStatus,
  M3Role,
  ReviewableComprehensionQuestion,
  UploadedMaterial,
  QuestionType,
} from "../types/content";

export const QUESTION_TYPES: readonly QuestionType[] = [
  "literal",
  "inferential",
  "critical",
];

export interface QuestionValidationIssue {
  questionId?: string;
  questionNumber?: number;
  messages: string[];
}

export const INVALID_CORRECT_ANSWER_MESSAGE =
  "The saved correct answer does not match any answer option. Regenerate the questions or contact support.";

export function cloneGeneratedQuestions(questions: GeneratedComprehensionQuestion[]) {
  return questions.map((question) => ({
    ...question,
    options: [...question.options] as GeneratedComprehensionQuestion["options"],
  }));
}

export function normalizeGeneratedQuestions(questions: GeneratedComprehensionQuestion[]) {
  return questions.map((question) => ({
    ...question,
    questionText: question.questionText.trim(),
    options: question.options.map((option) => option.trim()) as GeneratedComprehensionQuestion["options"],
    correctAnswer: question.correctAnswer.trim(),
    scaffoldingHint: question.scaffoldingHint.trim(),
  }));
}

export function toReviewableQuestions(
  questions: GeneratedComprehensionQuestion[],
): ReviewableComprehensionQuestion[] {
  return questions.map((question) => {
    const derivedIndex = question.options.indexOf(question.correctAnswer);
    const correctOptionIndex = Number.isInteger(question.correctOptionIndex)
      ? question.correctOptionIndex as number
      : derivedIndex;

    if (
      correctOptionIndex < 0
      || correctOptionIndex >= question.options.length
      || derivedIndex !== correctOptionIndex
    ) {
      throw new Error(INVALID_CORRECT_ANSWER_MESSAGE);
    }

    return {
      id: question.id,
      type: question.type,
      questionText: question.questionText,
      options: [...question.options] as ReviewableComprehensionQuestion["options"],
      correctOptionIndex,
      scaffoldingHint: question.scaffoldingHint,
    };
  });
}

export function normalizeReviewableQuestions(
  questions: ReviewableComprehensionQuestion[],
) {
  return questions.map((question) => ({
    ...question,
    questionText: question.questionText.trim(),
    options: question.options.map((option) => option.trim()) as ReviewableComprehensionQuestion["options"],
    scaffoldingHint: question.scaffoldingHint.trim(),
  }));
}

export function formatCorrectAnswer(question: ReviewableComprehensionQuestion) {
  const answer = question.options[question.correctOptionIndex];
  if (question.correctOptionIndex < 0 || question.correctOptionIndex >= question.options.length) {
    return INVALID_CORRECT_ANSWER_MESSAGE;
  }

  return `${String.fromCharCode(65 + question.correctOptionIndex)}. ${answer || "Blank option"}`;
}

export function validateReviewableQuestions(
  questions: ReviewableComprehensionQuestion[],
): QuestionValidationIssue[] {
  const generatedShape = questions.map((question) => ({
    ...question,
    correctAnswer: question.options[question.correctOptionIndex] ?? "",
  }));
  return validateGeneratedQuestions(generatedShape);
}

export function validateGeneratedQuestions(
  questions: GeneratedComprehensionQuestion[],
): QuestionValidationIssue[] {
  if (questions.length === 0) {
    return [{ messages: ["At least one generated question is required."] }];
  }

  return questions.flatMap((question, index) => {
    const messages: string[] = [];
    const normalizedOptions = question.options.map((option) => option.trim());
    const comparableOptions = normalizedOptions.map((option) => option.toLocaleLowerCase());

    if (!question.questionText.trim()) {
      messages.push("Question text cannot be blank.");
    }

    if (question.options.length !== 4) {
      messages.push("Exactly four answer options are required.");
    }

    if (normalizedOptions.some((option) => !option)) {
      messages.push("Answer options cannot be blank.");
    }

    if (new Set(comparableOptions).size !== comparableOptions.length) {
      messages.push("Answer options must be unique.");
    }

    if (
      !question.correctAnswer.trim() ||
      !normalizedOptions.includes(question.correctAnswer.trim())
    ) {
      messages.push("Select a correct answer that matches one of the four options.");
    }

    if (!question.scaffoldingHint.trim()) {
      messages.push("Scaffolding hint cannot be blank.");
    }

    if (!QUESTION_TYPES.includes(question.type)) {
      messages.push("Question type must be Literal, Inferential, or Critical.");
    }

    return messages.length > 0
      ? [{ questionId: question.id, questionNumber: index + 1, messages }]
      : [];
  });
}

export function setQuestionsForMaterial(
  current: GeneratedQuestionsByMaterial,
  materialId: string,
  questions: GeneratedComprehensionQuestion[],
  reviewStatus: GeneratedQuestionsReviewStatus,
): GeneratedQuestionsByMaterial {
  return {
    ...current,
    [materialId]: {
      questions: cloneGeneratedQuestions(questions),
      reviewStatus,
    },
  };
}

export function getQuestionsForMaterial(
  current: GeneratedQuestionsByMaterial,
  materialId: string | undefined,
) {
  return materialId ? current[materialId] : undefined;
}

export function canReviewMaterialQuestions(
  role: M3Role,
  material: UploadedMaterial | undefined,
  currentTeacherId: string,
) {
  if (!material || role === "general_user") {
    return false;
  }

  return role === "admin" || material.uploadedById === currentTeacherId;
}
