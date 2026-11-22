const { throwIfContentScreen } = require('./contentScreen');
// Private practice is an additional source, never a classroom or a catalog module.
const { randomUUID } = require('node:crypto');
const { getSupabaseAdmin } = require('./supabaseAdmin');
const { generateComprehensionQuestions, validateGeneratedQuestions, MAX_QUESTION_CONTENT_LENGTH } = require('./questionGenerationService');
const { MAX_MATERIAL_TEXT_LENGTH } = require('./materialTextLimits');

class PersonalMaterialError extends Error {
  constructor(message, statusCode = 409) { super(message); this.statusCode = statusCode; }
}
const dbFor = deps => deps.getSupabaseAdmin?.() ?? getSupabaseAdmin();
function personalContext(requester, context = {}) {
  if (requester.profile.role !== 'general_user' || ['moduleId', 'passageId', 'roomId', 'assignmentId', 'activityAssignmentId'].some(k => context[k] != null && context[k] !== '')) {
    throw new PersonalMaterialError('Personal practice requires your own material without classroom or module references.', 403);
  }
}
async function rpc(requester, materialId, action, extra = {}, deps = {}) {
  personalContext(requester);
  const { data, error } = await dbFor(deps).rpc('personal_material_access', {
    actor: requester.user.id, material: materialId, operation: action, ...extra,
  });
  throwIfContentScreen(error);
  if (error) throw Object.assign(new PersonalMaterialError(
    ['PGRST202', '42883'].includes(error.code) ? 'Personal practice is not installed yet.'
      : error.code === '42501' ? 'This personal material is unavailable to your account.'
        : error.code === 'P0001' ? error.message : 'Unable to open personal practice. Please retry.',
    error.code === '42501' ? 403 : 409), { code: error.code });
  return data;
}
async function loadPersonalReadingSource(requester, materialId, context = {}, deps = {}) {
  personalContext(requester, context);
  const value = await rpc(requester, materialId, 'source', {}, deps);
  if (!require('./materialTextNormalization').hasReadableText(value.text)) {
    throw new PersonalMaterialError('This material has no usable reviewed text.', 422);
  }
  return { id: null, materialId, activityAssignmentId: null, roomId: null, assignmentId: null, passageId: null,
    title: value.title, passageTitle: value.title, passage: value.text, language: value.language,
    passageRevision: require('./assignedReadingSource').passageRevision(value.text), difficulty: '', learningPath: '' };
}
async function loadMaterialReadingSource(requester, materialId, context, deps = {}) {
  return requester.profile.role === 'general_user'
    ? loadPersonalReadingSource(requester, materialId, context, deps)
    : require('./assignedReadingSource').loadAssignedReadingSource(requester, materialId, context, deps);
}
/**
 * Generates the private question set for the current text. With `replace`, gets NEW questions for the same text before
 * any assessment (personal_material_3: the current set is kept and marked replaced, and it still counts toward the
 * 5-per-24-hours limit). The database refuses a replacement once an assessment exists.
 */
async function generatePersonalQuestions(requester, materialId, deps = {}, { replace = false } = {}) {
  const source = await loadPersonalReadingSource(requester, materialId, {}, deps);
  if (source.passage.length > MAX_QUESTION_CONTENT_LENGTH) throw new PersonalMaterialError('This material exceeds the 30,000-character question-generation limit.', 413);
  const db = dbFor(deps);
  const call = async (operation, token = null, bank = null) => {
    const { data, error } = await db.rpc('personal_material_generation', { actor: requester.user.id, material: materialId, operation, token, bank });
    throwIfContentScreen(error);
    if (error) throw new PersonalMaterialError(error.code === 'P0001' ? error.message : 'Private question generation is unavailable. Please retry.', error.code === '42501' ? 403 : 409);
    return data;
  };
  let previousQuestions = [];
  if (replace) {
    if (!(await personalFeatures(db)).newQuestions) throw new PersonalMaterialError(NEW_QUESTIONS_UNAVAILABLE);
    // Ask for different questions than the ones being replaced.
    const current = await loadPersonalBank(requester, materialId, deps);
    previousQuestions = (current?.questions ?? []).map(q => ({ type: q.type, questionText: q.questionText }));
  }
  const reservation = await call(replace ? 'begin_replace' : 'begin');
  if (reservation.reused) return reservation;
  try {
    // Bind the provider input to the revision reserved in the database. A concurrent
    // edit before reservation must never save a bank generated from stale source text.
    const reservedSource = await loadPersonalReadingSource(requester, materialId, {}, deps);
    if (reservedSource.passage !== source.passage || reservedSource.language !== source.language) {
      throw new PersonalMaterialError('The material changed. Review it and generate again.');
    }
    const generated = await (deps.generate ?? generateComprehensionQuestions)({ contentText: source.passage, language: source.language, questionCount: 9, previousQuestions });
    const validated = validateGeneratedQuestions({ questions: generated }, 9, source.passage);
    const bank = validated.map(q => ({ id: randomUUID(), type: q.type, questionText: q.questionText, options: q.options,
      scaffoldingHint: q.scaffoldingHint, correctOptionIndex: q.options.indexOf(q.correctAnswer),
      answerExplanation: q.answerExplanation, supportingEvidence: q.supportingEvidence }));
    return await call(replace ? 'finish_replace' : 'finish', reservation.token, bank);
  } catch (error) {
    // Expired tokens cannot release a newer worker's lease. A crashed process expires after five minutes.
    await call('fail', reservation.token).catch(() => undefined);
    throw error;
  }
}
async function loadPersonalBank(requester, materialId, deps = {}) {
  return rpc(requester, materialId, 'bank', {}, deps);
}
/** Material id -> time it was moved to Trash (soft deletion in personal_material_state). */
async function deletedPersonalMaterials(db, ids) {
  if (!ids.length) return new Map();
  const { data, error } = await db.from('personal_material_state').select('material_id,deleted_at').in('material_id', ids);
  if (error && ['42P01', 'PGRST205'].includes(error.code)) return new Map(); // Before installation, no soft deletions exist.
  if (error) throw new PersonalMaterialError('Unable to verify material availability. Please retry.');
  return new Map((data ?? []).filter(row => row.deleted_at).map(row => [row.material_id, row.deleted_at]));
}
async function deletedPersonalIds(db, ids) {
  return new Set((await deletedPersonalMaterials(db, ids)).keys());
}

