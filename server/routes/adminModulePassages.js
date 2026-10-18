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
    model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    code: error?.code,
    statusCode: error?.statusCode,
    providerStatus: cause?.status ?? cause?.statusCode,
    message: safeErrorMessage(error?.message),
    cause: safeErrorMessage(cause?.message),
  });
}

function createAdminModulePassagesRouter(deps = {}) {
  const router = express.Router();

  router.post(
    "/:moduleId/passages/:passageId/generate",
    async (req, res) => {
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

        const input = {
          contentText: passage.passageText,
          language: collectionLanguage(collection.language),
        };

        validateQuestionGenerationRequest({
          ...input,
          materialId: passage.id,
        });

        const questions = await (
          deps.generate || generateComprehensionQuestions
        )(input);

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

          return res.status(409).json({
            message:
              "The bank could not be saved. Reload the module; its content may have changed.",
          });
        }

        return res.json({ revision: saved.data });
      } catch (error) {
        logGenerationError(error);

        const status =
          error instanceof SupabaseAuthenticationError
            ? 401
            : error.statusCode || 500;

        return res.status(status).json({
          message:
            status === 500
              ? "Unable to generate passage questions."
              : error.message,
        });
      }
    },
  );

  return router;
}

module.exports = { createAdminModulePassagesRouter };