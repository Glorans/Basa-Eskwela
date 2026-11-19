/** M2 F8: where each learner's reassessment list and history live, and the full-screen reading flow. */
export const STUDENT_REASSESSMENTS_PATH = "/dashboard/reassessments";
export const INDEPENDENT_REASSESSMENTS_PATH = "/m3/general/reassessments";
export const REASSESSMENT_FLOW_PATH = "/reassessments";
/** Students take classroom reassessments; Independent Learners take their own self-started ones. */
export const REASSESSMENT_LEARNER_ROLES = ["student", "general_user"] as const;

export type ReassessmentAudience = "student" | "independent";

export const reassessmentListPath = (audience: ReassessmentAudience) =>
  (audience === "independent" ? INDEPENDENT_REASSESSMENTS_PATH : STUDENT_REASSESSMENTS_PATH);
export const assessmentHistoryPath = (audience: ReassessmentAudience) =>
  (audience === "independent" ? "/m3/general/assessment-history" : "/dashboard/assessment-history");
/** Separate draft namespaces: Student and Independent Learner reassessment drafts never mix (nor with the others). */
export const reassessmentDraftNamespace = (audience: ReassessmentAudience) =>
  (audience === "independent" ? "m2-reassessment-independent" as const : "m2-reassessment" as const);
