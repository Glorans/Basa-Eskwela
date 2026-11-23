import PersonalMaterialPractice from "../components/PersonalMaterialPractice";
import { ArrowLeft, FileText, LoaderCircle } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import M3PageHeader from "../components/M3PageHeader";
import M3StatusBadge from "../components/M3StatusBadge";
import MaterialLanguageControl from "../components/MaterialLanguageControl";
import MaterialQuestionSets from "../components/MaterialQuestionSets";
import { useM3Content } from "../context/M3ContentContext";
import useAuthenticatedProfile from "../../../hooks/useAuthenticatedProfile";
import type { M3Role } from "../types/content";
import { getM3WorkspaceRoot } from "../utils/workspaceRoot";

interface MaterialDetailPageProps {
  role: Extract<M3Role, "admin" | "teacher" | "general_user" | "system_admin">;
}

export default function MaterialDetailPage({ role }: MaterialDetailPageProps) {
  const { materialId } = useParams<{ materialId: string }>();
  const [searchParams] = useSearchParams();
  const {
    getMaterial,
    materialsLoading,
    refreshMaterials,
  } = useM3Content();
  const { profile } = useAuthenticatedProfile();
  const material = getMaterial(materialId);
  const root = getM3WorkspaceRoot(role);
  const canView = Boolean(material);
  // M3 all-role refinement: School Admins work on their own uploads like Teachers (Teacher uploads in their school
  // stay view-and-review for them).
  const staff = role === "teacher" || role === "system_admin" || role === "admin";
  const canGenerate = Boolean(
    staff &&
      material &&
      material.uploadedById === profile?.id &&
      material.processingStatus === "completed" &&
      material.contentText?.trim(),
  );
  const canDeleteSets = Boolean(staff && material && material.uploadedById === profile?.id);
  // Only the uploader corrects the language (a School Admin views, but does not change, a Teacher's upload).
  const canEditLanguage = Boolean(material && material.uploadedById === profile?.id);

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
        <Link className={role === "system_admin" ? "m3-back-link" : "m3-button m3-button--primary"} to={`${root}/materials`}>
          {role === "system_admin" && <ArrowLeft size={17} aria-hidden="true" />} Back to Materials
        </Link>
      </div>
    );
  }

  const backTarget = `${root}/materials`;
  const showQuestionSets = role !== "general_user";

  // Independent Learner: a short summary, then the practice steps (the reading text is checked and edited in step 1).
  if (role === "general_user") {
    return (
      <div className="m3-page-stack m3-page-stack--narrow m3-personal-material">
        <Link className="m3-back-link" to={backTarget}>
          <ArrowLeft size={17} /> Back to Reading Materials
        </Link>
        <M3PageHeader eyebrow="My reading material" title={material.title} description="Check the text, then practice reading it." />
        <section className="m3-detail-card">
          <div className="m3-detail-summary">
            <div><span>Source</span><strong>{material.originalFilename}</strong></div>
            <div><span>File type</span><strong>{material.fileType}</strong></div>
            <div><span>Status</span><M3StatusBadge value={material.processingStatus} /></div>
          </div>
          <MaterialLanguageControl
            materialId={material.id}
            language={material.languageCode}
            canEdit={canEditLanguage}
            hasQuestionSets={false}
            onChanged={refreshMaterials}
          />
        </section>
        <PersonalMaterialPractice
          key={`${material.id}:${material.languageCode}`}
          materialId={material.id}
          contentText={material.contentText}
          startEditing={searchParams.get("edit") === "1"}
          onTextSaved={() => void refreshMaterials()}
        />
      </div>
    );
  }

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
          hasQuestionSets={staff}
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

      <div className="m3-material-split__main">
        <MaterialQuestionSets
          key={material.id}
          materialId={material.id}
          root={root}
          canGenerate={canGenerate}
          canDelete={canDeleteSets}
          materialTitle={material.title}
          contentText={material.contentText ?? ""}
        />
      </div>
      </div>
    </div>
  );
}
