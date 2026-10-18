const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { extractReadingMaterial, MaterialExtractionError } = require('./materialExtractionService');
const { MAX_MATERIAL_TEXT_LENGTH, MATERIAL_DOCUMENT_TIMEOUT_MS } = require('./materialTextLimits');

async function extractTeacherMaterial(input, { timeoutMs = MATERIAL_DOCUMENT_TIMEOUT_MS } = {}) {
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
