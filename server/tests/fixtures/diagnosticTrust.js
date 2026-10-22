// Synthetic M2 trust fixtures. Never reads Supabase or Google credentials.
const { createTranscriptReceiptService } = require("../../services/diagnosticTranscriptReceipts");

const TEST_RECEIPT_SECRET = "test-only-diagnostic-receipt-secret-0123456789";

function testReceipts(options = {}) {
  return createTranscriptReceiptService({ getSecret: () => TEST_RECEIPT_SECRET, ...options });
}

module.exports = { TEST_RECEIPT_SECRET, testReceipts };
