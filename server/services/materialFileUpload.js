const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const multer = require("multer");
const {
  MAX_MATERIAL_FILE_SIZE,
  validateMaterialFile,
} = require("./materialValidation");

const materialUploadDirectory = path.join(__dirname, "..", "uploads", "materials");

fs.mkdirSync(materialUploadDirectory, { recursive: true });

// M3 material uploads and Admin module-passage extraction intentionally share
// one upload boundary so format, MIME, and size rules cannot drift apart.
const materialFileUpload = multer({
  storage: multer.diskStorage({
    destination: materialUploadDirectory,
    filename: (_req, file, callback) => {
      try {
        const { extension } = validateMaterialFile(file);
        callback(null, `${randomUUID()}${extension}`);
      } catch (error) {
        callback(error);
      }
    },
  }),
  limits: {
    fieldNameSize: 100,
    fieldSize: 1024,
    fields: 3,
    fileSize: MAX_MATERIAL_FILE_SIZE,
    files: 1,
    parts: 4,
  },
  fileFilter: (_req, file, callback) => {
    try {
      validateMaterialFile(file);
      callback(null, true);
    } catch (error) {
      callback(error);
    }
  },
});

async function removeUploadedMaterialFile(file) {
  if (!file?.path) return;

  await fsPromises.unlink(file.path).catch((error) => {
    if (error.code !== "ENOENT") {
      console.error("Unable to clean up a temporary M3 upload:", error);
    }
  });
}

module.exports = {
  materialFileUpload,
  materialUploadDirectory,
  removeUploadedMaterialFile,
};
