const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const {
  getAuthenticatedSupabaseUser,
  SupabaseAuthenticationError,
} = require("../services/supabaseAdmin");
const {
  generateComprehensionQuestions,
  validateQuestionGenerationRequest,
  DEFAULT_GEMINI_MODEL,
} = require("../services/questionGenerationService");
const { createPassageGenerationJobs } = require('../services/passageGenerationJobs');

// Six is the default and needs no database support. Nine and twelve are only generated
// once m3_passage_bank_sizes() (supabase/proposed/m3_variable_passage_banks_PROPOSED.sql)
// reports them, checked before any billable generation request.
const DEFAULT_PASSAGE_BANK_SIZE = 6;
const PASSAGE_BANK_SIZES = Object.freeze([6, 9, 12]);

function collectionLanguage(value) {
  switch (
    typeof value === "string"
      ? value.trim().toLowerCase()
      : ""
  ) {
    case "en":
    case "english":
      return "en";

    case "fil":
    case "filipino":
    case "tagalog":
      return "fil";

    default: {
      const error = new Error(
        "The saved learning path has a missing or unsupported language. Select an English or Filipino learning path and save the draft.",
      );
      error.statusCode = 400;
      throw error;
    }
  }
}

function safeErrorMessage(value) {
  let message = String(value ?? "No additional details.");

  // Remove configured secrets before writing diagnostic output.
  for (const secret of [
    process.env.GEMINI_API_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_ANON_KEY,
  ]) {
    if (secret) {
      message = message.split(secret).join("[REDACTED]");
    }
  }

  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/AIza[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL REDACTED]")
    .slice(0, 2000);
}

function logGenerationError(error) {
  const cause = error?.cause ?? error;

  console.error("[Passage question generation failed]", {
    model: safeErrorMessage(process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL),
    code: safeErrorMessage(error?.code),
    statusCode: safeErrorMessage(error?.statusCode),
    providerStatus: safeErrorMessage(cause?.status ?? cause?.statusCode),
    message: safeErrorMessage(error?.message),
    cause: safeErrorMessage(cause?.message),
  });
}

// Database refusals the Admin can act on. Anything else (for example a broken
// database function) is reported as a database error, never as a stale module.
const BANK_SAVE_REFUSALS = [
  [/This module changed/i, 409,
    "This module changed while the questions were being generated. Reload the module and try again. No questions were saved."],
  [/Only never-published drafts|Referenced module content|Oral-reading history/i, 409,
    "This module is published or already used by rooms or learners, so its questions cannot be replaced. No questions were saved."],
  [/Passage belongs to another module/i, 404,
    "This passage is no longer in the module. Reload the module. No questions were saved."],
  [/Exactly (six|two|\d+)|6, 9 or 12|Invalid question|answer key|Answer explanation|Supporting evidence/i, 502,
    "The generated questions did not pass the database checks. Please try again. No questions were saved."],
];

function bankSaveFailure(error) {
  const message = String(error?.message ?? "");
  const [, status, text] = BANK_SAVE_REFUSALS.find(([pattern]) => pattern.test(message)) ?? [
    null, 500,
    "The question bank could not be saved because of a database error. No questions were saved. Check the backend log for details.",
  ];
  return { status, message: text };
}

