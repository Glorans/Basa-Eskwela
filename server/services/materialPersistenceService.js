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

  const materials = data ?? [];
  const profiles = await loadUploaderProfiles(
    supabase,
    materials,
  );

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
  validateReviewedQuestions,
};