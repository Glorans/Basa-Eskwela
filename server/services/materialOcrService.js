const fs = require("fs");
const path = require("path");
const { createWorker, OEM } = require("tesseract.js");
const {
  hasReadableText,
  normalizeExtractedText,
} = require("./materialTextNormalization");

const OCR_LANGUAGE_MAP = Object.freeze({
  en: "eng",
  fil: "tgl",
});
const OCR_LANGUAGE_DATA_URL =
  "https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata@main";
const ocrCachePath = path.join(__dirname, "..", "uploads", "ocr-cache");

fs.mkdirSync(ocrCachePath, { recursive: true });

class MaterialOcrError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "MaterialOcrError";
    this.code = code;
  }
}

let workerPromise;
let activeOcrLanguage;
let ocrQueue = Promise.resolve();

function getOcrLanguage(applicationLanguage) {
  const ocrLanguage = OCR_LANGUAGE_MAP[applicationLanguage];

  if (!ocrLanguage) {
    throw new MaterialOcrError(
      "UNSUPPORTED_OCR_LANGUAGE",
      "The selected language is not supported for image text extraction.",
    );
  }

  return ocrLanguage;
}

async function getWorker(ocrLanguage) {
  if (!workerPromise) {
    workerPromise = createWorker(ocrLanguage, OEM.LSTM_ONLY, {
      cachePath: ocrCachePath,
      gzip: false,
      langPath: OCR_LANGUAGE_DATA_URL,
    });

    try {
      const worker = await workerPromise;
      activeOcrLanguage = ocrLanguage;
      return worker;
    } catch (error) {
      workerPromise = undefined;
      activeOcrLanguage = undefined;
      throw error;
    }
  }

  const worker = await workerPromise;

  if (activeOcrLanguage !== ocrLanguage) {
    await worker.reinitialize(ocrLanguage, OEM.LSTM_ONLY);
    activeOcrLanguage = ocrLanguage;
  }

  return worker;
}

function serializeOcrJob(job) {
  const queuedJob = ocrQueue.then(job, job);
  ocrQueue = queuedJob.catch(() => undefined);
  return queuedJob;
}

async function resetOcrWorkerAfterFailure() {
  const failedWorkerPromise = workerPromise;
  workerPromise = undefined;
  activeOcrLanguage = undefined;

  if (!failedWorkerPromise) {
    return;
  }

  const failedWorker = await failedWorkerPromise.catch(() => undefined);
  if (failedWorker) {
    await failedWorker.terminate().catch(() => undefined);
  }
}

async function extractImageText({ filePath, language }) {
  const ocrLanguage = getOcrLanguage(language);

  return serializeOcrJob(async () => {
    try {
      const worker = await getWorker(ocrLanguage);
      const result = await worker.recognize(filePath);
      const extractedText = normalizeExtractedText(result.data.text);

      if (!hasReadableText(extractedText)) {
        throw new MaterialOcrError(
          "EMPTY_OCR_TEXT",
          "No readable text was detected. Try a clearer image.",
        );
      }

      return {
        extractedText,
        ocrConfidence: Number.isFinite(result.data.confidence)
          ? Math.round(result.data.confidence * 10) / 10
          : null,
      };
    } catch (error) {
      if (error instanceof MaterialOcrError) {
        throw error;
      }

      await resetOcrWorkerAfterFailure();

      throw new MaterialOcrError(
        "OCR_PROCESSING_FAILED",
        "The image could not be processed for text. Try a valid, clearer image.",
        error,
      );
    }
  });
}

async function terminateOcrWorker() {
  await ocrQueue.catch(() => undefined);

  if (!workerPromise) {
    return;
  }

  const worker = await workerPromise.catch(() => undefined);
  workerPromise = undefined;
  activeOcrLanguage = undefined;

  if (worker) {
    await worker.terminate();
  }
}

module.exports = {
  MaterialOcrError,
  OCR_LANGUAGE_MAP,
  OCR_LANGUAGE_DATA_URL,
  extractImageText,
  getOcrLanguage,
  ocrCachePath,
  terminateOcrWorker,
};