// Independent Learner question preview before the scored assessment. Read-only and owner-only (the database checks
// uploaded_by = actor, the general_user role and that the material is not in Trash). It sends only what the learner
// sees while answering: never the correct option, explanation, supporting evidence or hint. Nothing is written, so
// previewing never starts or uses the single comprehension assessment.
const PREVIEW_FIELDS = ['id', 'type', 'questionText', 'options'];
async function previewPersonalQuestions(requester, materialId, deps = {}) {
  const bank = await loadPersonalBank(requester, materialId, deps);
  const questions = Array.isArray(bank?.questions) ? bank.questions : [];
  return {
    questionSetId: bank?.id ?? null,
    questions: questions.map(q => Object.fromEntries(PREVIEW_FIELDS.map(field => [field, field === 'options' ? [...(q.options ?? [])] : q[field] ?? null]))),
  };
}

// Correcting the extracted text. Only the reading text used for practice changes: the original file and the raw
// extraction are kept. Saved readings, assessments and question sets keep their own copies (passage_snapshot,
// passage_text, question_snapshot), so they never change. The database trigger personal_material_text_guard decides:
//  - before personal_material_3 is installed: editing is allowed only until practice starts;
//  - after it: editing is allowed at any time except while an assessment is unfinished (its answers are checked
//    against the current text) or questions are being generated.
// A changed text has a new revision: it must be confirmed again, read aloud again, and questions for the old text are
// never used for it.
const PRACTICE_STARTED_MESSAGE = 'You already practiced with this text, so it can no longer be changed. Upload a corrected copy to practice with new text.';
const ASSESSMENT_UNFINISHED_MESSAGE = 'Finish your comprehension first. Then you can edit the text.';
const NEW_QUESTIONS_UNAVAILABLE = 'Getting new questions is not available yet.';

/** Which optional database features (personal_material_3) are installed. Missing function = not installed. */
async function personalFeatures(db) {
  const { data, error } = await db.rpc('personal_material_features', {});
  if (error) {
    if (['PGRST202', '42883'].includes(error.code)) return {};
    throw new PersonalMaterialError('Unable to load personal practice. Please retry.');
  }
  return data && typeof data === 'object' ? data : {};
}

/** The practice state plus what the learner may do next (the database still enforces every rule). */
async function personalPracticeState(requester, materialId, deps = {}) {
  const state = await rpc(requester, materialId, 'status', {}, deps);
  const db = dbFor(deps);
  const features = await personalFeatures(db);
  const assessmentUnfinished = Boolean(state.attemptId) && state.attemptStatus !== 'completed';
  const started = Boolean(state.questionSetId || state.readingId || state.attemptId) || await personalPracticeStarted(db, materialId);
  // Questions exist only for an older version of the text: new questions are needed before answering.
  let questionsOutdated = false;
  if (!state.questionSetId && !state.attemptId) {
    const { data, error } = await db.from('personal_material_question_sets').select('revision').eq('material_id', materialId).eq('user_id', requester.user.id);
    if (error) throw new PersonalMaterialError('Unable to load personal practice. Please retry.');
    questionsOutdated = (data ?? []).some(row => row.revision !== state.revision);
  }
  return {
    ...state,
    questionsOutdated,
    canEditText: !assessmentUnfinished && (!started || Boolean(features.textEditsAfterPractice)),
    textLockedReason: assessmentUnfinished ? 'assessment_unfinished' : started && !features.textEditsAfterPractice ? 'practice_started' : null,
    canGetNewQuestions: Boolean(features.newQuestions) && Boolean(state.questionSetId) && !state.attemptId,
    // Questions are locked once an assessment exists (its own frozen copy is what is scored).
    questionsLockedReason: !state.attemptId ? null : state.attemptStatus === 'completed' ? 'assessment_completed' : 'assessment_unfinished',
  };
}

