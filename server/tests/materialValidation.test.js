const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  MAX_MATERIAL_FILE_SIZE,
  MaterialValidationError,
  validateMaterialFields,
  validateMaterialFile,
  validateMaterialFileSignature,
  validateMaterialLanguage,
} = require("../services/materialValidation");

function file(originalname, mimetype, size = 1024) {
  return { originalname, mimetype, size };
}

test("accepts matching PDF and DOCX extensions and MIME types", () => {
  assert.equal(validateMaterialFile(file("lesson.pdf", "application/pdf")).fileType, "PDF");
  assert.equal(
    validateMaterialFile(
      file(
        "lesson.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).fileType,
    "DOCX",
  );
});

test("accepts JPG, JPEG, and PNG for OCR processing", () => {
  assert.equal(validateMaterialFile(file("page.jpg", "image/jpeg")).fileType, "JPG");
  assert.equal(validateMaterialFile(file("page.jpeg", "image/jpeg")).fileType, "JPG");
  assert.equal(validateMaterialFile(file("page.png", "image/png")).fileType, "PNG");
});

test("rejects unsupported extensions", () => {
  assert.throws(
    () => validateMaterialFile(file("lesson.txt", "text/plain")),
    (error) =>
      error instanceof MaterialValidationError &&
      error.code === "UNSUPPORTED_EXTENSION" &&
      error.statusCode === 415,
  );
});

test("rejects a supported extension with a mismatched MIME type", () => {
  assert.throws(
    () => validateMaterialFile(file("lesson.pdf", "image/png")),
    (error) =>
      error instanceof MaterialValidationError && error.code === "UNSUPPORTED_MIME_TYPE",
  );
});

test("rejects files larger than 25 MB", () => {
  assert.throws(
    () => validateMaterialFile(file("lesson.pdf", "application/pdf", MAX_MATERIAL_FILE_SIZE + 1)),
    (error) => error instanceof MaterialValidationError && error.statusCode === 413,
  );
});

test("rejects empty files", () => {
  assert.throws(
    () => validateMaterialFile(file("lesson.pdf", "application/pdf", 0)),
    (error) =>
      error instanceof MaterialValidationError
      && error.code === "EMPTY_FILE"
      && error.statusCode === 400,
  );
});

test("accepts only en and fil language values", () => {
  assert.equal(validateMaterialLanguage("en"), "en");
  assert.equal(validateMaterialLanguage("fil"), "fil");
  assert.equal(
    validateMaterialFields({ title: "Lesson", language: "en" })
      .language,
    "en",
  );
  assert.equal(
    validateMaterialFields({
      title: "Aralin",
      language: "fil",
    }).language,
    "fil",
  );
  assert.throws(
    () => validateMaterialFields({ title: "Lesson", language: "es" }),
    (error) => error instanceof MaterialValidationError && error.code === "UNSUPPORTED_LANGUAGE",
  );
});

test("ignores browser-supplied uploader roles", () => {
  assert.deepEqual(
    validateMaterialFields({ title: "Lesson", language: "en", uploaderRole: "admin" }),
    { title: "Lesson", language: "en" },
  );
});

test("rejects an empty title", () => {
  assert.throws(
    () => validateMaterialFields({ title: "   ", language: "en" }),
    (error) => error instanceof MaterialValidationError && error.code === "INVALID_TITLE",
  );
});

test("checks basic file signatures after upload", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "readflow-signature-"));
  const validPng = path.join(directory, "valid.png");
  const invalidPng = path.join(directory, "invalid.png");

  try {
    await fs.writeFile(
      validPng,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    await fs.writeFile(invalidPng, Buffer.from("not-png"));
    assert.equal(await validateMaterialFileSignature(validPng, "PNG"), true);
    await assert.rejects(
      validateMaterialFileSignature(invalidPng, "PNG"),
      (error) =>
        error instanceof MaterialValidationError && error.code === "INVALID_FILE_SIGNATURE",
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
