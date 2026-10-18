const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { createMaterialsRouter } = require("../routes/materials");
const { SupabaseAuthenticationError } = require("../services/supabaseAdmin");
const {
  MAX_QUESTION_CONTENT_LENGTH,
  MAX_GENERATION_ATTEMPTS,
  QuestionGenerationError,
  generateComprehensionQuestions,
  validateGeneratedQuestions,
  validateQuestionGenerationRequest,
} = require("../services/questionGenerationService");

function question(type, number) {
  const options = [
    `${type} answer ${number}`,
    `${type} distractor B ${number}`,
    `${type} distractor C ${number}`,
    `${type} distractor D ${number}`,
  ];

  return {
    type,
    questionText: `${type} question ${number}?`,
    options,
    correctAnswer: options[0],
    scaffoldingHint: `Review the passage for ${type} clue ${number}.`,
    answerExplanation: `The passage supports ${type} answer ${number}.`,
    supportingEvidence: "The river became cleaner after the class cleanup.",
  };
}

function validGeminiPayload(evidence = "The river became cleaner after the class cleanup.") {
  const payload = {
    questions: [
      question("literal", 1),
      question("literal", 2),
      question("inferential", 1),
      question("inferential", 2),
      question("critical", 1),
      question("critical", 2),
    ],
  };
  payload.questions.forEach(question => { question.supportingEvidence = evidence; });
  return payload;
}

function expectGenerationError(code, statusCode) {
  return (error) =>
    error instanceof QuestionGenerationError &&
    error.code === code &&
    error.statusCode === statusCode;
}

test("validates and normalizes question-generation request fields", () => {
  assert.deepEqual(
    validateQuestionGenerationRequest({
      materialId: "  material-1  ",
      contentText: "  A short reviewed passage.  ",
      language: "en",
    }),
    {
      materialId: "material-1",
      contentText: "A short reviewed passage.",
      language: "en",
    },
  );

  assert.throws(
    () => validateQuestionGenerationRequest(null),
    expectGenerationError("INVALID_MATERIAL_ID", 400),
  );
  assert.throws(
    () => validateQuestionGenerationRequest({ contentText: "Text", language: "en" }),
    expectGenerationError("INVALID_MATERIAL_ID", 400),
  );
  assert.throws(
    () =>
      validateQuestionGenerationRequest({
        materialId: "material-1",
        contentText: "   ",
        language: "en",
      }),
    expectGenerationError("MISSING_CONTENT_TEXT", 400),
  );
  assert.throws(
    () =>
      validateQuestionGenerationRequest({
        materialId: "material-1",
        contentText: "x".repeat(MAX_QUESTION_CONTENT_LENGTH + 1),
        language: "en",
      }),
    expectGenerationError("CONTENT_TEXT_TOO_LONG", 413),
  );
  assert.throws(
    () =>
      validateQuestionGenerationRequest({
        materialId: "material-1",
        contentText: "Text",
        language: "es",
      }),
    expectGenerationError("UNSUPPORTED_QUESTION_LANGUAGE", 400),
  );
});

test("evidence matching tolerates formatting but never paraphrases, punctuation changes or translated quotes", () => {
  for (const [source, quote] of [
    ["Nagtanim si Lina\r\nng\t mga kamatis.", "Nagtanim si Lina ng mga kamatis."],
    ["The river\n became\u00a0cleaner after the class cleanup.", "The river became cleaner after the class cleanup."],
    ["May cafe\u0301 sa tabi ng ilog.", "May caf\u00e9 sa tabi ng ilog."],
  ]) assert.equal(validateGeneratedQuestions(validGeminiPayload(quote), 6, source).length, 6);
  for (const [source, quote] of [
    ["Nagtanim si Lina ng mga kamatis.", "Si Lina ay nagtanim ng kamatis."],
    ["Nagtanim si Lina ng mga kamatis.", "Lina planted tomatoes."],
    ["“Malinis na!” sabi ni Lina.", '"Malinis na!" sabi ni Lina.'],
    ["The river became cleaner.", "The river became cleaner!"],
    ["One sentence. Another sentence.", "One ... Another sentence."],
    ["The river became cleaner.", '"The river became cleaner."'],
  ]) assert.throws(() => validateGeneratedQuestions(validGeminiPayload(quote), 6, source),
    expectGenerationError("INVALID_GEMINI_RESPONSE", 502));
});

