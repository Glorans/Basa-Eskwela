const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { createServer } = require("node:http");

dotenv.config();

const { createSpeechRouter } = require("./routes/speech");
const { materialsRouter } = require("./routes/materials");
const {
  adminDiagnosticResultsRouter,
} = require("./routes/adminDiagnosticResults");
const { adminUsersRouter } = require("./routes/adminUsers");
const { oralReadingRouter } = require("./routes/oralReading");
const { adminStudentReadingRouter } = require("./routes/adminStudentReading");
const { weeklyReportsRouter } = require("./routes/weeklyReports");
const {
  adminModuleExtractionRouter,
} = require("./routes/adminModuleExtraction");
const { terminateOcrWorker } = require("./services/materialOcrService");
const { attachDiagnosticSpeechSocket } = require("./routes/diagnosticSpeechSocket");
const { createDiagnosticResultsRouter } = require("./routes/diagnosticResults");
const { createTranscriptReceiptService } = require("./services/diagnosticTranscriptReceipts");

const app = express();
// Signs M2 transcripts at both Azure STT entry points and verifies them when
// the diagnostic result is submitted (DIAGNOSTIC_RECEIPT_SECRET).
const diagnosticReceipts = createTranscriptReceiptService();

app.use(
  cors({
    origin: (process.env.FRONTEND_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173")
      .split(",").map((origin) => origin.trim()).filter(Boolean),
  })
);

app.post("/api/materials/finalize", require("./services/materialFinalizeBody").materialFinalizeBody);
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "ReadFlow backend is running.",
  });
});

app.use("/api/materials", materialsRouter);
app.use("/api/admin/modules", adminModuleExtractionRouter);
app.use("/api/admin/modules", require("./routes/adminModulePassages").createAdminModulePassagesRouter());
app.use("/api/admin/diagnostic-results", adminDiagnosticResultsRouter);
app.use("/api/admin/users", adminUsersRouter);
app.use("/api/admin/teacher-invitations", require("./routes/teacherInvitations").createTeacherInvitationsRouter());
// Admin review of students' saved assessments; other /admin paths continue to oralReadingRouter.
app.use("/api/oral-reading/admin", adminStudentReadingRouter);
app.use("/api/oral-reading", oralReadingRouter);
app.use("/api/weekly-reports", weeklyReportsRouter);
app.use("/api/admin/weekly-reports", require("./routes/weeklyReports").createAdminWeeklyReportsRouter());
app.use("/api/analytics", require("./routes/m7Analytics"));
app.use("/api/comprehension", require("./routes/comprehension"));
// POST /api/tts, /api/diagnostic/audio (M2 parts) and /api/read-aloud/audio (M5
// whole recordings): authenticated, throttled Azure Speech.
app.use(createSpeechRouter({ receipts: diagnosticReceipts }));
// POST /api/diagnostic/results: the only write path for M2 diagnostic results.
app.use(createDiagnosticResultsRouter({ receipts: diagnosticReceipts }));

function startServer(port = process.env.PORT || 5000) {
  const server = createServer(app);
  const speechSocket = attachDiagnosticSpeechSocket(server, { receipts: diagnosticReceipts });
  const stopRiskWorker = require("./services/m7RiskWorker").startRiskWorker();
  server.once("close", stopRiskWorker);
  // Removes extracted uploads that were never saved (closed tabs, restarts); never saved materials.
  const stopUploadCleanup = require("./services/temporaryMaterialRegistry").startTemporaryUploadCleanup(
    require("./services/materialFileUpload").materialUploadDirectory);
  server.once("close", stopUploadCleanup);
  server.closeDiagnosticSpeech = speechSocket.dispose;
  return server.listen(port, () => {
    console.log(`ReadFlow server running on http://localhost:${port}`);
  });
}

if (require.main === module) {
  const server = startServer();
  let shuttingDown = false;

  function shutdown() {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    server.closeDiagnosticSpeech();
    server.close(async () => {
      await terminateOcrWorker().catch((error) => {
        console.error("Unable to terminate the OCR worker cleanly:", error);
      });
      process.exit(0);
    });
  }

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

module.exports = { app, startServer };
