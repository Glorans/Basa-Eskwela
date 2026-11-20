import axios from "axios";
import api from "../../../services/api";
import { getSessionAuthHeaders } from "../../../services/authHeaders";
import { requireDiagnosticAssessment } from "../data/diagnosticData";
import type { DiagnosticLanguage } from "../types/diagnostic";

// M2 F6 + F10 assessment packages (staff only). The server decides which packages this account may see and change;
// nothing here changes what learners take. Learner accounts are refused by the server on every call.

export type PackageCategory = "initial" | "independent" | "school" | "teacher";
export type VersionStatus = "draft" | "in_review" | "approved" | "published" | "retired";
export type QuestionType = "literal" | "inferential" | "critical" | "";
export type ChoiceId = "a" | "b" | "c" | "d";

export interface PackageQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  choices: { id: ChoiceId; label: string }[];
  correctChoiceId: ChoiceId | null;
}

export interface PackageContent {
  passageTitle: string;
  paragraphs: string[];
  questions: PackageQuestion[];
}

export interface VersionSummary {
  id: string;
  versionNumber: number;
  versionLabel: string;
  status: VersionStatus;
  source: "authored" | "code_import";
  createdAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
  retiredAt: string | null;
}

export interface EducatorReview {
  id: string;
  reviewerName: string;
  /** As stated by the reviewer; the application cannot verify professional qualifications. */
  reviewerQualification: string;
  reviewedOn: string;
  passageSuitable: boolean;
  questionsSound: boolean;
  answerKeysCorrect: boolean;
  languageAccurate: boolean;
  outcome: "endorsed" | "changes_requested";
  notes: string | null;
  recordedBy: string;
  recordedAt: string;
}

export interface EducatorReviewInput {
  reviewerName: string;
  reviewerQualification: string;
  reviewedOn: string;
  passageSuitable: boolean;
  questionsSound: boolean;
  answerKeysCorrect: boolean;
  languageAccurate: boolean;
  outcome: "endorsed" | "changes_requested";
  notes: string;
}

export interface VersionDetail extends VersionSummary {
  basedOnVersionId: string | null;
  stageLabel: string;
  /** Separate from library status: true only for the version learners take now. */
  activeForLearners: boolean;
  activationNote: string;
  /** Initial packages: true when a System Admin may make this version the one learners take (F6). */
  canActivate?: boolean;
  /** True only when the most recent educator review is an endorsement with all four checks passed. */
  educatorEndorsed: boolean;
  educatorReviews: EducatorReview[];
  content: PackageContent;
  contentSha256: string | null;
  issues: string[];
  reviewNote: string | null;
  educatorReviewAttestation: string | null;
  createdBy: string | null;
  submittedBy: string | null;
  reviewedBy: string | null;
  publishedBy: string | null;
  retiredBy: string | null;
}

export interface PackagePermissions { view: boolean; manage: boolean; review: boolean; publish: boolean }

export interface PackageSummary {
  id: string;
  category: PackageCategory;
  language: DiagnosticLanguage;
  title: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  publishedVersion: string | null;
  /** Initial packages: the version learners take now (the current initial diagnostic). */
  activeVersion: string | null;
  latestVersion: VersionSummary | null;
  versionCount: number;
  permissions: PackagePermissions;
  ownerName?: string;
  /** Initial packages only: what learners take now (the built-in version unless a System Admin activated another). */
  delivery?: { source: "code" | "package"; assessmentId: string | null; version: string | null; activationAvailable: boolean };
  /** Initial packages (detail only): F6 controlled activation. Only a System Admin can manage it. */
  activation?: { available: boolean; canManage: boolean; activeVersionId: string | null };
}

export interface PackageList {
  packages: PackageSummary[];
  capabilities: { create: PackageCategory[]; importInitial: DiagnosticLanguage[] };
}

export interface PackageDetail { package: PackageSummary; versions: VersionDetail[] }

export type VersionAction = "submit" | "return" | "approve" | "publish" | "retire";

export class AssessmentPackageRequestError extends Error {
  issues: string[];
  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = "AssessmentPackageRequestError";
    this.issues = issues;
  }
}

const BASE = "/api/assessment-packages";
const headers = async () => ({ headers: await getSessionAuthHeaders("Your session could not be verified. Please sign in again.") });

async function request<T>(work: () => Promise<{ data: T }>): Promise<T> {
  try {
    return (await work()).data;
  } catch (error) {
    if (axios.isAxiosError<{ message?: string; issues?: string[] }>(error)) {
      throw new AssessmentPackageRequestError(
        error.response?.data?.message || "Unable to complete the assessment package request.",
        Array.isArray(error.response?.data?.issues) ? error.response.data.issues : [],
      );
    }
    throw error instanceof Error ? error : new Error("Unable to complete the assessment package request.");
  }
}

export const listAssessmentPackages = async () => request<PackageList>(async () => api.get(BASE, await headers()));
export const getAssessmentPackage = async (id: string) =>
  request<PackageDetail>(async () => api.get(`${BASE}/${encodeURIComponent(id)}`, await headers()));
export const createAssessmentPackage = async (input: { category: PackageCategory; language: DiagnosticLanguage; title: string }) =>
  request<PackageDetail>(async () => api.post(BASE, input, await headers()));
