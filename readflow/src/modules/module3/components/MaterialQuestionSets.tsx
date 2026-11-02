import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ASSIGNED_QUESTION_SET_MESSAGE, DEFAULT_NEW_QUESTION_SET_COUNT, NEW_QUESTION_SET_COUNTS, createMaterialQuestionSet, deleteMaterialQuestionSet, getMaterialQuestionSets, getMaterialServiceError } from '../services/materialService';
import type { MaterialQuestionSetSummary } from '../types/content';

export default function MaterialQuestionSets({ materialId, root, canGenerate, canDelete }: {
  materialId: string; root: string; canGenerate: boolean; canDelete: boolean;
}) {
  const [sets, setSets] = useState<MaterialQuestionSetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [questionCount, setQuestionCount] = useState<number>(DEFAULT_NEW_QUESTION_SET_COUNT);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [reload, setReload] = useState(0);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deletingSet = sets.find(set => set.id === deletingId);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setDeletingId(null); setSuccess('');
    getMaterialQuestionSets(materialId).then(value => { if (active) setSets(value); })
      .catch(error => { if (active) setError(getMaterialServiceError(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [materialId, reload]);
  useEffect(() => {
    if (!deletingId) return;
    cancelDeleteRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !deleteBusy) {
        event.preventDefault();
        setDeletingId(null);
        requestAnimationFrame(() => deleteTriggerRef.current?.focus());
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = cancelDeleteRef.current?.closest('[role="dialog"]');
      const controls = dialog ? Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled)')) : [];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [deletingId, deleteBusy]);
  function closeDeleteModal() {
    if (deleteBusy) return;
    setDeletingId(null);
    requestAnimationFrame(() => deleteTriggerRef.current?.focus());
  }
  async function generate() {
    if (busy || deleteBusy || !canGenerate) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const set = await createMaterialQuestionSet(materialId, questionCount);
      setSets(current => [...current.filter(value => value.id !== set.id), set].sort((a, b) => a.sequenceNumber - b.sequenceNumber));
      setSuccess(`${set.name} generated and saved. Your previous sets are unchanged.`);
    } catch (error) { setError(getMaterialServiceError(error)); }
    finally { setBusy(false); }
  }
  async function remove(set: MaterialQuestionSetSummary) {
    if (busy || deleteBusy || !canDelete) return;
    setDeleteBusy(true); setError(''); setSuccess('');
    try {
      await deleteMaterialQuestionSet(materialId, set.id, set.revision);
      setSets(current => current.filter(value => value.id !== set.id));
      setDeletingId(null);
      setSuccess(`${set.name} deleted. Other sets are unchanged.`);
    } catch (error) { setError(getMaterialServiceError(error)); }
    finally { setDeleteBusy(false); }
  }
  return <section id="question-sets" className="m3-page-stack" aria-labelledby="saved-question-sets-title">
    <div className="m3-section-heading"><div>
      <h2 id="saved-question-sets-title">Saved Question Sets</h2>
      <p>Prepare separate sets before class. Each new set keeps all your previous sets.</p>
    </div></div>
    {loading ? <p role="status">Loading saved question sets...</p> : <>
      {!sets.length && !error && <p>No saved question sets yet.</p>}
      {sets.map(set => <article className="m3-detail-card m3-saved-set-card" key={set.id}>
        <h3>{set.name}</h3>
        <p>{set.questionCount} questions</p>
        <p>{set.counts.literal} Literal &bull; {set.counts.inferential} Inferential &bull; {set.counts.critical} Critical</p>
        <p>{set.reviewStatus === 'reviewed' ? 'Reviewed' : 'Needs Review'}</p>
        {Boolean(set.assignedCount) && <p>
          Assigned in a class activity ({set.assignedCount} {set.assignedCount === 1 ? 'student' : 'students'}).{' '}
          {set.hasStudentAttempts ? 'Students have answered it, so it can no longer be edited.' : ASSIGNED_QUESTION_SET_MESSAGE}
        </p>}
        <div className="m3-form-actions">
          <Link className="m3-button m3-button--primary" to={`${root}/materials/${materialId}/question-sets/${set.id}`}>View Questions</Link>
          {!set.hasStudentAttempts && <Link className="m3-button m3-button--secondary" to={`${root}/materials/${materialId}/question-sets/${set.id}/edit`}>Edit</Link>}
          {canDelete && <button type="button" className="m3-button m3-button--danger"
            disabled={busy || deleteBusy || Boolean(set.assignedCount)} onClick={(event) => {
              deleteTriggerRef.current = event.currentTarget;
              setError(''); setSuccess(''); setDeletingId(set.id);
            }}>Delete Set</button>}
        </div>
      </article>)}
    </>}
    {canDelete && deletingSet && <div className="m3-modal-backdrop">
      <section className="m3-confirmation-modal" role="dialog" aria-modal="true"
        aria-labelledby="delete-question-set-title" aria-describedby="delete-question-set-description">
        <h2 id="delete-question-set-title">Delete Question Set?</h2>
        <p id="delete-question-set-description">Delete {deletingSet.name}? Its questions and answer keys will be permanently deleted.</p>
        {error && <p className="m3-error-message" role="alert">{error}</p>}
        <div className="m3-form-actions">
          <button ref={cancelDeleteRef} type="button" className="m3-button m3-button--secondary"
            disabled={deleteBusy} onClick={closeDeleteModal}>Cancel</button>
          <button type="button" className="m3-button m3-button--danger" disabled={busy || deleteBusy}
            aria-busy={deleteBusy} onClick={() => void remove(deletingSet)}>{deleteBusy ? 'Deleting...' : 'Delete Set'}</button>
        </div>
      </section>
    </div>}
    {error && <div role="alert" className="m3-error-message">{error} <button type="button" className="m3-button m3-button--secondary" disabled={busy || deleteBusy} onClick={() => setReload(value => value + 1)}>Reload Sets</button></div>}
    {success && <p role="status" className="m3-success-message">{success}</p>}
    {canGenerate && <div className="m3-question-set-generation">
      <label className="m3-field"><span>Number of questions</span>
        <select value={questionCount} disabled={busy || deleteBusy} onChange={event => setQuestionCount(Number(event.target.value))}>
          {NEW_QUESTION_SET_COUNTS.map(count => <option key={count} value={count}>
            {count} questions ({count / 3} Literal, {count / 3} Inferential, {count / 3} Critical)
          </option>)}
        </select>
      </label>
      <button type="button" className="m3-button m3-button--coral"
      disabled={busy || deleteBusy || loading} aria-busy={busy} onClick={() => void generate()}>
      {busy ? 'Generating and saving...' : '+ Generate New Question Set'}
    </button></div>}
    {busy && <p role="status">Generating {questionCount} questions in a new saved set...</p>}
  </section>;
}
