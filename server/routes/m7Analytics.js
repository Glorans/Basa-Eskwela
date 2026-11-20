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
router.get('/system',wrap(async req => {
  const requester = await authorizeAdminRequest(req);
  return require('../services/adminSystemAnalytics').getAdminSystemAnalytics(requester, req.query, { rows: analytics.rows, quizzes: analytics.quizzes });
}));
router.get('/teacher',wrap(async req => { const requester = await authorizeTeacherOralReadingRequest(req); return analytics.teacher(requester.user.id); }));
router.get('/teacher/quizzes',wrap(async req => {
  const requester = await authorizeTeacherOralReadingRequest(req);
  return require('../services/m7TeacherQuizzes').getTeacherQuizzes(requester);
}));
router.post('/students/:studentId/interventions',wrap(async req => {
  const requester = await authorizeTeacherOralReadingRequest(req);
  return analytics.saveIntervention(requester.user.id,req.params.studentId,null,req.body);
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
  const own = await analytics.rows('m7_interventions','*',{ teacher_id: requester.user.id, student_id: req.params.studentId });
  const detail = adminAnalytics().buildAdminStudentDetail(await adminData(await schoolMembers(requester)), req.params.studentId, requester.user.id, own);
  return { ...detail, historicalQuizzes: await analytics.historicalQuizzes({ user_id: req.params.studentId }) };
}));
router.post('/admin/students/:studentId/interventions',wrap(async req => {
  const requester = await authorizeAdminRequest(req);
  return analytics.saveIntervention(requester.user.id,req.params.studentId,null,req.body,{ authorize: () => analytics.requireAdminStudent(req.params.studentId, undefined, requester.schoolId) });
}));
router.patch('/admin/students/:studentId/interventions/:id',wrap(async req => {
  const requester = await authorizeAdminRequest(req);
  return analytics.saveIntervention(requester.user.id,req.params.studentId,req.params.id,req.body,{ authorize: () => analytics.requireAdminStudent(req.params.studentId, undefined, requester.schoolId) });
}));
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
router.get('/system-admin/independent-learners/:learnerId',wrap(async req => {
  await authorizeSystemAdminRequest(req);
  return systemAdmin().independentLearnerDetail(req.params.learnerId);
}));
module.exports = router;
