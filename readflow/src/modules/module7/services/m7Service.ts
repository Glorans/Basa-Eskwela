import axios from 'axios';
import api from '../../../services/api';
import { getSessionAuthHeaders } from '../../../services/authHeaders';
export interface Metrics { invalidCompletedQuizzes?: number; readingAttempts: number; completedQuizzes: number; pronunciationAccuracy: number | null; readingSpeedWpm: number | null; comprehensionScore: number | null }
export interface Quiz { id: string; title: string; completedAt: string | null; score: number | null; firstCorrect?: number; totalQuestions?: number; hintsUsed?: number; dataQuality?: string }
export interface RiskEvent { id: string; attempt_id: string; student_id: string; classification: string; previous_classification: string; occurred_at: string; read_at: string | null; superseded_at: string | null; evidence: {id: string; score: number | null; completedAt: string | null}[] }
export interface Intervention { id: string; notes: string; intervention_date: string; status: string; follow_up_date: string | null; follow_up_notes: string }
export interface Student extends Metrics { id: string; full_name: string; nickname: string; classification: string; quizzes: Quiz[]; competency: Record<string,{total:number;score:number|null}>; history: RiskEvent[]; interventions: Intervention[] }
export interface TeacherData { students: Student[]; notifications: RiskEvent[] }
export interface PersonalData { summary: Metrics; quizzes: Quiz[]; readings: {id:string;completed_at:string;pronunciation_accuracy:number;reading_speed_wpm:number;detected_error_count:number}[]; activities: {id:string;status:string;roomId:string;materialId:string;title:string}[] }
export interface SystemData extends Metrics { students:number;teachers:number;classrooms:number;assignedActivities:number }
export async function m7Request<T>(path:string, method = 'GET', data?:unknown):Promise<T> {
  try {
    const response = await api.request({ url:`/api/analytics${path}`, method, data, headers: await getSessionAuthHeaders('Please sign in again.') });
    return response.data.data as T;
  } catch(error) {
    throw new Error(axios.isAxiosError(error) ? error.response?.data?.message || 'Unable to connect to analytics. Please retry.' : error instanceof Error ? error.message : 'Unable to load analytics.');
  }
}

export interface AdminFilters { roomId: string | null; startDate: string | null; endDate: string | null }
export interface CompletionSummary { assigned: number; completed: number; incomplete: number; completionRate: number | null }
export interface ClassroomComparison extends Metrics, CompletionSummary {
  id: string; name: string; teacherName: string; enrolledStudents: number; participatingStudents: number;
}
export interface SupportStudent {
  id: string; name: string; classification: string;
  contexts: { teacherId: string; teacherName: string; classrooms: string[]; classification: string; completedQuizzes: number; latestScores: { score: number | null; completedAt: string | null }[] }[];
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
