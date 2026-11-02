import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import axios from "axios";
import { CheckCircle2, FileCheck2, LoaderCircle, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import M3StatusBadge from "./M3StatusBadge";
import {
  deleteTemporaryMaterial,
  getMaterialPersistenceError,
  getMaterialRequestError,
  MAX_MATERIAL_UPLOAD_BYTES,
  MAX_MATERIAL_TEXT_LENGTH,
  persistUploadedMaterial,
  uploadReadingMaterial,
  type MaterialLanguageDetection,
  type TemporaryUploadedMaterial,
} from "../services/materialUpload";
import type { MaterialLanguageCode } from "../types/content";

interface UploadMaterialFormProps {
  onCancel: () => void;
  /** Runs after the material is saved, e.g. to refresh the material list. */
  onSaved: (materialId: string) => void | Promise<void>;
  onViewMaterials: () => void;
  /** True while extracted text is waiting to be saved. */
  onUnsavedChange?: (unsaved: boolean) => void;
}

type UploadStage = "idle" | "uploading" | "processing" | "success" | "error";

const ACCEPTED_FILE_TYPES =
  ".pdf,.docx,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png";
const ACCEPTED_EXTENSIONS = ["pdf", "docx", "jpg", "jpeg", "png"];
const LANGUAGE_NAMES: Record<MaterialLanguageCode, string> = { en: "English", fil: "Filipino" };

function getFileProblem(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ACCEPTED_EXTENSIONS.includes(extension)) return "Choose a PDF, DOCX, JPG, or PNG file.";
  if (file.size > MAX_MATERIAL_UPLOAD_BYTES) return "The selected file is larger than the 25 MB upload limit.";
  return "";
}

