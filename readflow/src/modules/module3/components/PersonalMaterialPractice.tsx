import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../services/api';
import { getMaterialAuthHeaders, getMaterialServiceError } from '../services/materialService';
import './PersonalMaterialPractice.css';

interface PracticeState {
  revision: string; reviewed: boolean; missingPages: number[] | null;
  questionSetId: string | null; readingId: string | null;
  attemptId: string | null; attemptStatus: 'in_progress' | 'completed' | null;
}
export default function PersonalMaterialPractice({ materialId }: { materialId: string }) {
  const [state, setState] = useState<PracticeState>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const path = `/api/materials/${encodeURIComponent(materialId)}/personal-practice`;
  const root = `/m3/general/materials/${encodeURIComponent(materialId)}`;
  async function refresh() {
    const { data } = await api.get<{ state: PracticeState }>(path, { headers: await getMaterialAuthHeaders() });
    setState(data.state);
  }
  useEffect(() => {
    let active = true;
    void getMaterialAuthHeaders().then(headers => api.get<{ state: PracticeState }>(path, { headers }))
      .then(({ data }) => { if (active) setState(data.state); })
      .catch(e => { if (active) setError(getMaterialServiceError(e)); });
    return () => { active = false; };
  }, [path]);
  async function act(action: 'confirm' | 'generate') {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await api.post(`${path}/${action}`, action === 'confirm' ? { confirmed, revision: state?.revision } : {},
        { headers: await getMaterialAuthHeaders(), timeout: 150000 });
      await refresh();
    } catch (e) { setError(getMaterialServiceError(e)); }
    finally { setBusy(false); }
  }
  return <section className="m3-panel m3-personal-practice" aria-label="Personal reading practice">
    <h2>Personal reading practice</h2>
    <p>Your material and questions stay private. Practice uses the reviewed text shown on this page.</p>
    {error && <p className="m3-error-message" role="alert">{error}</p>}
    {!state && !error && <p role="status">Loading practice…</p>}
    {state && <>
      {!!state.missingPages?.length && <p role="note">No readable text was extracted from page(s) {state.missingPages.join(', ')}. Those pages are not included in practice.</p>}
      {!state.reviewed && <div className="m3-personal-review">
        <p>Check the saved text against your original document. Missing, blank or unreadable pages are not included. Older uploads may not have a saved page-extraction report.</p>
        <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I reviewed the usable extracted text and confirm it is suitable for practice.</label>
        <button type="button" className="m3-button m3-button--primary" disabled={!confirmed || busy} onClick={() => void act('confirm')}>Confirm reviewed text</button>
      </div>}
      <div className="m3-personal-actions">
        {state.reviewed && <Link className="m3-action-link" to={`${root}/read-aloud?recordAgain=1`}>{state.readingId ? 'Read Again' : 'Read Aloud'}</Link>}
        {state.readingId && <Link className="m3-action-link" to={`/m3/general/read-aloud/results/${state.readingId}`}>View Reading Result</Link>}
        {state.reviewed && !state.questionSetId && !state.attemptId && <button type="button" className="m3-button m3-button--primary" disabled={busy} onClick={() => void act('generate')}>{busy ? 'Generating questions…' : 'Generate Questions'}</button>}
        {state.questionSetId && <span>Private AI-validated questions ready. These have not been Teacher-reviewed.</span>}
        {state.attemptId ? <Link className="m3-action-link" to={`/m3/general/comprehension/${state.attemptId}`}>{state.attemptStatus === 'completed' ? 'View Comprehension Result' : 'Resume Comprehension'}</Link>
          : state.reviewed && state.questionSetId && state.readingId ? <Link className="m3-action-link" to={`${root}/comprehension?oralReadingAttemptId=${state.readingId}`}>Start Comprehension</Link>
            : state.questionSetId && <p>Complete and save Read Aloud before starting comprehension.</p>}
      </div>
      <p>Up to five new question sets per rolling 24 hours. Saved questions are reused. Read Aloud may be repeated; comprehension has one assessment per material.</p>
      <p>Removing this material from Reading Materials stops new practice and makes an unfinished assessment read-only. It is not permanently deleted: the file, text, private questions and saved results are kept, and completed results stay in your history.</p>
    </>}
  </section>;
}
