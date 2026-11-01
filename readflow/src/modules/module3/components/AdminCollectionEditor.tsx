import { confirmReadFlow } from "../../../components/ReadFlowDialog";
import "./AdminCollectionEditor.css";
import InlineRegeneration from "./InlineRegeneration";
import PassageBank from "./PassageBank";
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
  loadCollection,
  passageRepository,
  saveBank,
  saveCollection,
  type AdminCollection,
  type AdminPassage,
} from "../services/adminCollectionService";

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
  const [generating, setGenerating] = useState<string | null>(null);
  const [generationFeedback, setGenerationFeedback] = useState<{
    passageId: string;
    message: string;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const [extracting, setExtracting] = useState<string | null>(null);

  const generation = useRef(0);
  const savedIds = useRef(new Set<string>());
  const extractionController = useRef<AbortController | null>(null);

  useEffect(() => {
    if (dirty) setDraftMessage("");
  }, [dirty]);

  useEffect(() => {
    const current = ++generation.current;

    setGenerating(null);
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
    setMessage("");
    setRemoved([]);
    setDirty(false);
    setBankDirty(null);
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

  async function extract(id: string, file?: File) {
    if (!file || !collection) return;

    if (file.size > 25 * 1024 * 1024) {
      setMessage("The selected file exceeds 25 MB.");
      return;
    }

    const language = learningPaths.find(
      (path) => path.id === collection.learningPathId,
    )?.language;

    if (!language) {
      setMessage("Select a learning path before extracting.");
      return;
    }

    const current = generation.current;
    const controller = new AbortController();

    extractionController.current = controller;
    setExtracting(id);

    await perform(async () => {
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

        changePassage(id, {
          passageText: result.extractedText,
        });

        setMessage(
          "Extracted text is ready to edit. Review it before saving the draft.",
        );
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        if (extractionController.current === controller) {
          extractionController.current = null;
          setExtracting(null);
        }
      }
    });
  }

  function generateQuestions(passageId: string) {
    if (!collection || busy || dirty || readOnly || bankDirty) {
      return;
    }

    void perform(
      async () => {
        setGenerating(passageId);

        try {
          await generateBank(collection, passageId);
          await reload();

          setGenerationFeedback({
            passageId,
            message:
              "Six questions generated and saved. Review the answers, explanations, and evidence before publication.",
          });
        } finally {
          setGenerating(null);
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
            Learning path
            <select
              value={collection.learningPathId}
              onChange={(event) => {
                setCollection({
                  ...collection,
                  learningPathId: event.target.value,
                  language:
                    learningPaths.find(
                      (path) => path.id === event.target.value,
                    )?.language ?? null,
                });
                setDirty(true);
              }}
            >
              <option value="">Select learning path</option>
              {learningPaths.map((path) => (
                <option key={path.id} value={path.id}>
                  {path.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Difficulty
            <select
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
          </label>
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
                  {passage.questions.length} / 6 questions
                </span>
                <span
                  className={`m3-editor-badge ${
                    passage.questions.length === 6 &&
                    passage.questions.every(
                      (question) =>
                        question.reviewStatus === "reviewed",
                    )
                      ? "m3-editor-badge--ready"
                      : "m3-editor-badge--pending"
                  }`}
                >
                  {passage.questions.length !== 6
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
              <p className="m3-passage-preview">
                {passage.passageText || "No passage text yet."}
              </p>
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

                <label className="m3-editor-upload">
                  Upload / Extract into this passage
                  <span className="m3-editor-help">
                    Choose a document to extract reading text.
                    Maximum 25 MB.
                  </span>
                  <input
                    type="file"
                    accept={ADMIN_MODULE_FILE_ACCEPT}
                    onChange={(event) => {
                      void extract(
                        passage.id,
                        event.target.files?.[0],
                      );
                      event.target.value = "";
                    }}
                  />
                </label>

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
                  setMessage(
                    "Extraction cancelled. Passage text was preserved.",
                  );
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
                        busy || dirty || readOnly || Boolean(bankDirty)
                      }
                      isGenerating={generating === passage.id}
                      onGenerate={() =>
                        generateQuestions(passage.id)
                      }
                    />
                  </>
                )}

                <div className="m3-collection-actions">
                  {!passage.questions.length && (
                    <button
                      type="button"
                      className="m3-button m3-button--secondary"
                      disabled={
                        busy || dirty || readOnly || Boolean(bankDirty)
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
                    Generating and saving questions...
                  </p>
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
        <ul role="alert">
          {issues.map((issue, index) => (
            <li key={index}>{issue}</li>
          ))}
        </ul>
      )}
    </div>
  );
}