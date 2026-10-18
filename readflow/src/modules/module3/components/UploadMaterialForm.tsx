import { useId, useState, type FormEvent } from "react";
import { FileCheck2, LoaderCircle, UploadCloud } from "lucide-react";
import M3StatusBadge from "./M3StatusBadge";
import {
  getMaterialPersistenceError,
  getMaterialRequestError,
  MAX_MATERIAL_UPLOAD_BYTES,
  MAX_MATERIAL_TEXT_LENGTH,
  persistUploadedMaterial,
  uploadReadingMaterial,
  type TemporaryUploadedMaterial,
} from "../services/materialUpload";
import type { MaterialLanguageCode } from "../types/content";

interface UploadMaterialFormProps {
  onCancel: () => void;
  onAddToLibrary: (materialId: string) => void | Promise<void>;
}

type UploadStage = "idle" | "uploading" | "processing" | "success" | "error";

const ACCEPTED_FILE_TYPES =
  ".pdf,.docx,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png";

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function isImageFile(file: File | undefined) {
  return Boolean(file && (file.type === "image/jpeg" || file.type === "image/png"));
}

export default function UploadMaterialForm({
  onCancel,
  onAddToLibrary,
}: UploadMaterialFormProps) {
  const fileInputId = useId();
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<MaterialLanguageCode>("en");
  const [selectedFile, setSelectedFile] = useState<File>();
  const [stage, setStage] = useState<UploadStage>("idle");
  const [error, setError] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [uploadedMaterial, setUploadedMaterial] = useState<TemporaryUploadedMaterial>();
  const [reviewedText, setReviewedText] = useState("");
  const [isPersisting, setIsPersisting] = useState(false);
  const busy = stage === "uploading" || stage === "processing";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setStage("error");
      setError("Enter a material title before uploading.");
      return;
    }

    if (!selectedFile) {
      setStage("error");
      setError("Choose a PDF, DOCX, JPG, or PNG file to upload.");
      return;
    }

    if (selectedFile.size > MAX_MATERIAL_UPLOAD_BYTES) {
      setStage("error");
      setError("The selected file is larger than the 25 MB upload limit.");
      return;
    }

    setError("");
    setReviewError("");
    setStage("uploading");

    try {
      const material = await uploadReadingMaterial(
        {
          file: selectedFile,
          title: trimmedTitle,
          language,
        },
        () => setStage("processing"),
      );
      setUploadedMaterial(material);
      setReviewedText(material.extractedText ?? "");
      setStage("success");
    } catch (uploadError) {
      setError(getMaterialRequestError(uploadError));
      setStage("error");
    }
  }

  async function addReviewedMaterial() {
    const contentText = reviewedText.trim();

    if (!contentText || !uploadedMaterial || !selectedFile) {
      setReviewError("Reviewed text cannot be blank before adding this material.");
      return;
    }

    if (contentText.length > MAX_MATERIAL_TEXT_LENGTH) {
      setReviewError("The reviewed text is too long to save. Please shorten it before saving.");
      return;
    }
    setReviewError("");
    setIsPersisting(true);

    try {
      const persistedMaterial = await persistUploadedMaterial({
        file: selectedFile,
        material: uploadedMaterial,
        contentText,
      });
      await onAddToLibrary(persistedMaterial.id);
    } catch (persistenceError) {
      setReviewError(getMaterialPersistenceError(persistenceError));
    } finally {
      setIsPersisting(false);
    }
  }

  if (stage === "success" && uploadedMaterial) {
    const isImage = uploadedMaterial.fileType === "JPG" || uploadedMaterial.fileType === "PNG";

    return (
      <section className="m3-form-card m3-upload-result" aria-labelledby="m3-upload-result-title">
        <div className="m3-upload-result__heading">
          <span className="m3-upload-result__icon" aria-hidden="true">
            <FileCheck2 size={28} />
          </span>
          <div>
            <p className="m3-eyebrow">Upload complete</p>
            <h2 id="m3-upload-result-title">Text ready for review</h2>
          </div>
          <M3StatusBadge value={uploadedMaterial.extractionStatus} />
        </div>

        <dl className="m3-upload-metadata">
          <div>
            <dt>Filename</dt>
            <dd>{uploadedMaterial.originalFilename}</dd>
          </div>
          <div>
            <dt>{isImage ? "Image type" : "Type"}</dt>
            <dd>{uploadedMaterial.fileType}</dd>
          </div>
          <div>
            <dt>File size</dt>
            <dd>{formatFileSize(uploadedMaterial.size)}</dd>
          </div>
          <div>
            <dt>Language</dt>
            <dd>{uploadedMaterial.language === "en" ? "English" : "Filipino"}</dd>
          </div>
          {typeof uploadedMaterial.pageCount === "number" && (
            <div><dt>Pages detected</dt><dd>{uploadedMaterial.pageCount}</dd></div>
          )}
          {isImage && typeof uploadedMaterial.ocrConfidence === "number" && (
            <div>
              <dt>OCR confidence</dt>
              <dd>{Math.round(uploadedMaterial.ocrConfidence)}%</dd>
            </div>
          )}
          {isImage && (
            <div>
              <dt>OCR status</dt>
              <dd>Completed</dd>
            </div>
          )}
        </dl>

        {!!uploadedMaterial.pagesWithoutText?.length && (
          <p className="m3-inline-notice" role="status">
            No selectable text was found on PDF page(s) {uploadedMaterial.pagesWithoutText.join(", ")}.
            They may be blank or scanned. PDF images are not OCR-processed. Add any missing reading text below before saving.
          </p>
        )}
        <label className="m3-field m3-field--wide m3-review-text">
          <span>Extracted Reading Text</span>
          <small>Review all pages in order. Correct words, spacing, or unwanted headers and footers before saving.</small>
          <textarea
            value={reviewedText}
            onChange={(event) => {
              setReviewedText(event.target.value);
              setReviewError("");
            }}
            rows={15}
            required
            disabled={isPersisting}
          />
        </label>

        {reviewError && (
          <p className="m3-error-message" role="alert">
            {reviewError}
          </p>
        )}

        <div className="m3-form-actions">
          <button
            className="m3-button m3-button--primary"
            type="button"
            onClick={addReviewedMaterial}
            disabled={isPersisting}
          >
            {isPersisting && <LoaderCircle className="m3-spinner" size={18} />}
            {isPersisting ? "Adding Material..." : "Save Material"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <form className="m3-form-card" onSubmit={handleSubmit} aria-busy={busy}>
      <div className="m3-image-guidance">
        <strong>Multi-page reading materials</strong>
        <span>Upload one text-based PDF (maximum 5 pages), a DOCX, or one clear JPG/PNG image. Scanned PDFs and multiple image files are not supported.</span>
      </div>

      <div className="m3-form-grid">
        <label className="m3-field m3-field--wide">
          <span>Title</span>
          <input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setError("");
              setStage("idle");
            }}
            placeholder="Give this reading material a title"
            required
            disabled={busy}
          />
        </label>

        <label className="m3-field">
          <span>Language</span>
          <select
            value={language}
            onChange={(event) => {
              setLanguage(event.target.value as MaterialLanguageCode);
              setError("");
              setStage("idle");
            }}
            disabled={busy}
          >
            <option value="en">English</option>
            <option value="fil">Filipino</option>
          </select>
        </label>

        <div className="m3-field">
          <span>Supported formats</span>
          <div className="m3-format-list" aria-label="Supported file formats">
            <span>PDF</span>
            <span>DOCX</span>
            <span>JPG</span>
            <span>PNG</span>
          </div>
        </div>

        <div className="m3-field m3-field--wide">
          <span>File</span>
          <label
            className={`m3-file-drop ${selectedFile ? "m3-file-drop--selected" : ""}`}
            htmlFor={fileInputId}
          >
            {selectedFile ? <FileCheck2 size={32} /> : <UploadCloud size={34} />}
            <strong>{selectedFile ? selectedFile.name : "Choose a reading material"}</strong>
            <small>
              {selectedFile
                ? `${formatFileSize(selectedFile.size)} selected locally`
                : "PDF, DOCX, JPG, or PNG - maximum 25 MB"}
            </small>
          </label>
          <input
            className="m3-visually-hidden"
            id={fileInputId}
            type="file"
            accept={ACCEPTED_FILE_TYPES}
            disabled={busy}
            onChange={(event) => {
              setSelectedFile(event.target.files?.[0]);
              setError("");
              setStage("idle");
            }}
          />
        </div>
      </div>

      {busy && (
        <p className="m3-inline-notice" role="status">
          <span className="m3-progress-label">
            <LoaderCircle className="m3-spinner" size={19} />
            {stage === "uploading"
              ? "Uploading material..."
              : isImageFile(selectedFile)
                ? "Processing image text..."
                : "Extracting document text..."}
          </span>
        </p>
      )}

      {error && (
        <p className="m3-error-message" role="alert">
          {error}
        </p>
      )}

      <div className="m3-form-actions">
        <button className="m3-button m3-button--secondary" type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="m3-button m3-button--primary" type="submit" disabled={busy}>
          {busy ? <LoaderCircle className="m3-spinner" size={18} /> : <UploadCloud size={18} />}
          {busy ? "Working..." : stage === "error" ? "Retry Upload" : "Upload & Extract Text"}
        </button>
      </div>
    </form>
  );
}
