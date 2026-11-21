const express = require('express');
const { authorizeOralReadingRequest, authorizeTeacherOralReadingRequest } = require('../services/oralReadingAttemptService');
const { authorizeAdminRequest, authorizeSystemAdminRequest } = require('../services/adminUserService');
const { SupabaseAuthenticationError, SupabaseServerConfigurationError, getSupabaseAdmin } = require('../services/supabaseAdmin');
const analytics = require('../services/m7Analytics');
const router = express.Router();
const wrap = handler => async (req,res) => {
  try { res.json({ success: true, data: await handler(req) }); }
  catch(error) {
    const status = error instanceof SupabaseAuthenticationError ? 401 : error instanceof SupabaseServerConfigurationError ? 503 : error.statusCode || 500;
    if (status >= 500) console.error('[M7 analytics]',error.message);
    res.status(status).json({ success: false, message: status >= 500 ? 'Unable to load or save analytics. Check that the M7 migrations are installed and retry.' : error.message });
  }
};
// Students and Independent Learners: only the signed-in learner's own records.
router.get('/personal',wrap(async req => {
  const requester = await authorizeOralReadingRequest(req);
  if (!['student','general_user'].includes(requester.profile.role)) throw analytics.fail('Learner access is required.',403);
  // Independent Learners have no classroom assignments to report, so their classroom reads are skipped. The role
  // comes from the verified profile above, never from the request.
  const data = await analytics.personal(requester.user.id, { includeActivities: requester.profile.role === 'student' });
  return requester.profile.role === 'general_user' ? { ...data, activities: [] } : data;
}));
// M7 F10 for Students and Independent Learners: suggested practice from the signed-in learner's OWN results only
// (classroom and personal practice; Independent Learners have no classroom). Simple wording, no labels, no
// intervention records. The learner id always comes from the verified session, never from the request.
router.get('/personal/suggestions',wrap(async req => {
  const requester = await authorizeOralReadingRequest(req);
  if (!['student','general_user'].includes(requester.profile.role)) throw analytics.fail('Learner access is required.',403);
  const s = require('../services/m7Suggestions');
  return s.learnerView(await s.suggestionsFor(requester.user.id, { include: () => true, interventions: [] }));
}));
router.get('/system',wrap(async req => {
  const requester = await authorizeAdminRequest(req);
  return require('../services/adminSystemAnalytics').getAdminSystemAnalytics(requester, req.query, { rows: analytics.rows, quizzes: analytics.quizzes });
}));
router.get('/teacher',wrap(async req => { const requester = await authorizeTeacherOralReadingRequest(req); return analytics.teacher(requester.user.id); }));
router.get('/teacher/quizzes',wrap(async req => {
  const requester = await authorizeTeacherOralReadingRequest(req);
  return require('../services/m7TeacherQuizzes').getTeacherQuizzes(requester);
}));
// M7 F10 suggested interventions. Teacher: evidence from the Teacher's own classrooms only (the same scope as the
// competency report); personal practice is never attributed to a Teacher. Rule-based, read-only: see m7Suggestions.js.
const suggestions = () => require('../services/m7Suggestions');
async function teacherSuggestions(teacherId, studentId) {
  const scope = await analytics.requireStudent(teacherId, studentId);
  const roomIds = scope.enrollments.filter(e => e.student_id === studentId).map(e => e.room_id);
  const own = await analytics.rows('m7_interventions','*',{ teacher_id: teacherId, student_id: studentId });
  return suggestions().suggestionsFor(studentId, { include: row => Boolean(row.room_id) && roomIds.includes(row.room_id), interventions: own });
}
router.get('/students/:studentId/suggestions',wrap(async req => {
  const requester = await authorizeTeacherOralReadingRequest(req);
  return teacherSuggestions(requester.user.id, req.params.studentId);
}));
router.post('/students/:studentId/interventions',wrap(async req => {
  const requester = await authorizeTeacherOralReadingRequest(req);
  return analytics.saveIntervention(requester.user.id,req.params.studentId,null,req.body,{ suggest: () => teacherSuggestions(requester.user.id, req.params.studentId) });
}));
router.patch('/students/:studentId/interventions/:id',wrap(async req => {
  const requester = await authorizeTeacherOralReadingRequest(req);
  return analytics.saveIntervention(requester.user.id,req.params.studentId,req.params.id,req.body);
}));
router.patch('/notifications/:id/read',wrap(async req => {
  const requester = await authorizeTeacherOralReadingRequest(req);
  const db = getSupabaseAdmin();
  const { data, error } = await db.from('m7_risk_events').select('student_id').eq('id',req.params.id).eq('teacher_id',requester.user.id).maybeSingle();
  if (error || !data) throw analytics.fail('Notification not found.',404);
  await analytics.requireStudent(requester.user.id,data.student_id);
  const result = await db.from('m7_risk_events').update({read_at: new Date().toISOString()}).eq('id',req.params.id).eq('teacher_id',requester.user.id);
  if (result.error) throw analytics.fail('Unable to mark notification read.');
  return { id: req.params.id };
}));
// ---- Admin student performance, competency and interventions (Admin only; Student-role learners) ----
const adminAnalytics = () => require('../services/adminSystemAnalytics');
// M1 multi-tenancy: every Admin view is limited to the School Admin's own school (school read from the database).
const schoolMembers = requester => require('../services/schoolScope').requesterSchoolMembers(requester).then(scope => scope.members);
const adminData = members => adminAnalytics().loadAdminData({ rows: analytics.rows, quizzes: analytics.quizzes }, members);
router.get('/admin/students',wrap(async req => {
  const requester = await authorizeAdminRequest(req);
  return adminAnalytics().buildAdminStudents(await adminData(await schoolMembers(requester)));
}));
router.get('/admin/students/:studentId',wrap(async req => {
  const requester = await authorizeAdminRequest(req);
  await analytics.requireAdminStudent(req.params.studentId, undefined, requester.schoolId);
  const detail = adminAnalytics().buildAdminStudentDetail(await adminData(await schoolMembers(requester)), req.params.studentId, requester.user.id, []);
  // Appendix N M7 F11 is Teacher-only: the School Admin sees every intervention recorded for this Student by an
  // author of the Admin's own school, read-only. Teachers' private notes (teacher_notes) are not returned.
  const history = await analytics.schoolInterventionHistory(req.params.studentId, requester.schoolId);
  return { ...detail, interventions: { ...detail.interventions, own: [], history }, historicalQuizzes: await analytics.historicalQuizzes({ user_id: req.params.studentId }) };
}));
// School Admin: the same rules over the Student's classroom work in the Admin's own school (M1 multi-tenancy).
async function adminSuggestions(requester, studentId) {
  await analytics.requireAdminStudent(studentId, undefined, requester.schoolId);
  const roomIds = await analytics.adminStudentRoomIds(studentId, requester.schoolId);
  // "Results since the intervention" uses the school's recorded interventions (Teachers record them).
  const recorded = await analytics.schoolInterventionHistory(studentId, requester.schoolId);
  return suggestions().suggestionsFor(studentId, { include: row => Boolean(row.room_id) && roomIds.includes(row.room_id),
    interventions: recorded.map(i => ({ id: i.id, competency: i.competency, language: i.language, intervention_date: i.intervention_date, status: i.status })) });
}
router.get('/admin/students/:studentId/suggestions',wrap(async req => {
  const requester = await authorizeAdminRequest(req);
  return adminSuggestions(requester, req.params.studentId);
}));
// Appendix N M7 F11 (Record Student Interventions) is Teacher-only. School Admins keep read-only access to the
// suggestions and their school's intervention history; earlier Admin-authored records stay in that history.
const teacherOnly = () => analytics.fail('Only Teachers record student interventions. School Admins can view the intervention history.', 403);
router.post('/admin/students/:studentId/interventions',wrap(async req => { await authorizeAdminRequest(req); throw teacherOnly(); }));
router.patch('/admin/students/:studentId/interventions/:id',wrap(async req => { await authorizeAdminRequest(req); throw teacherOnly(); }));
// ---- System Admin (M7 F2 platform overview, F4 Independent Learner performance). Read-only; System Admin only. ----
// School Admin, Teacher and learner routes above are unchanged; /system and /admin/* stay School Admin only.
const systemAdmin = () => require('../services/systemAdminAnalytics');
router.get('/system-admin/overview',wrap(async req => {
  await authorizeSystemAdminRequest(req);
  return systemAdmin().platformOverview();
}));
router.get('/system-admin/independent-learners',wrap(async req => {
  await authorizeSystemAdminRequest(req);
  return systemAdmin().independentLearners();
}));
// M7 F10 for the System Admin: read-only. Platform-wide counts by competency and language (no names), and one
// Independent Learner's suggestions without private text. School Students are never shown individually here.
router.get('/system-admin/suggestions',wrap(async req => {
  await authorizeSystemAdminRequest(req);
  return require('../services/m7Suggestions').platformSummary();
}));
router.get('/system-admin/independent-learners/:learnerId/suggestions',wrap(async req => {
  await authorizeSystemAdminRequest(req);
  const id = req.params.learnerId;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw analytics.fail('Independent Learner not found.',404);
  const [profile] = await analytics.rows('profiles','id,role',{ id });
  if (!profile || profile.role !== 'general_user') throw analytics.fail('Independent Learner not found.',404);
  const s = require('../services/m7Suggestions');
  const [evaluation, attempts, readings] = await Promise.all([s.suggestionsFor(id, { include: () => true, interventions: [] }),
    analytics.rows('m6_comprehension_attempts','id,module_id',{ user_id: id }), analytics.rows('oral_reading_attempts','id,module_id',{ user_id: id })]);
  const moduleIds = [...new Set([...attempts, ...readings].map(r => r.module_id).filter(Boolean))];
  const moduleTitles = new Map((moduleIds.length ? await analytics.rows('modules','id,title',{ id: moduleIds }) : []).map(m => [m.id, m.title]));
  return s.systemAdminProjection(evaluation, { attempts, readings, moduleTitles });
}));
router.get('/system-admin/independent-learners/:learnerId',wrap(async req => {
  await authorizeSystemAdminRequest(req);
  return systemAdmin().independentLearnerDetail(req.params.learnerId);
}));
module.exports = router;
