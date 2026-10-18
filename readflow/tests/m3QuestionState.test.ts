import assert from "node:assert/strict";
import test from "node:test";
import {
  canReviewMaterialQuestions,
  formatCorrectAnswer,
  getQuestionsForMaterial,
  normalizeGeneratedQuestions,
  setQuestionsForMaterial,
  toReviewableQuestions,
  validateGeneratedQuestions,
} from "../src/modules/module3/state/questionState.ts";
import type {
  GeneratedComprehensionQuestion,
  GeneratedQuestionsByMaterial,
  UploadedMaterial,
} from "../src/modules/module3/types/content.ts";

const generatedQuestion: GeneratedComprehensionQuestion = {
  id: "generated-1",
  type: "literal",
  questionText: "What did Lina plant?",
  options: ["Tomato seeds", "A mango tree", "Rice", "Flowers"],
  correctAnswer: "Tomato seeds",
  scaffoldingHint: "Look at the first sentence.",
};

const teacherMaterial: UploadedMaterial = {
  id: "material-1",
  title: "My First Garden",
  uploadedById: "teacher-demo",
  uploaderName: "Teacher",
  uploaderRole: "Teacher",
  fileType: "PDF",
  language: "English",
  uploadedAt: "2026-09-30",
  processingStatus: "completed",
  originalFilename: "garden.pdf",
  fileSizeBytes: 1_048_576,
  fileSizeLabel: "1 MB",
  rawExtractedText: "Lina planted tomato seeds.",
  contentText: "Lina planted tomato seeds.",
  ocrConfidence: null,
  mimeType: "application/pdf",
  languageCode: "en",
};

test("stores system-generated results centrally and returns them to the review workflow", () => {
  const systemGeneratedQuestions = [generatedQuestion];
  const state = setQuestionsForMaterial({}, teacherMaterial.id, systemGeneratedQuestions, "generated");
  const stored = getQuestionsForMaterial(state, teacherMaterial.id);

  assert.equal(stored?.reviewStatus, "generated");
  assert.deepEqual(stored?.questions, systemGeneratedQuestions);
  assert.notEqual(stored?.questions, systemGeneratedQuestions);
});

test("saves edited question text and changes generated status to reviewed", () => {
  const generatedState = setQuestionsForMaterial(
    {},
    teacherMaterial.id,
    [generatedQuestion],
    "generated",
  );
  const editedQuestions = [
    { ...generatedQuestion, questionText: "  Which seeds did Lina plant?  " },
  ];
  const normalizedQuestions = normalizeGeneratedQuestions(editedQuestions);

  assert.deepEqual(validateGeneratedQuestions(normalizedQuestions), []);

  const reviewedState = setQuestionsForMaterial(
    generatedState,
    teacherMaterial.id,
    normalizedQuestions,
    "reviewed",
  );
  const stored = getQuestionsForMaterial(reviewedState, teacherMaterial.id);

  assert.equal(stored?.questions[0].questionText, "Which seeds did Lina plant?");
  assert.equal(stored?.reviewStatus, "reviewed");
});

test("requires a new valid correct answer when an answer option changes", () => {
  const editedQuestion: GeneratedComprehensionQuestion = {
    ...generatedQuestion,
    options: ["Vegetable seeds", "A mango tree", "Rice", "Flowers"],
  };
  const issues = validateGeneratedQuestions([editedQuestion]);

  assert.equal(
    issues[0].messages.includes(
      "Select a correct answer that matches one of the four options.",
    ),
    true,
  );
});

test("review state preserves the correct option position while its text changes", () => {
  const question = {
    ...generatedQuestion,
    options: ["Carbon dioxide", "Fresh oxygen", "Water", "Soil"] as GeneratedComprehensionQuestion["options"],
    correctAnswer: "Fresh oxygen",
    correctOptionIndex: 1,
  };
  const [reviewQuestion] = toReviewableQuestions([question]);

  assert.equal(Object.prototype.hasOwnProperty.call(reviewQuestion, "correctAnswer"), false);
  assert.equal(formatCorrectAnswer(reviewQuestion), "B. Fresh oxygen");

  reviewQuestion.options[1] = "Oxygen";
  assert.equal(reviewQuestion.correctOptionIndex, 1);
  assert.equal(formatCorrectAnswer(reviewQuestion), "B. Oxygen");
});

test("review state rejects a corrupted saved correct-answer reference", () => {
  assert.throws(
    () => toReviewableQuestions([{ ...generatedQuestion, correctOptionIndex: 3 }]),
    /saved correct answer does not match/i,
  );
});

test("rejects blank, duplicate, and non-four-option answer sets", () => {
  const invalidQuestion: GeneratedComprehensionQuestion = {
    ...generatedQuestion,
    options: ["Tomato seeds", " ", "tomato seeds", "Flowers"],
  };
  const invalidLengthQuestion: GeneratedComprehensionQuestion = {
    ...generatedQuestion,
    options: ["One", "Two", "Three"] as unknown as GeneratedComprehensionQuestion["options"],
    correctAnswer: "One",
  };

  const messages = validateGeneratedQuestions([invalidQuestion])[0].messages;
  const lengthMessages = validateGeneratedQuestions([invalidLengthQuestion])[0].messages;

  assert.equal(messages.includes("Answer options cannot be blank."), true);
  assert.equal(messages.includes("Answer options must be unique."), true);
  assert.equal(lengthMessages.includes("Exactly four answer options are required."), true);
});

test("regeneration replaces reviewed questions and resets status to generated", () => {
  const reviewedState = setQuestionsForMaterial(
    {},
    teacherMaterial.id,
    [generatedQuestion],
    "reviewed",
  );
  const regeneratedQuestion = {
    ...generatedQuestion,
    id: "generated-2",
    questionText: "What did Lina check each morning?",
  };
  const regeneratedState = setQuestionsForMaterial(
    reviewedState,
    teacherMaterial.id,
    [regeneratedQuestion],
    "generated",
  );
  const stored = getQuestionsForMaterial(regeneratedState, teacherMaterial.id);

  assert.equal(stored?.reviewStatus, "generated");
  assert.deepEqual(stored?.questions.map((question) => question.id), ["generated-2"]);
});

test("limits review controls to Admin and the owning Teacher", () => {
  assert.equal(canReviewMaterialQuestions("admin", teacherMaterial, "teacher-demo"), true);
  assert.equal(canReviewMaterialQuestions("teacher", teacherMaterial, "teacher-demo"), true);
  assert.equal(canReviewMaterialQuestions("teacher", teacherMaterial, "another-teacher"), false);
  assert.equal(canReviewMaterialQuestions("general_user", teacherMaterial, "teacher-demo"), false);
});

test("returns a safe empty lookup for an invalid material id", () => {
  const state: GeneratedQuestionsByMaterial = {};

  assert.equal(getQuestionsForMaterial(state, "missing-material"), undefined);
  assert.equal(getQuestionsForMaterial(state, undefined), undefined);
});
