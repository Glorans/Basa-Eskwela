const { parentPort, workerData } = require('node:worker_threads');
const { extractReadingMaterial } = require('./materialExtractionService');
extractReadingMaterial(workerData).then(
  result => parentPort.postMessage({ result }),
  error => parentPort.postMessage({ error: { code: error.code || 'DOCUMENT_EXTRACTION_FAILED',
    message: error.code ? error.message : "We couldn't extract the reading text. Please try another file." } }),
);
