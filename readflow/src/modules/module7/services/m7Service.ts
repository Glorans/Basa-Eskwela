import axios from 'axios';
import api from '../../../services/api';
import { getSessionAuthHeaders } from '../../../services/authHeaders';
export interface Metrics { invalidCompletedQuizzes?: number; readingAttempts: number; completedQuizzes: number; pronunciationAccuracy: number | null; readingSpeedWpm: number | null; comprehensionScore: number | null }
export interface Quiz { id: string; title: string; completedAt: string | null; score: number | null; firstCorrect?: number; totalQuestions?: number; hintsUsed?: number; dataQuality?: string; notCounted?: boolean }
export interface RiskEvent { id: string; attempt_id: string; student_id: string; classification: string; previous_classification: string; occurred_at: string; read_at: string | null; superseded_at: string | null; evidence: {id: string; score: number | null; completedAt: string | null}[] }
export type CompetencyKey = 'word_recognition' | 'fluency' | 'literal' | 'inferential' | 'critical';
export type LanguageCode = 'en' | 'fil';
/** The server's copy of a chosen suggestion, saved with the intervention and fixed afterwards. */
export interface SuggestionSnapshot { id: string; competency: CompetencyKey; language: LanguageCode; title: string; approach: string; activity: string; evidenceText: string; reason: string; level: 'pattern' | 'preliminary' | null; period: EvidencePeriod | null; generatedAt: string }
export interface Intervention { id: string; notes: string; intervention_date: string; status: string; follow_up_date: string | null; follow_up_notes: string;
  /** M7 F11 fields: absent before the intervention migration, null on older records. */
  competency?: CompetencyKey | 'other' | null; language?: LanguageCode | null; suggestion_key?: string | null; suggestion_snapshot?: SuggestionSnapshot | null;
  teacher_notes?: string; follow_up_outcome?: 'improved' | 'partly_improved' | 'no_change' | 'too_early' | null; created_at?: string; updated_at?: string }
/** M7 F10, learner view: the signed-in learner's own practice ideas in simple words (no labels, no records). */
export interface LearnerTip { id: string; competency: CompetencyKey; language: LanguageCode; languageName: string; title: string; steps: string[]; basedOn: string; note: string; words: string[] }
export interface LearnerSuggestionsData { generatedAt: string; hasAnyData: boolean; moreDataNeeded: boolean; tips: LearnerTip[]; improving: LearnerTip[] }
/** M7 F10, System Admin: platform-wide counts only. */
export interface SuggestionGroupCounts { learners: number; withSuggestion: number; withRepeated: number; preliminaryOnly: number; improving: number; moreDataNeeded: number; noData: number; onTrack: number }
export interface PlatformSuggestionSummary { generatedAt: string; students: SuggestionGroupCounts; independentLearners: SuggestionGroupCounts;
  needs: { competency: CompetencyKey; competencyName: string; language: LanguageCode; languageName: string; student: { pattern: number; preliminary: number }; general_user: { pattern: number; preliminary: number } }[] }
// ---- M7 F10 suggested interventions (rule-based; see server/services/m7Suggestions.js) ----
export interface EvidencePeriod { from: string; to: string }
export interface AssessmentEvidence { id: string; title: string; completedAt: string; correct: number; total: number; percent: number }
export interface ReadingEvidence { id: string; title: string; completedAt: string; accuracy: number; wpm: number | null }
export interface CategoryResult { status: 'insufficient' | 'needs_practice' | 'improving' | 'on_track' | 'not_evaluated'; level?: 'pattern' | 'preliminary'; trend?: string | null;
  evidence: { assessments?: AssessmentEvidence[]; readings?: ReadingEvidence[]; correct?: number; total?: number; percent?: number | null; accuracy?: number | null; wpm?: number | null;
    wordsReadDifferently?: { word: string; times: number }[]; pronunciationPracticeWords?: string[]; benchmark?: number | null } }
export interface SinceIntervention { interventionId: string; date: string; status: string; results: number; correct?: number; total?: number; percent?: number | null; average?: number | null; unit: string }
export interface SuggestionItem { id: string; competency: CompetencyKey; competencyName: string; language: LanguageCode; languageName: string;
  status: 'needs_practice' | 'improving'; level: 'pattern' | 'preliminary' | null; trend: string | null; moreEvidenceNeeded: boolean;
  evidence: CategoryResult['evidence']; evidenceText: string; reason: string; period: EvidencePeriod | null; priority?: number;
  suggestion: { key: string; title: string; approach: string; activity: string } | null; sinceIntervention: SinceIntervention | null }
export interface LanguageEvaluation { language: LanguageCode; name: string; hasData: boolean; assessments: number; readings: number;
  placement: { readingLevel: string; difficultyTier: string; source: string } | null;
  comprehension: Record<'literal' | 'inferential' | 'critical', CategoryResult>; wordRecognition: CategoryResult; fluency: CategoryResult }
export interface SuggestionsData { generatedAt: string; rules: Record<string, number | null>; languages: LanguageEvaluation[]; suggestions: SuggestionItem[];
  additionalNeeds: { id: string; competencyName: string; languageName: string; level: string | null }[]; improving: SuggestionItem[];
  moreDataNeeded: boolean; hasAnyData: boolean; notes: string[] }
