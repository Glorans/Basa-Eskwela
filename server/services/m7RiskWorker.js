const { getSupabaseAdmin } = require('./supabaseAdmin');
let running = false;
let lastError = '';
async function drainRiskQueue(dependencies = {}) {
  if (running) return;
  running = true;
  try {
    const db = (dependencies.getSupabaseAdmin ?? getSupabaseAdmin)();
    const { data: jobs, error } = await db.from('m7_risk_queue').select('*').order('updated_at').limit(50);
    if (error) throw new Error('M7 risk queue unavailable; apply the M7 analytics migration.');
    for (const job of jobs) {
      try {
        // The database derives and authorizes every transition atomically.
        // No caller-supplied teacher IDs, scores, or alert payloads are accepted.
        const { error: saveError } = await db.rpc('m7_save_evaluation', {
          target_student: job.id, expected_generation: job.generation,
        });
        if (saveError) throw new Error('Unable to persist risk evaluation.');
      } catch (error) {
        // Keep the job durable, but move failures behind other students to avoid starvation.
        await db.from('m7_risk_queue').update({ updated_at: new Date().toISOString() }).eq('id',job.id).eq('generation',job.generation);
        console.error('[M7 evaluation pending]', error.message);
      }
    }
    lastError = '';
  } catch (error) {
    if (lastError !== error.message) console.error('[M7 worker]',error.message);
    lastError = error.message;
  } finally { running = false; }
}
// Off until the M7 analytics migration and its dependencies are verified on the target database.
function isRiskWorkerEnabled(env = process.env) {
  return env.M7_RISK_WORKER_ENABLED === 'true';
}
function startRiskWorker(env = process.env) {
  if (!isRiskWorkerEnabled(env)) return () => {};
  void drainRiskQueue();
  const timer = setInterval(() => void drainRiskQueue(),15000);
  timer.unref();
  return () => clearInterval(timer);
}
module.exports = { startRiskWorker, drainRiskQueue, isRiskWorkerEnabled };
