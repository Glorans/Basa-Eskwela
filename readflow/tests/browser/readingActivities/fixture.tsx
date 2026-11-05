// Isolated browser fixture: real activity pages, in-memory network/recorder boundaries.
// No Supabase credentials, microphone access, speech providers or live records.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import BasaLayout from "../../../src/components/basa/BasaLayout";
import StudentClassroomPage from "../../../src/modules/module4/pages/StudentClassroomPage";
import ReadAloudPage from "../../../src/pages/reading-activity/ReadAloudPage";
import ReadingResultPage from "../../../src/pages/reading-activity/ReadingResultPage";
import ComprehensionPage from "../../../src/modules/module6/pages/ComprehensionPage";
import { normalizeActivityLanguage } from "../../../src/pages/reading-activity/activityLanguage";
import "../../../src/index.css";

const delay = () => new Promise(resolve => setTimeout(resolve, 100));
const languages = ["en", "Filipino", "fil-PH", "tl", "missing", "unsupported"];
const modes = ["questions", "oral", "legacy"];
const sources = languages.flatMap(language => modes.map(mode => ({
  id: `${language}-${mode}`, title: "Ang Hardin ni Maya", language: language === "missing" ? undefined : language === "unsupported" ? "es" : language,
  mode, passage: "Si Maya ay may hardin. Masaya siyang nagtanim ng mga bulaklak.",
})));
const oral = new Map<string, any>();
const comprehension = new Map<string, any>();
const events: any[] = [];
const failures: Record<string, number> = {};
let activeSource = sources[0];
function maybeFail(kind: string) {
  if (failures[kind] > 0) { failures[kind]--; throw Error("Network response lost"); }
}
// pronunciation.enabled: a saved recording and a fake (never paid) pronunciation check that counts its calls.
const pronunciation = { enabled: false, calls: [] as string[], delayMs: 600, fail: false };
Object.assign(window, { activityFixture: { events, failures, oral, comprehension, sources, pronunciation } });

