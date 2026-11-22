const express = require("express");
const path = require("path");
const { randomUUID } = require("crypto");
const multer = require("multer");
const {
  MaterialValidationError,
  validateMaterialFields,
  validateMaterialFile,
  validateMaterialFileSignature,
  validateMaterialLanguage,
} = require("../services/materialValidation");
const {
  MaterialExtractionError,
} = require("../services/materialExtractionService");
const {
  QuestionGenerationError,
  generateComprehensionQuestions,
} = require("../services/questionGenerationService");
const {
  deleteTemporaryMaterial,
  getTemporaryMaterial,
  registerTemporaryMaterial,
} = require("../services/temporaryMaterialRegistry");
const {
  SupabaseAuthenticationError,
  SupabaseServerConfigurationError,
  getSupabaseAdmin,
} = require("../services/supabaseAdmin");
const {
  MaterialAuthorizationError,
  MaterialPersistenceError,
  authorizeMaterialRequest,
  deletePersistedMaterial,
  getPersistedMaterial,
  listPersistedMaterials,
  requireUploadRole,
  updateMaterialLanguage,
  listTrashedPersonalMaterials,
} = require("../services/materialPersistenceService");
const {
  materialFileUpload,
  materialUploadDirectory,
  removeUploadedMaterialFile,
} = require("../services/materialFileUpload");

const questionSets = require("../services/materialQuestionSetService");

const { extractTeacherMaterial } = require("../services/teacherMaterialExtraction");
const { MAX_MATERIAL_TEXT_LENGTH } = require("../services/materialTextLimits");

const materialStorageBucket = "reading-materials";
const { ContentScreenError, contentScreenMessage, isContentScreenError, screenText } = require("../services/contentScreen");
// Uploads run file extraction (and OCR for images) on the server, so each account is limited per 10 minutes.
const MATERIAL_UPLOAD_RATE_LIMIT = Object.freeze({ limit: 20, windowMs: 10 * 60 * 1000 });
const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const materialIdPattern = new RegExp(`^${uuidPattern}$`, "i");
// Independent Learner private generation: at most 10 requests per learner per hour.
const PERSONAL_GENERATION_RATE_LIMIT = Object.freeze({ limit: 10, windowMs: 60 * 60 * 1000 });
const storageExtensionsByFileType = Object.freeze({
  PDF: ["pdf"],
  DOCX: ["docx"],
  JPG: ["jpg", "jpeg"],
  PNG: ["png"],
});

function sanitizeOriginalFilename(originalFilename) {
  return path.basename(originalFilename || "material").replace(/[\u0000-\u001f\u007f]/g, "");
}

function sendMaterialError(res, error, fallbackMessage) {
  if (error instanceof ContentScreenError) {
    return res.status(422).json({ success: false, code: error.code, message: error.message });
  }
  if (error instanceof QuestionGenerationError) {
    const safeValidation = {
      MISSING_CONTENT_TEXT: "Reviewed material text is required before generating questions.",
      CONTENT_TEXT_TOO_LONG: "Reviewed material text must be 30,000 characters or fewer.",
      UNSUPPORTED_QUESTION_LANGUAGE: "Choose English or Filipino as the material language.",
      INVALID_QUESTION_COUNT: "Choose 3, 6, 9 or 12 questions.",
      INVALID_MATERIAL_ID: "Choose a saved material and try again.",
    };
    // Only bounded server error codes/status enter logs; never provider payloads, prompts, keys or stacks.
    const code = typeof error.code === "string" && /^[A-Z_]{1,80}$/.test(error.code) ? error.code : "QUESTION_GENERATION_FAILED";
    console.error("M3 question generation failed", { code, statusCode: error.statusCode });
    return res.status(error.statusCode).json({ success: false,
      message: safeValidation[code] || "We couldn't generate a new question set. Please try again." });
  }

  if (error instanceof MaterialValidationError) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  if (error instanceof SupabaseAuthenticationError) {
    return res.status(401).json({ success: false, message: error.message });
  }
  if (
    error instanceof MaterialAuthorizationError
    || error instanceof MaterialPersistenceError
    || error instanceof require("../services/personalMaterialService").PersonalMaterialError
  ) {
    if (error.statusCode >= 500) console.error("M3 material operation failed:", error);
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  if (error instanceof SupabaseServerConfigurationError) {
    console.error("M3 material persistence is not configured.");
    return res.status(503).json({ success: false, message: error.message });
  }
  console.error("Unexpected M3 material operation failure:", safeErrorSummary(error));
  return res.status(500).json({ success: false, message: fallbackMessage });
}

// Developer log for unexpected failures: enough to diagnose (type, code, short message) without request bodies,
// provider payloads, stacks or anything that looks like a key, token or password.
function safeErrorSummary(error) {
  const text = (value, max) => (typeof value === "string" ? value : "").slice(0, max);
  const message = text(error?.message, 300)
    .replace(/\b(api[_-]?key|key|token|secret|password|authorization|bearer)\b(\s*[:=]\s*|\s+)\S+/gi, "$1$2[redacted]")
    .replace(/\b[A-Za-z0-9_\-]{32,}\b/g, "[redacted]");
  const code = text(error?.code, 40);
  return {
    name: text(error?.name, 60) || typeof error,
    code: /^[A-Za-z0-9_.-]{1,40}$/.test(code) ? code : undefined,
    message,
  };
}

function sendUploadError(res, error) {
  if (error instanceof MaterialValidationError) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  if (error instanceof multer.MulterError) {
    return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      success: false,
      message: error.code === "LIMIT_FILE_SIZE"
        ? "The selected file is larger than the 25 MB upload limit."
        : "The material upload request is invalid.",
    });
  }
  return sendMaterialError(res, error, "Unable to upload the reading material. Please try again.");
}