for (const language of ["fil", "en"]) test(`${language}: bad evidence is repaired once using only the specific safe failure`, async () => {
  const source = language === "fil" ? "Nagtanim si Lina ng mga kamatis." : "Lina planted tomatoes.";
  const bad = validGeminiPayload(source);
  bad.questions[1].supportingEvidence = "REJECTED_PRIVATE_RESPONSE_DO_NOT_ECHO";
  const requests = [];
  const result = await generateComprehensionQuestions({ contentText: source, language, previousQuestions: [] }, {
    generateContent: async request => {
      requests.push(request);
      if (request.contents.startsWith("Check only language")) return { text: '{"correctLanguage":true}' };
      return { text: JSON.stringify(requests.length === 1 ? bad : validGeminiPayload(source)) };
    },
  });
  assert.equal(requests.length, 3); // bad candidate, repaired candidate, language audit
  assert.match(requests[1].contents, /Question 2 quotes evidence that does not appear in the passage/);
  assert.doesNotMatch(requests[1].contents, /REJECTED_PRIVATE_RESPONSE_DO_NOT_ECHO/);
  assert.match(requests[1].contents, /original spelling, capitalization, accents/);
  assert.match(requests[1].contents, /Evidence stays in the original passage language/);
  assert.ok(result.every(item => item.supportingEvidence === source));
  for (const type of ["literal", "inferential", "critical"]) assert.equal(result.filter(item => item.type === type).length, 2);
});

test("malformed JSON, missing explanations and invalid categories get one full revalidation retry", async () => {
  const source = "The river became cleaner after the class cleanup.";
  for (const bad of ["not JSON PRIVATE_CONTENT", JSON.stringify({ questions: [] }),
    JSON.stringify({ questions: validGeminiPayload().questions.map(q => ({ ...q, answerExplanation: "" })) }),
    JSON.stringify({ questions: validGeminiPayload().questions.map(q => ({ ...q, type: "literal" })) })]) {
    let calls = 0;
    const result = await generateComprehensionQuestions({ contentText: source, language: "en" }, {
      generateContent: async request => {
        calls++;
        if (calls === 2) {
          assert.match(request.contents, /previous candidate failed validation/);
          assert.doesNotMatch(request.contents, /PRIVATE_CONTENT/);
        }
        return { text: calls === 1 ? bad : JSON.stringify(validGeminiPayload()) };
      },
    });
    assert.equal(calls, MAX_GENERATION_ATTEMPTS);
    assert.equal(result.length, 6);
  }
});

test("mixed validation failures share one budget; final error is helpful and excludes rejected content", async () => {
  let calls = 0;
  await assert.rejects(generateComprehensionQuestions({ contentText: "Source", language: "en", previousQuestions: [] }, {
    generateContent: async () => {
      calls++;
      return { text: calls === 1 ? "PRIVATE_INVALID_JSON" : JSON.stringify(validGeminiPayload("PRIVATE_INVENTED_EVIDENCE")) };
    },
  }), error => {
    assert.equal(error.code, "INVALID_GEMINI_RESPONSE");
    assert.match(error.message, /after 2 attempts/);
    assert.match(error.message, /Question 1 quotes evidence/);
    assert.match(error.message, /No question set was saved or changed/);
    assert.doesNotMatch(error.message + error.cause.message, /PRIVATE_/);
    return true;
  });
  assert.equal(calls, MAX_GENERATION_ATTEMPTS);
});

test("evidence and language repairs cannot multiply retry budgets; provider failures are not retried", async () => {
  let calls = 0;
  await assert.rejects(generateComprehensionQuestions({ contentText: "Source", language: "fil", previousQuestions: [] }, {
    generateContent: async request => {
      calls++;
      if (request.contents.startsWith("Check only language")) return { text: '{"correctLanguage":false}' };
      return { text: JSON.stringify(validGeminiPayload(calls === 1 ? "Invented" : "Source")) };
    },
  }), { code: "QUESTION_LANGUAGE_MISMATCH" });
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(generateComprehensionQuestions({ contentText: "Source", language: "en" }, {
    generateContent: async () => { calls++; throw new Error("Provider unavailable"); },
  }), { code: "GEMINI_REQUEST_FAILED" });
  assert.equal(calls, 1);
});

