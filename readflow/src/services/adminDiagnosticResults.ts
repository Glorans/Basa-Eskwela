import axios from "axios";
import type { Difficulty, ReadingLevel } from "../data/dashboardData";
import api from "./api";
import { getSessionAuthHeaders } from "./authHeaders";

export interface AdminDiagnosticResult {
  id: string;
  userId: string;
  learnerName: string;
  email: string | null;
  role: "student" | "general_user";
  language: "en" | "fil";
  orvScore: number;
  comprehensionScore: number;
  readingSpeedWpm: number | null;
  readingLevel: ReadingLevel;
  difficultyTier: Difficulty;
  completedAt: string;
  verificationStatus: "unverified" | "server_verified";
}

interface AdminDiagnosticResultsResponse {
  success: true;
  results: AdminDiagnosticResult[];
}

const getAdminRequestHeaders = () =>
  getSessionAuthHeaders("Your session could not be verified. Please sign in again.");

export async function getAdminDiagnosticResults() {
  const response = await api.get<AdminDiagnosticResultsResponse>(
    "/api/admin/diagnostic-results",
    { headers: await getAdminRequestHeaders() },
  );
  return response.data.results;
}

export function getAdminDiagnosticResultsError(error: unknown) {
  if (axios.isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || "Unable to load diagnostic results.";
  }

  return error instanceof Error
    ? error.message
    : "Unable to load diagnostic results.";
}
