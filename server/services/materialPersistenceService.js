const {
  SupabaseAuthenticationError,
  getAuthenticatedSupabaseUser,
  getSupabaseAdmin,
} = require("./supabaseAdmin");

const MATERIAL_ROLES = Object.freeze([
  "admin",
  "teacher",
  "general_user",
]);

const UPLOADER_ROLES = Object.freeze([
  "teacher",
  "general_user",
]);

const QUESTION_REVIEW_ROLES = Object.freeze([
  "admin",
  "teacher",
]);

const QUESTION_TYPES = Object.freeze([
  "literal",
  "inferential",
  "critical",
]);

const ROLE_LABELS = Object.freeze({
  admin: "Admin",
  teacher: "Teacher",
  general_user: "Independent Learner",
});

const MATERIAL_SELECT = [
  "id",
  "uploaded_by",
  "title",
  "language",
  "original_filename",
  "storage_path",
  "mime_type",
  "file_size_bytes",
  "raw_extracted_text",
  "content_text",
  "ocr_confidence",
  "extraction_status",
  "created_at",
  "updated_at",
].join(", ");

class MaterialAuthorizationError extends Error {
  constructor(
    message = "You are not allowed to manage uploaded materials.",
    statusCode = 403,
  ) {
    super(message);
    this.name = "MaterialAuthorizationError";
    this.statusCode = statusCode;
  }
}

class MaterialPersistenceError extends Error {
  constructor(
    message,
    statusCode = 500,
    code = "MATERIAL_OPERATION_FAILED",
  ) {
    super(message);
    this.name = "MaterialPersistenceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function requireRole(profile, allowedRoles, message) {
  if (!profile || !allowedRoles.includes(profile.role)) {
    throw new MaterialAuthorizationError(message);
  }
}

function requireUploadRole(profile) {
  requireRole(
    profile,
    UPLOADER_ROLES,
    "Only Teachers and Independent Learners may upload reading materials.",
  );
}

function canAccessMaterial(requester, material) {
  return Boolean(
    requester &&
      material &&
      (
        requester.profile.role === "admin" ||
        (
          UPLOADER_ROLES.includes(requester.profile.role) &&
          material.uploaded_by === requester.user.id
        )
      ),
  );
}

async function authorizeMaterialRequest(
  req,
  dependencies = {},
) {
  const authenticate =
    dependencies.getAuthenticatedSupabaseUser ??
    getAuthenticatedSupabaseUser;

  const getAdmin =
    dependencies.getSupabaseAdmin ?? getSupabaseAdmin;

  const user = await authenticate(req);

  const { data: profile, error } = await getAdmin()
    .from("profiles")
    .select("id, full_name, role, teacher_status")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    throw new SupabaseAuthenticationError();
  }

  if (
    profile.role === "teacher" &&
    profile.teacher_status !== "approved"
  ) {
    throw new MaterialAuthorizationError(
      "Approved Teacher access is required.",
    );
  }

  requireRole(profile, MATERIAL_ROLES);

  return { user, profile };
}

function fileTypeFromMimeType(mimeType) {
  if (mimeType === "application/pdf") return "PDF";

  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "DOCX";
  }

  if (mimeType === "image/jpeg") return "JPG";

  return "PNG";
}

function fileSizeLabel(bytes) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function toMaterialDto(material, uploaderProfile) {
  return {
    id: material.id,
    title: material.title,
    uploadedById: material.uploaded_by,
    uploaderName:
      uploaderProfile?.full_name?.trim() || "Profile",
    uploaderRole:
      ROLE_LABELS[uploaderProfile?.role] || "User",
    fileType: fileTypeFromMimeType(material.mime_type),
    language:
      material.language === "fil" ? "Filipino" : "English",
    languageCode: material.language,
    uploadedAt: material.created_at,
    processingStatus: material.extraction_status,
    originalFilename: material.original_filename,
    fileSizeBytes: material.file_size_bytes,
    fileSizeLabel: fileSizeLabel(material.file_size_bytes),
    contentText: material.content_text,
    rawExtractedText: material.raw_extracted_text,
    ocrConfidence: material.ocr_confidence,
    mimeType: material.mime_type,
  };
}