test("teacher API returns a helpful error without logging provider causes or secrets", async context => {
  const logs = [];
  context.mock.method(console, "error", (...values) => logs.push(values));
  const app = express();
  app.use(express.json());
  app.use("/api/materials", createMaterialsRouter({
    authorizeMaterialRequest: async () => ({ user: { id: "teacher" }, profile: { role: "teacher" } }),
    generateMaterialQuestionSet: async () => {
      throw new QuestionGenerationError("GEMINI_REQUEST_FAILED", 502,
        "Gemini could not generate questions right now. Please try again.", new Error("PRIVATE_PROVIDER_PAYLOAD_AND_KEY"));
    },
  }));
  const server = app.listen(0, "127.0.0.1");
  context.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once("listening", resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/materials/11111111-1111-4111-8111-111111111111/question-sets`, { method: "POST" });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.match(body.message, /Please try again/);
  assert.equal(Object.hasOwn(body, "cause"), false);
  assert.doesNotMatch(JSON.stringify(body) + JSON.stringify(logs), /PRIVATE_PROVIDER_PAYLOAD_AND_KEY/);
  assert.equal(logs[0][1].code, "GEMINI_REQUEST_FAILED");
});

test("validates six questions with two of each required category", () => {
  const questions = validateGeneratedQuestions(validGeminiPayload());

  assert.equal(questions.length, 6);
  assert.equal(questions.filter((item) => item.type === "literal").length, 2);
  assert.equal(questions.filter((item) => item.type === "inferential").length, 2);
  assert.equal(questions.filter((item) => item.type === "critical").length, 2);
  assert.ok(questions.every((item) => typeof item.id === "string" && item.id.length > 0));
});

test("rejects an invalid category distribution", () => {
  const payload = validGeminiPayload();
  payload.questions[0].type = "critical";

  assert.throws(
    () => validateGeneratedQuestions(payload),
    expectGenerationError("INVALID_GEMINI_RESPONSE", 502),
  );
});

test("generated feedback is required, bounded, and grounded in the supplied passage", () => {
  const source = "The river became cleaner after the class cleanup.";
  const questions = validateGeneratedQuestions(validGeminiPayload(), 6, source);
  assert.ok(questions.every(question => question.answerExplanation && question.supportingEvidence === source));
  for (const [field, value, reason] of [
    ["answerExplanation", undefined, /no answer explanation/],
    ["answerExplanation", "   ", /no answer explanation/],
    ["answerExplanation", "x".repeat(1501), /explanation that is too long/],
    ["supportingEvidence", undefined, /no supporting passage evidence/],
    ["supportingEvidence", "   ", /no supporting passage evidence/],
    ["supportingEvidence", "x".repeat(1001), /passage quote that is too long/],
    ["supportingEvidence", "An invented quotation.", /does not appear in the passage/],
  ]) {
    const payload = validGeminiPayload();
    payload.questions[0][field] = value;
    assert.throws(() => validateGeneratedQuestions(payload, 6, source), error => {
      assert.equal(error.code, "INVALID_GEMINI_RESPONSE");
      assert.match(error.cause.message, reason);
      return true;
    });
  }
});

test("requires non-empty question text and scaffolding hints", () => {
  const missingQuestion = validGeminiPayload();
  missingQuestion.questions[0].questionText = "   ";
  assert.throws(
    () => validateGeneratedQuestions(missingQuestion),
    expectGenerationError("INVALID_GEMINI_RESPONSE", 502),
  );

  const missingHint = validGeminiPayload();
  missingHint.questions[0].scaffoldingHint = "";
  assert.throws(
    () => validateGeneratedQuestions(missingHint),
    expectGenerationError("INVALID_GEMINI_RESPONSE", 502),
  );
});

test("requires exactly four distinct, non-empty options", () => {
  const tooFew = validGeminiPayload();
  tooFew.questions[0].options.pop();
  assert.throws(
    () => validateGeneratedQuestions(tooFew),
    expectGenerationError("INVALID_GEMINI_RESPONSE", 502),
  );

  const duplicate = validGeminiPayload();
  duplicate.questions[0].options[3] = duplicate.questions[0].options[0].toUpperCase();
  assert.throws(
    () => validateGeneratedQuestions(duplicate),
    expectGenerationError("INVALID_GEMINI_RESPONSE", 502),
  );
});

test("requires the correct answer to match one option exactly", () => {
  const payload = validGeminiPayload();
  payload.questions[0].correctAnswer = "An answer not present in the options";

  assert.throws(
    () => validateGeneratedQuestions(payload),
    expectGenerationError("INVALID_GEMINI_RESPONSE", 502),
  );
});

test("uses a mocked Gemini call and requests constrained JSON output", async () => {
  let parameters;
  const questions = await generateComprehensionQuestions(
    { contentText: "The river became cleaner after the class cleanup.", language: "en" },
    {
      model: "mock-gemini-model",
      generateContent: async (request) => {
        parameters = request;
        return { text: JSON.stringify(validGeminiPayload()) };
      },
    },
  );

  assert.equal(questions.length, 6);
  assert.equal(parameters.model, "mock-gemini-model");
  assert.equal(parameters.config.responseMimeType, "application/json");
  assert.equal(parameters.config.responseJsonSchema.properties.questions.minItems, 6);
  assert.match(parameters.contents, /Write every question.*English/i);
  assert.match(parameters.contents, /<reading_material>/);
});

test("requests Filipino output without silently switching to English", async () => {
  let prompt = "";

  await generateComprehensionQuestions(
    { contentText: "Nagtanim si Lina ng mga kamatis.", language: "fil" },
    {
      generateContent: async (request) => {
        prompt = request.contents;
        return { text: JSON.stringify(validGeminiPayload("Nagtanim si Lina ng mga kamatis.")) };
      },
    },
  );

  assert.match(prompt, /in Filipino/);
  assert.doesNotMatch(prompt, /Write every question.*in English/i);
});

test("returns a controlled error for malformed Gemini JSON", async () => {
  await assert.rejects(
    generateComprehensionQuestions(
      { contentText: "A reviewed passage.", language: "en" },
      { generateContent: async () => ({ text: "```json\nnot valid\n```" }) },
    ),
    expectGenerationError("MALFORMED_GEMINI_RESPONSE", 502),
  );
});

test("returns controlled configuration, timeout, and provider errors", async () => {
  await assert.rejects(
    generateComprehensionQuestions(
      { contentText: "A reviewed passage.", language: "en" },
      { apiKey: "" },
    ),
    expectGenerationError("MISSING_GEMINI_API_KEY", 503),
  );

  const timeout = new Error("request timed out");
  timeout.code = "ETIMEDOUT";
  await assert.rejects(
    generateComprehensionQuestions(
      { contentText: "A reviewed passage.", language: "en" },
      { generateContent: async () => Promise.reject(timeout) },
    ),
    expectGenerationError("GEMINI_TIMEOUT", 504),
  );

  await assert.rejects(
    generateComprehensionQuestions(
      { contentText: "A reviewed passage.", language: "en" },
      { generateContent: async () => Promise.reject(new Error("provider detail")) },
    ),
    expectGenerationError("GEMINI_REQUEST_FAILED", 502),
  );
});

test("persisted question endpoint requires authentication and a valid material UUID", async (context) => {
  let authenticated = false;
  const app = express();
  app.use(express.json());
  app.use("/api/materials", createMaterialsRouter({
    authorizeMaterialRequest: async () => {
      if (!authenticated) throw new SupabaseAuthenticationError();
      return {
        user: { id: "11111111-1111-4111-8111-111111111111" },
        profile: { role: "teacher" },
      };
    },
    generateMaterialQuestionSet: async () => {
      throw new Error("Generator must not run for an invalid material ID.");
    },
  }));
  const server = app.listen(0, "127.0.0.1");
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}/api/materials`;

  const unauthenticatedResponse = await fetch(
    `${baseUrl}/11111111-1111-4111-8111-111111111111/question-sets`,
    { method: "POST" },
  );
  assert.equal(unauthenticatedResponse.status, 401);

  authenticated = true;
  const invalidResponse = await fetch(`${baseUrl}/not-a-uuid/question-sets`, {
    method: "POST",
  });
  const invalidBody = await invalidResponse.json();
  assert.equal(invalidResponse.status, 400);
  assert.equal(Object.hasOwn(invalidBody, "stack"), false);

});