export interface Student extends Metrics { id: string; full_name: string; nickname: string; classification: string; recoveryCount?: number; activities?: ActivityProgress[]; quizzes: Quiz[]; historicalQuizzes?: Quiz[]; competency: Record<string,{total:number;score:number|null}>; history: RiskEvent[]; interventions: Intervention[] }
export interface TeacherData { students: Student[]; notifications: RiskEvent[]; notificationsActive?: boolean }
export interface ActivityProgress { id: string; status: string; roomId: string; materialId?: string; title: string; kind?: 'module'; passagesCompleted?: number; passagesTotal?: number }
export interface PersonalData { summary: Metrics; quizzes: Quiz[]; historicalQuizzes?: Quiz[]; readings: {id:string;completed_at:string;pronunciation_accuracy:number;reading_speed_wpm:number;detected_error_count:number}[]; activities: ActivityProgress[] }
export interface SystemData extends Metrics { students:number;teachers:number;classrooms:number;assignedActivities:number }
/** A learner's progress request ends after this, so a stalled connection shows an error with Retry instead of loading forever. */
export const PERSONAL_PROGRESS_TIMEOUT_MS = 60_000;
export const ANALYTICS_TIMEOUT_MESSAGE = 'Loading is taking too long. Check your internet connection, then select Retry.';
/** `timeoutMs` is opt-in: requests without it behave exactly as before (no time limit). */
export async function m7Request<T>(path:string, method = 'GET', data?:unknown, { timeoutMs, signal }: { timeoutMs?: number; signal?: AbortSignal } = {}):Promise<T> {
  try {
    const response = await api.request({ url:`/api/analytics${path}`, method, data, ...(signal ? { signal } : {}), headers: await getSessionAuthHeaders('Please sign in again.'), ...(timeoutMs ? { timeout: timeoutMs } : {}) });
    return response.data.data as T;
  } catch(error) {
    if (timeoutMs && axios.isAxiosError(error) && !error.response && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')) throw new Error(ANALYTICS_TIMEOUT_MESSAGE);
    throw new Error(axios.isAxiosError(error) ? error.response?.data?.message || 'Unable to connect to analytics. Please retry.' : error instanceof Error ? error.message : 'Unable to load analytics.');
  }
}

export interface AdminStudentRow extends Metrics {
  id: string; name: string; classrooms: string[]; classification: string;
  completion: { assigned: number; completed: number; completionRate: number | null };
}
export interface AdminStudentDetail extends AdminStudentRow {
  competency: Record<string, { total: number; correct: number | null; score: number | null }>;
  contexts: { teacherId: string; teacherName: string; classrooms: string[]; classification: string; recoveryCount?: number; completedQuizzes: number; latestScores: { score: number | null; completedAt: string | null }[] }[];
  quizzes: Quiz[];
  historicalQuizzes?: Quiz[];
  readings: { id: string; title: string; completedAt: string; readingAccuracy: number | null; readingSpeedWpm: number | null }[];
  activities: { id: string; kind?: string; title: string; roomName: string; status: string; passagesCompleted?: number; passagesTotal?: number }[];
  interventions: { own: Intervention[]; others: { total: number; planned: number; inProgress: number; completed: number }; history?: SchoolInterventionRecord[] };
}
/** School Admin, read-only: one intervention recorded in the Admin's school (no Teacher private notes). */
export interface SchoolInterventionRecord { id: string; intervention_date: string; status: string; competency: string | null; language: string | null; suggestion_title: string | null;
  notes: string; follow_up_date: string | null; follow_up_outcome: string | null; follow_up_notes: string; created_at: string; updated_at: string; author: { name: string; role: string } }

export interface AdminFilters { roomId: string | null; startDate: string | null; endDate: string | null }
export interface CompletionSummary { assigned: number; completed: number; incomplete: number; completionRate: number | null }
export interface ClassroomComparison extends Metrics, CompletionSummary {
  id: string; name: string; teacherName: string; enrolledStudents: number; participatingStudents: number;
}
export interface SupportStudent {
  id: string; name: string; classification: string;
  contexts: { teacherId: string; teacherName: string; classrooms: string[]; classification: string; recoveryCount?: number; completedQuizzes: number; latestScores: { score: number | null; completedAt: string | null }[] }[];
  interventions: { total: number; planned: number; inProgress: number; completed: number };
}
export interface AdminSystemData extends SystemData {
  details: {
    filters: AdminFilters; generatedAt: string; classroomOptions: { id: string; name: string }[];
    performance: Metrics; trends: (Metrics & { weekStart: string })[]; classroomComparisons: ClassroomComparison[];
    participation: { students: number; participatingStudents: number; withoutRecordedActivity: number; participationRate: number | null };
    completion: CompletionSummary; riskCounts: Record<string, number>; supportStudents: SupportStudent[];
    independentPerformance: Metrics; unassignedClassroomReadings: number;
  };
}

// ---- System Admin (M7 F2 platform overview, F4 Independent Learner performance) ----
export interface PlatformOverview {
  generatedAt: string;
  users: { total: number; systemAdmins: number; schoolAdmins: number; teachers: number; approvedTeachers: number; students: number; independentLearners: number; withoutRole: number };
  modules: { published: number; draft: number; archived: number; inTrash: number };
  activity: Metrics & { activeLearners7Days: number; activeLearners30Days: number };
  students: Metrics;
  independentLearners: Metrics;
  weeklyActivity: { weekStart: string; readings: number; completedQuizzes: number; activeLearners: number }[];
}
export interface IndependentLearnerRow extends Metrics { id: string; name: string; lastActivityAt: string | null }
export interface ResultSource { kind: 'module' | 'own_material'; title: string }
export interface IndependentLearnerDetail {
  id: string; name: string; summary: Metrics; lastActivityAt: string | null;
  competency: Record<string, { total: number; correct: number | null; score: number | null }>;
  quizzes: { id: string; completedAt: string | null; score: number | null; firstCorrect?: number; totalQuestions?: number; dataQuality?: string; source: ResultSource }[];
  notCountedQuizzes: number;
  readings: { id: string; completedAt: string; readingAccuracy: number | null; readingSpeedWpm: number | null; wordsDifferent: number | null; source: ResultSource }[];
}
