// M7 F10: Provide Suggested Intervention. Shows the server's rule-based suggestions for one Student with the saved
// evidence behind each one. Display only: choosing a suggestion opens the intervention form; nothing is saved,
// assigned, completed or scored from here.
import { useCallback, useEffect, useState } from 'react';
import { formatAnalyticsDate as day } from '../services/dateDisplay';
import { m7Request, type CategoryResult, type LanguageEvaluation, type SuggestionItem, type SuggestionsData } from '../services/m7Service';
import './suggestedInterventions.css';

const LEVEL_LABEL = { pattern: 'Repeated difficulty', preliminary: 'Preliminary observation' } as const;
const STATUS_LABEL: Record<CategoryResult['status'], string> = {
  needs_practice: 'Needs practice', improving: 'Improving', on_track: 'On track', insufficient: 'More data needed', not_evaluated: 'Not evaluated',
};
const period = (p: SuggestionItem['period']) => (!p ? 'No dated evidence' : day(p.from) === day(p.to) ? day(p.to) : `${day(p.from)} – ${day(p.to)}`);

function SinceInterventionNote({ item }: { item: SuggestionItem }) {
  const since = item.sinceIntervention;
  if (!since) return null;
  const recorded = `Intervention recorded ${day(since.date)} (${since.status.replace('_', ' ')})`;
  if (!since.results) return <p className="m7s-since">{recorded}. No new results since then yet.</p>;
  const result = since.unit === '%' && since.total !== undefined
    ? `${since.correct}/${since.total} correct (${since.percent}%) in ${since.results} later ${since.results === 1 ? 'assessment' : 'assessments'}`
    : `average ${since.average}${since.unit === '%' ? '%' : ' WPM'} in ${since.results} later ${since.results === 1 ? 'reading' : 'readings'}`;
  return <p className="m7s-since">{recorded}. Since then: {result}.</p>;
}

function EvidenceRows({ item }: { item: SuggestionItem }) {
  const { assessments, readings } = item.evidence;
  if (assessments?.length) return <div className="m7-scroll" role="region" tabIndex={0} aria-label={`${item.competencyName} supporting assessments`}><table className="m7s-evidence">
    <thead><tr><th>Assessment</th><th>Completed</th><th>{item.competency[0].toUpperCase() + item.competency.slice(1)} questions correct</th></tr></thead>
    <tbody>{[...assessments].reverse().map(a => <tr key={a.id}><td>{a.title}</td><td>{day(a.completedAt)}</td><td>{a.correct}/{a.total} ({a.percent}%)</td></tr>)}</tbody></table></div>;
  if (readings?.length) return <div className="m7-scroll" role="region" tabIndex={0} aria-label={`${item.competencyName} supporting readings`}><table className="m7s-evidence">
    <thead><tr><th>Reading</th><th>Completed</th><th>{item.competency === 'fluency' ? 'Reading speed' : 'Reading accuracy'}</th></tr></thead>
    <tbody>{[...readings].reverse().map(r => <tr key={r.id}><td>{r.title}</td><td>{day(r.completedAt)}</td><td>{item.competency === 'fluency' ? `${r.wpm} WPM` : `${Math.round(r.accuracy)}%`}</td></tr>)}</tbody></table></div>;
  return null;
}

function PracticeWords({ item }: { item: SuggestionItem }) {
  if (item.competency !== 'word_recognition') return null;
  const different = item.evidence.wordsReadDifferently ?? [];
  const flagged = item.evidence.pronunciationPracticeWords ?? [];
  if (!different.length && !flagged.length) return null;
  return <div className="m7s-words">
    {different.length > 0 && <p><span className="m7-field-label">Story words read differently or not heard</span>{different.map(w => <span className="m7s-word" key={w.word}>{w.word}{w.times > 1 ? ` ×${w.times}` : ''}</span>)}</p>}
    {flagged.length > 0 && <p><span className="m7-field-label">Words flagged by the English pronunciation check</span>{flagged.map(w => <span className="m7s-word" key={w}>{w}</span>)}</p>}
  </div>;
}

