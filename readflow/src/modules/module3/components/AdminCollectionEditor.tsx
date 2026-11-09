import { confirmReadFlow } from "../../../components/ReadFlowDialog";
import "./AdminCollectionEditor.css";
import InlineRegeneration from "./InlineRegeneration";
import BankSizeSelect from "./BankSizeSelect";
import PassageBank from "./PassageBank";
import ReadOnlyPassageBank from "./ReadOnlyPassageBank";
import { resolveLearningPath, learningPathSelectionIssue } from "../utils/learningPathSelection";
import { groupPublishIssues } from "../utils/publishIssues";
import { passageUploadIssue, suggestedPassageTitle } from "../utils/passageUpload";
import { SIX_ONLY, isBalancedBank, numberWord, targetBankSize } from "../utils/passageBankSize.ts";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { useM3Content } from "../context/M3ContentContext";
import {
  ADMIN_MODULE_FILE_ACCEPT,
  extractAdminModulePassage,
} from "../services/adminModuleExtraction";
import {
  collectionError,
  generateBank,
  checkGeneratedBank,
  getPassageBankSizes,
  getModuleRevisions,
  reviseModule,
  type ModuleRevision,
  GenerationPendingError,
  type GenerationStage,
  loadCollection,
  passageRepository,
  saveBank,
  saveCollection,
  type AdminCollection,
  type AdminPassage,
} from "../services/adminCollectionService";

interface PassageUpload {
  fileName: string;
  status: "selected" | "extracting" | "done" | "error" | "cancelled";
  message: string;
}

// Axios reports an unreachable server as a bare "Network Error".
function uploadErrorMessage(text: string) {
  return /^Network Error$/i.test(text)
    ? "The extraction service could not be reached. Check your connection and try again, or type the passage text."
    : text;
}

