const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { extractReadingMaterial, MaterialExtractionError } = require('./materialExtractionService');
const { detectMaterialLanguage } = require('./materialLanguageDetection');
const { MAX_MATERIAL_TEXT_LENGTH, MATERIAL_DOCUMENT_TIMEOUT_MS } = require('./materialTextLimits');

const isImage = fileType => fileType === 'JPG' || fileType === 'PNG';

/**
 * Extracts the text and decides its language. An explicit language (older clients)
 * is used as before. Without one, documents are detected from their text; images are
 * read once with the English model and, only when that text leans Filipino, read again
 * with the Tagalog model for better accuracy. At most two OCR passes run, one at a
 * time, using the installed models. Uncertain text is never labelled English.
 */
async function extractTeacherMaterial(input, options = {}) {
  const extract = options.extract ?? extractMaterialText;
  if (input.language) {
    const result = await extract(input, options);
    return { ...result, language: input.language, languageDetection: null };
  }

  let result = await extract({ ...input, language: isImage(input.fileType) ? 'en' : undefined }, options);
  let detection = detectMaterialLanguage(result.extractedText);

  // Imperfect Filipino images can read poorly with the English model, so any lean towards
  // Filipino (not only a certain result) earns the single Tagalog pass.
  if (isImage(input.fileType) && detection.scores.fil > detection.scores.en) {
    const tagalog = await extract({ ...input, language: 'fil' }, options);
    const confirmed = detectMaterialLanguage(tagalog.extractedText);
    if (confirmed.language === 'fil') {
      result = tagalog;
      detection = confirmed;
    } else if (detection.language === 'fil') {
      // The Tagalog reading is kept; if it no longer looks clearly Filipino the teacher decides.
      result = tagalog;
      detection = { ...confirmed, language: null, certain: false, reason: 'mixed', suggestedLanguage: 'fil' };
    } else if ((tagalog.ocrConfidence ?? 0) > (result.ocrConfidence ?? 0)) {
      // Neither reading is clearly Filipino: keep the clearer one and never claim a language.
      result = tagalog;
      detection = { ...confirmed, language: null, certain: false, reason: confirmed.reason === 'clear' ? 'mixed' : confirmed.reason };
    }
  }

  return { ...result, language: detection.language, languageDetection: detection };
}

async function extractMaterialText(input, { timeoutMs = MATERIAL_DOCUMENT_TIMEOUT_MS } = {}) {
  const result = ['PDF', 'DOCX'].includes(input.fileType)
    ? await new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, 'materialDocumentWorker.js'), { workerData: { ...input, maxPages: 5 } });
      let settled = false;
      const finish = async (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        await worker.terminate();
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => void finish(new MaterialExtractionError('EXTRACTION_TIMEOUT',
        'Text extraction took too long. Please try a smaller or simpler document.')), timeoutMs);
      worker.once('message', message => void finish(message.error
        ? new MaterialExtractionError(message.error.code, message.error.message) : null, message.result));
      worker.once('error', () => void finish(new MaterialExtractionError('DOCUMENT_EXTRACTION_FAILED',
        "We couldn't extract the reading text. Please try another file.")));
      worker.once('exit', () => { if (!settled) void finish(new MaterialExtractionError('DOCUMENT_EXTRACTION_FAILED',
        "We couldn't extract the reading text. Please try another file.")); });
    })
    : await extractReadingMaterial(input);
  if (result.extractedText.length > MAX_MATERIAL_TEXT_LENGTH) {
    throw new MaterialExtractionError('MATERIAL_TEXT_TOO_LONG',
      'This document exceeds the 1,000,000-character extracted-text limit. Please split it into smaller reading materials. No text was saved or truncated.');
  }
  return result;
}
module.exports = { extractTeacherMaterial };
