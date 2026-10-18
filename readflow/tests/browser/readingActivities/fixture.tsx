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
Object.assign(window, { activityFixture: { events, failures, oral, comprehension, sources } });

export default function useAuthenticatedProfile() { return { profile: { role: "student", nickname: "Ana" }, loading: false }; }
export async function logout() { return true; }
export async function getClassroomById() { return { id: "room", room_name: "Readers", room_code: "ABC" }; }
export async function getAssignedModules() { return []; }
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
  const attempt = { ...input, id: source.id, moduleTitle: source.title, language: normalizeActivityLanguage(source.language),
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
export async function synthesizeDiagnosticSpeech(_: string, language: string) { events.push(["tts", language]); throw Error("Audio unavailable"); }
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
      correctOptionIndex: null, answerExplanation: null, supportingEvidence: null,
    }));
    comprehension.set(source.id, { ...input, id: source.id, language: normalizeActivityLanguage(source.language), passageTitle: source.title,
      passageText: source.passage, status: "in_progress", questions, summary: summary(questions) });
  }
  return structuredClone(comprehension.get(source.id));
}
export async function getComprehension(id: string) { await delay(); return structuredClone(comprehension.get(id)); }
export async function sendComprehensionAction(id: string, action: any) {
  events.push(["action", id, structuredClone(action)]); await delay(); maybeFail("action");
  const attempt = comprehension.get(id);
  let outcome = {};
  if (action.action === "complete") attempt.status = "completed";
  else {
    const q = attempt.questions.find((q: any) => q.id === action.questionId);
    if (action.action === "hint") { q.hintUsed = true; q.hint = "Teacher hint: remember the garden."; }
    else {
      const correct = action.optionIndex === 0;
      q.answerHistory.push({ optionIndex: action.optionIndex, correct, requestId: action.requestId });
      if (q.firstOptionIndex === null) { q.firstOptionIndex = action.optionIndex; q.firstAnswerCorrect = correct; }
      q.resolved = correct || q.answerHistory.length === 2;
      if (q.resolved) { q.correctOptionIndex = 0; q.answerExplanation = "Teacher explanation: Maya planted flowers there."; q.supportingEvidence = "Si Maya ay may hardin."; }
      outcome = { correct, resolved: q.resolved };
    }
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
