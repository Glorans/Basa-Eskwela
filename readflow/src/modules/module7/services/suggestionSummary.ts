// M7 F10, System Admin summary: display helpers only (no counting). The backend gives each learner exactly one of
// noData / withSuggestion (= withRepeated + preliminaryOnly) / moreDataNeeded / onTrack; `improving` is a separate
// flag that overlaps those groups, so it is never shown as one of the four cards.
import type { SuggestionGroupCounts } from './m7Service';

/** The four mutually exclusive learner categories; their values add up to `learners`. */
export function suggestionCategoryCards(group: SuggestionGroupCounts): [string, number][] {
  return [
    ['Repeated learning difficulty', group.withRepeated],
    ['Preliminary observations only', group.preliminaryOnly],
    ['More data needed or no results yet', group.moreDataNeeded + group.noData],
    ['On track', group.onTrack],
  ];
}

/** The overlapping progress indicator shown below the cards. */
export function improvingNote(improving: number): string {
  if (!improving) return 'No learners currently improving after earlier results below the benchmark.';
  return `${improving} ${improving === 1 ? 'learner' : 'learners'} improving (keep monitoring). ${improving === 1 ? 'This learner is' : 'These learners are'} also counted in the categories above.`;
}
