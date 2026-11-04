// Passage question-bank sizes. Six is the default and the only size the app offers until
// the database reports support for more through m3_passage_bank_sizes() (see
// supabase/proposed/m3_variable_passage_banks_PROPOSED.sql). Every size is split equally
// into literal, inferential and critical questions.

export const DEFAULT_PASSAGE_BANK_SIZE = 6;
export const SUPPORTED_PASSAGE_BANK_SIZES = [6, 9, 12] as const;
export const SIX_ONLY: readonly number[] = [DEFAULT_PASSAGE_BANK_SIZE];

const CATEGORIES = ["literal", "inferential", "critical"] as const;

/** Sizes the database reported, limited to ones this app understands. Anything unexpected means six only. */
export function parsePassageBankSizes(value: unknown): readonly number[] {
  if (!Array.isArray(value)) return SIX_ONLY;
  const sizes = SUPPORTED_PASSAGE_BANK_SIZES.filter((size) => value.includes(size));
  return sizes.includes(DEFAULT_PASSAGE_BANK_SIZE) ? sizes : SIX_ONLY;
}

export function isBalancedBank(
  questions: readonly { type: string }[],
  sizes: readonly number[] = SIX_ONLY,
): boolean {
  const total = questions.length;
  return sizes.includes(total)
    && CATEGORIES.every((category) => questions.filter((question) => question.type === category).length === total / 3);
}

/** The size a passage is working towards: its saved bank if that is a valid size, otherwise the default. */
export function targetBankSize(questionCount: number, sizes: readonly number[] = SIX_ONLY): number {
  return sizes.includes(questionCount) ? questionCount : DEFAULT_PASSAGE_BANK_SIZE;
}

export function bankSizeOptionLabel(size: number): string {
  const each = size / 3;
  return `${size} questions (${each} Literal, ${each} Inferential, ${each} Critical)`;
}

const WORDS: Record<number, string> = { 2: "two", 3: "three", 4: "four", 6: "six", 9: "nine", 12: "twelve" };

/** "six questions: 2 literal, 2 inferential and 2 critical", or the 6/9/12 wording when more sizes are available. */
export function describeBankRequirement(sizes: readonly number[] = SIX_ONLY): string {
  if (sizes.length === 1) {
    const each = sizes[0] / 3;
    return `${WORDS[sizes[0]] ?? sizes[0]} questions: ${each} literal, ${each} inferential and ${each} critical`;
  }
  return `${sizes.slice(0, -1).join(", ")} or ${sizes[sizes.length - 1]} questions, with equal numbers of literal, inferential and critical questions`;
}

export function numberWord(value: number): string {
  return WORDS[value] ?? String(value);
}
