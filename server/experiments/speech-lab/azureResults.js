"use strict";
const { LabError } = require("./contracts");
function azureError(sdk, event) {
  const code = event?.errorCode;
  if (code === sdk.CancellationErrorCode?.AuthenticationFailure) return new LabError("AZURE_AUTH", "Azure authentication failed. Check the dedicated lab configuration.", 502);
  if (code === sdk.CancellationErrorCode?.TooManyRequests || code === sdk.CancellationErrorCode?.Forbidden) return new LabError("AZURE_QUOTA", "Azure rejected the request due to quota, capacity, or access limits. No retry was made.", 429);
  return new LabError("AZURE_SERVICE", "Azure could not complete this operation. No automatic retry was made.", 502);
}
const score = value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
function assessmentSegment(sdk, result) {
  const assessment = sdk.PronunciationAssessmentResult.fromResult(result);
  const details = assessment.detailResult;
  const words = details?.Words || [];
  if (!Array.isArray(words) || words.length > 5000) throw new LabError("AZURE_RESULT", "Azure returned an invalid assessment result.", 502);
  return {
    text: typeof result.text === "string" ? result.text.slice(0, 20000) : "",
    scores: { accuracy: score(assessment.accuracyScore), fluency: score(assessment.fluencyScore) },
    words: words.map(word => ({ word: typeof word.Word === "string" ? word.Word.slice(0, 500) : "", accuracy: score(word.PronunciationAssessment?.AccuracyScore), errorType: ["None", "Mispronunciation", "Omission", "Insertion"].includes(word.PronunciationAssessment?.ErrorType) ? word.PronunciationAssessment.ErrorType : null, offsetTicks: Number.isSafeInteger(word.Offset) ? word.Offset : null, durationTicks: Number.isSafeInteger(word.Duration) ? word.Duration : null })),
  };
}
module.exports = { azureError, assessmentSegment };
