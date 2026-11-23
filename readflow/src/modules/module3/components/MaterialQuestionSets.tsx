import { getQuestionGenerationError } from '../services/questionGenerationError';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ASSIGNED_QUESTION_SET_MESSAGE, DEFAULT_NEW_QUESTION_SET_COUNT, createMaterialQuestionSet, deleteMaterialQuestionSet, getMaterialQuestionSet, getMaterialQuestionSets, getMaterialServiceError, saveReviewedMaterialQuestionSet } from '../services/materialService';
import type { MaterialQuestionSet, MaterialQuestionSetSummary } from '../types/content';
import QuestionCountInput from './QuestionCountInput';
import QuestionBankEditorModal, { type EditableQuestion } from './QuestionBankEditorModal';
import ComprehensionStudentPreview from './ComprehensionStudentPreview';
import { checkQuestionCount } from '../utils/questionCount';
import './M3Dialog.css';

function toEditable(set: MaterialQuestionSet): EditableQuestion[] {
  return set.questions.map(question => {
    const options = [0, 1, 2, 3].map(index => question.options[index] ?? '') as EditableQuestion['options'];
    const index = Number.isInteger(question.correctOptionIndex) ? question.correctOptionIndex as number : options.indexOf(question.correctAnswer);
    return { id: question.id, type: question.type, questionText: question.questionText, options, correctIndex: Math.max(0, index),
      scaffoldingHint: question.scaffoldingHint ?? '', answerExplanation: question.answerExplanation ?? '', supportingEvidence: question.supportingEvidence ?? '' };
  });
}

export default function MaterialQuestionSets({ materialId, root, canGenerate, canDelete, materialTitle = 'Reading material', contentText = '' }: {
  materialId: string; root: string; canGenerate: boolean; canDelete: boolean; materialTitle?: string; contentText?: string;
}) {
  const [sets, setSets] = useState<MaterialQuestionSetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Shared M3 rule (at least 6, multiples of 3, at most 12). Only a valid typed total is sent.
  const [questionCount, setQuestionCount] = useState<string>(String(DEFAULT_NEW_QUESTION_SET_COUNT));
  const countCheck = checkQuestionCount(questionCount);
  const [editing, setEditing] = useState<MaterialQuestionSet | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<{ title: string; questions: EditableQuestion[] } | null>(null);
  // Opened from the old full-page edit link (?editSet=<id>): open that set in the editor once the list is loaded.
  const [searchParams, setSearchParams] = useSearchParams();
  const editSet = searchParams.get('editSet');
  useEffect(() => {
    if (!editSet || loading) return;
    const target = sets.find(set => set.id === editSet);
    const next = new URLSearchParams(searchParams); next.delete('editSet'); setSearchParams(next, { replace: true });
    if (target) void openSet(target);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSet, loading, sets]);
  async function openSet(set: MaterialQuestionSetSummary, preview = false) {
    if (openingId) return;
    setOpeningId(set.id); setError(''); setSuccess('');
    try {
      const full = await getMaterialQuestionSet(materialId, set.id);
      if (preview) setPreviewing({ title: full.name, questions: toEditable(full) }); else setEditing(full);
    } catch (openError) { setError(getMaterialServiceError(openError)); }
    finally { setOpeningId(null); }
  }
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
    if (busy || deleteBusy || !canGenerate || !countCheck.ok) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const set = await createMaterialQuestionSet(materialId, countCheck.value);
      setSets(current => [...current.filter(value => value.id !== set.id), set].sort((a, b) => a.sequenceNumber - b.sequenceNumber));
      setSuccess(`${set.name} generated and saved. Your previous sets are unchanged.`);
    } catch (error) { setError(getQuestionGenerationError(error)); }
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
          <button type="button" className="m3-button m3-button--primary" disabled={Boolean(openingId)} onClick={() => void openSet(set)}>
            {openingId === set.id ? 'Opening...' : set.hasStudentAttempts ? 'View Questions' : 'View/Edit Questions'}</button>
          <button type="button" className="m3-button m3-button--secondary" disabled={Boolean(openingId)} onClick={() => void openSet(set, true)}>Preview as Student</button>
          <Link className="m3-action-link" to={`${root}/materials/${materialId}/question-sets/${set.id}`}>Open full page</Link>
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
      <QuestionCountInput value={questionCount} onChange={setQuestionCount} disabled={busy || deleteBusy} />
      <button type="button" className="m3-button m3-button--coral"
      disabled={busy || deleteBusy || loading || !countCheck.ok} aria-busy={busy} onClick={() => void generate()}>
      {busy ? 'Generating and saving...' : '+ Generate New Question Set'}
    </button></div>}
    {busy && <p role="status">Generating {countCheck.ok ? countCheck.value : ''} questions in a new saved set...</p>}
    {editing && <QuestionBankEditorModal
      title={`${editing.hasStudentAttempts ? 'Questions' : 'Edit Questions'} · ${editing.name}`}
      subtitle={materialTitle}
      questions={toEditable(editing)}
      rules={{ requireExplanation: false, requireEvidence: false, evidenceSource: contentText || undefined }}
      readOnly={Boolean(editing.hasStudentAttempts)}
      saveLabel="Save Reviewed Questions"
      notice={editing.hasStudentAttempts ? 'Students have answered this set, so it can no longer be changed. Generate a new set instead.'
        : 'Saving keeps these questions (nothing is regenerated) and marks the set as reviewed.'}
      onPreview={(questions) => setPreviewing({ title: editing.name, questions })}
      onClose={() => setEditing(null)}
      onSave={async (questions) => {
        let saved: MaterialQuestionSet;
        try {
          saved = await saveReviewedMaterialQuestionSet(materialId, editing.id, editing.revision, questions.map(question => ({
            id: question.id, type: question.type, questionText: question.questionText, options: [...question.options],
            correctOptionIndex: question.correctIndex, scaffoldingHint: question.scaffoldingHint,
            answerExplanation: question.answerExplanation, supportingEvidence: question.supportingEvidence,
          })));
        } catch (saveError) { throw new Error(getMaterialServiceError(saveError)); }
        setSets(current => current.map(value => (value.id === saved.id ? saved : value)));
        setEditing(null);
        setSuccess(`${saved.name} saved and marked as reviewed.`);
      }}
    />}
    {previewing && <ComprehensionStudentPreview title={materialTitle} passageTitle={previewing.title} questions={previewing.questions} onClose={() => setPreviewing(null)} />}
  </section>;
}