async function loadUploaderProfiles(supabase, materials) {
  const uploaderIds = [
    ...new Set(
      materials.map((material) => material.uploaded_by),
    ),
  ];

  if (uploaderIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .in("id", uploaderIds);

  if (error) {
    throw new MaterialPersistenceError(
      "Unable to load material uploader profiles.",
    );
  }

  return new Map(
    (data ?? []).map((profile) => [profile.id, profile]),
  );
}

async function listPersistedMaterials(
  requester,
  dependencies = {},
) {
  const supabase =
    dependencies.getSupabaseAdmin?.() ??
    getSupabaseAdmin();

  let query = supabase
    .from("uploaded_materials")
    .select(MATERIAL_SELECT);

  if (requester.profile.role !== "admin") {
    query = query.eq("uploaded_by", requester.user.id);
  }

  const { data, error } = await query.order(
    "created_at",
    { ascending: false },
  );

  if (error) {
    throw new MaterialPersistenceError(
      "Unable to load uploaded materials.",
    );
  }

  const deleted = requester.profile.role === "general_user"
    ? await require("./personalMaterialService").deletedPersonalIds(supabase, (data ?? []).map(m => m.id)) : new Set();
  let materials = (data ?? []).filter(m => !deleted.has(m.id));
  const profiles = await loadUploaderProfiles(
    supabase,
    materials,
  );
  if (requester.profile.role === "admin") {
    // School Admin: never an Independent Learner's personal upload (see isIndependentLearnerUpload).
    materials = materials.filter((material) => profiles.get(material.uploaded_by)?.role !== "general_user");
  }

  const materialIds = materials.map(
    (material) => material.id,
  );

  const questionCounts = new Map();
  const setCounts = new Map();

  if (materialIds.length > 0) {
    const { data: questions, error: questionError } =
      await supabase
        .from("comprehension_questions")
        .select("material_id")
        .in("material_id", materialIds);

    if (questionError) {
      throw new MaterialPersistenceError(
        "Unable to load material question counts.",
      );
    }

    for (const question of questions ?? []) {
      questionCounts.set(
        question.material_id,
        (questionCounts.get(question.material_id) ?? 0) + 1,
      );
    }
  }

  if (
    materialIds.length > 0 &&
    requester.profile.role !== "general_user"
  ) {
    const { data: sets, error: setError } = await supabase
      .from("material_question_sets")
      .select("material_id")
      .in("material_id", materialIds);

    if (setError) {
      throw new MaterialPersistenceError(
        "Unable to load saved question set counts.",
      );
    }

    for (const set of sets ?? []) {
      setCounts.set(
        set.material_id,
        (setCounts.get(set.material_id) ?? 0) + 1,
      );
    }
  }

  return materials.map((material) => ({
    ...toMaterialDto(
      material,
      profiles.get(material.uploaded_by),
    ),
    questionCount:
      questionCounts.get(material.id) ?? 0,
    questionSetCount:
      setCounts.get(material.id) ?? 0,
  }));
}

async function loadMaterialRow(
  materialId,
  dependencies = {},
) {
  const supabase =
    dependencies.getSupabaseAdmin?.() ??
    getSupabaseAdmin();

  const { data, error } = await supabase
    .from("uploaded_materials")
    .select(MATERIAL_SELECT)
    .eq("id", materialId)
    .maybeSingle();

  if (error) {
    throw new MaterialPersistenceError(
      "Unable to load the uploaded material.",
    );
  }

  if (!data) {
    throw new MaterialPersistenceError(
      "Uploaded material not found.",
      404,
      "MATERIAL_NOT_FOUND",
    );
  }

  return data;
}

// M1 scope: a School Admin manages Teacher and Student accounts only, so an Independent Learner's personal uploads
// (and the learner behind them) are outside the School Admin's reach. The uploader's role is read from the database.
async function isIndependentLearnerUpload(supabase, uploaderId) {
  if (!uploaderId) return false;
  const { data, error } = await supabase.from("profiles").select("id, role").eq("id", uploaderId).maybeSingle();
  if (error) throw new MaterialPersistenceError("Unable to verify the material owner.");
  return data?.role === "general_user";
}

async function getAuthorizedMaterialRow(
  requester,
  materialId,
  dependencies = {},
) {
  const material = await loadMaterialRow(
    materialId,
    dependencies,
  );

  if (!canAccessMaterial(requester, material)) {
    throw new MaterialAuthorizationError(
      "This uploaded material is not available to your account.",
    );
  }

  if (
    requester.profile.role === "admin"
    && material.uploaded_by !== requester.user.id
    && await isIndependentLearnerUpload(dependencies.getSupabaseAdmin?.() ?? getSupabaseAdmin(), material.uploaded_by)
  ) {
    // The same answer as a missing material, so the ID reveals nothing about the Independent Learner.
    throw new MaterialPersistenceError("Uploaded material not found.", 404, "MATERIAL_NOT_FOUND");
  }

  if (requester.profile.role === "general_user" && (await require("./personalMaterialService").deletedPersonalIds(dependencies.getSupabaseAdmin?.() ?? getSupabaseAdmin(), [materialId])).has(materialId)) {
    throw new MaterialAuthorizationError("This material was removed from your Reading Materials.");
  }
  return material;
}

async function getPersistedMaterial(
  requester,
  materialId,
  dependencies = {},
) {
  const supabase =
    dependencies.getSupabaseAdmin?.() ??
    getSupabaseAdmin();

  const material = await getAuthorizedMaterialRow(
    requester,
    materialId,
    dependencies,
  );

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", material.uploaded_by)
    .maybeSingle();

  if (error) {
    throw new MaterialPersistenceError(
      "Unable to load the material uploader profile.",
    );
  }

  return toMaterialDto(material, profile);
}

function optionalFeedbackText(
  value,
  label,
  maximumLength,
  questionNumber,
) {
  // Older questions and clients may omit feedback.
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new MaterialPersistenceError(
      `Question ${questionNumber}: ${label} must be text.`,
      400,
      "INVALID_QUESTIONS",
    );
  }

  const text = value.trim();

  if (!text || text.length > maximumLength) {
    throw new MaterialPersistenceError(
      `Question ${questionNumber}: ${label} must contain 1 to ${maximumLength} characters.`,
      400,
      "INVALID_QUESTIONS",
    );
  }

  return text;
}