export default function useAuthenticatedProfile() { return { profile: { id: "learner-1", role: "student", nickname: "Ana" }, loading: false }; }
export async function logout() { return true; }
export async function getClassroomById() { return { id: "room", room_name: "Readers", room_code: "ABC" }; }
export async function getAssignedModules() { return []; }
export function formatDueDateTime(dueAt: string, locale?: string) {
  return new Date(dueAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });
}
export function isRoomArchived(room: any) { return Boolean(room?.archived_at); }
export async function getStudentReadingActivities() {
  return sources.map(source => ({ assignment_id: source.id, material_id: source.id, title: source.title,
    language: source.language, assigned_at: "2026-10-15", due_at: null, status: "assigned", has_questions: source.mode === "questions" }));
}
export async function updateReadingActivityStatus(...args: any[]) { events.push(["status", ...args]); }
export async function getAssignedReadingProgress() {
  return sources.map(source => ({ activityAssignmentId: source.id, materialId: source.id, roomId: "room", status: "Not Started",
    oralReadingAttemptId: oral.has(source.id) ? source.id : null,
    comprehensionAttemptId: comprehension.has(source.id) ? source.id : null,
    ...(source.mode !== "legacy" ? { readAloudOnly: source.mode === "oral" } : {}),
  }));
}
export async function getOwnOralReadingAttempts() { return []; }
export async function getOralReadingModule(_: any, context: any) {
  await delay(); maybeFail("load");
  const source = sources.find(s => s.id === context.materialId)!;
  activeSource = source;
  return { id: null, ...context, title: source.title, passageTitle: source.title, passage: source.passage,
    language: normalizeActivityLanguage(source.language), passageRevision: "original", readAloudOnly: source.mode === "oral" };
}
export async function createOralReadingAttempt(input: any) {
  events.push(["save", structuredClone(input)]); await delay(); maybeFail("save");
  const source = sources.find(s => s.id === input.materialId)!;
  const attempt = { ...input, id: source.id, userId: "learner-1", moduleTitle: source.title, language: normalizeActivityLanguage(source.language),
    readAloudOnly: source.mode === "oral", readAloudCompleted: true, pronunciationAccuracy: 85,
    readingSpeedWpm: 61, expectedWordCount: 12, transcript: source.passage,
    wordMetrics: [{ expected: "Maya", actual: "Maya", type: "match" }, { expected: "hardin", actual: null, type: "omission" }],
  };
  oral.set(attempt.id, attempt); return structuredClone(attempt);
}
export async function getOralReadingAttempt(id: string) { await delay(); maybeFail("result"); return structuredClone(oral.get(id)); }
export async function uploadDiagnosticAudio(_: Blob, language: string) {
  events.push(["transcribe", language]); await delay(); maybeFail("transcribe");
  return { success: true, transcription: { text: activeSource.passage } };
}
// Oral-reading service functions added since this fixture was written: no cache, no stored recording.
export const RECORDING_UPLOAD_ERROR = "Your result is saved, but recording upload failed. Retry saving the recording before leaving this page.";
export function peekOralReadingAttempt() { return undefined; }
export function rememberOralReadingAttempt() {}
export function peekOralReadingAttemptNumber() { return undefined; }
export async function getOralReadingAttemptNumber() { return undefined; }
export async function uploadOralReadingRecording(attemptId: string) { events.push(["upload", attemptId]); }
export async function getOralReadingRecording() {
  return pronunciation.enabled ? { available: true, segments: ["data:audio/webm;base64,AA=="] } : { available: false, segments: [] };
}
export async function convertToSpeechWavRecording() { return new Blob(["fixture wav"], { type: "audio/wav" }); }
// M5 now sends one continuous recording to the server; same events and failures as the old upload.
export function startReadAloudTiming() { return () => {}; }
export async function transcribeOralReadingRecording(_: Blob, language: string, options: any = {}) {
  for (const step of ["preparing", "uploading", "recognizing"]) options.onStep?.(step);
  events.push(["transcribe", language]); await delay(); maybeFail("transcribe");
  return { text: activeSource.passage };
}
// Like the server: one saved, server-summarized check per attempt, reused after a reload.
const savedPronunciation = new Map<string, any>();
export async function assessOralReadingPronunciation(attemptId: string, _wavs: Blob | Blob[], options: any = {}) {
  if (savedPronunciation.has(attemptId)) return savedPronunciation.get(attemptId);
  if (!pronunciation.enabled) throw Error("Pronunciation check unavailable in this fixture");
  pronunciation.calls.push(attemptId); options.onAssessing?.();
  await new Promise(resolve => setTimeout(resolve, pronunciation.delayMs));
  if (pronunciation.fail) throw Error("Speech processing is temporarily unavailable. Please try again later.");
  const result = { saved: true, checkedAt: "2026-11-05T08:00:00Z", summary: {
    parts: 1, utterances: 1, accuracy: 78, fluency: 70, wordsToPractice: ["hardin"], assessedSeconds: 12, complete: true, unassessedSeconds: 0 } };
  savedPronunciation.set(attemptId, result);
  return result;
}
export async function getSavedPronunciationCheck(attemptId: string) {
  const check = savedPronunciation.get(attemptId);
  return check ? { status: "completed", check } : { status: "none", check: null };
}
export async function getTeacherPronunciationCheck(attemptId: string) { return getSavedPronunciationCheck(attemptId); }
export async function getSessionAuthHeaders() { return { Authorization: "Bearer fixture" }; }
export async function synthesizeDiagnosticSpeech(_: string, language: string, options: { voiceProfile?: string } = {}) {
  events.push(["tts", language, options.voiceProfile ?? "default"]); throw Error("Audio unavailable");
}
export function useVoiceFollowStoryScroll() { return { onStreamReady() {}, onStreamStopped() {} }; }
export function useAudioRecorder() {
  const [recording, setRecording] = useState(false);
  const [segments, setSegments] = useState<Blob[]>([]);
  const [message, setMessage] = useState("Press the microphone button when you're ready.");
  return { audioSegments: segments, audioURLs: segments.length ? ["data:audio/webm;base64,AA=="] : [], segmentDurationsSeconds: segments.length ? [10] : [],
    isRecording: recording, isStarting: false, isStopping: false, message, recordingDurationSeconds: segments.length ? 10 : null,
    resetRecording() { setRecording(false); setSegments([]); setMessage("Press the microphone button when you're ready."); },
    async startRecording() { setRecording(true); setMessage("Recording... Read aloud, then press Stop recording."); },
    stopRecording() { setRecording(false); setSegments([new Blob(["fixture"], { type: "audio/webm;codecs=opus" })]); setMessage("Recording complete. Your reading was captured successfully."); },
  };
}
function summary(questions: any[]) {
  const group = (rows: any[]) => ({ total: rows.length, firstCorrect: rows.filter(q => q.firstAnswerCorrect).length,
    firstAttemptPercentage: Math.round(100 * rows.filter(q => q.firstAnswerCorrect).length / (rows.length || 1)) });
  return { totalQuestions: questions.length, firstCorrect: group(questions).firstCorrect, firstAttemptPercentage: group(questions).firstAttemptPercentage,
    hintsUsed: questions.filter(q => q.hintUsed).length, allResolved: questions.every(q => q.resolved),
    byType: Object.fromEntries(["literal", "inferential", "critical"].map(type => [type, group(questions.filter(q => q.type === type))])) };
}
export async function startComprehension(input: any) {
  events.push(["start", structuredClone(input)]); await delay(); maybeFail("start");
  const source = sources.find(s => s.id === input.materialId)!;
  if (!comprehension.has(source.id)) {
    const questions = Array.from({ length: 6 }, (_, i) => ({ id: `reviewed-${i}`, type: ["literal", "inferential", "critical"][Math.floor(i / 2)],
      // Deliberately English in Filipino activities: teacher content must stay verbatim.
      questionText: `Teacher reviewed question ${i + 1}: Where did Maya plant the flowers?`, options: ["In the garden", "At school", "By the river", "On the road"],
      firstOptionIndex: null, firstAnswerCorrect: null, answerHistory: [], hintUsed: false, hint: null, resolved: false,
      correctOptionIndex: null, answerExplanation: null, supportingEvidence: null, scaffoldingPrompt: null,
    }));
    comprehension.set(source.id, { ...input, id: source.id, language: normalizeActivityLanguage(source.language), passageTitle: source.title,
      passageText: source.passage, status: "in_progress", questions, summary: summary(questions) });
  }
  return structuredClone(comprehension.get(source.id));
}
export async function getComprehension(id: string) { await delay(); return structuredClone(comprehension.get(id)); }
// Read-only M5 -> M6 status lookup (fixture IDs: an oral reading and its activity share the source ID).
export async function getComprehensionForReading(oralReadingAttemptId: string) {
  const saved = comprehension.get(oralReadingAttemptId);
  return saved ? { id: saved.id, status: saved.status === "completed" ? "completed" : "in_progress" } : null;
}
export async function sendComprehensionAction(id: string, action: any) {
  events.push(["action", id, structuredClone(action)]); await delay(); maybeFail("action");
  const attempt = comprehension.get(id);
  let outcome = {};
  if (action.action === "complete") attempt.status = "completed";
  else {
    // Single attempt, as the backend enforces it: the first answer is final.
    if (action.action !== "answer") throw Error("Invalid activity action.");
    const q = attempt.questions.find((q: any) => q.id === action.questionId);
    const retry = q.answerHistory.find((entry: any) => entry.requestId === action.requestId);
    if (q.firstOptionIndex !== null && !retry) throw Error("This question already has a final answer.");
    if (!retry) {
      const correct = action.optionIndex === 0;
      q.answerHistory.push({ optionIndex: action.optionIndex, correct, requestId: action.requestId });
      q.firstOptionIndex = action.optionIndex; q.firstAnswerCorrect = correct; q.resolved = true;
      q.correctOptionIndex = 0; q.answerExplanation = "Teacher explanation: Maya planted flowers there."; q.supportingEvidence = "Si Maya ay may hardin.";
      q.scaffoldingPrompt = correct ? null : "Teacher hint: remember the garden.";
    }
    outcome = { correct: q.firstAnswerCorrect, resolved: true, final: true };
  }
  attempt.summary = summary(attempt.questions);
  return { attempt: structuredClone(attempt), outcome };
}
function FixtureNavigation() {
  const navigate = useNavigate();
  Object.assign(window, { fixtureNavigate: navigate });
  return null;
}
createRoot(document.getElementById("root")!).render(<BrowserRouter><FixtureNavigation /><Routes><Route element={<BasaLayout />}>
  <Route path="/dashboard/learning-rooms/:roomId" element={<StudentClassroomPage />} />
  <Route path="/dashboard/reading-materials/:materialId/read-aloud" element={<ReadAloudPage role="student" />} />
  <Route path="/dashboard/read-aloud/results/:attemptId" element={<ReadingResultPage role="student" />} />
  <Route path="/dashboard/reading-materials/:materialId/comprehension" element={<ComprehensionPage role="student" />} />
  <Route path="/dashboard/comprehension/:attemptId" element={<ComprehensionPage role="student" />} />
  <Route path="/dashboard/comprehension/:attemptId/results" element={<ComprehensionPage role="student" results />} />
</Route></Routes></BrowserRouter>);
