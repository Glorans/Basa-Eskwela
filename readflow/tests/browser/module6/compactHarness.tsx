import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import BasaLayout from "../../../src/components/basa/BasaLayout";
import ComprehensionPage from "../../../src/modules/module6/pages/ComprehensionPage";
import "../../../src/index.css";
import "@fontsource/nunito/latin-500.css";
import "@fontsource/nunito/latin-600.css";
import "@fontsource/nunito/latin-700.css";
import "@fontsource/fredoka/latin-600.css";

export default function useAuthenticatedProfile() { return { profile: { role: "student", full_name: "Student Reader" }, loading: false }; }
export async function logout() { return true; }
const long = new URLSearchParams(location.search).has("long");
const questions = Array.from({ length: 6 }, (_, i) => ({ id: `q${i}`, type: ["literal", "inferential", "critical"][Math.floor(i / 2)],
  questionText: long ? "Explain what the children learned from helping their neighbors. ".repeat(30) : [
    "Where did Maya and her brother plant the seeds?", "What did the children use to water the plants each morning?",
    "Why did Maya move the young plants closer to the window?", "What can you infer about how the neighbors felt when they received the vegetables?",
    "Which action best shows that the children learned to take responsibility?", "Which lesson from the story would be most useful when working with others?"
  ][i],
  options: ["They worked together and took turns caring for the garden.", "They left the seeds outside without checking on them.", "They asked someone else to finish all their work.", "They stopped helping when the weather became warm."],
  firstOptionIndex: null, firstAnswerCorrect: null, resolved: false, answerHistory: [], hintUsed: false,
  hint: null, correctOptionIndex: null, answerExplanation: null, supportingEvidence: null,
}));
const attempt: any = { id: "fixture", materialId: "material", roomId: "room", activityAssignmentId: "assignment", oralReadingAttemptId: "oral",
  passageTitle: "Maya's Garden", passageText: "Maya and her brother planted a garden. They shared their vegetables with the neighbors.",
  language: "en", status: "in_progress", questions,
  summary: { allResolved: false, byType: Object.fromEntries(["literal", "inferential", "critical"].map(t => [t, { total: 2, firstCorrect: 0 }])) } };
export async function getComprehension() { return structuredClone(attempt); }
export async function startComprehension() { return getComprehension(); }
export async function sendComprehensionAction(_: string, action: any) {
  if (action.action === "complete") attempt.status = "completed";
  else {
    const q: any = questions.find(q => q.id === action.questionId);
    if (action.action === "hint") { q.hintUsed = true; q.hint = "Look at what the children did together."; }
    else { q.resolved = true; q.firstOptionIndex = action.optionIndex; q.firstAnswerCorrect = true;
      q.correctOptionIndex = action.optionIndex; q.answerHistory.push({ optionIndex: action.optionIndex, correct: true });
      q.answerExplanation = "Working together helped them finish the task.";
    }
  }
  attempt.summary.allResolved = questions.every(q => q.resolved);
  return { attempt: structuredClone(attempt), outcome: { correct: true, resolved: true } };
}
createRoot(document.getElementById("root")!).render(<BrowserRouter><Routes><Route element={<BasaLayout />}>
  <Route path="/dashboard/comprehension/:attemptId" element={<ComprehensionPage role="student" />} />
  <Route path="/dashboard/comprehension/:attemptId/results" element={<div>Completed result</div>} />
</Route></Routes></BrowserRouter>);