function validateReviewedQuestions(questions) {
  if (
    !Array.isArray(questions) ||
    questions.length === 0
  ) {
    throw new MaterialPersistenceError(
      "At least one generated question is required.",
      400,
      "INVALID_QUESTIONS",
    );
  }

  return questions.map((question, index) => {
    const id =
      typeof question?.id === "string"
        ? question.id.trim()
        : "";

    const type =
      typeof question?.type === "string"
        ? question.type.trim()
        : "";

    const questionText =
      typeof question?.questionText === "string"
        ? question.questionText.trim()
        : "";

    const scaffoldingHint =
      typeof question?.scaffoldingHint === "string"
        ? question.scaffoldingHint.trim()
        : "";

    const options = Array.isArray(question?.options)
      ? question.options.map((option) =>
          typeof option === "string" ? option.trim() : "",
        )
      : [];

    const comparableOptions = options.map((option) =>
      option.toLocaleLowerCase(),
    );

    if (
      !id ||
      !QUESTION_TYPES.includes(type) ||
      !questionText ||
      !scaffoldingHint ||
      options.length !== 4 ||
      options.some((option) => !option) ||
      new Set(comparableOptions).size !== 4
    ) {
      throw new MaterialPersistenceError(
        `Question ${index + 1} is invalid. Check its text, category, four unique choices, and hint.`,
        400,
        "INVALID_QUESTIONS",
      );
    }

    const answerExplanation = optionalFeedbackText(
      question.answerExplanation,
      "answer explanation",
      1500,
      index + 1,
    );

    const supportingEvidence = optionalFeedbackText(
      question.supportingEvidence,
      "supporting evidence",
      1000,
      index + 1,
    );

    return {
      id,
      type,
      questionText,
      options,
      scaffoldingHint,
      ...(answerExplanation !== undefined
        ? { answerExplanation }
        : {}),
      ...(supportingEvidence !== undefined
        ? { supportingEvidence }
        : {}),
    };
  });
}

