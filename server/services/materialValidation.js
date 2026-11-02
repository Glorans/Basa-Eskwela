const path = require("path");
const fs = require("fs/promises");

const MAX_MATERIAL_FILE_SIZE = 25 * 1024 * 1024;
const SUPPORTED_LANGUAGES = new Set(["en", "fil"]);

const MATERIAL_FILE_RULES = Object.freeze({
  ".pdf": {
    fileType: "PDF",
    mimeTypes: new Set(["application/pdf"]),
  },
  ".docx": {
    fileType: "DOCX",
    mimeTypes: new Set([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]),
  },
  ".jpg": {
    fileType: "JPG",
    mimeTypes: new Set(["image/jpeg"]),
  },
  ".jpeg": {
    fileType: "JPG",
    mimeTypes: new Set(["image/jpeg"]),
  },
  ".png": {
    fileType: "PNG",
    mimeTypes: new Set(["image/png"]),
  },
});

class MaterialValidationError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.name = "MaterialValidationError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function getBaseMimeType(mimeType = "") {
  return mimeType.split(";", 1)[0].trim().toLowerCase();
}

function validateMaterialFile(file) {
  if (!file) {
    throw new MaterialValidationError(
      "MISSING_FILE",
      400,
      "Choose a PDF, DOCX, JPG, or PNG file to upload.",
    );
  }

  const extension = path.extname(file.originalname || "").toLowerCase();
  const rule = MATERIAL_FILE_RULES[extension];

  if (!rule) {
    throw new MaterialValidationError(
      "UNSUPPORTED_EXTENSION",
      415,
      "Only PDF, DOCX, JPG, JPEG, and PNG files are supported.",
    );
  }

  const mimeType = getBaseMimeType(file.mimetype);

  if (!rule.mimeTypes.has(mimeType)) {
    throw new MaterialValidationError(
      "UNSUPPORTED_MIME_TYPE",
      415,
      "The file type does not match its filename extension.",
    );
  }

  if (file.size === 0) {
    throw new MaterialValidationError(
      "EMPTY_FILE",
      400,
      "The selected file is empty. Choose a file that contains readable text.",
    );
  }

  if (typeof file.size === "number" && file.size > MAX_MATERIAL_FILE_SIZE) {
    throw new MaterialValidationError(
      "FILE_TOO_LARGE",
      413,
      "The selected file is larger than the 25 MB upload limit.",
    );
  }

  return {
    extension,
    fileType: rule.fileType,
    mimeType,
  };
}

function validateMaterialLanguage(value) {
  const language = typeof value === "string" ? value.trim() : "";

  if (!SUPPORTED_LANGUAGES.has(language)) {
    throw new MaterialValidationError(
      "UNSUPPORTED_LANGUAGE",
      400,
      "Language must be either 'en' or 'fil'.",
    );
  }

  return language;
}

function matchesBytes(buffer, expected, offset = 0) {
  return expected.every((byte, index) => buffer[offset + index] === byte);
}

async function validateMaterialFileSignature(filePath, fileType) {
  const file = await fs.open(filePath, "r");
  const signature = Buffer.alloc(8);

  try {
    await file.read(signature, 0, signature.length, 0);
  } finally {
    await file.close();
  }

  const matches =
    (fileType === "PDF" && signature.subarray(0, 5).toString("ascii") === "%PDF-") ||
    (fileType === "DOCX" && matchesBytes(signature, [0x50, 0x4b, 0x03, 0x04])) ||
    (fileType === "JPG" && matchesBytes(signature, [0xff, 0xd8, 0xff])) ||
    (fileType === "PNG" &&
      matchesBytes(signature, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  if (!matches) {
    throw new MaterialValidationError(
      "INVALID_FILE_SIGNATURE",
      415,
      "The file contents do not match the selected file type.",
    );
  }

  // TODO(Production hardening): Add deeper content scanning beyond basic signatures.
  return true;
}

// A missing language means "detect it from the extracted text"; a supplied one
// (older clients) must still be valid.
function validateMaterialFields(fields = {}) {
  const title = typeof fields.title === "string" ? fields.title.trim() : "";
  const language = fields.language === undefined || fields.language === ""
    ? undefined
    : validateMaterialLanguage(fields.language);

  if (!title) {
    throw new MaterialValidationError(
      "INVALID_TITLE",
      400,
      "A material title is required.",
    );
  }

  if (title.length > 200) {
    throw new MaterialValidationError(
      "INVALID_TITLE",
      400,
      "The material title must be 200 characters or fewer.",
    );
  }

  return language === undefined ? { title } : { title, language };
}

module.exports = {
  MATERIAL_FILE_RULES,
  MAX_MATERIAL_FILE_SIZE,
  MaterialValidationError,
  getBaseMimeType,
  validateMaterialFields,
  validateMaterialFile,
  validateMaterialFileSignature,
  validateMaterialLanguage,
};
