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
// Models ship as npm dependencies (@tesseract.js-data/*), so a fresh server needs no
// download. The CDN copy of the tessdata repository is refused (files over 20 MB).
// tgl is only published as the 4.0.0 model; eng uses the smaller LSTM-only best_int model.
const OCR_MODEL_DIRECTORIES = Object.freeze({
  eng: { packageName: "@tesseract.js-data/eng", directory: "4.0.0_best_int" },
  tgl: { packageName: "@tesseract.js-data/tgl", directory: "4.0.0" },
});
const OCR_WORKER_START_TIMEOUT_MS = 60_000;
const OCR_RECOGNIZE_TIMEOUT_MS = 120_000;
const OCR_UNAVAILABLE_MESSAGE =
  "Image text extraction is unavailable right now. Please try again later, or upload a text-based PDF or DOCX.";

class MaterialOcrError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "MaterialOcrError";
    this.code = code;
  }
}

let workerPromise;

function ocrWorkerErrorHandler(error) {
  // Bounded, payload-free log line; the failed recognize() call reports the error to the uploader.
  console.error("OCR worker job failed:", String(error?.message ?? error ?? "").slice(0, 120));
}
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

function getOcrModelPath(ocrLanguage) {
  const model = OCR_MODEL_DIRECTORIES[ocrLanguage];

  try {
    const packageDirectory = path.dirname(require.resolve(`${model.packageName}/package.json`));
    return path.join(packageDirectory, model.directory);
  } catch (error) {
    throw new MaterialOcrError("OCR_UNAVAILABLE", OCR_UNAVAILABLE_MESSAGE, error);
  }
}

function withTimeout(promise, timeoutMs, onTimeout) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function getWorker(ocrLanguage) {
  // Each language loads from its own package directory, so switching languages
  // starts a new worker instead of reinitializing the current one.
  if (workerPromise && activeOcrLanguage !== ocrLanguage) {
    await resetOcrWorkerAfterFailure();
  }

  if (!workerPromise) {
    const startingWorker = createWorker(ocrLanguage, OEM.LSTM_ONLY, {
      cacheMethod: "none",
      gzip: true,
      langPath: getOcrModelPath(ocrLanguage),
      // Without a handler tesseract.js rethrows a failed job (for example an unreadable image) as an uncaught
      // exception, which stops the whole backend. The job's own promise is still rejected and handled below.
      errorHandler: ocrWorkerErrorHandler,
    });
    workerPromise = startingWorker;
    activeOcrLanguage = ocrLanguage;

    try {
      return await withTimeout(startingWorker, OCR_WORKER_START_TIMEOUT_MS, () =>
        new MaterialOcrError("OCR_UNAVAILABLE", OCR_UNAVAILABLE_MESSAGE));
    } catch (error) {
      workerPromise = undefined;
      activeOcrLanguage = undefined;
      // A worker that finishes starting after the timeout is not left running.
      startingWorker.then((worker) => worker.terminate()).catch(() => undefined);
      throw error instanceof MaterialOcrError
        ? error
        : new MaterialOcrError("OCR_UNAVAILABLE", OCR_UNAVAILABLE_MESSAGE, error);
    }
  }

  return workerPromise;
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
      const result = await withTimeout(worker.recognize(filePath), OCR_RECOGNIZE_TIMEOUT_MS, () =>
        new MaterialOcrError("OCR_TIMEOUT", "Image text extraction took too long. Try a smaller or clearer image."));
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
        // A timed-out worker may still be busy, so it is replaced before the next image.
        if (error.code === "OCR_TIMEOUT") await resetOcrWorkerAfterFailure();
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
  ocrWorkerErrorHandler,
  OCR_LANGUAGE_MAP,
  extractImageText,
  getOcrLanguage,
  getOcrModelPath,
  terminateOcrWorker,
};