function getCorrectOptionIndex(question, correctAnswer) {
  const index = Array.isArray(question.options)
    ? question.options.indexOf(correctAnswer)
    : -1;

  if (index < 0) {
    throw new MaterialPersistenceError(
      "The saved correct answer does not match any answer option. Regenerate the questions or contact support.",
      409,
      "INVALID_ANSWER_KEY",
    );
  }

  return index;
}

function toQuestionDto(
  question,
  correctAnswer,
  feedback = {},
) {
  const correctOptionIndex = getCorrectOptionIndex(
    question,
    correctAnswer,
  );

  return {
    id: question.id,
    type: question.question_type,
    questionText: question.question_text,
    options: question.options,
    correctAnswer,
    correctOptionIndex,
    scaffoldingHint: question.scaffolding_hint,
    answerExplanation:
      feedback.answer_explanation ?? null,
    supportingEvidence:
      feedback.supporting_evidence ?? null,
    reviewStatus: question.review_status,
    displayOrder: question.display_order,
  };
}

async function deletePersistedMaterial(
  requester,
  materialId,
  dependencies = {},
) {
  const supabase =
    dependencies.getSupabaseAdmin?.() ??
    getSupabaseAdmin();

  const material = await getAuthorizedMaterialRow(
    requester,
    materialId,
    dependencies,
  );

  if (requester.profile.role === "general_user") {
    try {
      await require("./personalMaterialService").personalMaterialAccess(requester, materialId, "delete", {}, dependencies);
      return;
    } catch (error) {
      // Before the proposals are installed no personal practice exists. Keep legacy deletion.
      if (!["PGRST202", "42883"].includes(error.code)) throw error;
    }
  } else if (requester.profile.role === "admin") {
    const { data: personal, error } = await supabase.from("personal_material_state").select("material_id").eq("material_id", materialId).maybeSingle();
    if (error && !["42P01", "PGRST205"].includes(error.code)) throw new MaterialPersistenceError("Unable to verify personal history.");
    if (personal) {
      // Existing Admin material-management permission, with the same history-preserving deletion.
      const { error: deletionError } = await supabase.rpc("personal_material_access", { actor: material.uploaded_by, material: materialId, operation: "delete" });
      if (deletionError) throw new MaterialPersistenceError("Unable to remove this personal material safely.");
      return;
    }
  }

  const { data: references, error: referenceError } =
    await supabase
      .from("modules")
      .select("id")
      .eq("source_material_id", materialId)
      .limit(1);

  if (referenceError) {
    throw new MaterialPersistenceError(
      "Unable to verify whether this material is in use.",
    );
  }

  if (references?.length) {
    throw new MaterialPersistenceError(
      "This material is used by a reading module and cannot be deleted.",
      409,
      "MATERIAL_REFERENCED",
    );
  }

  const { error: storageError } = await supabase.storage
    .from("reading-materials")
    .remove([material.storage_path]);

  if (storageError) {
    throw new MaterialPersistenceError(
      "The material file could not be deleted. The material remains available.",
      502,
      "STORAGE_DELETE_FAILED",
    );
  }

  const { error: questionError } = await supabase
    .from("comprehension_questions")
    .delete()
    .eq("material_id", materialId);

  if (questionError) {
    console.error(
      "Material file was removed but question cleanup failed:",
      {
        materialId,
        code: questionError.code,
        message: questionError.message,
      },
    );

    throw new MaterialPersistenceError(
      "The material file was deleted, but its database records could not be fully removed.",
    );
  }

  const { error: materialError } = await supabase
    .from("uploaded_materials")
    .delete()
    .eq("id", materialId);

  if (materialError) {
    console.error(
      "Material file was removed but metadata deletion failed:",
      {
        materialId,
        code: materialError.code,
        message: materialError.message,
      },
    );

    throw new MaterialPersistenceError(
      "The material file was deleted, but its database record could not be removed.",
    );
  }
}

const LANGUAGE_IN_USE_MESSAGE =
  "This material is already assigned in a classroom or has student reading results, so its language cannot be changed. "
  + "Upload the reading again with the correct language and assign the new copy instead. Existing results stay unchanged.";

