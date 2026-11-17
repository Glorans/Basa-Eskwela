import "./MaterialLibraryPage.css";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Eye, FilePlus2, FileQuestion, Files, LoaderCircle, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { confirmReadFlow } from "../../../components/ReadFlowDialog";
import M3PageHeader from "../components/M3PageHeader";
import M3StatusBadge from "../components/M3StatusBadge";
import { useM3Content } from "../context/M3ContentContext";
import { getMaterialServiceError, getTrashedMaterials, restorePersonalMaterial, type TrashedMaterial } from "../services/materialService";
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

  // Independent Learners move a material to Trash (kept, never erased) and can restore it from there.
  const personal = role === "general_user";
  const [searchParams, setSearchParams] = useSearchParams();
  const showTrash = personal && searchParams.get("view") === "trash";
  const [trash, setTrash] = useState<TrashedMaterial[]>();
  const [trashError, setTrashError] = useState("");
  const [restoringId, setRestoringId] = useState<string>();

  const loadTrash = useCallback(async () => {
    setTrashError("");
    try { setTrash(await getTrashedMaterials()); }
    catch (loadError) { setTrash([]); setTrashError(getMaterialServiceError(loadError, "Unable to load your Trash.")); }
  }, []);
  useEffect(() => { if (personal) void loadTrash(); }, [personal, loadTrash]);

  function openView(view: "materials" | "trash") {
    setNotice(""); setError("");
    setSearchParams(view === "trash" ? { view: "trash" } : {}, { replace: true });
  }

  async function deleteMaterial(material: UploadedMaterial) {
    if (personal && !(await confirmReadFlow(
      `Move "${material.title}" to Trash?\n\n`
      + "It leaves My Materials and you cannot practice with it until you restore it. "
      + "Nothing is erased: your file, text, questions and results are kept, and you can restore it from Trash.",
      { confirm: "Move to Trash", cancel: "Keep material" },
    ))) return;
    setDeletingId(material.id);
    setNotice("");
    setError("");

    try {
      await removeMaterial(material.id);
      setNotice(personal ? `${material.title} was moved to Trash.` : `${material.title} was deleted.`);
      if (personal) void loadTrash();
    } catch (deleteError) {
      setError(
        getMaterialServiceError(
          deleteError,
          personal
            ? "Unable to move the material to Trash. It is still in My Materials."
            : "Unable to delete the material. It remains in your library.",
        ),
      );
    } finally {
      setDeletingId(undefined);
    }
  }

  async function restore(material: TrashedMaterial) {
    setRestoringId(material.id); setNotice(""); setError("");
    try {
      await restorePersonalMaterial(material.id);
      setTrash((current) => current?.filter((item) => item.id !== material.id));
      await refreshMaterials();
      setNotice(`${material.title} is back in My Materials.`);
    } catch (restoreError) {
      setError(getMaterialServiceError(restoreError, "Unable to restore the material. It is still in Trash."));
    } finally {
      setRestoringId(undefined);
    }
  }

  const materialList = (
    <section className="m3-panel" id="my-materials">
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
                  <p>{personal ? `Source: ${material.originalFilename}` : material.originalFilename}</p>
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
                <Eye size={16} /> {personal ? "View" : "View Material"}
              </Link>
              {personal && (
                <Link className="m3-action-link" to={`${root}/materials/${material.id}?edit=1`}>
                  <Pencil size={16} /> Edit Text
                </Link>
              )}
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
                  ? (personal ? "Moving..." : "Deleting...")
                  : (personal ? "Move to Trash" : "Delete")}
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
  );

  const trashList = (
    <section className="m3-panel" id="trash" aria-labelledby="trash-heading">
      <div className="m3-section-heading">
        <div>
          <h2 id="trash-heading">Trash</h2>
          <p>Materials you moved here are kept. Restore one to practice with it again.</p>
        </div>
        <button type="button" className="m3-action-link" onClick={() => openView("materials")}>
          <ArrowLeft size={16} aria-hidden="true" /> Back to My Materials
        </button>
      </div>
      {trashError && <div className="m3-error-message" role="alert">{trashError}</div>}
      {!trash ? (
        <div className="m3-empty-state" role="status">
          <LoaderCircle className="m3-spinner" size={34} />
          <h2>Loading Trash...</h2>
        </div>
      ) : <div className="m3-card-list">
        {trash.map((material) => (
          <article className="m3-record-card m3-record-card--trash" key={material.id}>
            <div className="m3-record-icon m3-record-icon--material"><span>{material.fileType}</span></div>
            <div className="m3-record-main">
              <div className="m3-record-heading">
                <div>
                  <h2>{material.title}</h2>
                  <p>Source: {material.originalFilename}</p>
                </div>
              </div>
              <div className="m3-record-meta">
                <span>{material.language}</span>
                <span>Moved to Trash {formatDate(material.deletedAt)}</span>
              </div>
            </div>
            <div className="m3-record-actions" aria-label={`Actions for ${material.title}`}>
              <button className="m3-action-link" type="button" disabled={restoringId === material.id} onClick={() => void restore(material)}>
                {restoringId === material.id ? <LoaderCircle className="m3-spinner" size={16} /> : <RotateCcw size={16} />}
                {restoringId === material.id ? "Restoring..." : "Restore"}
              </button>
            </div>
          </article>
        ))}
        {trash.length === 0 && !trashError && (
          <div className="m3-empty-state">
            <Trash2 size={34} />
            <h2>Trash is empty</h2>
            <p>Materials you move to Trash appear here.</p>
          </div>
        )}
      </div>}
    </section>
  );

  return (
    <div className={`m3-page-stack${personal ? " m3-personal-library" : ""}`}>
      <M3PageHeader
        eyebrow={role === "teacher" ? "Teacher workspace" : "Personal workspace"}
        title="Reading Materials"
        description={
          role === "teacher"
            ? "Manage your source files and review generated comprehension questions."
            : "Upload a reading, check its text, then practice."
        }
        actions={<>
          {personal && (
            <button type="button" className={`m3-button m3-button--secondary m3-trash-button${showTrash ? " is-active" : ""}`}
              aria-pressed={showTrash} aria-label={`Trash, ${trash?.length ?? 0} ${(trash?.length ?? 0) === 1 ? "material" : "materials"}`}
              onClick={() => openView(showTrash ? "materials" : "trash")}>
              <Trash2 size={18} aria-hidden="true" />
              Trash
              <span className="m3-trash-button__count" aria-hidden="true">{trash?.length ?? 0}</span>
            </button>
          )}
          <Link className={`m3-button ${personal ? "m3-button--primary" : "m3-button--coral"}`} to={`${root}/materials/upload`}>
            <FilePlus2 size={18} />
            Upload Material
          </Link>
        </>}
      />

      {notice && <div className="m3-success-message" role="status">{notice}</div>}
      {(error || materialsError) && <div className="m3-error-message" role="alert">{error || materialsError}</div>}

      {showTrash ? trashList : materialList}
    </div>
  );
}
