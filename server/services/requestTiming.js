const { AsyncLocalStorage } = require("node:async_hooks");

// Performance instrumentation only: adds a Server-Timing header, e.g. "auth;dur=212.4, app;dur=845.0",
// to M6, M7 and Teacher reading responses, so the browser's Network panel shows how much of a request was
// the login check (Supabase Auth) and how much was the whole server time. Durations only: never tokens,
// user ids, answers or any response data. A route that sets its own Server-Timing keeps it.
const storage = new AsyncLocalStorage();

function requestTiming(req, res, next) {
  const store = { startedAt: performance.now(), authMs: 0 };
  const writeHead = res.writeHead;
  res.writeHead = function writeHeadWithTiming(...args) {
    try {
      if (!res.headersSent && !res.getHeader("Server-Timing")) {
        const app = performance.now() - store.startedAt;
        res.setHeader("Server-Timing", `auth;dur=${store.authMs.toFixed(1)}, app;dur=${app.toFixed(1)}`);
      }
    } catch { /* timing never affects the response */ }
    return writeHead.apply(this, args);
  };
  storage.run(store, next);
}

/** Adds time spent verifying the login (Supabase Auth) to the current request, if it is being timed. */
function recordAuthMs(ms) {
  const store = storage.getStore();
  if (store && Number.isFinite(ms)) store.authMs += ms;
}

module.exports = { recordAuthMs, requestTiming };