function describeDetection(detection: MaterialLanguageDetection | null | undefined, chosen: MaterialLanguageCode | "") {
  if (!detection) return "";
  if (detection.certain && detection.language) {
    return chosen && chosen !== detection.language
      ? `Detected as ${LANGUAGE_NAMES[detection.language]}; you changed it to ${LANGUAGE_NAMES[chosen]}.`
      : `Detected automatically from the reading text: ${LANGUAGE_NAMES[detection.language]}. Change it if this is wrong.`;
  }
  const hint = detection.suggestedLanguage ? ` It looks mostly ${LANGUAGE_NAMES[detection.suggestedLanguage]}.` : "";
  return detection.reason === "mixed"
    ? `The text mixes English and Filipino, so the language could not be confirmed.${hint} Choose the main language before saving.`
    : `There is not enough text to detect the language.${hint} Choose English or Filipino before saving.`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function isImageFile(file: File | undefined) {
  return Boolean(file && (file.type === "image/jpeg" || file.type === "image/png"));
}

function getFileTypeLabel(file: File) {
  return (file.name.split(".").pop() ?? "").toUpperCase().replace("JPEG", "JPG");
}

export default function UploadMaterialForm({
  onCancel,
  onSaved,
  onViewMaterials,
  onUnsavedChange,
}: UploadMaterialFormProps) {
  const fileInputId = useId();
  const languageFieldId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const languageSelectRef = useRef<HTMLSelectElement>(null);
  const [title, setTitle] = useState("");
  const [selectedFile, setSelectedFile] = useState<File>();
  const [stage, setStage] = useState<UploadStage>("idle");
  const [error, setError] = useState("");
  const [fileError, setFileError] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [uploadedMaterial, setUploadedMaterial] = useState<TemporaryUploadedMaterial>();
  const [reviewedText, setReviewedText] = useState("");
  // Set once from detection when extraction finishes; afterwards only the teacher changes it.
  const [languageChoice, setLanguageChoice] = useState<MaterialLanguageCode | "">("");
  // A file picked in Step 2 while the extracted text has edits waits for confirmation.
  const [pendingFile, setPendingFile] = useState<File>();
  const [isPersisting, setIsPersisting] = useState(false);
  const [savedMaterialId, setSavedMaterialId] = useState<string>();
  // Synchronous guard: blocks a second save before React re-renders the disabled button.
  const saveLock = useRef(false);
  // Each upload gets a number; results from a removed or replaced file are ignored.
  const uploadRun = useRef(0);
  const uploadAbort = useRef<AbortController>();
  const busy = stage === "uploading" || stage === "processing";
  const unsaved = stage === "success" && Boolean(uploadedMaterial) && !savedMaterialId;

  useEffect(() => {
    onUnsavedChange?.(unsaved);
  }, [unsaved, onUnsavedChange]);

  // Warn before a refresh or tab close discards extracted text that is not saved yet.
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  // Leaving the page cancels an extraction that is still running.
  useEffect(() => () => {
    uploadRun.current += 1;
    uploadAbort.current?.abort();
  }, []);

  /** Forgets any extraction for the current file: a running request and an unsaved review. */
  function discardFileWork() {
    uploadRun.current += 1;
    uploadAbort.current?.abort();
    uploadAbort.current = undefined;
    if (uploadedMaterial && !savedMaterialId) {
      // Temporary uploads stay on the server until deleted, so release the discarded one.
      void deleteTemporaryMaterial(uploadedMaterial.id).catch(() => undefined);
    }
    saveLock.current = false;
    setUploadedMaterial(undefined);
    setReviewedText("");
    setLanguageChoice("");
    setPendingFile(undefined);
    setReviewError("");
    setError("");
    setFileError("");
    setStage("idle");
  }

  function openFilePicker() {
    if (isPersisting) return;
    fileInputRef.current?.click();
  }

  function applyFile(file: File) {
    discardFileWork();
    setSelectedFile(file);
    setFileError(getFileProblem(file));
  }

  function selectFile(file: File | undefined) {
    if (!file) return;
    const edited = Boolean(uploadedMaterial) && reviewedText !== (uploadedMaterial?.extractedText ?? "");
    if (edited) {
      setPendingFile(file);
      return;
    }
    applyFile(file);
  }

  function removeFile() {
    if (isPersisting) return;
    discardFileWork();
    setSelectedFile(undefined);
    if (fileInputRef.current) fileInputRef.current.value = "";
    // Keep keyboard users on the upload area after the file card disappears.
    requestAnimationFrame(() => fileInputRef.current?.focus());
  }

  function startAnotherUpload() {
    saveLock.current = false;
    uploadRun.current += 1;
    setTitle("");
    setSelectedFile(undefined);
    setUploadedMaterial(undefined);
    setReviewedText("");
    setLanguageChoice("");
    setSavedMaterialId(undefined);
    setReviewError("");
    setError("");
    setFileError("");
    setStage("idle");
  }

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

    const problem = getFileProblem(selectedFile);
    if (problem) {
      setFileError(problem);
      return;
    }

    setError("");
    setReviewError("");
    setStage("uploading");
    const run = ++uploadRun.current;
    const controller = new AbortController();
    uploadAbort.current = controller;
    const isCurrent = () => run === uploadRun.current;

    try {
      // No language is sent: the server detects English or Filipino from the text.
      const material = await uploadReadingMaterial(
        { file: selectedFile, title: trimmedTitle, signal: controller.signal },
        () => { if (isCurrent()) setStage("processing"); },
      );
      if (!isCurrent()) {
        void deleteTemporaryMaterial(material.id).catch(() => undefined);
        return;
      }
      setUploadedMaterial(material);
      setReviewedText(material.extractedText ?? "");
      setLanguageChoice(material.language ?? "");
      setStage("success");
    } catch (uploadError) {
      if (!isCurrent() || axios.isCancel(uploadError)) return;
      setError(getMaterialRequestError(uploadError));
      setStage("error");
    } finally {
      if (uploadAbort.current === controller) uploadAbort.current = undefined;
    }
  }

  async function saveReviewedMaterial() {
    // Never create the same material twice: once saved, or while a save is running, do nothing.
    if (saveLock.current || savedMaterialId) return;
    const contentText = reviewedText.trim();

    if (!contentText || !uploadedMaterial || !selectedFile) {
      setReviewError("The reviewed text cannot be blank. Add the reading text before saving.");
      return;
    }

    if (contentText.length > MAX_MATERIAL_TEXT_LENGTH) {
      setReviewError("The reviewed text is too long to save. Please shorten it before saving.");
      return;
    }

    if (!languageChoice) {
      setReviewError("Choose English or Filipino for this material before saving.");
      languageSelectRef.current?.focus();
      return;
    }
    saveLock.current = true;
    setReviewError("");
    setIsPersisting(true);

    let persistedId: string;
    try {
      const persistedMaterial = await persistUploadedMaterial({
        file: selectedFile,
        material: uploadedMaterial,
        contentText,
        language: languageChoice,
      });
      persistedId = persistedMaterial.id;
    } catch (persistenceError) {
      // Nothing was saved; the edited text stays in the text area for another try.
      setReviewError(`Your material was not saved. ${getMaterialPersistenceError(persistenceError)} Your edits are still here, so you can try again.`);
      saveLock.current = false;
      setIsPersisting(false);
      return;
    }

    // The save succeeded: lock it in before anything else can fail.
    setSavedMaterialId(persistedId);
    try {
      await onSaved(persistedId);
    } catch {
      // The material is saved; refreshing the list is not required for that.
    } finally {
      setIsPersisting(false);
    }
  }

  // One hidden picker serves Step 1 and Step 2. Its value is cleared after each pick so
  // choosing the same file again still triggers a change.
  const fileInput = (
    <input
      ref={fileInputRef}
      className="m3-visually-hidden"
      id={fileInputId}
      type="file"
      accept={ACCEPTED_FILE_TYPES}
      disabled={isPersisting}
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        selectFile(file);
      }}
    />
  );

  if (stage === "success" && uploadedMaterial && savedMaterialId && !isPersisting) {
    return (
      <section className="m3-form-card m3-upload-result" aria-labelledby="m3-upload-saved-title">
        <div className="m3-upload-result__heading">
          <span className="m3-upload-result__icon" aria-hidden="true">
            <CheckCircle2 size={28} />
          </span>
          <div>
            <p className="m3-eyebrow">Saved to Reading Materials</p>
            <h2 id="m3-upload-saved-title">Material Saved Successfully</h2>
          </div>
          <M3StatusBadge value="completed" label="Saved" />
        </div>
        <p className="m3-success-message" role="status">
          "{title.trim() || uploadedMaterial.originalFilename}" is saved and now appears in Reading Materials.
        </p>
        <div className="m3-form-actions">
          <button className="m3-button m3-button--secondary" type="button" onClick={startAnotherUpload}>
            <UploadCloud size={18} /> Upload Another Material
          </button>
          <button className="m3-button m3-button--primary" type="button" onClick={onViewMaterials}>
            Go to Reading Materials
          </button>
        </div>
      </section>
    );
  }

  if (stage === "success" && uploadedMaterial) {
    const isImage = uploadedMaterial.fileType === "JPG" || uploadedMaterial.fileType === "PNG";
    const detectionNote = describeDetection(uploadedMaterial.languageDetection, languageChoice);
    const detectedLanguage = uploadedMaterial.languageDetection?.certain && uploadedMaterial.language
      ? LANGUAGE_NAMES[uploadedMaterial.language]
      : "Not confirmed - choose below";

    return (
      <section className="m3-form-card m3-upload-result" aria-labelledby="m3-upload-result-title" aria-busy={isPersisting}>
        {fileInput}
        <div className="m3-upload-result__heading">
          <span className="m3-upload-result__icon" aria-hidden="true">
            <FileCheck2 size={28} />
          </span>
          <div>
            <p className="m3-eyebrow">Step 2 of 2: Text Extracted Successfully</p>
            <h2 id="m3-upload-result-title">Review &amp; Save Material</h2>
          </div>
          <M3StatusBadge value="pending" label="Ready for Review" />
        </div>
        <p>Review the extracted text and correct any errors before saving.</p>
        <p className="m3-inline-notice" role="status">
          <strong>Not saved yet.</strong> This material will not appear in Reading Materials until you select Save Reviewed Material.
        </p>

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
            <dt>Detected language</dt>
            <dd>{detectedLanguage}</dd>
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
              <dd>Text extracted</dd>
            </div>
          )}
        </dl>

        <label className="m3-field m3-review-language" htmlFor={languageFieldId}>
          <span>Reading Language</span>
          {detectionNote && (
            <small id={`${languageFieldId}-note`} className={uploadedMaterial.languageDetection?.certain ? undefined : "m3-review-language__warning"}>
              {detectionNote}
            </small>
          )}
          <select
            ref={languageSelectRef}
            id={languageFieldId}
            value={languageChoice}
            aria-describedby={detectionNote ? `${languageFieldId}-note` : undefined}
            aria-invalid={!languageChoice}
            disabled={isPersisting}
            onChange={(event) => {
              setLanguageChoice(event.target.value as MaterialLanguageCode);
              setReviewError("");
            }}
          >
            <option value="" disabled>Choose English or Filipino</option>
            <option value="en">English</option>
            <option value="fil">Filipino</option>
          </select>
          <small>Learning Rooms only offer materials that match the room&apos;s language.</small>
        </label>

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
            disabled={isPersisting || Boolean(savedMaterialId)}
          />
        </label>

        {reviewError && (
          <p className="m3-error-message" role="alert">
            {reviewError}
          </p>
        )}

        {isPersisting && (
          <p className="m3-inline-notice" role="status">
            <span className="m3-progress-label">
              <LoaderCircle className="m3-spinner" size={19} />
              {savedMaterialId ? "Material saved. Updating Reading Materials..." : "Saving your reviewed material..."}
            </span>
          </p>
        )}

        {pendingFile && (
          <div className="m3-inline-notice m3-discard-confirm" role="alert">
            <span>
              <strong>Discard your edits?</strong> Using "{pendingFile.name}" removes the edited text for this file.
            </span>
            <span className="m3-discard-confirm__actions">
              <button className="m3-button m3-button--secondary" type="button" onClick={() => setPendingFile(undefined)}>
                Keep Editing
              </button>
              <button className="m3-button m3-button--danger" type="button" onClick={() => applyFile(pendingFile)}>
                Discard and Change File
              </button>
            </span>
          </div>
        )}

        <div className="m3-form-actions">
          <button
            className="m3-button m3-button--secondary"
            type="button"
            onClick={onCancel}
            disabled={isPersisting}
          >
            Cancel
          </button>
          <button
            className="m3-button m3-button--secondary"
            type="button"
            onClick={openFilePicker}
            disabled={isPersisting}
          >
            <RefreshCw size={17} /> Change File
          </button>
          <button
            className="m3-button m3-button--primary"
            type="button"
            onClick={() => void saveReviewedMaterial()}
            disabled={isPersisting || Boolean(savedMaterialId)}
            aria-busy={isPersisting}
          >
            {isPersisting && <LoaderCircle className="m3-spinner" size={18} />}
            {isPersisting ? "Saving Reviewed Material..." : "Save Reviewed Material"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <form className="m3-form-card" onSubmit={handleSubmit} aria-busy={busy}>
      <div>
        <p className="m3-eyebrow">Step 1 of 2: Upload &amp; Extract Text</p>
      </div>
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

        <div className="m3-field">
          <span>Language</span>
          <p className="m3-language-auto">
            Detected automatically as English or Filipino from the reading text. You can confirm or change it in Step 2.
          </p>
        </div>

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
          <span id={`${fileInputId}-label`}>File</span>
          {fileInput}
          {selectedFile ? (
            <div className="m3-file-drop m3-file-drop--selected m3-file-selected" aria-labelledby={`${fileInputId}-label`}>
              <FileCheck2 size={32} aria-hidden="true" />
              <strong className="m3-file-selected__name">{selectedFile.name}</strong>
              <small>
                {getFileTypeLabel(selectedFile)} &middot; {formatFileSize(selectedFile.size)} selected
              </small>
              <div className="m3-file-selected__actions">
                <button className="m3-button m3-button--secondary" type="button" onClick={openFilePicker}>
                  <RefreshCw size={17} /> Change File
                </button>
                <button className="m3-button m3-button--secondary" type="button" onClick={removeFile}>
                  <Trash2 size={17} /> Remove File
                </button>
              </div>
            </div>
          ) : (
            <label className="m3-file-drop" htmlFor={fileInputId}>
              <UploadCloud size={34} />
              <strong>Choose a reading material</strong>
              <small>PDF, DOCX, JPG, or PNG - maximum 25 MB</small>
            </label>
          )}
          {fileError && (
            <p className="m3-error-message" role="alert">
              {fileError}
            </p>
          )}
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
        <button className="m3-button m3-button--primary" type="submit" disabled={busy || Boolean(fileError)}>
          {busy ? <LoaderCircle className="m3-spinner" size={18} /> : <UploadCloud size={18} />}
          {busy ? "Working..." : stage === "error" ? "Retry Upload" : "Upload & Extract Text"}
        </button>
      </div>
    </form>
  );
}