export default function AdminCollectionEditor({
  mode,
}: {
  mode: "create" | "edit" | "detail";
}) {
  const { moduleId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const {
    learningPaths,
    learningPathsLoading,
    learningPathsError,
    refreshModules,
    publishModule,
  } = useM3Content();

  const [collection, setCollection] =
    useState<AdminCollection | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [bankDirty, setBankDirty] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pathLanguage, setPathLanguage] = useState<string | null>(null);
  const [pathReadingLevel, setPathReadingLevel] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [generationStage, setGenerationStage] = useState<GenerationStage>("generating");
  const [uncertainPassage, setUncertainPassage] = useState<string | null>(null);
  // Six only until the database reports 6/9/12 support (m3_passage_bank_sizes).
  const [bankSizes, setBankSizes] = useState<readonly number[]>(SIX_ONLY);
  const [requestedSizes, setRequestedSizes] = useState<Record<string, number>>({});
  // Versions of a published module; null until m3_module_revisions is installed.
  const [revisions, setRevisions] = useState<ModuleRevision[] | null>(null);
  const generationPending = useRef(false);
  const [generationFeedback, setGenerationFeedback] = useState<{
    passageId: string;
    message: string;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const [extracting, setExtracting] = useState<string | null>(null);
  // Per-passage file selection and extraction result, keyed by passage id.
  const [uploads, setUploads] = useState<Record<string, PassageUpload>>({});

  const generation = useRef(0);
  const collectionRef = useRef(collection);
  collectionRef.current = collection;
  const savedIds = useRef(new Set<string>());
  const extractionController = useRef<AbortController | null>(null);

  useEffect(() => {
    if (dirty) setDraftMessage("");
  }, [dirty]);

  useEffect(() => {
    let live = true;
    void getPassageBankSizes().then((sizes) => { if (live) setBankSizes(sizes); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (mode !== "detail" || !moduleId) { setRevisions(null); return; }
    let live = true;
    void getModuleRevisions(moduleId).then((list) => { if (live) setRevisions(list); });
    return () => { live = false; };
  }, [mode, moduleId]);

  function startRevision() {
    if (!collection || busy) return;
    void perform(async () => {
      if (!(await confirmReadFlow(`Revise "${collection.title}"? A separate editable draft copy is created. The published module, its assignments and learner results stay unchanged, and every copied question must be reviewed again before the revision can be published.`))) return;
      const revisionId = await reviseModule(collection.id);
      navigate(`/m3/admin/modules/${revisionId}/edit`);
    });
  }

  const bankSizeFor = (passage: AdminPassage) =>
    requestedSizes[passage.id] ?? targetBankSize(passage.questions.length, bankSizes);

  useEffect(() => {
    const current = ++generation.current;

    setGenerating(null);
    setUncertainPassage(null);
    setGenerationFeedback(null);
    setDraftMessage(
      location.state?.draftSaved ? "Draft saved successfully." : "",
    );

    if (location.state?.draftSaved) {
      navigate(location.pathname, {
        replace: true,
        state: null,
      });
    }

    setCollection(null);
    setPathLanguage(null);
    setPathReadingLevel(null);
    setMessage("");
    setRemoved([]);
    setDirty(false);
    setBankDirty(null);
    setUploads({});
    savedIds.current = new Set();

    if (mode === "create") {
      setCollection({
        id: crypto.randomUUID(),
        title: "",
        learningPathId: "",
        difficulty: "Easy",
        passages: [
          {
            id: crypto.randomUUID(),
            title: "",
            passageText: "",
            sourceMaterialId: null,
            displayOrder: 1,
            questions: [],
          },
        ],
        revision: 0,
        status: "draft",
        publishedAt: null,
        language: null,
      });
    } else if (moduleId) {
      void loadCollection(moduleId)
        .then((value) => {
          if (generation.current !== current) return;

          setCollection(value);
          savedIds.current = new Set(
            value.passages.map((passage) => passage.id),
          );
        })
        .catch((error) => {
          if (generation.current === current) {
            setMessage(collectionError(error));
          }
        });
    }

    return () => {
      generation.current++;
      extractionController.current?.abort();
    };
  }, [mode, moduleId]);

  const readOnly =
    mode === "detail" ||
    collection?.status !== "draft" ||
    Boolean(collection?.publishedAt);

  async function perform(
    work: () => Promise<void>,
    report: (message: string) => void = setMessage,
  ) {
    setBusy(true);
    report("");

    try {
      await work();
    } catch (error) {
      report(collectionError(error));
    } finally {
      setBusy(false);
    }
  }

  function changePassage(
    id: string,
    change: Partial<AdminPassage>,
  ) {
    setCollection((current) =>
      current
        ? {
            ...current,
            passages: current.passages.map((passage) =>
              passage.id === id
                ? { ...passage, ...change }
                : passage,
            ),
          }
        : current,
    );

    setDirty(true);
    setIssues([]);
  }

  function addPassageBelow(index: number) {
    const passage: AdminPassage = {
      id: crypto.randomUUID(),
      title: "",
      passageText: "",
      sourceMaterialId: null,
      displayOrder: index + 2,
      questions: [],
    };

    setCollection((current) => {
      if (!current) return current;

      const passages = [...current.passages];
      passages.splice(index + 1, 0, passage);

      return {
        ...current,
        passages: passages.map((item, itemIndex) => ({
          ...item,
          displayOrder: itemIndex + 1,
        })),
      };
    });

    setDirty(true);
    setIssues([]);
  }

  async function reload() {
    if (!collection) return;

    const current = generation.current;
    const value = await loadCollection(collection.id);

    if (generation.current !== current) return;

    setCollection(value);
    savedIds.current = new Set(
      value.passages.map((passage) => passage.id),
    );
    setDirty(false);
    setBankDirty(null);
    setRemoved([]);
    setIssues([]);

    await refreshModules();
  }

  async function persist() {
    if (!collection) return;
    const path = learningPaths.find(item => item.id === collection.learningPathId);
    if (!path || !resolveLearningPath(learningPaths, path.language, path.readingLevel)) {
      throw new Error("Choose a uniquely configured language and reading level before saving.");
    }

    if (mode === "create") {
      await passageRepository.createDraft(
        collection.id,
        collection,
        learningPaths.map((path) => path.id),
      );

      await refreshModules();

      navigate(`/m3/admin/modules/${collection.id}/edit`, {
        replace: true,
        state: { draftSaved: true },
      });
    } else {
      await saveCollection(collection, removed);
      await reload();
    }

    setDirty(false);
    setDraftMessage("Draft saved successfully.");
  }

  async function saveDraft() {
    if (
      !dirty ||
      busy ||
      saving ||
      readOnly ||
      bankDirty ||
      learningPathsError
    ) {
      return;
    }

    setSaving(true);

    try {
      await perform(persist, setDraftMessage);
    } finally {
      setSaving(false);
    }
  }

  function setUpload(id: string, upload: PassageUpload | null) {
    setUploads((current) => {
      const next = { ...current };
      if (upload) next[id] = upload;
      else delete next[id];
      return next;
    });
  }

  async function extract(id: string, file?: File) {
    const passage = collection?.passages.find((item) => item.id === id);
    if (!file || !collection || !passage) return;

    const fileName = file.name;
    const fail = (text: string) =>
      setUpload(id, { fileName, status: "error", message: text });

    const issue = passageUploadIssue(file, ADMIN_MODULE_FILE_ACCEPT);
    if (issue) return fail(issue);

    const language = learningPaths.find(
      (path) => path.id === collection.learningPathId,
    )?.language;

    if (!language) {
      return fail(
        "Select a learning path before extracting. Choose the module's Language and Reading Level above, then choose the file again.",
      );
    }

    const current = generation.current;
    setUpload(id, { fileName, status: "selected", message: "" });

    if (
      passage.passageText.trim() &&
      !(await confirmReadFlow(
        `This passage already has text. Replace it with the text extracted from "${fileName}"?`,
      ))
    ) {
      if (generation.current === current) {
        setUpload(id, {
          fileName,
          status: "cancelled",
          message: "Extraction cancelled. The passage text was kept.",
        });
      }
      return;
    }
    if (generation.current !== current) return;

    const controller = new AbortController();

    extractionController.current = controller;
    setExtracting(id);
    setUpload(id, {
      fileName,
      status: "extracting",
      message: `Extracting text from "${fileName}"…`,
    });

    await perform(
      async () => {
        try {
          const result = await extractAdminModulePassage(
            { file, learningPathLanguage: language },
            undefined,
            controller.signal,
          );

          if (
            generation.current !== current ||
            controller.signal.aborted
          ) {
            return;
          }

          // The title is filled only when this passage has none yet.
          const title = suggestedPassageTitle(result.extractedText);
          const titleFilled = Boolean(
            title &&
              !collectionRef.current?.passages
                .find((item) => item.id === id)
                ?.title.trim(),
          );
          changePassage(id, {
            passageText: result.extractedText,
            ...(titleFilled && title ? { title } : {}),
          });
          setUpload(id, {
            fileName,
            status: "done",
            message: `Extracted text is ready to edit. Review it before saving the draft.${
              titleFilled
                ? " The passage title was filled from the document's first line."
                : ""
            }`,
          });
        } catch (error) {
          if (!controller.signal.aborted) throw error;
        } finally {
          if (extractionController.current === controller) {
            extractionController.current = null;
            setExtracting(null);
          }
        }
      },
      (text) => {
        if (text && generation.current === current) {
          fail(uploadErrorMessage(text));
        }
      },
    );
  }

  function generateQuestions(passageId: string) {
    if (!collection || busy || dirty || readOnly || bankDirty || generationPending.current) {
      return;
    }
    generationPending.current = true;
    const current = generation.current;
    const target = collection.passages.find((passage) => passage.id === passageId);
    const size = target ? bankSizeFor(target) : bankSizes[0];
    const sizeWord = numberWord(size);

    void perform(
      async () => {
        // Regeneration keeps the saved bank size unless the Admin explicitly confirms a change.
        const saved = target?.questions.length ?? 0;
        if (saved && saved !== size && uncertainPassage !== passageId && !(await confirmReadFlow(
          `Replace this passage's saved ${saved}-question bank with ${size} new questions? The current questions and their reviews will be replaced.`,
        ))) {
          generationPending.current = false;
          return;
        }
        setGenerating(passageId);

        try {
          if (uncertainPassage === passageId) {
            setGenerationStage("checking");
            const outcome = await checkGeneratedBank(collection, passageId);
            setUncertainPassage(null);
            if (outcome === "failed") {
              setGenerationFeedback({ passageId, message: "No new questions were saved. Review the passage before choosing Generate again." });
              return;
            }
          } else {
            setGenerationStage("generating");
            await generateBank(collection, passageId, stage => {
              if (generation.current === current) setGenerationStage(stage);
            }, size);
          }
          if (generation.current !== current) return;
          try {
            await reload();
          } catch {
            setGenerationFeedback({ passageId, message: "Questions were saved, but the preview could not refresh. Reload this module to review them before generating another set." });
            return;
          }

          setGenerationFeedback({
            passageId,
            message:
              `${sizeWord.charAt(0).toUpperCase()}${sizeWord.slice(1)} questions generated and saved. Review the answers, explanations, and evidence before publication.`,
          });
        } catch (error) {
          if (generation.current !== current) return;
          if (error instanceof GenerationPendingError) setUncertainPassage(passageId);
          throw error;
        } finally {
          generationPending.current = false;
          if (generation.current === current) setGenerating(null);
        }
      },
      (feedback) =>
        setGenerationFeedback({
          passageId,
          message: feedback,
        }),
    );
  }

  if (!collection || learningPathsLoading) {
    return (
      <div role="status">
        {message || "Loading module…"}
      </div>
    );
  }

  const selectedPath = learningPaths.find(
    (path) => path.id === collection.learningPathId,
  );
  const chosenLanguage = pathLanguage ?? selectedPath?.language ?? "";
  const chosenLevel = pathReadingLevel ?? selectedPath?.readingLevel ?? "";
  const pathIssue = learningPathSelectionIssue(learningPaths, chosenLanguage, chosenLevel);
  function choosePath(language: string, readingLevel: string) {
    if (!collection) return;
    const path = resolveLearningPath(learningPaths, language, readingLevel);
    setPathLanguage(language);
    setPathReadingLevel(readingLevel);
    setCollection({ ...collection, learningPathId: path?.id ?? "", language: path?.language ?? null,
      difficulty: path?.difficultyTier ?? collection.difficulty });
    setDirty(true);
  }
  const groupedIssues = groupPublishIssues(issues);

  const total = collection.passages.reduce(
    (sum, passage) => sum + passage.questions.length,
    0,
  );

  return (
    <div className="m3-page-stack m3-page-stack--narrow m3-collection-editor">
      <header className="m3-editor-header">
        <Link className="m3-editor-back" to="/m3/admin">
          &larr; Back to Content Management
        </Link>
        <p className="m3-eyebrow">Admin Workspace</p>
        <h1>
          {mode === "create"
            ? "Create Reading Module"
            : mode === "edit"
              ? "Edit Reading Module"
              : collection.title}
        </h1>
        <p className="m3-page-description">
          Organize your passages and review their questions
          to prepare a reading module.
        </p>
        <span className="m3-editor-badge">
          {collection.status === "draft"
            ? "Draft"
            : collection.status === "published"
              ? "Published"
              : collection.status}
          {" • "}
          {collection.passages.length} passages
          {" • "}
          {total} questions
        </span>
      </header>

      {message && (
        <p className="m3-editor-notice" role="status">
          {message}
        </p>
      )}

      {bankDirty && (
        <p role="status">
          Save or discard question edits before changing
          passages or another bank.
        </p>
      )}

      {learningPathsError && (
        <p role="alert">{learningPathsError}</p>
      )}

      {(collection.status !== "draft" || collection.publishedAt) && (
        <p role="status">
          This module has been published, so its passages and
          questions are locked to protect learner results. Only
          unpublished drafts can be edited or have questions
          generated.
        </p>
      )}

      {mode === "detail" && revisions && collection.publishedAt && (
        <section className="m3-editor-card" aria-labelledby="module-versions">
          <h2 id="module-versions">Versions</h2>
          <ol className="m3-editor-help">
            {revisions.map((revision) => (
              <li key={revision.id}>
                {revision.id === collection.id ? <strong>Version {revision.revisionNumber} (this module)</strong>
                  : <Link to={`/m3/admin/modules/${revision.id}`}>Version {revision.revisionNumber}</Link>}
                {" · "}{revision.inTrash ? "in Trash" : revision.status}
              </li>
            ))}
          </ol>
          <button type="button" className="m3-button m3-button--secondary" disabled={busy} onClick={startRevision}>
            {revisions.some((revision) => revision.status === "draft" && !revision.inTrash) ? "Continue Revision" : "Revise Module"}
          </button>
        </section>
      )}

      {mode === "detail" && collection.status === "draft" && !collection.publishedAt && (
        <Link to={`/m3/admin/modules/${collection.id}/edit`}>
          Edit passages and review questions
        </Link>
      )}

      <div className="m3-editor-card">
        <h2 id="module-information">Module information</h2>

        <fieldset
          aria-labelledby="module-information"
          className="m3-editor-metadata m3-collection-fields"
          disabled={busy || readOnly || Boolean(bankDirty)}
        >
          <label className="m3-editor-wide">
            Title
            <input
              value={collection.title}
              onChange={(event) => {
                setCollection({
                  ...collection,
                  title: event.target.value,
                });
                setDirty(true);
              }}
            />
          </label>

          <label>
            Language
            <select
              id="module-language"
              value={chosenLanguage}
              aria-describedby="module-path-help"
              onChange={(event) => choosePath(event.target.value, chosenLevel)}
            >
              <option value="">Select language</option>
              <option value="en">English</option>
              <option value="fil">Filipino</option>
            </select>
          </label>
          <label>
            Reading Level
            <select id="module-reading-level" value={chosenLevel} aria-describedby="module-path-help"
              onChange={(event) => choosePath(chosenLanguage, event.target.value)}>
              <option value="">Select reading level</option>
              {["Frustration", "Instructional", "Independent"].map(level => <option key={level}>{level}</option>)}
            </select>
          </label>

          <label>
            Difficulty
            <select
              aria-describedby="module-difficulty-help"
              value={collection.difficulty}
              onChange={(event) => {
                setCollection({
                  ...collection,
                  difficulty: event.target
                    .value as AdminCollection["difficulty"],
                });
                setDirty(true);
              }}
            >
              {["Easy", "Medium", "Hard"].map((difficulty) => (
                <option key={difficulty}>{difficulty}</option>
              ))}
            </select>
            <span id="module-difficulty-help" className="m3-editor-help">
              Easy, Medium or Hard. Sets the XP learners earn for completing this module.
            </span>
          </label>

          <p id="module-path-help" className="m3-editor-wide m3-editor-help" role={pathIssue ? "status" : undefined}>
            {pathIssue || "Language and reading level determine learner recommendations. Difficulty sets completion XP."}
          </p>
        </fieldset>
      </div>

      <div className="m3-editor-section-heading">
        <div>
          <h2>Passages</h2>
          <p>
            Add reading text, then build a question bank for
            each passage.
          </p>
        </div>

        {!readOnly && !collection.passages.length && (
          <button
            type="button"
            className="m3-button m3-button--secondary"
            disabled={busy || Boolean(bankDirty)}
            onClick={() => addPassageBelow(-1)}
          >
            + Add First Passage
          </button>
        )}
      </div>

      {collection.passages.map((passage, index) => (
        <Fragment key={passage.id}>
          <section
            className="m3-editor-card m3-editor-passage"
            aria-labelledby={`passage-${passage.id}`}
          >
            <header className="m3-editor-passage-heading">
              <h3 id={`passage-${passage.id}`}>
                Passage {index + 1}
              </h3>
              <div className="m3-editor-passage-status">
                <span>
                  {passage.questions.length} / {bankSizeFor(passage)} questions
                </span>
                <span
                  className={`m3-editor-badge ${
                    isBalancedBank(passage.questions, bankSizes) &&
                    passage.questions.every(
                      (question) =>
                        question.reviewStatus === "reviewed",
                    )
                      ? "m3-editor-badge--ready"
                      : "m3-editor-badge--pending"
                  }`}
                >
                  {!isBalancedBank(passage.questions, bankSizes)
                    ? "Needs questions"
                    : passage.questions.every(
                          (question) =>
                            question.reviewStatus === "reviewed",
                        )
                      ? "Ready"
                      : "Needs review"}
                </span>
              </div>
            </header>

            {mode === "detail" ? (
              <>
                <h4>{passage.title || "Untitled passage"}</h4>
                <p className="m3-passage-preview">
                  {passage.passageText || "No passage text yet."}
                </p>
                <ReadOnlyPassageBank passage={passage} bankSizes={bankSizes} />
              </>
            ) : (
              <fieldset
                disabled={busy || readOnly || Boolean(bankDirty)}
                className="m3-collection-fields"
              >
                <label>
                  Passage title
                  <input
                    maxLength={200}
                    value={passage.title}
                    onChange={(event) =>
                      changePassage(passage.id, {
                        title: event.target.value,
                      })
                    }
                  />
                </label>

                <label>
                  Passage text
                  <textarea
                    className="m3-editor-passage-text"
                    rows={6}
                    value={passage.passageText}
                    onChange={(event) =>
                      changePassage(passage.id, {
                        passageText: event.target.value,
                      })
                    }
                  />
                </label>

                <div className="m3-editor-upload">
                  <span className="m3-editor-upload-heading">
                    Upload / Extract into this passage
                  </span>
                  <span
                    className="m3-editor-help"
                    id={`upload-help-${passage.id}`}
                  >
                    Choose a PDF, DOCX, JPG, JPEG or PNG document to
                    extract reading text. Maximum 25 MB.
                  </span>
                  <div className="m3-editor-upload-row">
                    <label className="m3-button m3-button--secondary m3-editor-upload-choose">
                      {uploads[passage.id]
                        ? "Choose Another File"
                        : "Choose File"}
                      <input
                        className="m3-editor-upload-input"
                        type="file"
                        accept={ADMIN_MODULE_FILE_ACCEPT}
                        aria-describedby={`upload-help-${passage.id} upload-status-${passage.id}`}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          // Cleared so the same file can be chosen again; its
                          // name stays visible from the upload state.
                          event.target.value = "";
                          void extract(passage.id, file);
                        }}
                      />
                    </label>
                    <span
                      className="m3-editor-upload-name"
                      title={uploads[passage.id]?.fileName}
                    >
                      {uploads[passage.id]?.fileName ??
                        "No file selected"}
                    </span>
                    {uploads[passage.id] &&
                      uploads[passage.id].status !== "extracting" && (
                        <button
                          type="button"
                          className="m3-button m3-button--secondary"
                          onClick={() => setUpload(passage.id, null)}
                        >
                          Clear File
                        </button>
                      )}
                  </div>
                  <p
                    id={`upload-status-${passage.id}`}
                    className={`m3-editor-upload-status m3-editor-upload-status--${
                      uploads[passage.id]?.status ?? "idle"
                    }`}
                    role={
                      uploads[passage.id]?.status === "error"
                        ? "alert"
                        : "status"
                    }
                  >
                    {uploads[passage.id]?.message ?? ""}
                  </p>
                </div>

                <div className="m3-collection-actions">
                  {[-1, 1].map((direction) => (
                    <button
                      className="m3-button m3-button--secondary"
                      key={direction}
                      type="button"
                      disabled={
                        index + direction < 0 ||
                        index + direction >=
                          collection.passages.length
                      }
                      onClick={() => {
                        const passages = [...collection.passages];
                        [
                          passages[index],
                          passages[index + direction],
                        ] = [
                          passages[index + direction],
                          passages[index],
                        ];
                        setCollection({
                          ...collection,
                          passages,
                        });
                        setDirty(true);
                      }}
                    >
                      {direction === -1 ? "Move Up" : "Move Down"}
                    </button>
                  ))}

                  <button
                    className="m3-button m3-editor-danger"
                    type="button"
                    disabled={passage.questions.length > 0}
                    title={
                      passage.questions.length
                        ? "Delete the question bank before removing this passage."
                        : undefined
                    }
                    onClick={async () => {
                      if (
                        !(await confirmReadFlow(
                          "Remove this passage from the draft?",
                        ))
                      ) {
                        return;
                      }

                      if (savedIds.current.has(passage.id)) {
                        setRemoved((ids) => [...ids, passage.id]);
                      }

                      setCollection({
                        ...collection,
                        passages: collection.passages.filter(
                          (item) => item.id !== passage.id,
                        ),
                      });
                      setDirty(true);
                    }}
                  >
                    Remove Passage
                  </button>
                </div>
              </fieldset>
            )}

            {extracting === passage.id && (
              <button
                type="button"
                className="m3-button m3-button--secondary"
                onClick={() => {
                  extractionController.current?.abort();
                  setUpload(passage.id, {
                    fileName: uploads[passage.id]?.fileName ?? "",
                    status: "cancelled",
                    message:
                      "Extraction cancelled. The passage text was kept.",
                  });
                }}
              >
                Cancel Extraction
              </button>
            )}

            {mode === "create" && (
              <p className="m3-editor-help">
                Save your draft to generate and review questions
                for this passage.
              </p>
            )}

            {mode !== "create" && mode !== "detail" && (
              <>
                <p className="m3-editor-help">
                  {dirty
                    ? "Save your passage changes before generating questions. "
                    : ""}
                  Each bank needs two literal, two inferential
                  and two critical questions.
                </p>

                {Boolean(passage.questions.length) && (
                  <>
                    <h4>Saved Question Bank</h4>
                    <p>
                      {passage.questions.length} questions saved
                    </p>

                    <PassageBank
                      key={`${passage.id}:${collection.revision}`}
                      passage={passage}
                      disabled={
                        busy ||
                        dirty ||
                        readOnly ||
                        Boolean(
                          bankDirty && bankDirty !== passage.id,
                        )
                      }
                      onDirty={(value) =>
                        setBankDirty(value ? passage.id : null)
                      }
                      onSave={(questions) =>
                        void perform(async () => {
                          await saveBank(
                            collection,
                            { ...passage, questions },
                            "review",
                          );
                          await reload();
                          setMessage(
                            "Question bank, explanations, and evidence reviewed and saved.",
                          );
                        })
                      }
                    />

                    <InlineRegeneration
                      disabled={
                        busy || dirty || readOnly || Boolean(bankDirty) || uncertainPassage === passage.id
                      }
                      isGenerating={generating === passage.id}
                      onGenerate={() =>
                        generateQuestions(passage.id)
                      }
                    >
                      <BankSizeSelect
                        sizes={bankSizes}
                        value={bankSizeFor(passage)}
                        disabled={busy || dirty || readOnly || Boolean(bankDirty) || uncertainPassage === passage.id}
                        onChange={(size) => setRequestedSizes((sizes) => ({ ...sizes, [passage.id]: size }))}
                      />
                    </InlineRegeneration>
                  </>
                )}

                {!passage.questions.length && (
                  <BankSizeSelect
                    sizes={bankSizes}
                    value={bankSizeFor(passage)}
                    disabled={busy || dirty || readOnly || Boolean(bankDirty) || uncertainPassage === passage.id}
                    onChange={(size) => setRequestedSizes((sizes) => ({ ...sizes, [passage.id]: size }))}
                  />
                )}

                <div className="m3-collection-actions">
                  {!passage.questions.length && (
                    <button
                      type="button"
                      className="m3-button m3-button--secondary"
                      disabled={
                        busy || dirty || readOnly || Boolean(bankDirty) || uncertainPassage === passage.id
                      }
                      aria-busy={generating === passage.id}
                      onClick={() =>
                        generateQuestions(passage.id)
                      }
                    >
                      {generating === passage.id
                        ? "Generating questions..."
                        : "Generate Questions"}
                    </button>
                  )}

                  <button
                    type="button"
                    className="m3-button m3-editor-danger"
                    disabled={
                      busy ||
                      dirty ||
                      readOnly ||
                      Boolean(bankDirty) ||
                      !passage.questions.length
                    }
                    onClick={() =>
                      void perform(async () => {
                        if (
                          !(await confirmReadFlow(
                            "Delete this draft question bank and its answer keys?",
                          ))
                        ) {
                          return;
                        }

                        await saveBank(
                          collection,
                          passage,
                          "delete",
                        );
                        await reload();
                      })
                    }
                  >
                    Delete Question Bank
                  </button>
                </div>

                {generating === passage.id && (
                  <p role="status">
                    {generationStage === "saving" ? "Questions are ready. Saving your question bank..."
                      : generationStage === "checking" ? "Checking whether your questions were saved..."
                      : generationStage === "saved" ? "Questions saved. Refreshing the preview..."
                      : "Creating questions for this passage. This may take a little while..."}
                  </p>
                )}
                {uncertainPassage === passage.id && (
                  <button type="button" className="m3-button m3-button--secondary" disabled={busy}
                    onClick={() => generateQuestions(passage.id)}>Check saved questions</button>
                )}

                {generationFeedback?.passageId === passage.id &&
                  generationFeedback.message && (
                    <p className="m3-editor-help" role="status">
                      {generationFeedback.message}
                    </p>
                  )}
              </>
            )}
          </section>

          {!readOnly && (
            <div className="m3-collection-actions">
              <button
                type="button"
                className="m3-button m3-button--secondary"
                disabled={busy || Boolean(bankDirty)}
                aria-label={`Add Passage Below Passage ${index + 1}`}
                onClick={() => addPassageBelow(index)}
              >
                + Add Passage Below
              </button>
            </div>
          )}
        </Fragment>
      ))}

      <footer className="m3-editor-footer">
        {draftMessage && (
          <p
            className="m3-editor-help m3-editor-draft-feedback"
            role="status"
          >
            {draftMessage}
          </p>
        )}

        {!readOnly && (
          <button
            type="button"
            className="m3-button m3-button--primary"
            disabled={
              !dirty ||
              busy ||
              saving ||
              Boolean(bankDirty) ||
              Boolean(learningPathsError)
            }
            aria-busy={saving}
            onClick={() => void saveDraft()}
          >
            {saving ? "Saving..." : "Save Draft"}
          </button>
        )}

        {mode !== "create" && (
          <button
            type="button"
            className="m3-button m3-button--secondary"
            disabled={busy || dirty || Boolean(bankDirty)}
            onClick={() =>
              void perform(async () => {
                const errors =
                  await passageRepository.getPublishIssues(
                    collection.id,
                  );

                setIssues(errors);
                setMessage(
                  errors.length
                    ? "Complete the passage-specific requirements below."
                    : "Content validation passed. This module is ready to publish.",
                );
              })
            }
          >
            Validate for Publication
          </button>
        )}

        {mode !== "create" &&
          collection.status === "draft" && (
            <button
              type="button"
              className="m3-button m3-button--primary"
              disabled={busy || dirty || Boolean(bankDirty)}
              onClick={() =>
                void perform(async () => {
                  setIssues([]);

                  const result = await publishModule(collection.id);

                  if (!result.ok) {
                    setMessage(result.message);
                    return;
                  }

                  await reload();
                  setDraftMessage("");
                  setMessage("Module published successfully.");
                })
              }
            >
              Publish Module
            </button>
          )}
      </footer>

      {Boolean(issues.length) && (
        <div role="alert" className="m3-editor-publish-issues">
          {groupedIssues.module.length > 0 && (
            <section>
              <h3>Module</h3>
              <ul>
                {groupedIssues.module.map((issue) => <li key={issue}>{issue}.</li>)}
              </ul>
            </section>
          )}
          {groupedIssues.passages.map(({ passage, messages }) => (
            <section key={passage}>
              <h3>Passage {passage}</h3>
              <ul>
                {messages.map((message) => <li key={message}>{message}</li>)}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
