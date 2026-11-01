import { ArrowLeft, BookOpen, LoaderCircle, Mic, Pencil } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import M3PageHeader from "../components/M3PageHeader";
import M3StatusBadge from "../components/M3StatusBadge";
import { useM3Content } from "../context/M3ContentContext";
import type { M3Role } from "../types/content";
import { getM3WorkspaceRoot } from "../utils/workspaceRoot";
import AdminCollectionEditor from '../components/AdminCollectionEditor';
import StudentModuleViewPage from '../../../pages/StudentModuleViewPage';

interface ModuleDetailPageProps {
  role: Extract<M3Role, "admin" | "teacher" | "general_user">;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value.includes("T") ? value : `${value}T00:00:00`));
}

export default function ModuleDetailPage({ role }: ModuleDetailPageProps) {
  if (role === 'general_user') return <StudentModuleViewPage role="general_user" />;
  return role === 'admin' ? <AdminCollectionEditor mode="detail" /> : <LegacyModuleDetailPage role={role} />;
}

function LegacyModuleDetailPage({ role }: ModuleDetailPageProps) {
  const { moduleId } = useParams<{ moduleId: string }>();
  const { clearFeedback, feedback, getModule, modulesError, modulesLoading } = useM3Content();
  const module = getModule(moduleId);
  const root = getM3WorkspaceRoot(role);
  const backTarget = role === "admin" ? root : `${root}/modules`;

  if (modulesLoading) {
    return (
      <div className="m3-empty-state m3-empty-state--page" role="status">
        <LoaderCircle className="m3-spinner" size={36} />
        <h1>Loading reading module…</h1>
      </div>
    );
  }

  if (modulesError) {
    return (
      <div className="m3-empty-state m3-empty-state--page" role="alert">
        <BookOpen size={36} />
        <h1>Unable to load reading modules</h1>
        <p>{modulesError}</p>
        <Link className="m3-button m3-button--primary" to={backTarget}>
          Back to Reading Modules
        </Link>
      </div>
    );
  }

  if (!module) {
    return (
      <div className="m3-empty-state m3-empty-state--page">
        <BookOpen size={36} />
        <h1>Module not found</h1>
        <p>This module does not exist or is not available to your account.</p>
        <Link className="m3-button m3-button--primary" to={backTarget}>
          Back to Reading Modules
        </Link>
      </div>
    );
  }

  if (role !== "admin" && module.status !== "published") {
    return (
      <div className="m3-empty-state m3-empty-state--page">
        <BookOpen size={36} />
        <h1>Module unavailable</h1>
        <p>Teacher and General User previews can only open published modules.</p>
        <Link className="m3-button m3-button--primary" to={backTarget}>
          Back to Reading Modules
        </Link>
      </div>
    );
  }

  return (
    <div className="m3-page-stack m3-page-stack--narrow">
      <Link className="m3-back-link" to={backTarget}>
        <ArrowLeft size={17} /> Back to {role === "admin" ? "Content Management" : "Reading Modules"}
      </Link>

      <M3PageHeader
        eyebrow={`${module.learningPath} · ${module.difficulty}`}
        title={module.title}
        description="Reading module stored in the shared Basa Eskwela library."
        actions={
          role === "admin" ? (
            // Only never-published drafts can be edited or have questions generated.
            module.status === "draft" && !module.publishedAt ? <Link className="m3-button m3-button--coral" to={`/m3/admin/modules/${module.id}/edit`}>
              <Pencil size={17} /> Edit Module
            </Link> : undefined
          ) : role === "general_user" ? (
            <Link className="m3-button m3-button--coral" to={`/m3/general/modules/${module.id}/read-aloud`}>
              <Mic size={17} /> Start Read-Aloud
            </Link>
          ) : undefined
        }
      />

      {role === "admin" && feedback && (
        <div
          className={`m3-feedback-banner m3-feedback-banner--${feedback.kind}`}
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          <span>{feedback.message}</span>
          <button type="button" onClick={clearFeedback} aria-label="Dismiss message">
            &times;
          </button>
        </div>
      )}

      <section className="m3-detail-card">
        <div className="m3-detail-summary">
          {role === "admin" && <>
            <div><span>Language</span><strong>{module.language === "en" ? "English" : "Filipino"}</strong></div>
            <div><span>Reading Level</span><strong>{module.readingLevel}</strong></div>
            <div><span>Learning-path Tier</span><strong>{module.difficultyTier}</strong></div>
          </>}
          <div>
            <span>Status</span>
            <M3StatusBadge value={module.status} />
          </div>
          <div>
            <span>Difficulty</span>
            <strong>{module.difficulty}</strong>
          </div>
          <div>
            <span>Created</span>
            <strong>{formatDate(module.createdAt)}</strong>
          </div>
          <div>
            <span>Question bank</span>
            <strong>{module.questionCount} questions</strong>
          </div>
        </div>

        <div className="m3-reading-preview">
          <p className="m3-eyebrow">Reading passage</p>
          <h2>{module.title}</h2>
          <p>{module.passage}</p>
        </div>

        <div className="m3-question-summary">
          <div>
            <BookOpen size={22} />
            <span>
              <strong>Comprehension question bank</strong>
              <small>Literal, inferential, and critical questions will appear here.</small>
            </span>
          </div>
          <strong>{module.questionCount}</strong>
        </div>
      </section>
    </div>
  );
}