function createAdminModulePassagesRouter(deps = {}) {
  const router = express.Router();
  const jobs = deps.jobs || createPassageGenerationJobs();
  const clientFor = req => deps.client || createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: req.get('authorization') } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Authorization is checked on every poll, including cached/finished jobs.
  router.get('/:moduleId/passages/:passageId/generation-status', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await (deps.authenticate || getAuthenticatedSupabaseUser)(req);
      const { data, error } = await clientFor(req).rpc('m3_admin_collection', { target_id: req.params.moduleId });
      if (error || !data) return res.status(403).json({ message: 'Admin access to this module is required.' });
      if (!data.passages.some(p => p.id === req.params.passageId)) return res.status(404).json({ message: 'Passage not found.' });
      const job = jobs.get(req.params.moduleId, req.params.passageId, Number(req.query.revision));
      return res.json({ state: job?.state || 'unknown', revision: job?.revision });
    } catch (error) {
      logGenerationError(error);
      return res.status(error instanceof SupabaseAuthenticationError ? 401 : 503).json({ message: 'Unable to check the saved questions right now.' });
    }
  });

  router.post(
    "/:moduleId/passages/:passageId/generate",
    async (req, res) => {
      let job;
      try {
        await (
          deps.authenticate || getAuthenticatedSupabaseUser
        )(req);

        // Keep the verified user's JWT for database authorization.
        const client =
          deps.client ||
          createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY,
            {
              global: {
                headers: {
                  Authorization: req.get("authorization"),
                },
              },
              auth: {
                persistSession: false,
                autoRefreshToken: false,
              },
            },
          );

        const { data: collection, error } = await client.rpc(
          "m3_admin_collection",
          { target_id: req.params.moduleId },
        );

        if (error || !collection) {
          return res.status(403).json({
            message: "Admin access to this module is required.",
          });
        }

        if (
          collection.status !== "draft" ||
          collection.publishedAt
        ) {
          return res.status(409).json({
            message: "Only never-published drafts can be edited.",
          });
        }

        if (collection.revision !== req.body?.revision) {
          return res.status(409).json({
            message:
              "This module changed. Reload before generating.",
          });
        }

        const passage = collection.passages.find(
          (item) => item.id === req.params.passageId,
        );

        if (!passage) {
          return res.status(404).json({
            message: "Passage not found in this module.",
          });
        }

        const questionCount = req.body?.questionCount ?? DEFAULT_PASSAGE_BANK_SIZE;
        if (!PASSAGE_BANK_SIZES.includes(questionCount)) {
          return res.status(400).json({ message: 'Choose 6, 9 or 12 questions for this passage.' });
        }
        if (questionCount !== DEFAULT_PASSAGE_BANK_SIZE) {
          const { data: sizes, error: sizesError } = await client.rpc('m3_passage_bank_sizes');
          if (sizesError || !Array.isArray(sizes) || !sizes.includes(questionCount)) {
            return res.status(409).json({
              message: 'Nine- and twelve-question banks are not available yet. Generate six questions instead. No questions were generated.',
            });
          }
        }

        const input = {
          contentText: passage.passageText,
          language: collectionLanguage(collection.language),
          questionCount,
        };

        validateQuestionGenerationRequest({
          ...input,
          materialId: passage.id,
        });

        const started = jobs.start(collection.id, passage.id, collection.revision);
        job = started.job;
        if (!started.started) return res.status(409).json({
          state: job.state, message: 'This request is already being processed. Check the saved questions before trying again.',
        });

        const questions = await (
          deps.generate || generateComprehensionQuestions
        )(input);

        job.state = 'saving';
        const saved = await client.rpc(
          "m3_save_passage_bank",
          {
            target_id: collection.id,
            target_passage: passage.id,
            expected_revision: collection.revision,
            bank: questions,
            bank_action: "generate",
          },
        );

        if (saved.error) {
          console.error("[Passage question bank save failed]", {
            code: saved.error.code,
            message: safeErrorMessage(saved.error.message),
          });

          const failure = bankSaveFailure(saved.error);
          // SQL errors are definitive rollbacks. A transport failure may have committed.
          job.state = /^[0-9A-Z]{5}$/.test(saved.error.code || '') && !String(saved.error.code).startsWith('08') ? 'failed' : 'unknown';
          job.updatedAt = Date.now();
          return res.status(failure.status).json({ state: job.state, message: job.state === 'unknown'
            ? 'The save response was interrupted. Check the saved questions before trying again.' : failure.message });
        }

        job.state = 'saved';
        job.revision = saved.data;
        job.updatedAt = Date.now();
        return res.json({ revision: saved.data });
      } catch (error) {
        if (job) { job.state = job.state === 'saving' ? 'unknown' : 'failed'; job.updatedAt = Date.now(); }
        logGenerationError(error);

        const status =
          error instanceof SupabaseAuthenticationError
            ? 401
            : error.statusCode || 500;

        const message = status === 401 ? 'Please sign in again before generating questions.'
          : status === 400 || status === 413 ? 'Check the saved passage text and its language before generating questions.'
          : status === 504 ? 'Question generation took longer than expected. Check the saved questions before trying again.'
          : status === 502 ? 'The question service could not produce a valid question set. Check the saved questions before trying again.'
          : 'Questions could not be generated right now. Check the saved questions before trying again.';
        return res.status(status).json({ state: job?.state || 'failed', message });
      }
    },
  );

  return router;
}

module.exports = { createAdminModulePassagesRouter };
