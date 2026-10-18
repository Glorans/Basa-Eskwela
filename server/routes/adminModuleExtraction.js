const express = require("express");
const multer = require("multer");
const {
  MaterialValidationError,
  validateMaterialFile,
  validateMaterialFileSignature,
  validateMaterialLanguage,
} = require("../services/materialValidation");
const {
  MaterialExtractionError,
  extractReadingMaterial,
} = require("../services/materialExtractionService");
const {
  materialFileUpload,
  removeUploadedMaterialFile,
} = require("../services/materialFileUpload");
const {
  MaterialAuthorizationError,
  authorizeMaterialRequest,
} = require("../services/materialPersistenceService");
const {
  SupabaseAuthenticationError,
  SupabaseServerConfigurationError,
} = require("../services/supabaseAdmin");

function requireAdmin(profile) {
  if (profile?.role !== "admin") {
    throw new MaterialAuthorizationError(
      "Only Admin may extract a file for a reading module.",
    );
  }
}

function sendExtractionError(res, error) {
  if (error instanceof SupabaseAuthenticationError) {
    return res.status(401).json({ success: false, message: error.message });
  }
  if (error instanceof MaterialAuthorizationError) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  if (error instanceof MaterialValidationError) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  if (error instanceof multer.MulterError) {
    return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      success: false,
      message: error.code === "LIMIT_FILE_SIZE"
        ? "The selected file is larger than the 25 MB upload limit."
        : "The reading-file upload request is invalid.",
    });
  }
  if (error instanceof MaterialExtractionError) {
    console.error("Admin module-passage extraction failed:", error.cause || error);
    return res.status(422).json({
      success: false,
      extractionStatus: "failed",
      message: error.message,
    });
  }
  if (error instanceof SupabaseServerConfigurationError) {
    console.error("Admin module-passage extraction is not configured.");
    return res.status(503).json({ success: false, message: error.message });
  }

  console.error("Unexpected Admin module-passage extraction failure:", error);
  return res.status(500).json({
    success: false,
    message: "Unable to extract text from this file. Please try again or enter the passage manually.",
  });
}

function createAdminModuleExtractionRouter(dependencies = {}) {
  const router = express.Router();
  const authorize = dependencies.authorizeMaterialRequest ?? authorizeMaterialRequest;
  const extract = dependencies.extractReadingMaterial ?? extractReadingMaterial;

  router.post("/extract", async (req, res) => {
    try {
      const requester = await authorize(req, dependencies);
      requireAdmin(requester.profile);
    } catch (error) {
      return sendExtractionError(res, error);
    }

    return materialFileUpload.single("file")(req, res, async (uploadError) => {
      if (uploadError) return sendExtractionError(res, uploadError);

      try {
        const fileDetails = validateMaterialFile(req.file);
        const language = validateMaterialLanguage(req.body?.language);
        await validateMaterialFileSignature(req.file.path, fileDetails.fileType);
        const extraction = await extract({
          filePath: req.file.path,
          fileType: fileDetails.fileType,
          language,
        });

        return res.json({
          success: true,
          extraction: {
            fileType: fileDetails.fileType,
            extractedText: extraction.extractedText,
            ocrConfidence: extraction.ocrConfidence,
          },
        });
      } catch (error) {
        return sendExtractionError(res, error);
      } finally {
        await removeUploadedMaterialFile(req.file);
      }
    });
  });

  return router;
}

module.exports = {
  createAdminModuleExtractionRouter,
  adminModuleExtractionRouter: createAdminModuleExtractionRouter(),
};