function validateMaterialFinalization(body) {
  const temporaryMaterialId = typeof body?.temporaryMaterialId === "string"
    ? body.temporaryMaterialId.trim()
    : "";
  const contentText = typeof body?.contentText === "string" ? body.contentText.trim() : "";
  const storagePath = typeof body?.storagePath === "string" ? body.storagePath.trim() : "";
  // The teacher-confirmed language; older clients omit it and keep the upload-time choice.
  const language = body?.language === undefined || body?.language === null
    ? undefined
    : validateMaterialLanguage(body.language);
  return temporaryMaterialId && contentText && storagePath
    ? { temporaryMaterialId, contentText, storagePath, language }
    : undefined;
}

function isOwnedMaterialStoragePath(storagePath, userId, fileType) {
  const extensions = storageExtensionsByFileType[fileType];
  return Boolean(
    extensions
    && new RegExp(`^${userId}/(${uuidPattern})\\.(${extensions.join("|")})$`, "i")
      .test(storagePath),
  );
}

async function storedMaterialMatchesExtraction(supabase, storagePath, material) {
  const { data: storedObject, error } = await supabase.storage
    .from(materialStorageBucket)
    .info(storagePath);
  return !error
    && Boolean(storedObject)
    && storedObject.size === material.size
    && storedObject.contentType === material.mimeType;
}

function safeSupabaseAdmin() {
  try { return getSupabaseAdmin(); } catch { return undefined; }
}

function requireMaterialId(value) {
  if (!materialIdPattern.test(value || "")) {
    throw new MaterialPersistenceError("The material ID is invalid.", 400, "INVALID_MATERIAL_ID");
  }
  return value;
}

