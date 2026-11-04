// Presentation only. The database (m3_collection_publish_issues and the publish
// trigger) stays the authority: every issue it returns still blocks publication.
// Its two validation layers report the same gap twice ("needs at least 2 literal
// questions" and "requires exactly two literal questions"); they are merged here.
// Once 6/9/12 banks are installed the database words these as "requires 6, 9 or 12
// questions" and "requires exactly 3 literal questions"; both wordings are understood,
// and the allowed sizes are taken from the database's own message.
import { SIX_ONLY, describeBankRequirement, numberWord } from "./passageBankSize.ts";

const QUESTION_TYPES = ["literal", "inferential", "critical"] as const;
type QuestionType = (typeof QUESTION_TYPES)[number];

export interface PassagePublishIssues {
  passage: number;
  messages: string[];
}

export interface GroupedPublishIssues {
  module: string[];
  passages: PassagePublishIssues[];
}

const KNOWN: Array<[RegExp, string]> = [
  [/^needs a title$/i, "Add a passage title."],
  [/^needs reading text$/i, "Add the passage text."],
  [/^has questions that need review$/i, "Review and save the question bank."],
  [/^has missing or invalid answer keys$/i, "Fix the missing or invalid answer keys."],
];

function listTypes(types: QuestionType[]) {
  return types.length > 1
    ? `${types.slice(0, -1).join(", ")} and ${types[types.length - 1]}`
    : types[0];
}

export function groupPublishIssues(issues: readonly string[]): GroupedPublishIssues {
  const module: string[] = [];
  type Entry = { noBank: boolean; wrongSize: boolean; types: Set<QuestionType>; exact?: number; legacy: boolean; messages: string[] };
  const passages = new Map<number, Entry>();
  let sizes: readonly number[] = SIX_ONLY;

  for (const raw of issues.flatMap((issue) => issue.split(/;\s*/))) {
    const issue = raw.trim().replace(/\.$/, "");
    if (!issue) continue;
    const match = /^Passage (\d+) (.+)$/i.exec(issue);
    if (!match) {
      if (!module.includes(issue)) module.push(issue);
      continue;
    }
    const number = Number(match[1]);
    const detail = match[2];
    const entry: Entry = passages.get(number) ?? { noBank: false, wrongSize: false, types: new Set<QuestionType>(), legacy: false, messages: [] };
    passages.set(number, entry);

    const typeMatch = /^(?:needs at least \d+|requires exactly (two|\d+)) (literal|inferential|critical) questions$/i.exec(detail);
    const sizeMatch = /^requires ((?:\d+, )*\d+ or \d+) questions$/i.exec(detail);
    if (typeMatch) {
      entry.types.add(typeMatch[2].toLowerCase() as QuestionType);
      if (typeMatch[1]?.toLowerCase() === "two") entry.legacy = true;
      else if (typeMatch[1]) entry.exact = Number(typeMatch[1]);
    } else if (sizeMatch) {
      entry.wrongSize = true;
      sizes = sizeMatch[1].split(/, | or /).map(Number);
    } else if (/^has no reviewed comprehension questions$/i.test(detail)) {
      entry.noBank = true;
    } else {
      const text = KNOWN.find(([pattern]) => pattern.test(detail))?.[1] ?? `${detail.charAt(0).toUpperCase()}${detail.slice(1)}.`;
      if (!entry.messages.includes(text)) entry.messages.push(text);
    }
  }

  return {
    module,
    passages: [...passages.entries()]
      .sort(([a], [b]) => a - b)
      .map(([passage, entry]) => {
        const messages = [...entry.messages];
        const types = QUESTION_TYPES.filter((type) => entry.types.has(type));
        if (entry.noBank) {
          messages.unshift(`No question bank yet. Generate and review ${describeBankRequirement(sizes)}.`);
        } else if (entry.wrongSize) {
          messages.unshift(`Regenerate this question bank with ${describeBankRequirement(sizes)}.`);
        } else if (types.length && entry.exact && !entry.legacy) {
          const n = entry.exact;
          messages.unshift(`Needs exactly ${numberWord(n)} ${listTypes(types)} questions (this ${n * 3}-question bank needs ${n} literal, ${n} inferential and ${n} critical).`);
        } else if (types.length) {
          messages.unshift(`Needs exactly two ${listTypes(types)} questions (each passage needs 2 literal, 2 inferential and 2 critical).`);
        }
        return { passage, messages };
      }),
  };
}

export function formatPublishIssues(issues: readonly string[]): string {
  const { module, passages } = groupPublishIssues(issues);
  const lines = ["This module cannot be published yet."];
  if (module.length) lines.push("", "Module:", ...module.map((issue) => `• ${issue}.`));
  for (const { passage, messages } of passages) {
    lines.push("", `Passage ${passage}:`, ...messages.map((message) => `• ${message}`));
  }
  return lines.join("\n");
}
