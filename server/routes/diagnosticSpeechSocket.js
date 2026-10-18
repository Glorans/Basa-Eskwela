const { WebSocketServer, WebSocket } = require("ws");
const { getAuthenticatedSupabaseUser } = require("../services/supabaseAdmin");
const {
  createDiagnosticSpeechSession, developmentLog, SAFE_STREAM_ERROR,
} = require("../services/diagnosticSpeechStream");

function attachDiagnosticSpeechSocket(server, {
  authenticate = (token) => getAuthenticatedSupabaseUser({ get: () => `Bearer ${token}` }),
  createSession = createDiagnosticSpeechSession,
  allowedOrigins = (process.env.DIAGNOSTIC_WS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
    .split(",").map((origin) => origin.trim()),
} = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384, perMessageDeflate: false });
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
    let configuring = false;
    let closed = false;
    const send = (message) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    };
    const reject = () => {
      send({ type: "error", code: "STREAM_UNAVAILABLE", message: SAFE_STREAM_ERROR });
      session?.dispose();
      ws.close(1008, "Diagnostic stream unavailable");
    };
    const configTimer = setTimeout(reject, 10000);
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
        await authenticate(message.accessToken);
        if (closed || ws.readyState !== WebSocket.OPEN) return;
        clearTimeout(configTimer);
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
    wss.close();
  };
  server.once("close", dispose);
  return { dispose, wss };
}

module.exports = { attachDiagnosticSpeechSocket };
