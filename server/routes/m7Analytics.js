const express = require('express');
const { authorizeOralReadingRequest, authorizeTeacherOralReadingRequest } = require('../services/oralReadingAttemptService');
const { authorizeAdminRequest } = require('../services/adminUserService');
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
router.get('/personal',wrap(async req => {
  const requester = await authorizeOralReadingRequest(req);
  if (requester.profile.role !== 'student') throw analytics.fail('Student access is required.',403);
  return analytics.personal(requester.user.id);
}));
router.get('/system',wrap(async req => {
  const requester = await authorizeAdminRequest(req);
  return require('../services/adminSystemAnalytics').getAdminSystemAnalytics(requester, req.query, { rows: analytics.rows, quizzes: analytics.quizzes });
}));
router.get('/teacher',wrap(async req => { const requester = await authorizeTeacherOralReadingRequest(req); return analytics.teacher(requester.user.id); }));
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
module.exports = router;
