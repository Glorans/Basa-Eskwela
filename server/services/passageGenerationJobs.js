// Process-local duplicate suppression and progress, never a source of authorization.
// A lost save response stays uncertain; do not expire it into an automatic retry.
function createPassageGenerationJobs() {
  const jobs = new Map();
  const key = (module, passage, revision) => JSON.stringify([module, passage, revision]);
  return {
    get(module, passage, revision) { return jobs.get(key(module, passage, revision)); },
    start(module, passage, revision) {
      const id = key(module, passage, revision);
      const previous = jobs.get(id);
      if (previous && previous.state !== 'failed') return { job: previous, started: false };
      for (const [k, job] of jobs) {
        if (['saved', 'failed'].includes(job.state) && Date.now() - job.updatedAt > 30 * 60_000) jobs.delete(k);
      }
      if (jobs.size >= 1000) throw Object.assign(new Error('Generation capacity reached'), { statusCode: 503 });
      const job = { state: 'generating', updatedAt: Date.now() };
      jobs.set(id, job);
      return { job, started: true };
    },
  };
}
module.exports = { createPassageGenerationJobs };