async function personalPracticeStarted(db, materialId) {
  const checks = await Promise.all([
    db.from('oral_reading_attempts').select('id').eq('material_id', materialId).is('activity_assignment_id', null).limit(1),
    db.from('personal_material_question_sets').select('id').eq('material_id', materialId).limit(1),
    db.from('modules').select('id').eq('source_material_id', materialId).limit(1),
  ]);
  for (const { data, error } of checks) {
    if (error) throw new PersonalMaterialError('Unable to check your practice history. Please retry.');
    if (data?.length) return true;
  }
  return false;
}
async function updatePersonalMaterialText(requester, materialId, { contentText, revision } = {}, deps = {}) {
  personalContext(requester);
  if (typeof contentText !== 'string') throw new PersonalMaterialError('Enter the reading text before saving.', 400);
  const text = contentText.replace(/\r\n?/g, '\n').trim();
  if (!text) throw new PersonalMaterialError('Enter the reading text before saving.', 400);
  if (text.length > MAX_MATERIAL_TEXT_LENGTH) throw new PersonalMaterialError('The reading text is too long to save.', 413);
  // Owner, not in Trash, completed English/Filipino text (the database checks all three).
  const state = await rpc(requester, materialId, 'status', {}, deps);
  if (typeof revision !== 'string' || revision !== state.revision) throw new PersonalMaterialError('The text changed. Review it again');
  const db = dbFor(deps);
  if (state.attemptId && state.attemptStatus !== 'completed') throw new PersonalMaterialError(ASSESSMENT_UNFINISHED_MESSAGE);
  if (!(await personalFeatures(db)).textEditsAfterPractice
    && (state.questionSetId || state.readingId || state.attemptId || await personalPracticeStarted(db, materialId))) {
    throw new PersonalMaterialError(PRACTICE_STARTED_MESSAGE);
  }
  const { data: current, error: readError } = await db.from('uploaded_materials').select('content_text')
    .eq('id', materialId).eq('uploaded_by', requester.user.id).maybeSingle();
  if (readError) throw new PersonalMaterialError('Unable to save your text. Please retry.');
  if (!current) throw new PersonalMaterialError('This personal material is unavailable to your account.', 403);
  if ((current.content_text ?? '').trim() === text) return state; // Unchanged: the confirmation stays valid.
  // Compare-and-set on the text read above: a concurrent change is refused, never overwritten.
  const { data: saved, error } = await db.from('uploaded_materials').update({ content_text: text })
    .eq('id', materialId).eq('uploaded_by', requester.user.id).eq('content_text', current.content_text).select('id').maybeSingle();
  throwIfContentScreen(error);
  if (error) {
    const message = error.code === 'P0001' ? error.message ?? '' : '';
    throw new PersonalMaterialError(/practice has started/i.test(message) ? PRACTICE_STARTED_MESSAGE
      : [ASSESSMENT_UNFINISHED_MESSAGE, 'A generation is already running. Please wait'].includes(message) ? message
        : 'Unable to save your text. Please retry.');
  }
  if (!saved) throw new PersonalMaterialError('The text changed. Review it again');
  return rpc(requester, materialId, 'status', {}, deps);
}

// Trash -> My Materials. Removal only ever set personal_material_state.deleted_at (nothing is erased), so restoring
// clears it again: the file, text, confirmation, private questions, readings and results come back unchanged, and an
// unfinished assessment can be resumed under the usual one-assessment rule.
async function restorePersonalMaterial(requester, materialId, deps = {}) {
  personalContext(requester);
  const db = dbFor(deps);
  const { data: material, error } = await db.from('uploaded_materials').select('id,uploaded_by').eq('id', materialId).maybeSingle();
  if (error) throw new PersonalMaterialError('Unable to restore this material. Please retry.');
  if (!material || material.uploaded_by !== requester.user.id) throw new PersonalMaterialError('This personal material is unavailable to your account.', 403);
  const { data: state, error: stateError } = await db.from('personal_material_state').select('material_id,deleted_at').eq('material_id', materialId).maybeSingle();
  if (stateError) throw new PersonalMaterialError('Unable to restore this material. Please retry.');
  if (!state?.deleted_at) throw new PersonalMaterialError('This material is not in Trash.');
  const { data: restored, error: restoreError } = await db.from('personal_material_state').update({ deleted_at: null })
    .eq('material_id', materialId).select('material_id').maybeSingle();
  if (restoreError || !restored) throw new PersonalMaterialError('Unable to restore this material. Please retry.');
  return { restored: true };
}
module.exports = { PersonalMaterialError, personalContext, loadMaterialReadingSource, loadPersonalReadingSource,
  generatePersonalQuestions, loadPersonalBank, previewPersonalQuestions, updatePersonalMaterialText, restorePersonalMaterial,
  personalPracticeState, personalFeatures,
  personalMaterialAccess: rpc, deletedPersonalIds, deletedPersonalMaterials };
