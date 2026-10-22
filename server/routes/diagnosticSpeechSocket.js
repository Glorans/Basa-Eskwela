const { WebSocketServer, WebSocket } = require("ws");
const { authorizeOralReadingPracticeRequest } = require("../services/oralReadingAttemptService");
const { SPEECH_STREAM_SESSION_LIMIT, createRequestLimiter } = require("../services/speechAccess");
const {
  createDiagnosticSpeechSession, developmentLog, SAFE_STREAM_ERROR,
} = require("../services/diagnosticSpeechStream");

// The browser treats every error as "use the recording upload instead", so the
// learner-facing message stays the same; the code and close reason differ.
const REJECTION = Object.freeze({
  unavailable: { code: "STREAM_UNAVAILABLE", close: 1008, reason: "Diagnostic stream unavailable" },
  rateLimited: { code: "SPEECH_RATE_LIMITED", close: 1013, reason: "Too many diagnostic streams" },
  replaced: { code: "STREAM_REPLACED", close: 4000, reason: "Replaced by a newer diagnostic stream" },
});

function attachDiagnosticSpeechSocket(server, {
  // Same Supabase token check and roles as the speech HTTP endpoints (student,
  // general_user, admin). Teachers and accounts without a role are rejected.
  authorize = (token) => authorizeOralReadingPracticeRequest({ get: () => `Bearer ${token}` }),
  createSession = createDiagnosticSpeechSession,
  allowedOrigins = (process.env.DIAGNOSTIC_WS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
    .split(",").map((origin) => origin.trim()),
  sessionLimit = SPEECH_STREAM_SESSION_LIMIT,
  now = Date.now,
} = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384, perMessageDeflate: false });
  // In-memory, per backend instance: user id -> the connection holding the live stream.
  const activeStreams = new Map();
  const sessionStarts = createRequestLimiter({ ...sessionLimit, now });
  const onUpgrade = (req, socket, head) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname !== "/ws/diagnostic/speech" || !allowedOrigins.includes(req.headers.origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  };
  server.on("upgrade", onUpgrade);

  wss.on("connection", (ws) => {
    let session;
    let userId;
    let configuring = false;
    let closed = false;
    const connection = { end: (rejection) => reject(rejection) };
    const send = (message) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    };
    function release() {
      if (userId && activeStreams.get(userId) === connection) activeStreams.delete(userId);
    }
    function reject(rejection = REJECTION.unavailable) {
      send({ type: "error", code: rejection.code, message: SAFE_STREAM_ERROR });
      session?.dispose();
      release();
      ws.close(rejection.close, rejection.reason);
    }
    const configTimer = setTimeout(() => reject(), 10000);
    configTimer.unref();
    let alive = true;
    const heartbeat = setInterval(() => {
      if (!alive) { ws.terminate(); return; }
      alive = false;
      ws.ping();
    }, 15000);
    heartbeat.unref();
    ws.on("pong", () => { alive = true; });
    ws.on("message", async (raw, binary) => {
      if (closed) return;
      if (binary) {
        if (!session) { reject(); return; }
        session.acceptAudio(raw);
        return;
      }
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === "stop" && session) { session.stop(); return; }
        if (message.type !== "configure" || configuring || session
          || message.encoding !== "LINEAR16" || message.sampleRate !== 16000 || message.channels !== 1
          || typeof message.accessToken !== "string" || !message.accessToken) {
          reject(); return;
        }
        configuring = true;
        const requester = await authorize(message.accessToken);
        if (closed || ws.readyState !== WebSocket.OPEN) return;
        clearTimeout(configTimer);
        // Only authorized starts are counted; over budget, no Google stream opens.
        if (!sessionStarts.take(requester.user.id).allowed) { reject(REJECTION.rateLimited); return; }
        userId = requester.user.id;
        // One live stream per user: a newer session (for example after a network
        // drop the server has not detected yet) ends the older one first.
        activeStreams.get(userId)?.end(REJECTION.replaced);
        activeStreams.set(userId, connection);
        session = createSession({
          language: message.language, send,
          close: () => ws.close(1000, "Diagnostic session ended"),
        });
        developmentLog("WebSocket connected");
      } catch { reject(); }
    });
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearTimeout(configTimer);
      clearInterval(heartbeat);
      session?.dispose();
      release();
      developmentLog("WebSocket closed");
    };
    ws.on("close", cleanup);
    ws.on("error", () => { cleanup(); ws.terminate(); });
  });

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    server.off("upgrade", onUpgrade);
    wss.clients.forEach((ws) => ws.terminate());
    activeStreams.clear();
    wss.close();
  };
  server.once("close", dispose);
  return { dispose, wss, activeStreams };
}

module.exports = { attachDiagnosticSpeechSocket };