export const renameAssessmentPackage = async (id: string, title: string) =>
  request<PackageDetail>(async () => api.patch(`${BASE}/${encodeURIComponent(id)}`, { title }, await headers()));
export const archiveAssessmentPackage = async (id: string) =>
  request<PackageDetail>(async () => api.post(`${BASE}/${encodeURIComponent(id)}/archive`, {}, await headers()));
export const createPackageVersion = async (id: string, input: { basedOnVersionId?: string; versionLabel?: string } = {}) =>
  request<PackageDetail>(async () => api.post(`${BASE}/${encodeURIComponent(id)}/versions`, input, await headers()));
export const savePackageDraft = async (id: string, versionId: string, content: PackageContent) =>
  request<PackageDetail>(async () => api.patch(`${BASE}/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`,
    { content }, await headers()));
export const deletePackageDraft = async (id: string, versionId: string) =>
  request<PackageDetail>(async () => api.delete(`${BASE}/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`,
    await headers()));
/** Reviewers record an educator's review of a submitted, approved, published or retired version (append-only). */
export const recordEducatorReview = async (id: string, versionId: string, input: EducatorReviewInput) =>
  request<PackageDetail>(async () => api.post(
    `${BASE}/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/educator-reviews`, input, await headers()));
export const changeVersionStatus = async (id: string, versionId: string, action: VersionAction,
  input: { note?: string; attestation?: string } = {}) =>
  request<PackageDetail>(async () => api.post(
    `${BASE}/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/${action}`, input, await headers()));

/**
 * F6 (System Admin only): make a published, educator-endorsed initial version the one NEW learners take. The page sends
 * the active version it showed, so two System Admins cannot overwrite each other. Learners who already completed the
 * initial diagnostic are never asked to retake it, and learners mid-way keep the version they started.
 */
export const activateInitialVersion = async (id: string, versionId: string, expectedActiveVersionId: string | null) =>
  request<PackageDetail>(async () => api.post(
    `${BASE}/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/activate`, { expectedActiveVersionId }, await headers()));
/** F6 (System Admin only): return new learners to the built-in initial diagnostic (3.0). */
export const returnToBuiltInInitial = async (id: string, expectedActiveVersionId: string | null) =>
  request<PackageDetail>(async () => api.post(`${BASE}/${encodeURIComponent(id)}/activation/built-in`, { expectedActiveVersionId }, await headers()));

/**
 * System Admin: record the current code-defined diagnostic (version 3.0) as the initial package's published
 * version. The full content is sent; the server checks it against its own copy (ids, passage, answer keys).
 */
export const importInitialDiagnostic = async (language: DiagnosticLanguage) => {
  const assessment = requireDiagnosticAssessment(language);
  return request<PackageDetail>(async () => api.post(`${BASE}/import-initial`, {
    language,
    assessment: {
      id: assessment.id,
      version: assessment.version,
      language: assessment.language,
      title: assessment.title,
      passage: { paragraphs: [...assessment.passage.paragraphs] },
      questions: assessment.questions.map((q) => ({
        id: q.id, prompt: q.prompt, correctChoiceId: q.correctChoiceId,
        choices: q.choices.map((c) => ({ id: c.id, label: c.label })),
      })),
    },
  }, await headers()));
};

export const EMPTY_QUESTION = (): PackageQuestion => ({
  id: "", type: "", prompt: "", correctChoiceId: null,
  choices: (["a", "b", "c", "d"] as ChoiceId[]).map((id) => ({ id, label: "" })),
});

/** Preserve the saved question set; authors add slots explicitly. */
export function toEditableContent(content: PackageContent): PackageContent {
  const questions = content.questions.map((q) => {
    return {
      ...q,
      choices: (["a", "b", "c", "d"] as ChoiceId[]).map((id) => ({ id, label: q.choices.find((c) => c.id === id)?.label ?? "" })),
    };
  });
  return {
    passageTitle: content.passageTitle,
    paragraphs: content.paragraphs.length ? [...content.paragraphs] : [""],
    questions,
  };
}

export const CATEGORY_LABELS: Record<PackageCategory, string> = {
  initial: "Initial diagnostic",
  independent: "Independent Learner reassessment",
  school: "School reassessment",
  teacher: "Teacher reassessment (private)",
};

export const STATUS_LABELS: Record<VersionStatus, string> = {
  draft: "Draft",
  in_review: "Submitted for review",
  approved: "Approved for library",
  published: "Published in library",
  retired: "Retired",
};

export const REVIEW_CHECK_LABELS = {
  passageSuitable: "The passage suits the intended reading level",
  questionsSound: "The comprehension questions are sound",
  answerKeysCorrect: "Every answer key is correct",
  languageAccurate: "The language (English or Filipino) is accurate",
} as const;

export const EDUCATOR_EVIDENCE_NOTICE = "Basa Eskwela records the review details entered here. It cannot verify a reviewer's "
  + "professional qualification. Library approval by a System Admin or School Admin is not educational validation.";

export const LANGUAGE_LABELS: Record<DiagnosticLanguage, string> = { en: "English", fil: "Filipino" };
