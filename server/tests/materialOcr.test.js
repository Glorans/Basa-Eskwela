const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createCanvas } = require("@napi-rs/canvas");
const {
  MaterialOcrError,
  OCR_LANGUAGE_MAP,
  extractImageText,
  terminateOcrWorker,
} = require("../services/materialOcrService");

function createTextImage(text, format) {
  const canvas = createCanvas(1100, 300);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "black";
  context.font = "bold 84px Arial";
  context.fillText(text, 60, 180);
  return canvas.toBuffer(format);
}

async function withFixture(extension, buffer, callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "readflow-ocr-"));
  const filePath = path.join(directory, `fixture.${extension}`);

  try {
    await fs.writeFile(filePath, buffer);
    return await callback(filePath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test.after(async () => {
  await terminateOcrWorker();
});

test("maps application languages to explicit Tesseract models", () => {
  assert.deepEqual(OCR_LANGUAGE_MAP, { en: "eng", fil: "tgl" });
});

test("extracts readable English text and confidence from PNG", async () => {
  const result = await withFixture(
    "png",
    createTextImage("READFLOW LEARNING", "image/png"),
    (filePath) => extractImageText({ filePath, language: "en" }),
  );

  assert.match(result.extractedText, /READFLOW LEARNING/i);
  assert.equal(typeof result.ocrConfidence, "number");
});

test("extracts readable English text from JPG", async () => {
  const result = await withFixture(
    "jpg",
    createTextImage("BRIGHT READING", "image/jpeg"),
    (filePath) => extractImageText({ filePath, language: "en" }),
  );

  assert.match(result.extractedText, /BRIGHT READING/i);
});

test("returns a safe empty-text failure for a blank image", async () => {
  const canvas = createCanvas(500, 200);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);

  await assert.rejects(
    withFixture("png", canvas.toBuffer("image/png"), (filePath) =>
      extractImageText({ filePath, language: "en" }),
    ),
    (error) => error instanceof MaterialOcrError && error.code === "EMPTY_OCR_TEXT",
  );
});

test("uses the Tagalog model for a simple Filipino phrase", async () => {
  const result = await withFixture(
    "png",
    createTextImage("MAGANDANG ARAW", "image/png"),
    (filePath) => extractImageText({ filePath, language: "fil" }),
  );

  assert.match(result.extractedText, /MAGANDANG/i);
  assert.match(result.extractedText, /ARAW/i);
});
