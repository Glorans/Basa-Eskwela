import { useEffect, useState } from "react";
import { Eye, FilePlus2, FileQuestion, Files, LoaderCircle, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { confirmReadFlow } from "../../../components/ReadFlowDialog";
import M3PageHeader from "../components/M3PageHeader";
import M3StatusBadge from "../components/M3StatusBadge";
import { useM3Content } from "../context/M3ContentContext";
import { getMaterialServiceError } from "../services/materialService";
import type { M3Role, UploadedMaterial } from "../types/content";
import { getM3WorkspaceRoot } from "../utils/workspaceRoot";

interface MaterialLibraryPageProps {
  role: Extract<M3Role, "teacher" | "general_user">;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value.includes("T") ? value : `${value}T00:00:00`));
}

export default function MaterialLibraryPage({ role }: MaterialLibraryPageProps) {
  const root = getM3WorkspaceRoot(role);
  const { materials, materialsError, materialsLoading, removeMaterial, refreshMaterials } = useM3Content();
  useEffect(() => { void refreshMaterials(); }, [refreshMaterials]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string>();

  // Independent Learners remove a material from their list; it is retained, not erased.
  const personal = role === "general_user";

  async function deleteMaterial(material: UploadedMaterial) {
    if (personal && !(await confirmReadFlow(
      `Remove "${material.title}" from your Reading Materials?\n\n`
      + "You will no longer see it in this list or start new reading, question or comprehension practice with it. "
      + "An unfinished comprehension assessment for it becomes read-only.\n\n"
      + "This is not a permanent deletion. Basa Eskwela keeps the uploaded file, its saved text, any private questions "
      + "and your saved reading and comprehension results. Completed results stay in your history. "
      + "Removal cannot be undone here.",
      { confirm: "Remove", cancel: "Keep material" },
    ))) return;
    setDeletingId(material.id);
    setNotice("");
    setError("");

    try {
      await removeMaterial(material.id);
      setNotice(personal
        ? `${material.title} was removed from your Reading Materials. Its file, text and saved results are kept.`
        : `${material.title} was deleted.`);
    } catch (deleteError) {
      setError(
        getMaterialServiceError(
          deleteError,
          personal
            ? "Unable to remove the material. It remains in your library."
            : "Unable to delete the material. It remains in your library.",
        ),
      );
    } finally {
      setDeletingId(undefined);
    }
  }

  return (
    <div className="m3-page-stack">
      <M3PageHeader
        eyebrow={role === "teacher" ? "Teacher workspace" : "Personal workspace"}
        title="Reading Materials"
        description={
          role === "teacher"
            ? "Manage your source files and review generated comprehension questions."
            : "Manage source files for your personal reading activities."
        }
        actions={
          <Link className="m3-button m3-button--coral" to={`${root}/materials/upload`}>
            <FilePlus2 size={18} />
            Upload Material
          </Link>
        }
      />

      {notice && <div className="m3-success-message" role="status">{notice}</div>}
      {(error || materialsError) && <div className="m3-error-message" role="alert">{error || materialsError}</div>}

      <section className="m3-panel">
        <div className="m3-section-heading">
          <div>
            <h2>My Uploaded Materials</h2>
            <p>{materials.length} saved {materials.length === 1 ? "material" : "materials"}</p>
          </div>
        </div>

        {materialsLoading ? (
          <div className="m3-empty-state" role="status">
            <LoaderCircle className="m3-spinner" size={34} />
            <h2>Loading uploaded materials...</h2>
          </div>
        ) : <div className="m3-card-list">
          {materials.map((material) => (
            <article className="m3-record-card" key={material.id}>
              <div className="m3-record-icon m3-record-icon--material">
                <span>{material.fileType}</span>
              </div>
              <div className="m3-record-main">
                <div className="m3-record-heading">
                  <div>
                    <h2>{material.title}</h2>
                    <p>{material.originalFilename}</p>
                  </div>
                  <M3StatusBadge value={material.processingStatus} />
                </div>
                <div className="m3-record-meta">
                  <span>{material.fileType}</span>
                  <span>{material.language}</span>
                  <span>Uploaded {formatDate(material.uploadedAt)}</span>
                  {role === "teacher" && <span>{material.questionSetCount
                    ? `${material.questionSetCount} saved question ${material.questionSetCount === 1 ? "set" : "sets"}`
                    : "No saved question sets yet"}</span>}
                </div>
              </div>
              <div className="m3-record-actions" aria-label={`Actions for ${material.title}`}>
                <Link className="m3-action-link" to={`${root}/materials/${material.id}`}>
                  <Eye size={16} /> View Material
                </Link>
                {role === "teacher" && (
                  <Link className="m3-action-link" to={`${root}/materials/${material.id}#question-sets`}>
                    <FileQuestion size={16} /> {(material.questionSetCount ?? 0) > 0 ? "View Question Sets" : "Generate First Question Set"}
                  </Link>
                )}
                <button
                  className="m3-action-link m3-action-link--danger"
                  type="button"
                  disabled={deletingId === material.id}
                  onClick={() => deleteMaterial(material)}
                >
                  {deletingId === material.id ? (
                    <LoaderCircle className="m3-spinner" size={16} />
                  ) : (
                    <Trash2 size={16} />
                  )}
                  {deletingId === material.id
                    ? (personal ? "Removing..." : "Deleting...")
                    : (personal ? "Remove from Reading Materials" : "Delete")}
                </button>
              </div>
            </article>
          ))}

          {materials.length === 0 && (
            <div className="m3-empty-state">
              <Files size={34} />
              <h2>No uploaded materials yet</h2>
              <p>Use Upload Material to add your first reading source.</p>
            </div>
          )}
        </div>}
      </section>
    </div>
  );
}
