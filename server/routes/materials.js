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
  if (error instanceof MaterialValidationError) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  if (error instanceof SupabaseAuthenticationError) {
    return res.status(401).json({ success: false, message: error.message });
  }
  if (
    error instanceof MaterialAuthorizationError
    || error instanceof MaterialPersistenceError
    || error instanceof QuestionGenerationError
    || error instanceof require("../services/personalMaterialService").PersonalMaterialError
  ) {
    if (error.statusCode >= 500) console.error("M3 material operation failed:",
      error instanceof QuestionGenerationError
        ? { code: error.code, statusCode: error.statusCode, message: error.message }
        : error);
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  if (error instanceof SupabaseServerConfigurationError) {
    console.error("M3 material persistence is not configured.");
    return res.status(503).json({ success: false, message: error.message });
  }
  console.error("Unexpected M3 material operation failure:", error);
  return res.status(500).json({ success: false, message: fallbackMessage });
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

  router.post("/upload", async (req, res) => {
    let requester;
    try {
      requester = await authorize(req, dependencies);
      requireUploadRole(requester.profile);
    } catch (error) {
      return sendMaterialError(res, error, "Unable to authorize the material upload.");
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
    } catch (error) { return sendMaterialError(res, error, "Unable to generate the question set."); }
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
      const state = await require("../services/personalMaterialService").personalMaterialAccess(requester, requireMaterialId(req.params.materialId), "status", {}, adminDependencies);
      res.json({ state });
    } catch (error) { return sendMaterialError(res, error, "Unable to load personal practice."); }
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
      if (req.params.action === "generate") {
        const decision = personalGenerationLimiter.take(requester.user.id);
        if (!decision.allowed) {
          res.set("Retry-After", String(decision.retryAfterSeconds));
          return res.status(429).json({ success: false, code: "PERSONAL_GENERATION_RATE_LIMITED",
            message: "Too many question-generation requests. Please wait before trying again; saved questions are kept." });
        }
        return res.json({ set: await service.generatePersonalQuestions(requester, id, { ...adminDependencies, generate: generateWithGemini }) });
      }
      return res.status(400).json({ message: "Confirm the reviewed text or generate private questions." });
    } catch (error) { return sendMaterialError(res, error, "Unable to update personal practice."); }
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