function SuggestionCard({ item, onUse, disabled, primary }: { item: SuggestionItem; onUse?: (item: SuggestionItem) => void; disabled?: boolean; primary?: boolean }) {
  const s = item.suggestion;
  const Heading = primary ? 'h3' : 'h4';
  return <article className={`m7s-card${primary ? ' m7s-primary' : ''}`} aria-label={`${primary ? 'Top suggestion' : 'Suggestion'}: ${item.competencyName}, ${item.languageName}`}>
    <div className="m7s-card-head">
      <Heading>{primary && <span className="m7s-kicker">Clearest need</span>}{item.competencyName}</Heading>
      <span className="m7s-chips"><span className="m7s-chip">{item.languageName}</span>
        {item.level && <span className={`m7s-chip m7s-level-${item.level}`}>{LEVEL_LABEL[item.level]}</span>}</span>
    </div>
    {primary ? <SuggestionBody item={item} onUse={onUse} disabled={disabled} /> : <>
      <p className="m7s-headline">{item.evidenceText} <strong>Suggested: {s?.title}.</strong></p>
      <details className="m7s-details"><summary>Show evidence and activity</summary><SuggestionBody item={item} onUse={onUse} disabled={disabled} /></details>
    </>}
  </article>;
}

function SuggestionBody({ item, onUse, disabled }: { item: SuggestionItem; onUse?: (item: SuggestionItem) => void; disabled?: boolean }) {
  const s = item.suggestion;
  return <>
    <dl className="m7s-facts">
      <div><dt>Evidence</dt><dd>{item.evidenceText}</dd></div>
      <div><dt>Evidence period</dt><dd>{period(item.period)}</dd></div>
      {s && <div className="m7s-suggestion"><dt>Suggested intervention</dt><dd><strong>{s.title}</strong><span className="m7s-approach">{s.approach}</span></dd></div>}
      {s && <div><dt>Practice activity</dt><dd>{s.activity}</dd></div>}
      <div><dt>Why this is suggested</dt><dd>{item.reason}</dd></div>
      <div><dt>More evidence needed</dt><dd>{item.moreEvidenceNeeded ? 'Yes. Confirm with the next assessments before treating this as a persistent difficulty.' : 'No. The difficulty repeats across recent results. Keep checking new results.'}</dd></div>
    </dl>
    <PracticeWords item={item} />
    <SinceInterventionNote item={item} />
    <details className="m7s-details"><summary>Supporting results</summary><EvidenceRows item={item} /></details>
    {onUse && s && <button type="button" disabled={disabled} onClick={() => onUse(item)}>Use this suggestion</button>}
  </>;
}

function cell(result: CategoryResult) {
  const e = result.evidence;
  const figure = e.total ? `${e.correct}/${e.total}` : e.accuracy !== undefined && e.accuracy !== null ? `${e.accuracy}%` : '';
  return <td data-status={result.status}>{STATUS_LABEL[result.status]}{result.level ? ` (${LEVEL_LABEL[result.level].toLowerCase()})` : ''}{figure && <span className="m7s-figure">{figure}</span>}</td>;
}

function LanguageTable({ languages }: { languages: LanguageEvaluation[] }) {
  const shown = languages.filter(l => l.hasData);
  if (!shown.length) return null;
  return <div className="m7-scroll" role="region" tabIndex={0} aria-label="Evidence by competency and language"><table className="m7s-grid">
    <thead><tr><th>Language</th><th>Literal</th><th>Inferential</th><th>Critical</th><th>Word recognition</th><th>Fluency</th><th>Initial reading level (M2)</th></tr></thead>
    <tbody>{shown.map(l => <tr key={l.language}><th scope="row">{l.name}<span className="m7s-figure">{l.assessments} {l.assessments === 1 ? 'assessment' : 'assessments'}, {l.readings} {l.readings === 1 ? 'reading' : 'readings'}</span></th>
      {cell(l.comprehension.literal)}{cell(l.comprehension.inferential)}{cell(l.comprehension.critical)}{cell(l.wordRecognition)}{cell(l.fluency)}
      <td>{l.placement ? `${l.placement.readingLevel} (${l.placement.difficultyTier})` : 'No official result'}</td></tr>)}</tbody>
  </table></div>;
}

/**
 * path: '/students/:id/suggestions' (Teacher) or '/admin/students/:id/suggestions' (School Admin).
 * refreshKey: change it to reload (after an intervention is saved).
 */
