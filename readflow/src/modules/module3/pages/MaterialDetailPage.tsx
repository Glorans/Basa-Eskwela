import { ArrowLeft, FileText, LoaderCircle } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import M3PageHeader from "../components/M3PageHeader";
import M3StatusBadge from "../components/M3StatusBadge";
import MaterialLanguageControl from "../components/MaterialLanguageControl";
import MaterialQuestionSets from "../components/MaterialQuestionSets";
import { useM3Content } from "../context/M3ContentContext";
import useAuthenticatedProfile from "../../../hooks/useAuthenticatedProfile";
import type { M3Role } from "../types/content";
import { getM3WorkspaceRoot } from "../utils/workspaceRoot";

interface MaterialDetailPageProps {
  role: Extract<M3Role, "admin" | "teacher" | "general_user">;
}

export default function MaterialDetailPage({ role }: MaterialDetailPageProps) {
  const { materialId } = useParams<{ materialId: string }>();
  const {
    getMaterial,
    materialsLoading,
    refreshMaterials,
  } = useM3Content();
  const { profile } = useAuthenticatedProfile();
  const material = getMaterial(materialId);
  const root = getM3WorkspaceRoot(role);
  const canView = Boolean(material);
  const canGenerate = Boolean(
    role === "teacher" &&
      material &&
      material.uploadedById === profile?.id &&
      material.processingStatus === "completed" &&
      material.contentText?.trim(),
  );
  const canDeleteSets = Boolean(
    role === "teacher" && material && material.uploadedById === profile?.id,
  );
  // Only the uploader corrects the language; Admin views but does not edit uploads.
  const canEditLanguage = Boolean(
    role !== "admin" && material && material.uploadedById === profile?.id,
  );

  // A background refresh (e.g. after a language correction) keeps the loaded page visible.
  if (materialsLoading && !material) {
    return (
      <div className="m3-empty-state m3-empty-state--page" role="status">
        <LoaderCircle className="m3-spinner" size={36} />
        <h1>Loading material...</h1>
      </div>
    );
  }

  if (!material || !canView) {
    return (
      <div className="m3-empty-state m3-empty-state--page">
        <FileText size={36} />
        <h1>Material unavailable</h1>
        <p>This material does not exist or is unavailable to your account.</p>
        <Link className="m3-button m3-button--primary" to={role === "admin" ? root : `${root}/materials`}>
          Back to Materials
        </Link>
      </div>
    );
  }

  const backTarget = role === "admin" ? root : `${root}/materials`;
  const showQuestionSets = role !== "general_user";
  return (
    <div className={`m3-page-stack ${showQuestionSets ? "m3-page-stack--wide" : "m3-page-stack--narrow"}`}>
      <Link className="m3-back-link" to={backTarget}>
        <ArrowLeft size={17} /> Back
      </Link>

      <M3PageHeader
        eyebrow={`${material.fileType} · ${material.language}`}
        title={material.title}
        description={
          "Saved reading material and its reviewed extracted text."
        }

      />

      <div className={showQuestionSets ? "m3-material-split" : "m3-page-stack"}>
      <section className={showQuestionSets ? "m3-detail-card m3-material-split__text" : "m3-detail-card"}>
        <div className="m3-detail-summary">
          <div>
            <span>Processing</span>
            <M3StatusBadge value={material.processingStatus} />
          </div>
          <div>
            <span>File</span>
            <strong>{material.originalFilename}</strong>
          </div>
          <div>
            <span>Size</span>
            <strong>{material.fileSizeLabel}</strong>
          </div>
          <div>
            <span>Uploader</span>
            <strong>{material.uploaderName}</strong>
          </div>
          {typeof material.ocrConfidence === "number" && (
            <div>
              <span>OCR confidence</span>
              <strong>{Math.round(material.ocrConfidence)}%</strong>
            </div>
          )}
        </div>

        <MaterialLanguageControl
          materialId={material.id}
          language={material.languageCode}
          canEdit={canEditLanguage}
          hasQuestionSets={role === "teacher"}
          onChanged={refreshMaterials}
        />

        <div className="m3-reading-preview">
          <p className="m3-eyebrow">Reviewed material text</p>
          {material.contentText ? (
            <p>{material.contentText}</p>
          ) : (
            <div className="m3-processing-placeholder">
              <FileText size={28} />
              <div>
                <strong>
                  {material.processingStatus === "pending_ocr"
                    ? "Text extraction status: Pending OCR"
                    : "Extracted text is not available"}
                </strong>
                <p>
                  {material.processingStatus === "pending_ocr"
                    ? "Text extraction for image files will be processed in the next step."
                    : "This saved record does not contain extracted text."}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {role !== "general_user" && (
        <div className="m3-material-split__main">
          <MaterialQuestionSets
            key={material.id}
            materialId={material.id}
            root={root}
            canGenerate={canGenerate}
            canDelete={canDeleteSets}
          />
        </div>
      )}
      </div>
    </div>
  );
}
