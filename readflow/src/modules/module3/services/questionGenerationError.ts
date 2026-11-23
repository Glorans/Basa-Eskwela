export const QUESTION_GENERATION_FAILURE = "We couldn't generate a new question set. Please try again.";

const SAFE_MESSAGES = new Set([
 "Five new question sets are allowed per rolling 24 hours. Reuse a saved set or try later",
 "A generation is already running. Please wait",
 "Review and confirm the extracted text before practice",
 "This material has no usable reviewed text.",
 "This material exceeds the 30,000-character question-generation limit.",
 "Question generation is limited to 30,000 characters",
 "The material changed. Review it and generate again.",
 "Enter at least 6 questions.",
 "Use a multiple of 3 so the questions divide equally into Literal, Inferential, and Critical.",
 "Enter at most 12 questions. That is the most the question generator supports.",
 "Enter a whole number of questions, such as 6, 9 or 12.",
 "Choosing a number other than 9 needs a database update (m3_all_role_refinement) that is not installed yet. Choose 9 questions.",
 "Reviewed material text is required before generating questions.",
 "Reviewed material text must be 30,000 characters or fewer.",
 "Choose English or Filipino as the material language.",
 "Choose 3, 6, 9 or 12 questions.",
 "This question set is assigned to a class activity. Remove the assignment first.",
 "Students have already answered this question set in a class activity, so it cannot be changed. Generate a new set instead.",
 // Saved question sets (Teacher/Admin): app-authored instructions where "try again" alone would not help.
 "This question set changed. Reload it before regenerating.",
 "Reload the question set before changing it.",
 "Completed reviewed material text is required before generating questions.",
 "The saved material language must be English or Filipino before generating questions.",
 // Private questions (Independent Learner): database refusals that tell the learner what to do.
 "The text changed. Review it again",
 "Generation expired or the material changed. Please retry",
 "This material already has an assessment. Use its saved questions and result",
 "Personal practice has started. Upload a corrected copy; saved practice remains unchanged",
 "Material is used by a module",
 // New questions for the same text (personal_material_3).
 "There are no questions to replace yet",
 "Getting new questions is not available yet.",
]);

export function getQuestionGenerationError(error: unknown): string {
 const response = (error as { response?: { status?: number; data?: { message?: unknown } } } | null)?.response;
 const message = response?.data?.message;
 if (typeof message === "string" && SAFE_MESSAGES.has(message)) return message;
 if (response?.status === 429) return "The question-generation limit has been reached. Please wait before trying again. Your saved questions are still available.";
 if (response?.status === 401) return "Please sign in again before generating questions.";
 if (response?.status === 403 || response?.status === 404) return "This material or question set is unavailable to your account. Return to Reading Materials.";
 if (response?.status === 413) return "Use reviewed text with 30,000 characters or fewer, then try again.";
 return QUESTION_GENERATION_FAILURE;
}
