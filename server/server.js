const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const multer = require("multer");
const { createServer } = require("node:http");

dotenv.config();

const { createDiagnosticAudioHandler } = require("./routes/diagnosticAudio");
const diagnosticAudioHandler = createDiagnosticAudioHandler();
const { synthesizeSpeech } = require("./services/googleTtsService");
const {
  getGoogleSpeechLanguageCode,
} = require("./services/diagnosticLanguage");
const { materialsRouter } = require("./routes/materials");
const {
  adminDiagnosticResultsRouter,
} = require("./routes/adminDiagnosticResults");
const { adminUsersRouter } = require("./routes/adminUsers");
const { oralReadingRouter } = require("./routes/oralReading");
const { weeklyReportsRouter } = require("./routes/weeklyReports");
const {
  adminModuleExtractionRouter,
} = require("./routes/adminModuleExtraction");
const { terminateOcrWorker } = require("./services/materialOcrService");
const { attachDiagnosticSpeechSocket } = require("./routes/diagnosticSpeechSocket");

const app = express();
const uploadDirectory = path.join(__dirname, "uploads");
const MAX_TTS_TEXT_LENGTH = 200;

fs.mkdirSync(uploadDirectory, { recursive: true });

const audioExtensionsByMimeType = {
  "audio/aac": ".aac",
  "audio/flac": ".flac",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/webm": ".webm",
  "audio/x-wav": ".wav",
};

function getBaseMimeType(mimeType = "") {
  return mimeType.split(";", 1)[0].trim().toLowerCase();
}

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDirectory,
    filename: (req, file, callback) => {
      const originalExtension = path.extname(file.originalname).toLowerCase();
      const baseMimeType = getBaseMimeType(file.mimetype);
      const safeExtension = /^\.[a-z0-9]{1,10}$/.test(originalExtension)
        ? originalExtension
        : audioExtensionsByMimeType[baseMimeType] || "";

      callback(null, `${randomUUID()}${safeExtension}`);
    },
  }),
  fileFilter: (req, file, callback) => {
    const baseMimeType = getBaseMimeType(file.mimetype);

    if (audioExtensionsByMimeType[baseMimeType]) {
      callback(null, true);
      return;
    }

    const error = new Error("Unsupported diagnostic audio type.");
    error.code = "UNSUPPORTED_AUDIO_TYPE";
    callback(error);
  },
});

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
app.use("/api/oral-reading", oralReadingRouter);
app.use("/api/weekly-reports", weeklyReportsRouter);
app.use("/api/analytics", require("./routes/m7Analytics"));
app.use("/api/comprehension", require("./routes/comprehension"));

app.post("/api/tts", async (req, res) => {
  const { text, language } = req.body || {};

  if (typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: "Text is required for speech synthesis.",
    });
  }

  if (text.trim().length > MAX_TTS_TEXT_LENGTH) {
    return res.status(400).json({
      success: false,
      message: `Text must be ${MAX_TTS_TEXT_LENGTH} characters or fewer.`,
    });
  }

  let languageCode;

  try {
    languageCode = getGoogleSpeechLanguageCode(language);
  } catch {
    return res.status(400).json({
      success: false,
      message: "Language must be either 'en' or 'fil'.",
    });
  }

  try {
    const audio = await synthesizeSpeech(text.trim(), languageCode);

    res.set({
      "Cache-Control": "no-store",
      "Content-Type": "audio/mpeg",
    });
    return res.send(audio);
  } catch (error) {
    console.error("Diagnostic text-to-speech synthesis failed:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to generate pronunciation audio. Please try again.",
    });
  }
});

app.post("/api/diagnostic/audio", (req, res) => {
  upload.single("audio")(req, res, (error) => diagnosticAudioHandler(req, res, error));
});

function startServer(port = process.env.PORT || 5000) {
  const server = createServer(app);
  const speechSocket = attachDiagnosticSpeechSocket(server);
  const stopRiskWorker = require("./services/m7RiskWorker").startRiskWorker();
  server.once("close", stopRiskWorker);
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
