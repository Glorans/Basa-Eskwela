import type { PackageContent } from "./assessmentPackages";

export const passageToText = (paragraphs: string[]) => paragraphs.join("\n\n");

/** Keep untouched legacy arrays byte-for-byte. Exactly two newlines separate paragraphs.
 * Longer blank-line runs remain within an entry, so neither empty paragraphs nor lost spacing are introduced. */
export function textToPassage(text: string, original: string[] = []): string[] {
  if (text === passageToText(original)) return [...original];
  // Blank lines at the very start or end are not paragraphs.
  return text.replace(/\r\n?/g, "\n").replace(/^\s+|\s+$/g, "").split(/(?<!\n)\n{2}(?!\n)/).map(p => p.trim());
}

/**
 * The EXISTING passage limits, unchanged (verified 2026-11-20):
 *   20–600 words and 1–10 paragraphs: database rule m2_assessment_content_issues() when a version is published;
 *   10 paragraphs and 3,000 characters per paragraph: the server refuses to SAVE a draft beyond them (LIMITS).
 * Words are counted like the database: whitespace-separated, across all paragraphs.
 */
export const PASSAGE_LIMITS = Object.freeze({ minWords: 20, maxWords: 600, maxParagraphs: 10, maxParagraphChars: 3000 });

const fmt = (n: number) => n.toLocaleString("en-US");

export interface PassageStats {
  words: number;
  paragraphs: number;
  wordState: "below" | "ok" | "over";
  /** Problems the server would refuse when SAVING the draft (paragraph count or length). */
  saveIssues: string[];
  /** Every passage-length problem, in plain words (also listed before publishing). */
  issues: string[];
}

/** Live counts and messages for the complete-story editor. Nothing is ever cut or removed. */
export function passageStats(paragraphs: string[]): PassageStats {
  const filled = paragraphs.filter((p) => p.trim());
  const words = paragraphs.join(" ").trim().split(/\s+/).filter(Boolean).length;
  const { minWords, maxWords, maxParagraphs, maxParagraphChars } = PASSAGE_LIMITS;
  const wordState = words < minWords ? "below" : words > maxWords ? "over" : "ok";
  const saveIssues: string[] = [];
  if (filled.length > maxParagraphs) {
    saveIssues.push(`The reading passage can have at most ${maxParagraphs} paragraphs (now ${filled.length}). Remove a blank line to join paragraphs.`);
  }
  paragraphs.forEach((p, i) => {
    if (p.length > maxParagraphChars) {
      saveIssues.push(`Paragraph ${i + 1} has ${fmt(p.length)} characters; a paragraph can have at most ${fmt(maxParagraphChars)}. Add a blank line to split it.`);
    }
  });
  const issues = [
    ...(wordState === "below" ? [`The reading passage must contain at least ${minWords} words.`] : []),
    ...(wordState === "over" ? [`The reading passage cannot exceed ${maxWords} words.`] : []),
    ...(!filled.length ? ["Add the reading passage."] : []),
    ...saveIssues,
  ];
  return { words, paragraphs: filled.length, wordState, saveIssues, issues };
}

export function assessmentRequirements(content: PackageContent): string[] {
  const issues: string[] = [];
  if (!content.passageTitle.trim()) issues.push("Add a passage title.");
  issues.push(...passageStats(content.paragraphs).issues);
  if (content.paragraphs.some(p => !p.trim()) && content.paragraphs.some(p => p.trim())) issues.push("Complete the reading passage; paragraphs cannot be empty.");
  if (content.questions.length < 5 || content.questions.length > 8) issues.push("Include 5–8 comprehension questions.");
  for (const type of ["literal", "inferential", "critical"]) {
    if (!content.questions.some(q => q.type === type)) issues.push(`Include at least one ${type} question.`);
  }
  content.questions.forEach((q, i) => {
    if (!q.type) issues.push(`Question ${i + 1}: choose a type.`);
    if (!q.prompt.trim()) issues.push(`Question ${i + 1}: add question text.`);
    if (q.choices.length !== 4 || q.choices.some(c => !c.label.trim())) issues.push(`Question ${i + 1}: complete all four choices.`);
    if (!q.correctChoiceId || !q.choices.some(c => c.id === q.correctChoiceId)) issues.push(`Question ${i + 1}: choose one correct answer.`);
  });
  return issues;
}
