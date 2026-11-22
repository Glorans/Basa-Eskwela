// M7 F10 for Students and Independent Learners: practice ideas from the learner's own saved results, in simple
// words. No labels such as "at risk", no Teacher activities and nothing to record. Display only.
import { useEffect, useState } from 'react';
import { m7Request, PERSONAL_PROGRESS_TIMEOUT_MS, type LearnerSuggestionsData, type LearnerTip } from '../services/m7Service';
import './suggestedInterventions.css';

function Tip({ tip }: { tip: LearnerTip }) {
  return <article className="m7s-card m7s-learner-tip" aria-label={`${tip.title}, ${tip.languageName}`}>
    <div className="m7s-card-head"><h3>{tip.title}</h3><span className="m7s-chips"><span className="m7s-chip">{tip.languageName}</span></span></div>
    <p className="m7s-headline">{tip.basedOn}</p>
    <ol className="m7s-steps">{tip.steps.map(step => <li key={step}>{step}</li>)}</ol>
    {tip.words.length > 0 && <p className="m7s-words-inline"><span className="m7-field-label">Words to practise</span>{tip.words.map(w => <span className="m7s-word" key={w}>{w}</span>)}</p>}
    <p className="m7s-figure">{tip.note}</p>
  </article>;
}

export function LearnerSuggestions() {
  const [data, setData] = useState<LearnerSuggestionsData | null>(null), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    m7Request<LearnerSuggestionsData>('/personal/suggestions', 'GET', undefined, { timeoutMs: PERSONAL_PROGRESS_TIMEOUT_MS })
      .then(value => { if (active) setData(value); }).catch(e => { if (active) setError((e as Error).message); });
    return () => { active = false; };
  }, []);
  return <section className="m7s" aria-label="Practice ideas for you">
    <h2>Practice ideas for you</h2>
    {!data && !error && <p role="status">Looking at your results…</p>}
    {error && <p role="alert" className="m7-error">{error}</p>}
    {data && <>
      {!data.hasAnyData ? <p className="m7s-empty">Finish a story and its questions, then come back here for practice ideas.</p>
        : !data.tips.length ? <p className="m7s-empty">{data.moreDataNeeded ? 'Keep reading! After a few more stories, you will see practice ideas here.' : 'Great job! Your recent results look good. Keep reading every day.'}</p>
        : <><p className="m7s-intro">These ideas come from your own saved readings and answers. They can change as you keep practising.</p>
          <div className="m7s-list">{data.tips.map(tip => <Tip key={tip.id} tip={tip} />)}</div></>}
      {data.improving.length > 0 && <div className="m7s-improving"><h3>You are getting better!</h3>
        {data.improving.map(tip => <p key={tip.id}><strong>{tip.title} ({tip.languageName}):</strong> {tip.basedOn} {tip.note}</p>)}</div>}
    </>}
  </section>;
}