export function SuggestedInterventions({ path, onUse, disabled, refreshKey = 0, scope = 'your classrooms', readOnly = false, scopeNote }: { path: string; onUse?: (item: SuggestionItem) => void; disabled?: boolean; refreshKey?: number; scope?: string; readOnly?: boolean; scopeNote?: string }) {
  const [data, setData] = useState<SuggestionsData | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await m7Request<SuggestionsData>(path)); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [path]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  const rules = data?.rules;
  return <section className="m7s" aria-label="Suggested interventions">
    <div className="m7-support-section-heading"><h2>Suggested Interventions</h2></div>
    <p className="m7s-intro">{readOnly ? <>Read-only, rule-based suggestions from saved results in {scope}. Nothing can be recorded from this view.</> : <>Rule-based suggestions from this student's saved results in {scope}. A suggestion is a starting point for your judgement; it is not a diagnosis, and nothing is recorded until you save an intervention.</>}</p>
    {loading && !data && <p role="status">Checking saved results…</p>}
    {error && <div role="alert" className="m7-error">{error} <button type="button" onClick={() => void load()}>Retry</button></div>}
    {data && <>
      {!data.hasAnyData ? <p className="m7s-empty" role="status"><strong>More assessment data needed.</strong> There are no completed comprehension assessments or saved readings in {scope} yet, so no suggestion can be made.</p>
        : !data.suggestions.length ? <p className="m7s-empty" role="status"><strong>No intervention suggested right now.</strong> {data.moreDataNeeded ? 'Some competencies have too few saved questions to judge. More assessments are needed.' : 'Recent results meet the benchmarks used by these rules.'}</p>
        : <div className="m7s-list">{data.suggestions.map((item, index) => <SuggestionCard key={item.id} item={item} primary={index === 0} onUse={onUse} disabled={disabled} />)}</div>}
      {data.additionalNeeds.length > 0 && <p className="m7s-also"><strong>Also observed:</strong> {data.additionalNeeds.map(n => `${n.competencyName} (${n.languageName}${n.level ? `, ${LEVEL_LABEL[n.level as 'pattern' | 'preliminary'].toLowerCase()}` : ''})`).join('; ')}. Shown after the clearest needs are addressed.</p>}
      {data.improving.length > 0 && <div className="m7s-improving"><h3>Improving: keep monitoring</h3>{data.improving.map(item => <div key={item.id}><p><strong>{item.competencyName} ({item.languageName})</strong>: {item.evidenceText}</p><SinceInterventionNote item={item} /></div>)}</div>}
      {data.notes.map(note => <p key={note} className="m7s-note">{note}</p>)}
      <details className="m7-support-disclosure m7s-rules"><summary>Evidence by competency and how suggestions are made</summary>
        <LanguageTable languages={data.languages} />
        {rules && <ul>
          <li>Comprehension: first answers to the saved literal, inferential and critical questions of counted assessments, English and Filipino separately. A need is below {rules.comprehensionBenchmark}% across the latest {rules.recentAssessments} assessments that included that question type.</li>
          <li>A <strong>repeated pattern</strong> needs at least {rules.patternMinQuestions} questions with {rules.patternMinAssessmentsBelow} or more of those assessments below {rules.comprehensionBenchmark}%. Anything less is a <strong>preliminary observation</strong>; fewer than {rules.minQuestionsToObserve} questions is not judged at all.</li>
          <li>Word recognition: reading accuracy (words matching the story) below {rules.wordRecognitionMinAccuracy}% across the latest {rules.recentReadings} readings; repeated when {rules.patternMinReadingsBelow} or more readings are below.</li>
          <li>Fluency: {rules.fluencyMinWpm === null ? 'not evaluated, because no reading-speed benchmark has been approved.' : `below ${rules.fluencyMinWpm} words per minute.`}</li>
          <li>Order: repeated patterns first, then foundational skills (word recognition, literal, inferential, critical). At most {rules.maxSuggestions} suggestions are shown.</li>
          <li>The initial reading level (M2) is context only and is never changed here. {scopeNote ?? `Personal practice outside ${scope} is not included.`}</li>
        </ul>}
      </details>
    </>}
  </section>;
}
