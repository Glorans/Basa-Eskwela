// Private practice is an additional source, never a classroom or a catalog module.
const { randomUUID } = require('node:crypto');
const { getSupabaseAdmin } = require('./supabaseAdmin');
const { generateComprehensionQuestions, validateGeneratedQuestions, MAX_QUESTION_CONTENT_LENGTH } = require('./questionGenerationService');

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
async function generatePersonalQuestions(requester, materialId, deps = {}) {
  const source = await loadPersonalReadingSource(requester, materialId, {}, deps);
  if (source.passage.length > MAX_QUESTION_CONTENT_LENGTH) throw new PersonalMaterialError('This material exceeds the 30,000-character question-generation limit.', 413);
  const db = dbFor(deps);
  const call = async (operation, token = null, bank = null) => {
    const { data, error } = await db.rpc('personal_material_generation', { actor: requester.user.id, material: materialId, operation, token, bank });
    if (error) throw new PersonalMaterialError(error.code === 'P0001' ? error.message : 'Private question generation is unavailable. Please retry.', error.code === '42501' ? 403 : 409);
    return data;
  };
  const reservation = await call('begin');
  if (reservation.reused) return reservation;
  try {
    // Bind the provider input to the revision reserved in the database. A concurrent
    // edit before reservation must never save a bank generated from stale source text.
    const reservedSource = await loadPersonalReadingSource(requester, materialId, {}, deps);
    if (reservedSource.passage !== source.passage || reservedSource.language !== source.language) {
      throw new PersonalMaterialError('The material changed. Review it and generate again.');
    }
    const generated = await (deps.generate ?? generateComprehensionQuestions)({ contentText: source.passage, language: source.language, questionCount: 9, previousQuestions: [] });
    const validated = validateGeneratedQuestions({ questions: generated }, 9, source.passage);
    const bank = validated.map(q => ({ id: randomUUID(), type: q.type, questionText: q.questionText, options: q.options,
      scaffoldingHint: q.scaffoldingHint, correctOptionIndex: q.options.indexOf(q.correctAnswer),
      answerExplanation: q.answerExplanation, supportingEvidence: q.supportingEvidence }));
    return await call('finish', reservation.token, bank);
  } catch (error) {
    // Expired tokens cannot release a newer worker's lease. A crashed process expires after five minutes.
    await call('fail', reservation.token).catch(() => undefined);
    throw error;
  }
}
async function loadPersonalBank(requester, materialId, deps = {}) {
  return rpc(requester, materialId, 'bank', {}, deps);
}
async function deletedPersonalIds(db, ids) {
  if (!ids.length) return new Set();
  const { data, error } = await db.from('personal_material_state').select('material_id,deleted_at').in('material_id', ids);
  if (error && ['42P01', 'PGRST205'].includes(error.code)) return new Set(); // Before installation, no soft deletions exist.
  if (error) throw new PersonalMaterialError('Unable to verify material availability. Please retry.');
  return new Set((data ?? []).filter(row => row.deleted_at).map(row => row.material_id));
}
module.exports = { PersonalMaterialError, personalContext, loadMaterialReadingSource, loadPersonalReadingSource,
  generatePersonalQuestions, loadPersonalBank, personalMaterialAccess: rpc, deletedPersonalIds };
