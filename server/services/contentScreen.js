/**
 * Preliminary content screen (m3_content_screen_v1). The rules live in the database (public.content_screen_findings)
 * and are ENFORCED there by triggers on every learner-facing write, so direct Supabase writes cannot skip them.
 * This module only (1) turns the database refusal (PT422, hint CONTENT_SCREEN) into a 422 with its safe message and
 * (2) asks the same database function for an early, advisory warning right after a file is extracted.
 * Messages name categories and line numbers only, never the matched words or personal details.
 */
const FALLBACK_MESSAGE = "Content check: this text may not be suitable for young learners. Please review and edit it before saving.";

const CATEGORY_LABELS = Object.freeze({
  strong_language: "strong language",
  sexual_content: "sexual content",
  hateful_language: "hateful language",
  self_harm_or_threat: "self-harm or threats",
  graphic_violence: "graphic violence",
  personal_information: "personal information such as a phone number, e-mail address or ID number",
  web_link: "a web link",
});

class ContentScreenError extends Error {
  constructor(message = FALLBACK_MESSAGE) {
    super(message);
    this.name = "ContentScreenError";
    this.statusCode = 422;
    this.code = "CONTENT_SCREEN";
  }
}

function isContentScreenError(error) {
  return Boolean(error) && (error.code === "PT422" || error.hint === "CONTENT_SCREEN");
}

/** The database message is built only from fixed category labels and line numbers; anything else gets the fallback. */
function contentScreenMessage(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  return message.startsWith("Content check:") && message.length <= 600 ? message : FALLBACK_MESSAGE;
}

function throwIfContentScreen(error) {
  if (isContentScreenError(error)) throw new ContentScreenError(contentScreenMessage(error));
}

/**
 * Advisory screen of extracted text (the database still decides when the text is saved).
 * Returns { checked: false } when the screen is not installed or unavailable; never throws.
 */
async function screenText(supabase, text) {
  if (typeof text !== "string" || !text.trim() || !supabase?.rpc) return { checked: false };
  try {
    const { data, error } = await supabase.rpc("content_screen_findings", { p_text: text });
    if (error || !Array.isArray(data)) return { checked: false };
    const categories = [...new Set(data.map((row) => row.category).filter((c) => CATEGORY_LABELS[c]))];
    return {
      checked: true,
      flagged: categories.length > 0,
      categories: categories.map((c) => CATEGORY_LABELS[c]),
      firstLine: categories.length ? Math.min(...data.map((row) => Number(row.paragraph) || 1)) : null,
    };
  } catch {
    return { checked: false };
  }
}

module.exports = { CATEGORY_LABELS, ContentScreenError, contentScreenMessage, isContentScreenError, screenText, throwIfContentScreen };
