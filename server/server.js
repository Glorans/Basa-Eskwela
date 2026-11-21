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
// M2 F8: one reassessment delivery service shared by the Student routes and the speech binding (receipts are bound
// to the Student's own active assignment and exact package version).
const reassessmentDelivery = require("./services/reassessmentDeliveryService").createReassessmentDeliveryService({
  repository: require("./services/reassessmentDeliveryRepository").createSupabaseReassessmentDeliveryRepository(),
  receipts: diagnosticReceipts,
});
// M2 F6: which initial diagnostic version learners take (built-in 3.0 unless a System Admin activated another).
const initialDiagnostics = require("./services/initialDiagnosticService").createInitialDiagnosticService();
const resolveDiagnosticBinding = require("./services/diagnosticBindingResolver")
  .createDiagnosticBindingResolver({ getReassessments: () => reassessmentDelivery, initialAssessments: initialDiagnostics });

app.use(
  cors({
    origin: (process.env.FRONTEND_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173")
      .split(",").map((origin) => origin.trim()).filter(Boolean),
    // Performance: browsers may reuse an allowed preflight for 10 minutes instead of repeating it before
    // almost every API call (without this header Chrome keeps it 5 seconds). Origins, methods, headers and
    // credentials are unchanged; a disallowed origin still gets no Access-Control-Allow-Origin.
    maxAge: 600,
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
// M2 F3: learners' own diagnostic history and approved Teachers' enrolled Students (read-only).
app.use("/api/diagnostic-history", require("./routes/diagnosticHistory").createDiagnosticHistoryRouter());
// M2 F6 + F10: assessment packages (staff only; learner delivery unchanged).
app.use("/api/assessment-packages", require("./routes/assessmentPackages").createAssessmentPackagesRouter());
// M2 F9: classroom reassessment assignments (School Admin + approved Teachers). Refused by the database while the
// official reassessment gate is OFF.
app.use("/api/reassessments", require("./routes/reassessments").createReassessmentsRouter({ delivery: reassessmentDelivery }));
app.use("/api/admin/users", adminUsersRouter);
// M1 F8 Create School / list / rename / activate-deactivate (System Admin only).
app.use("/api/admin/schools", require("./routes/adminSchools").createAdminSchoolsRouter());
app.use("/api/account", require("./routes/accountInvitation").accountInvitationRouter);
app.use("/api/admin/teacher-invitations", require("./routes/teacherInvitations").createTeacherInvitationsRouter());
// Admin review of students' saved assessments; other /admin paths continue to oralReadingRouter.
// Server-Timing (auth and total server time) for the M6, M7 and Teacher reading requests; durations only.
app.use(["/api/comprehension", "/api/analytics", "/api/oral-reading"], require("./services/requestTiming").requestTiming);
app.use("/api/oral-reading/admin", adminStudentReadingRouter);
app.use("/api/oral-reading", oralReadingRouter);
app.use("/api/weekly-reports", weeklyReportsRouter);
app.use("/api/admin/weekly-reports", require("./routes/weeklyReports").createAdminWeeklyReportsRouter());
app.use("/api/analytics", require("./routes/m7Analytics"));
app.use("/api/comprehension", require("./routes/comprehension"));
app.use("/api/m8", require("./routes/m8Rewards").createM8RewardsRouter());
// M4 Student Learning Rooms: assigned Teacher names for the Student's own enrolled rooms.
app.use("/api/classrooms", require("./routes/studentClassrooms").createStudentClassroomsRouter());
// POST /api/tts, /api/diagnostic/audio (M2 parts) and /api/read-aloud/audio (M5
// whole recordings): authenticated, throttled Azure Speech.
app.use(createSpeechRouter({ receipts: diagnosticReceipts, resolveBinding: resolveDiagnosticBinding }));
// POST /api/diagnostic/results: the only write path for M2 diagnostic results.
app.use(createDiagnosticResultsRouter({ receipts: diagnosticReceipts, initialAssessments: initialDiagnostics }));
// GET /api/diagnostic/initial/:language: the initial diagnostic version a learner takes now (F6), never answer keys.
app.use(require("./routes/initialDiagnostic").createInitialDiagnosticRouter({ initialAssessments: initialDiagnostics }));
// POST /api/diagnostic/practice: M2 F7 staff Practice Mode. Scores and returns; never stores anything.
app.use(require("./routes/diagnosticPractice").createDiagnosticPracticeRouter({ receipts: diagnosticReceipts }));

function startServer(port = process.env.PORT || 5000) {
  const server = createServer(app);
  const speechSocket = attachDiagnosticSpeechSocket(server, { receipts: diagnosticReceipts, resolveBinding: resolveDiagnosticBinding });
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
