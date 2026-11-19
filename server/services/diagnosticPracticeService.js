const {
  getActiveDiagnosticAssessment,
  getDiagnosticAssessmentBinding,
  getDiagnosticPassageText,
} = require("./diagnosticAssessments");
const {
  DIAGNOSTIC_SCORING_RULE,
  classifyDiagnosticPlacement,
  scoreDiagnostic,
} = require("./diagnosticScoring");
const { DiagnosticSubmissionError, resolveDuration, verifyReading } = require("./diagnosticResultService");

// M2 F7 Preview / Try Assessment (Practice Mode) for staff.
// Scores a staff practice attempt with the SAME server-verified reading receipts and the SAME authoritative scorer
// and classification as the official diagnostic, and returns the result. This module has no database access at all:
// it never creates diagnostic_results rows, history, placement, M7 analytics or M8 progress.
// The assessment is chosen by language + id + version, so a later versioned assessment package can be practised by
// passing its identity without changing this contract.

const finiteOrNull = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);

function createDiagnosticPracticeService({ receipts } = {}) {
  if (!receipts) throw new Error("A transcript receipt service is required.");

  function scorePractice(requester, body) {
    const userId = requester?.user?.id;
    if (!userId) throw new DiagnosticSubmissionError(403, "PRACTICE_FORBIDDEN", "Practice Mode is available to staff accounts only.");
    const language = body?.language;
    const assessment = getActiveDiagnosticAssessment(language);
    if (!assessment || assessment.contentStatus !== "active") {
      throw new DiagnosticSubmissionError(400, "INVALID_ASSESSMENT", "This assessment is not available.");
    }
    if (body.assessmentId !== assessment.id || body.assessmentVersion !== assessment.version) {
      throw new DiagnosticSubmissionError(409, "ASSESSMENT_CHANGED", "This assessment was updated. Please reload it and start again.");
    }
    const answers = body.answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers)
      || assessment.questions.some((question) => !question.choiceIds.includes(answers[question.id]))) {
      throw new DiagnosticSubmissionError(400, "INVALID_ANSWERS", "Read the story and answer every question first.");
    }

    // Same proof as the official diagnostic: transcript receipts issued by this server to THIS account for this
    // assessment. Client-supplied scores, levels and transcripts are never read.
    const binding = getDiagnosticAssessmentBinding(language, assessment.id, assessment.version);
    const reading = verifyReading({ tokens: body.transcriptReceipts, userId, language, binding, receiptService: receipts });
    const duration = resolveDuration(reading, body.recordingDurationSeconds);
    const score = scoreDiagnostic({
      assessment,
      passageText: getDiagnosticPassageText(assessment),
      transcript: reading.text,
      recordingDurationSeconds: duration.seconds,
      answers,
    });
    const placement = classifyDiagnosticPlacement(score.orvScore, score.comprehensionScore);
    const metrics = score.oralReadingMetrics;
    const questionResults = assessment.questions.map((question) => ({
      id: question.id,
      correct: score.comprehensionAnswers[question.id] === question.correctChoiceId,
    }));

    return {
      practice: true,
      saved: false,
      language,
      assessmentId: assessment.id,
      assessmentVersion: assessment.version,
      scoringRule: DIAGNOSTIC_SCORING_RULE,
      wordRecognitionScore: score.orvScore,
      comprehensionScore: score.comprehensionScore,
      wordRecognitionLevel: placement.wordRecognitionLevel,
      comprehensionLevel: placement.comprehensionLevel,
      readingLevel: placement.overallReadingLevel,
      readingSpeedWpm: finiteOrNull(score.readingSpeedWpm),
      reading: {
        totalExpectedWords: metrics.totalExpectedWords,
        correctWords: metrics.correctWords,
        substitutions: metrics.substitutions,
        omissions: metrics.omissions,
        insertions: metrics.insertions,
        titleWordsExcluded: metrics.titleWordsExcluded ?? 0,
      },
      comprehension: {
        correct: questionResults.filter((result) => result.correct).length,
        total: questionResults.length,
        // Right or wrong per question only; the answer key itself is not returned.
        questions: questionResults,
      },
    };
  }

  return { scorePractice };
}

module.exports = { createDiagnosticPracticeService };