function createMaterialsRouter(dependencies = {}) {
  const router = express.Router();
  const authorize = dependencies.authorizeMaterialRequest ?? authorizeMaterialRequest;
  const listMaterials = dependencies.listPersistedMaterials ?? listPersistedMaterials;
  const getMaterial = dependencies.getPersistedMaterial ?? getPersistedMaterial;
  const removeMaterial = dependencies.deletePersistedMaterial ?? deletePersistedMaterial;
  const generateWithGemini = dependencies.generateComprehensionQuestions
    ?? generateComprehensionQuestions;
  const extractMaterial = dependencies.extractTeacherMaterial ?? extractTeacherMaterial;
  const adminDependencies = dependencies.getSupabaseAdmin
    ? { getSupabaseAdmin: dependencies.getSupabaseAdmin }
    : {};
  // Failed private generations do not use the five-set quota, so every generation request
  // (success, reuse or failure) is also bounded per learner. Per process; resets on restart.
  const personalGenerationLimiter = dependencies.personalGenerationLimiter
    ?? require("../services/speechAccess").createRequestLimiter({ ...PERSONAL_GENERATION_RATE_LIMIT });
  const uploadLimiter = dependencies.uploadLimiter
    ?? require("../services/speechAccess").createRequestLimiter({ ...MATERIAL_UPLOAD_RATE_LIMIT });
  const screen = dependencies.screenText ?? screenText;

  router.post("/upload", async (req, res) => {
    let requester;
    try {
      requester = await authorize(req, dependencies);
      requireUploadRole(requester.profile);
    } catch (error) {
      return sendMaterialError(res, error, "Unable to authorize the material upload.");
    }
    const decision = uploadLimiter.take(requester.user.id);
    if (!decision.allowed) {
      res.set("Retry-After", String(decision.retryAfterSeconds));
      return res.status(429).json({ success: false, code: "UPLOAD_RATE_LIMITED",
        message: "Too many uploads in a short time. Please wait a few minutes and try again." });
    }

    // The teacher removed or replaced the file, or closed the page, before extraction finished.
    let clientGone = false;
    res.once("close", () => { if (!res.writableFinished) clientGone = true; });

    return materialFileUpload.single("file")(req, res, async (uploadError) => {
      if (uploadError) return sendUploadError(res, uploadError);
      try {
        const fileDetails = validateMaterialFile(req.file);
        const fields = validateMaterialFields(req.body);
        await validateMaterialFileSignature(req.file.path, fileDetails.fileType);
        const extraction = await extractMaterial({
          filePath: req.file.path,
          fileType: fileDetails.fileType,
          language: fields.language,
        });
        const material = {
          id: randomUUID(),
          uploadedBy: requester.user.id,
          title: fields.title,
          // null when detection is uncertain: the teacher must choose before saving.
          language: extraction.language,
          languageDetection: extraction.languageDetection,
          originalFilename: sanitizeOriginalFilename(req.file.originalname),
          storedFilename: req.file.filename,
          mimeType: fileDetails.mimeType,
          fileType: fileDetails.fileType,
          size: req.file.size,
          uploadedAt: new Date().toISOString(),
          extractionStatus: extraction.status,
          extractedText: extraction.extractedText,
          ocrConfidence: extraction.ocrConfidence,
          pageCount: extraction.pageCount,
          pagesWithoutText: extraction.pagesWithoutText,
          // Advisory only: the database checks the reviewed text again when it is saved.
          contentScreening: await screen(dependencies.getSupabaseAdmin?.() ?? safeSupabaseAdmin(), extraction.extractedText),
        };
        // Nobody can save this result any more, so it is not kept.
        if (clientGone) {
          await removeUploadedMaterialFile(req.file);
          return undefined;
        }
        registerTemporaryMaterial(material, req.file.path);
        return res.status(201).json({ success: true, material });
      } catch (error) {
        await removeUploadedMaterialFile(req.file);
        if (error instanceof MaterialExtractionError) {
          console.error("Reading-material extraction failed:", error.cause || error);
          return res.status(422).json({
            success: false,
            extractionStatus: "failed",
            message: error.message,
          });
        }
        return sendUploadError(res, error);
      }
    });
  });

  router.post("/finalize", async (req, res) => {
    try {
      const requester = await authorize(req, dependencies);
      requireUploadRole(requester.profile);
      const request = validateMaterialFinalization(req.body);
      if (!request) {
        return res.status(400).json({
          success: false,
          message: "The material persistence request is incomplete.",
        });
      }
      if (request.contentText.length > MAX_MATERIAL_TEXT_LENGTH) {
        return res.status(413).json({ success: false, message: "Reviewed text exceeds the 1,000,000-character storage limit. Please shorten it. No text was saved or truncated." });
      }
      const material = getTemporaryMaterial(request.temporaryMaterialId);
      if (!material) {
        return res.status(404).json({
          success: false,
          message: "The extracted material was not found. Upload it again and retry.",
        });
      }
      if (material.uploadedBy !== requester.user.id) {
        throw new MaterialAuthorizationError("This temporary material belongs to another user.");
      }
      if (material.extractionStatus !== "completed" || !material.extractedText) {
        throw new MaterialPersistenceError(
          "Material extraction must be completed before it can be added.",
          409,
          "MATERIAL_NOT_READY",
        );
      }
      if (!isOwnedMaterialStoragePath(request.storagePath, requester.user.id, material.fileType)) {
        throw new MaterialAuthorizationError("The uploaded file path is not valid for your account.");
      }
      const language = request.language ?? material.language;
      if (!language) {
        throw new MaterialPersistenceError(
          "Select English or Filipino for this material before saving.",
          400,
          "MATERIAL_LANGUAGE_REQUIRED",
        );
      }
      const supabaseAdmin = dependencies.getSupabaseAdmin?.() ?? getSupabaseAdmin();
      if (!await storedMaterialMatchesExtraction(supabaseAdmin, request.storagePath, material)) {
        throw new MaterialPersistenceError(
          "The uploaded file does not match the extracted material. Upload it again and retry.",
          409,
          "STORAGE_OBJECT_MISMATCH",
        );
      }
      const isImage = material.fileType === "JPG" || material.fileType === "PNG";
      const { data: persistedMaterial, error: insertError } = await supabaseAdmin
        .from("uploaded_materials")
        .insert({
          uploaded_by: requester.user.id,
          title: material.title,
          language,
          original_filename: material.originalFilename,
          storage_path: request.storagePath,
          mime_type: material.mimeType,
          file_size_bytes: material.size,
          raw_extracted_text: material.extractedText,
          content_text: request.contentText,
          ocr_confidence: isImage ? material.ocrConfidence : null,
          extraction_status: "completed",
        })
        .select("id, created_at")
        .single();
      if (insertError) {
        const screened = isContentScreenError(insertError);
        const { error: cleanupError } = await supabaseAdmin.storage
          .from(materialStorageBucket)
          .remove([request.storagePath]);
        if (cleanupError) {
          console.error("Uploaded-material insert and Storage cleanup both failed:", {
            insertCode: insertError.code,
            cleanupMessage: cleanupError.message,
          });
          throw new MaterialPersistenceError(
            "The material could not be added, and its uploaded file could not be cleaned up. Please contact support.",
          );
        }
        if (screened) throw new ContentScreenError(contentScreenMessage(insertError));
        throw new MaterialPersistenceError(
          "The material could not be added. Its uploaded file was cleaned up; please try again.",
        );
      }
      if (requester.profile.role === "general_user") {
        const { error: metadataError } = await supabaseAdmin.rpc("personal_material_access", {
          actor: requester.user.id, material: persistedMaterial.id, operation: "metadata", missing_pages: material.pagesWithoutText ?? [],
        });
        if (metadataError && !["PGRST202", "42883"].includes(metadataError.code)) {
          console.error("Personal extraction warning metadata unavailable", { code: metadataError.code });
        }
      }
      try {
        await deleteTemporaryMaterial(material.id);
      } catch (cleanupError) {
        console.error("Persisted material temporary-file cleanup failed:", cleanupError);
      }
      return res.status(201).json({
        success: true,
        material: {
          id: persistedMaterial.id,
          uploadedBy: requester.user.id,
          createdAt: persistedMaterial.created_at,
        },
      });
    } catch (error) {
      return sendMaterialError(res, error, "The material could not be added. Please try again.");
    }
  });

  router.get("/", async (req, res) => {
    try {
      const requester = await authorize(req, dependencies);
      return res.json({ success: true, materials: await listMaterials(requester, adminDependencies) });
    } catch (error) {
      return sendMaterialError(res, error, "Unable to load uploaded materials.");
    }
  });

  // Independent Learner Trash: own materials that were moved to Trash (never erased). Other roles are refused.
  router.get("/trash", async (req, res) => {
    try {
      const requester = await authorize(req, dependencies);
      res.set("Cache-Control", "no-store");
      return res.json({ success: true, materials: await listTrashedPersonalMaterials(requester, adminDependencies) });
    } catch (error) {
      return sendMaterialError(res, error, "Unable to load your Trash.");
    }
  });

  router.delete("/temporary/:temporaryId", async (req, res) => {
    try {
      const requester = await authorize(req, dependencies);
      requireUploadRole(requester.profile);
      const material = getTemporaryMaterial(req.params.temporaryId);
      if (!material) {
        return res.status(404).json({ success: false, message: "Temporary material not found." });
      }
      if (material.uploadedBy !== requester.user.id) {
        throw new MaterialAuthorizationError("This temporary material belongs to another user.");
      }
      await deleteTemporaryMaterial(material.id);
      return res.json({ success: true, message: "Temporary material deleted." });
    } catch (error) {
      return sendMaterialError(res, error, "Unable to delete the temporary material.");
    }
  });

  // Fail closed for old clients: material-wide writes could destroy separate sets.
  router.all(["/:materialId/questions", "/:materialId/generate-questions"], async (req, res) => {
    try {
      await authorize(req, dependencies);
      return res.status(409).json({ success: false, message: "Choose a saved question set from the material page. Refresh to use the updated workflow." });
    } catch (error) { return sendMaterialError(res, error, "Unable to authorize question management."); }
  });

  router.get("/:materialId/question-sets", async (req, res) => {
    try {
      const requester = await authorize(req, dependencies);
      const sets = await (dependencies.listMaterialQuestionSets ?? questionSets.listMaterialQuestionSets)(
        requester, requireMaterialId(req.params.materialId), adminDependencies);
      return res.json({ success: true, sets });
    } catch (error) { return sendMaterialError(res, error, "Unable to load question sets."); }
  });
  router.get("/:materialId/question-sets/:setId", async (req, res) => {
    try {
      const requester = await authorize(req, dependencies);
      const set = await (dependencies.getMaterialQuestionSet ?? questionSets.getMaterialQuestionSet)(
        requester, requireMaterialId(req.params.materialId), requireMaterialId(req.params.setId), adminDependencies);
      return res.json({ success: true, set });
    } catch (error) { return sendMaterialError(res, error, "Unable to load the question set."); }
  });
  router.post(["/:materialId/question-sets", "/:materialId/question-sets/:setId/regenerate"], async (req, res) => {
    try {
      const requester = await authorize(req, dependencies);
      const set = await (dependencies.generateMaterialQuestionSet ?? questionSets.generateMaterialQuestionSet)(
        requester, requireMaterialId(req.params.materialId), req.params.setId ? requireMaterialId(req.params.setId) : null,
        req.body?.revision, generateWithGemini, adminDependencies, req.body?.questionCount);
      return res.status(req.params.setId ? 200 : 201).json({ success: true, set });
    } catch (error) { return sendMaterialError(res, error, "We couldn't generate a new question set. Please try again."); }
  });
  router.delete("/:materialId/question-sets/:setId", async (req, res) => {
    try {
      const requester = await authorize(req, dependencies);
      await questionSets.deleteMaterialQuestionSet(requester, requireMaterialId(req.params.materialId),
        requireMaterialId(req.params.setId), req.body?.revision, adminDependencies);
      return res.json({ success: true });
    } catch (error) { return sendMaterialError(res, error, "Unable to delete the question set."); }
  });
  router.post("/:materialId/question-sets/:setId/review", async (req, res) => {
    try {
      const requester = await authorize(req, dependencies);
      const set = await questionSets.reviewMaterialQuestionSet(
        requester, requireMaterialId(req.params.materialId), requireMaterialId(req.params.setId),
        req.body?.revision, adminDependencies);
      return res.json({ success: true, set });
    } catch (error) { return sendMaterialError(res, error, "Unable to mark the question set as reviewed."); }
  });
  router.put("/:materialId/question-sets/:setId", async (req, res) => {
    try {
      const requester = await authorize(req, dependencies);
      const set = await (dependencies.saveMaterialQuestionSet ?? questionSets.saveMaterialQuestionSet)(
        requester, requireMaterialId(req.params.materialId), requireMaterialId(req.params.setId),
        req.body?.revision, req.body?.questions, adminDependencies);
      return res.json({ success: true, set });
    } catch (error) { return sendMaterialError(res, error, "Unable to save the question set."); }
  });

  router.patch("/:materialId/language", async (req, res) => {
    try {
      const requester = await authorize(req, dependencies);
      const result = await (dependencies.updateMaterialLanguage ?? updateMaterialLanguage)(
        requester, requireMaterialId(req.params.materialId), req.body?.language, adminDependencies);
      return res.json({ success: true, material: result });
    } catch (error) {
      return sendMaterialError(res, error, "Unable to change the material language.");
    }
  });

  router.get("/:materialId/personal-practice", async (req, res) => {
    try {
      const requester = await authorize(req);
      const state = await require("../services/personalMaterialService").personalPracticeState(requester, requireMaterialId(req.params.materialId), adminDependencies);
      res.json({ state });
    } catch (error) { return sendMaterialError(res, error, "Unable to load personal practice."); }
  });
  // Independent Learner question preview: read-only, owner-only, no answer keys; never starts an assessment.
  router.get("/:materialId/personal-practice/questions", async (req, res) => {
    try {
      const requester = await authorize(req);
      const preview = await require("../services/personalMaterialService").previewPersonalQuestions(requester, requireMaterialId(req.params.materialId), adminDependencies);
      res.set("Cache-Control", "no-store");
      return res.json(preview);
    } catch (error) { return sendMaterialError(res, error, "Unable to load your questions."); }
  });
  // Independent Learner: correct the extracted reading text (the original file is unchanged; saved results keep their
  // own copies). The database decides when editing is allowed (see personalMaterialService.updatePersonalMaterialText).
  router.put("/:materialId/personal-practice/text", async (req, res) => {
    try {
      const requester = await authorize(req);
      const service = require("../services/personalMaterialService");
      const id = requireMaterialId(req.params.materialId);
      await service.updatePersonalMaterialText(requester, id, { contentText: req.body?.contentText, revision: req.body?.revision }, adminDependencies);
      return res.json({ state: await service.personalPracticeState(requester, id, adminDependencies) });
    } catch (error) { return sendMaterialError(res, error, "Unable to save your text."); }
  });
  // Independent Learner: Trash -> My Materials.
  router.post("/:materialId/personal-practice/restore", async (req, res) => {
    try {
      const requester = await authorize(req);
      return res.json(await require("../services/personalMaterialService").restorePersonalMaterial(
        requester, requireMaterialId(req.params.materialId), adminDependencies));
    } catch (error) { return sendMaterialError(res, error, "Unable to restore this material."); }
  });
  router.post("/:materialId/personal-practice/:action", async (req, res) => {
    try {
      const requester = await authorize(req);
      const id = requireMaterialId(req.params.materialId);
      const service = require("../services/personalMaterialService");
      if (req.params.action === "confirm" && req.body?.confirmed === true && typeof req.body?.revision === "string") {
        const state = await service.personalMaterialAccess(requester, id, "confirm", { expected_revision: req.body.revision }, adminDependencies);
        return res.json({ state });
      }
      if (req.params.action === "generate" || req.params.action === "new-questions") {
        const decision = personalGenerationLimiter.take(requester.user.id);
        if (!decision.allowed) {
          res.set("Retry-After", String(decision.retryAfterSeconds));
          return res.status(429).json({ success: false, code: "PERSONAL_GENERATION_RATE_LIMITED",
            message: "Too many question-generation requests. Please wait before trying again; saved questions are kept." });
        }
        // "new-questions": a new set for the same text before any assessment (counts toward the same limits).
        return res.json({ set: await service.generatePersonalQuestions(requester, id, { ...adminDependencies, generate: generateWithGemini },
          { replace: req.params.action === "new-questions" }) });
      }
      return res.status(400).json({ message: "Confirm the reviewed text or generate private questions." });
    } catch (error) {
      const generating = ["generate", "new-questions"].includes(req.params.action);
      // AI-step failures are logged by sendMaterialError (code + status). Refusals from the private-question database
      // functions (for example an invalid bank, or the material changing during generation) were not logged at all;
      // log a sanitized summary for every personal generation failure so a failed attempt can be diagnosed later.
      if (generating && !(error instanceof QuestionGenerationError)) {
        console.error("Personal question generation refused", {
          action: req.params.action,
          statusCode: typeof error?.statusCode === "number" ? error.statusCode : 500,
          code: typeof error?.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : undefined,
          reason: typeof error?.message === "string" ? error.message.slice(0, 160).replace(/[A-Za-z0-9_\-]{32,}/g, "[redacted]") : undefined,
        });
      }
      return sendMaterialError(res, error, generating ? "We couldn't generate a new question set. Please try again." : "Unable to update personal practice.");
    }
  });

  router.get("/:materialId", async (req, res) => {
    try {
      const requester = await authorize(req, dependencies);
      const materialId = requireMaterialId(req.params.materialId);
      return res.json({
        success: true,
        material: await getMaterial(requester, materialId, adminDependencies),
      });
    } catch (error) {
      return sendMaterialError(res, error, "Unable to load the uploaded material.");
    }
  });

  router.delete("/:materialId", async (req, res) => {
    try {
      const requester = await authorize(req, dependencies);
      const materialId = requireMaterialId(req.params.materialId);
      await removeMaterial(requester, materialId, adminDependencies);
      return res.json({ success: true, message: "Uploaded material deleted." });
    } catch (error) {
      return sendMaterialError(res, error, "Unable to delete the uploaded material.");
    }
  });

  return router;
}

module.exports = {
  createMaterialsRouter,
  materialUploadDirectory,
  materialsRouter: createMaterialsRouter(),
};