// Tables whose rows lock a material's language: assignments (room-subject filtering)
// and saved M5/M6 attempts (results and XP are tied to the attempt's language).
const LANGUAGE_LOCKING_TABLES = Object.freeze([
  "reading_activity_assignments",
  "oral_reading_attempts",
  "m6_comprehension_attempts",
]);

async function isMaterialLanguageLocked(supabase, materialId) {
  for (const table of LANGUAGE_LOCKING_TABLES) {
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .eq("material_id", materialId)
      .limit(1);

    if (error) {
      throw new MaterialPersistenceError(
        "Unable to verify whether this material is in use.",
      );
    }

    if (data?.length) return true;
  }
  return false;
}

/**
 * Corrects the language of the uploader's own saved material. Only unused materials
 * can change, so assignments, results, scores and XP are never reinterpreted.
 * Question sets are kept unchanged; the teacher reviews or generates new ones.
 */
async function updateMaterialLanguage(
  requester,
  materialId,
  language,
  dependencies = {},
) {
  const supabase =
    dependencies.getSupabaseAdmin?.() ??
    getSupabaseAdmin();

  requireUploadRole(requester.profile);

  if (!["en", "fil"].includes(language)) {
    throw new MaterialPersistenceError(
      "Choose English or Filipino.",
      400,
      "INVALID_MATERIAL_LANGUAGE",
    );
  }

  const material = await getAuthorizedMaterialRow(
    requester,
    materialId,
    dependencies,
  );

  if (material.uploaded_by !== requester.user.id) {
    throw new MaterialAuthorizationError(
      "Only the teacher who uploaded this material can change its language.",
    );
  }

  if (material.language === language) {
    return { id: material.id, language: material.language, changed: false };
  }

  if (await isMaterialLanguageLocked(supabase, materialId)) {
    throw new MaterialPersistenceError(
      LANGUAGE_IN_USE_MESSAGE,
      409,
      "MATERIAL_LANGUAGE_IN_USE",
    );
  }

  // Matching the old language makes a concurrent change fail instead of being overwritten.
  const { data: updated, error: updateError } = await supabase
    .from("uploaded_materials")
    .update({ language })
    .eq("id", materialId)
    .eq("language", material.language)
    .select("id, language")
    .maybeSingle();

  if (updateError) {
    // The room-subject trigger also blocks a change that conflicts with an assignment.
    if (updateError.code === "23514") {
      throw new MaterialPersistenceError(LANGUAGE_IN_USE_MESSAGE, 409, "MATERIAL_LANGUAGE_IN_USE");
    }
    throw new MaterialPersistenceError("The material language could not be changed. Please try again.");
  }

  if (!updated) {
    throw new MaterialPersistenceError(
      "This material changed while you were editing it. Reload the page and try again.",
      409,
      "MATERIAL_CHANGED",
    );
  }

  // Legacy (subjectless) rooms have no database lock, so an assignment created between the
  // check above and this update is caught here and the change is undone.
  if (await isMaterialLanguageLocked(supabase, materialId)) {
    const { error: revertError } = await supabase
      .from("uploaded_materials")
      .update({ language: material.language })
      .eq("id", materialId)
      .eq("language", language);
    if (revertError) {
      console.error("Material language change could not be undone after a concurrent assignment:", {
        materialId,
        code: revertError.code,
      });
    }
    throw new MaterialPersistenceError(LANGUAGE_IN_USE_MESSAGE, 409, "MATERIAL_LANGUAGE_IN_USE");
  }

  return { id: updated.id, language: updated.language, changed: true };
}

module.exports = {
  MATERIAL_ROLES,
  QUESTION_REVIEW_ROLES,
  ROLE_LABELS,
  UPLOADER_ROLES,
  MaterialAuthorizationError,
  MaterialPersistenceError,
  authorizeMaterialRequest,
  canAccessMaterial,
  deletePersistedMaterial,
  getPersistedMaterial,
  getAuthorizedMaterialRow,
  toQuestionDto,
  listPersistedMaterials,
  requireUploadRole,
  toMaterialDto,
  updateMaterialLanguage,
  validateReviewedQuestions,
};
