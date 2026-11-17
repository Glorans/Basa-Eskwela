import { useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, Circle, LoaderCircle, Lock, Pencil, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../../../services/api';
import { confirmReadFlow } from '../../../components/ReadFlowDialog';
import {
  confirmPersonalMaterialText, getMaterialAuthHeaders, getMaterialServiceError, getNewPersonalQuestions, getPersonalPracticeState,
  savePersonalMaterialText, type PersonalPracticeState,
} from '../services/materialService';
import './PersonalMaterialPractice.css';
import { getQuestionGenerationError } from '../services/questionGenerationError';

export const CHECK_TEXT_INSTRUCTION = 'Check the text below. You can edit it if something is incorrect.';
export const REVIEW_QUESTIONS_INSTRUCTION = 'Review your questions before starting comprehension.';
export const REGENERATE_CONFIRMATION = 'Regenerate your questions?\n\nYour current questions will be replaced by a new set for the same text. '
  + 'This counts toward your 5 question sets for today.';
export const QUESTION_LOCKS = {
  assessment_unfinished: 'Your comprehension has started, so these questions are locked until you finish.',
  assessment_completed: 'You already answered these questions, so they stay the same.',
} as const;

interface Props {
  materialId: string;
  /** The reading text used for practice (the original file is never changed). */
  contentText: string | null;
  /** Open the text editor right away (from "Edit Text" in Reading Materials). */
  startEditing?: boolean;
  /** Called after corrected text is saved, so the rest of the page shows it. */
  onTextSaved?: (text: string) => void;
}

function Step({ number, title, done, children }: { number: number; title: string; done: boolean; children?: ReactNode }) {
  return <li className={`m3-practice-step${done ? ' m3-practice-step--done' : ''}`}>
    <div className="m3-practice-step__head">
      {done ? <CheckCircle2 size={22} aria-hidden="true" /> : <Circle size={22} aria-hidden="true" />}
      <h3><span className="m3-practice-step__number">Step {number}.</span> {title}</h3>
      <span className="m3-practice-step__status">{done ? 'Done' : 'To do'}</span>
    </div>
    {children && <div className="m3-practice-step__body">{children}</div>}
  </li>;
}

/** Whether the learner may edit now. The server decides (and the database enforces); older servers send no flag. */
function canEdit(state: PersonalPracticeState) {
  if (typeof state.canEditText === 'boolean') return state.canEditText;
  return !(state.questionSetId || state.readingId || state.attemptId);
}

/**
 * Independent Learner practice for one private material:
 * Check or edit text -> Confirm -> Get questions -> Review them -> Read Aloud -> Comprehension -> Results.
 * The server keeps every rule (owner only, one assessment per material, generation limits, when the text may change);
 * this page only shows the next step.
 */
export default function PersonalMaterialPractice({ materialId, contentText, startEditing = false, onTextSaved }: Props) {
  const [state, setState] = useState<PersonalPracticeState>();
  const [text, setText] = useState(contentText ?? '');
  const [draft, setDraft] = useState(contentText ?? '');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<'' | 'save' | 'confirm' | 'generate' | 'regenerate'>('');
  const root = `/m3/general/materials/${encodeURIComponent(materialId)}`;

  useEffect(() => { setText(contentText ?? ''); }, [contentText]);
  useEffect(() => {
    let active = true;
    getPersonalPracticeState(materialId)
      .then(next => { if (active) setState(next); })
      .catch(e => { if (active) setError(getMaterialServiceError(e)); });
    return () => { active = false; };
  }, [materialId]);

  const editable = Boolean(state && canEdit(state));
  const ready = Boolean(state);
  useEffect(() => {
    if (startEditing && ready && editable) setEditing(true);
  }, [startEditing, ready, editable]);

  async function run(kind: 'save' | 'confirm' | 'generate' | 'regenerate', work: () => Promise<void>) {
    if (busy) return;
    setBusy(kind); setError(''); setNotice('');
    try { await work(); }
    catch (e) { setError(kind === 'generate' || kind === 'regenerate' ? getQuestionGenerationError(e) : getMaterialServiceError(e)); }
    finally { setBusy(''); }
  }
  const save = () => run('save', async () => {
    if (!state) return;
    const next = await savePersonalMaterialText(materialId, draft, state.revision);
    const saved = draft.replace(/\r\n?/g, '\n').trim();
    const changed = next.revision !== state.revision;
    setState(next); setText(saved); setEditing(false);
    setNotice(!changed ? 'No changes to save.'
      : state.attemptStatus === 'completed' ? 'Your changes are saved. Your answers and result stay the same. Confirm the text when it is ready.'
        : 'Your changes are saved. Confirm the text when it is ready.');
    if (changed) onTextSaved?.(saved);
  });
  const confirmText = () => run('confirm', async () => {
    if (!state) return;
    await confirmPersonalMaterialText(materialId, state.revision);
    setState(await getPersonalPracticeState(materialId));
    setNotice('Text confirmed.');
  });
  const generate = () => run('generate', async () => {
    await api.post(`/api/materials/${encodeURIComponent(materialId)}/personal-practice/generate`, {},
      { headers: await getMaterialAuthHeaders(), timeout: 150000 });
    setState(await getPersonalPracticeState(materialId));
    setNotice('Your questions are ready.');
  });
  const regenerate = async () => {
    if (busy) return;
    if (!(await confirmReadFlow(REGENERATE_CONFIRMATION, { confirm: 'Regenerate Questions', cancel: 'Keep my questions' }))) return;
    await run('regenerate', async () => {
      await getNewPersonalQuestions(materialId);
      setState(await getPersonalPracticeState(materialId));
      setNotice('Your new questions are ready.');
    });
  };

  const completed = state?.attemptStatus === 'completed';
  return <section className="m3-panel m3-personal-practice" aria-label="Personal reading practice">
    <h2>Practice with this reading</h2>
    {error && <p className="m3-error-message" role="alert">{error}</p>}
    {notice && <p className="m3-success-message" role="status">{notice}</p>}
    {!state && !error && <p role="status"><LoaderCircle className="m3-spinner" size={16} aria-hidden="true" /> Loading your practice…</p>}
    {state && <ol className="m3-practice-steps">
      <Step number={1} title="Check the text" done={state.reviewed}>
        {!editing && <>
          <p>{CHECK_TEXT_INSTRUCTION}</p>
          <div className="m3-practice-text" tabIndex={0} aria-label="Reading text">{text || 'No reading text was found in this file.'}</div>
          <div className="m3-personal-actions">
            {editable && <button type="button" className="m3-button m3-button--secondary" disabled={!!busy}
              onClick={() => { setDraft(text); setEditing(true); setNotice(''); }}><Pencil size={16} aria-hidden="true" /> Edit Text</button>}
            {!state.reviewed && <button type="button" className="m3-button m3-button--primary" disabled={!!busy || !text.trim()} onClick={() => void confirmText()}>
              {busy === 'confirm' ? 'Confirming…' : 'Confirm Text'}</button>}
          </div>
          {state.textLockedReason === 'assessment_unfinished' && <p className="m3-practice-note">Finish your comprehension first. Then you can edit the text.</p>}
          {state.textLockedReason === 'practice_started' && <p className="m3-practice-note">You already practiced with this text, so it stays as it is.</p>}
        </>}
        {editing && <div className="m3-practice-editor">
          <label className="m3-field m3-field--wide">
            <span>Edit the reading text</span>
            <textarea value={draft} rows={12} onChange={e => setDraft(e.target.value)} disabled={busy === 'save'} />
          </label>
          <div className="m3-personal-actions">
            <button type="button" className="m3-button m3-button--primary" disabled={!!busy || !draft.trim()} onClick={() => void save()}>
              {busy === 'save' ? 'Saving…' : 'Save Changes'}</button>
            <button type="button" className="m3-button m3-button--secondary" disabled={busy === 'save'}
              onClick={() => { setEditing(false); setDraft(text); setError(''); }}>Cancel</button>
          </div>
          <p className="m3-practice-note">Your original file stays the same.</p>
        </div>}
      </Step>

      <Step number={2} title="Get your questions" done={Boolean(state.questionSetId) || Boolean(state.attemptId)}>
        {state.questionSetId ? <>
          <p>{REVIEW_QUESTIONS_INSTRUCTION}</p>
          <div className="m3-personal-actions">
            <Link className="m3-action-link" to={`${root}/questions`}>Preview Questions</Link>
            {state.canGetNewQuestions && <button type="button" className="m3-button m3-button--secondary" disabled={!!busy} onClick={() => void regenerate()}>
              {busy === 'regenerate' ? <LoaderCircle className="m3-spinner" size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
              {busy === 'regenerate' ? 'Making new questions…' : 'Regenerate Questions'}</button>}
          </div>
        </> : !state.attemptId && (!state.reviewed ? <p>Confirm the text first.</p>
          : <>
            {state.questionsOutdated && <p>Your text changed, so you need new questions.</p>}
            <button type="button" className="m3-button m3-button--primary" disabled={!!busy} onClick={() => void generate()}>
              {busy === 'generate' ? 'Making your questions…' : 'Generate Questions'}</button>
          </>)}
        {state.questionsLockedReason && <p className="m3-practice-note m3-practice-lock"><Lock size={15} aria-hidden="true" /> {QUESTION_LOCKS[state.questionsLockedReason]}</p>}
      </Step>

      <Step number={3} title="Read aloud" done={Boolean(state.readingId)}>
        {state.reviewed ? <div className="m3-personal-actions">
          <Link className="m3-action-link" to={`${root}/read-aloud?recordAgain=1`}>{state.readingId ? 'Read Again' : 'Read Aloud'}</Link>
          {state.readingId && <Link className="m3-action-link" to={`/m3/general/read-aloud/results/${state.readingId}`}>View Reading Result</Link>}
        </div> : <p>Confirm the text first.</p>}
      </Step>

      <Step number={4} title="Answer the questions" done={completed}>
        {state.attemptId
          ? <Link className="m3-action-link" to={`/m3/general/comprehension/${state.attemptId}`}>{completed ? 'View Comprehension Result' : 'Resume Comprehension'}</Link>
          : state.questionSetId && state.readingId && state.reviewed
            ? <Link className="m3-button m3-button--primary" to={`${root}/comprehension?oralReadingAttemptId=${state.readingId}`}>Start Comprehension</Link>
            : <p>{state.questionSetId ? 'Read aloud first.' : 'Get your questions and read aloud first.'}</p>}
        <p className="m3-practice-note">{completed ? 'Your answers are saved. You can answer the questions one time.' : 'You can answer the questions one time.'}</p>
      </Step>
    </ol>}
  </section>;
}
