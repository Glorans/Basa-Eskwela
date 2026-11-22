/** Page-lifetime, authorization-scoped GET cache. No module-global records or persistent storage. */
export type StudentPerformanceFetch = <T>(path: string, signal: AbortSignal) => Promise<T>;
export type StudentPerformanceRequests = ReturnType<typeof createStudentPerformanceRequests>;
const TTL_MS = 30_000;
const MAX_ENTRIES = 24;
let nextScope = 0;

export function createStudentPerformanceRequests(fetcher: StudentPerformanceFetch, now = Date.now) {
  type Entry = { promise: Promise<unknown>; controller: AbortController; expires: number; settled: boolean; cancel?: ReturnType<typeof setTimeout> };
  const entries = new Map<string, Entry>();
  let disposal: ReturnType<typeof setTimeout> | undefined;
  const remove = (path: string, entry: Entry) => {
    clearTimeout(entry.cancel); entry.controller.abort();
    if (entries.get(path) === entry) entries.delete(path);
  };
  const clear = () => { entries.forEach((entry, path) => remove(path, entry)); };
  const request = <T>(path: string): Promise<T> => {
    // Never cache writes or arbitrary endpoints. The caller supplies only existing authorized GETs.
    if (path !== '/system' && path !== '/admin/students' && !/^\/admin\/students\/[^/]+(?:\/suggestions)?$/.test(path)) return Promise.reject(new Error('Unsupported student performance request.'));
    const existing = entries.get(path);
    if (existing) {
      clearTimeout(existing.cancel);
      if (!existing.settled || existing.expires > now()) return existing.promise as Promise<T>;
      remove(path, existing);
    }
    const controller = new AbortController();
    const entry: Entry = { controller, expires: 0, settled: false, promise: Promise.resolve() };
    // Defer execution until after insertion, so same-turn consumers share the entire request, including auth headers.
    entry.promise = Promise.resolve().then(() => fetcher<T>(path, controller.signal)).then(value => {
      if (controller.signal.aborted || entries.get(path) !== entry) throw new Error('Request no longer active.');
      entry.settled = true; entry.expires = now() + TTL_MS;
      return value;
    }).catch(error => {
      if (entries.get(path) === entry) entries.delete(path);
      // A failed validation/request must not leave other completed sensitive snapshots reusable.
      if (!controller.signal.aborted) entries.forEach((other, key) => { if (other.settled) remove(key, other); });
      throw error;
    });
    entries.set(path, entry);
    if (entries.size > MAX_ENTRIES) {
      const oldest = entries.entries().next().value;
      if (oldest) remove(...oldest);
    }
    return entry.promise as Promise<T>;
  };
  return {
    scope: ++nextScope,
    request,
    invalidate(path: string) { const entry = entries.get(path); if (entry) remove(path, entry); },
    cancelStudent(studentId: string) {
      const base = `/admin/students/${encodeURIComponent(studentId)}`;
      for (const path of [base, `${base}/suggestions`]) {
        const entry = entries.get(path);
        if (entry && !entry.settled) {
          // Strict Mode immediately re-subscribes; real selection changes cancel on the next task.
          clearTimeout(entry.cancel);
          entry.cancel = setTimeout(() => { if (!entry.settled) remove(path, entry); }, 0);
        }
      }
    },
    retain() { clearTimeout(disposal); },
    release() { clearTimeout(disposal); disposal = setTimeout(clear, 0); },
    clear,
  };
}
