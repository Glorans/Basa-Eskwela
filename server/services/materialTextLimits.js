// Storage/extraction capacity is separate from the 30,000-character AI limit.
const MAX_MATERIAL_TEXT_LENGTH = 1_000_000;
const MATERIAL_FINALIZE_JSON_LIMIT = '8mb'; // Includes worst-case JSON escaping.
const MATERIAL_DOCUMENT_TIMEOUT_MS = 120_000;
module.exports = { MAX_MATERIAL_TEXT_LENGTH, MATERIAL_FINALIZE_JSON_LIMIT, MATERIAL_DOCUMENT_TIMEOUT_MS };
