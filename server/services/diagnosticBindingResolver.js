// Which M2 assessment a diagnostic recording belongs to, for the speech stream and the upload fallback.
//   * Staff (F7 Practice Mode): the code-defined version, exactly the existing synchronous check.
//   * Learners' initial diagnostic: the version the server accepts now (active, or replaced < 24 h ago), F6.
//     Without the activation migration this is exactly the code-defined check as well.
//   * "m2-package-version:<id>" ids (F8 reassessment): the assigned Student only, through the delivery service,
//     which re-checks the assignment, gate, room, enrollment and version on every recording.
//   * "m2-practice-version:<id>" ids (F7 version practice): staff who may view that authored Initial Diagnostic
//     version, while it is published (or the version learners take), through the practice version service.
// Anything else yields null, and the speech paths then refuse to issue a receipt.
const { getDiagnosticAssessmentBinding } = require("./diagnosticAssessments");
const { isReassessmentAssessmentId } = require("./reassessmentDeliveryService");
const { createCodeOnlyInitialDiagnostics } = require("./initialDiagnosticService");
const { isPracticeVersionAssessmentId } = require("./practiceVersionService");

const STAFF_ROLES = new Set(["system_admin", "admin", "teacher"]);

function createDiagnosticBindingResolver({ getReassessments, initialAssessments = createCodeOnlyInitialDiagnostics(),
  getPracticeVersions = () => require("./practiceVersionService").createPracticeVersionService() } = {}) {
  let practiceVersions = null;
  let reassessments = null;
  const delivery = () => {
    if (!reassessments) {
      reassessments = getReassessments ? getReassessments() : (() => {
        const { createReassessmentDeliveryService } = require("./reassessmentDeliveryService");
        const { createSupabaseReassessmentDeliveryRepository } = require("./reassessmentDeliveryRepository");
        return createReassessmentDeliveryService({ repository: createSupabaseReassessmentDeliveryRepository() });
      })();
    }
    return reassessments;
  };
  return async function resolveBinding({ requester, language, assessmentId, assessmentVersion }) {
    if (isReassessmentAssessmentId(assessmentId)) {
      return delivery().resolveBinding({ requester, language, assessmentId, assessmentVersion });
    }
    if (isPracticeVersionAssessmentId(assessmentId)) {
      if (!STAFF_ROLES.has(requester?.profile?.role)) return null;
      practiceVersions ??= getPracticeVersions();
      return practiceVersions.resolveBinding({ requester, language, assessmentId, assessmentVersion });
    }
    if (STAFF_ROLES.has(requester?.profile?.role)) return getDiagnosticAssessmentBinding(language, assessmentId, assessmentVersion);
    const assessment = await initialAssessments.resolve(language, assessmentId, assessmentVersion);
    return assessment ? initialAssessments.binding(assessment) : null;
  };
}

module.exports = { createDiagnosticBindingResolver };
