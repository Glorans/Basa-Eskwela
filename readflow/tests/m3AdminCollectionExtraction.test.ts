import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";

// AdminCollectionEditor: file extraction is optional and the passage text stays
// editable before and after extracting. Replaces the check that existed for the
// deleted ModuleForm (see "Found during Step 2" in docs/refactor-audit.md).

const require = createRequire(import.meta.url);
const editorUrl = new URL("../src/modules/module3/components/AdminCollectionEditor.tsx", import.meta.url);
const ACCEPT = ".pdf,.docx,.jpg,.jpeg,.png,application/pdf";
const PATH = { id: "path-en", name: "English Path", language: "en", readingLevel: "Instructional", difficultyTier: "Easy" };

// In-memory browser storage shared by the editor and its real draft helpers.
const memoryStore = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    get length() { return memoryStore.size; },
    key: (index: number) => [...memoryStore.keys()][index] ?? null,
    getItem: (key: string) => memoryStore.get(key) ?? null,
    setItem: (key: string, value: string) => { memoryStore.set(key, String(value)); },
    removeItem: (key: string) => { memoryStore.delete(key); },
    clear: () => memoryStore.clear(),
  },
});

test.beforeEach(() => memoryStore.clear());

function listenerTarget() {
  const listeners = new Map<string, Set<unknown>>();
  return {
    listeners,
    addEventListener: (type: string, fn: unknown) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(fn); },
    removeEventListener: (type: string, fn: unknown) => { listeners.get(type)?.delete(fn); },
  };
}

function mount(
  extract: (input: { file: unknown; learningPathLanguage: string }) => Promise<unknown> = async () => ({ extractedText: "" }),
  confirm: (message: string) => boolean = () => true,
  userId = "admin-1",
  options: { edit?: Record<string, any>; saveError?: Error; createError?: Error; workspace?: "admin" | "system_admin" } = {},
) {
  const published: string[] = [];
  const saves: { title: string; passages: { id: string; passageText: string }[]; revision: number }[] = [];
  let serverCollection = options.edit ? structuredClone(options.edit) : null;
  const browserWindow = { ...listenerTarget(), location: { href: "http://app.test/m3/admin/modules/new", origin: "http://app.test", pathname: "/m3/admin/modules/new", search: "" } };
  const browserDocument = listenerTarget();
  const confirms: string[] = [];
  const extractCalls: { file: unknown; learningPathLanguage: string }[] = [];
  const drafts: { passageText: string; title: string }[] = [];
  const runtime = createHookRuntime(require("react"));
  const editor = loadComponentModule(editorUrl, (id) => {
    if (id === "react") return runtime.react;
    if (id === "react-router-dom") {
      return {
        Link: "a",
        useParams: () => (options.edit ? { moduleId: options.edit.id } : {}),
        useNavigate: () => () => {},
        useLocation: () => ({ pathname: "/m3/admin/modules/new", state: null }),
      };
    }
    if (id.endsWith("/M3ContentContext")) {
      return {
        useM3Content: () => ({
          learningPaths: [PATH],
          learningPathsLoading: false,
          learningPathsError: null,
          refreshModules: async () => {},
          publishModule: async (id: string) => { published.push(id); return { ok: true }; },
        }),
      };
    }
    if (id.endsWith("/adminModuleExtraction")) {
      return {
        ADMIN_MODULE_FILE_ACCEPT: ACCEPT,
        extractAdminModulePassage: (input: { file: unknown; learningPathLanguage: string }) => {
          extractCalls.push(input);
          return extract(input);
        },
      };
    }
    if (id.endsWith("/adminCollectionService")) {
      return {
        collectionError: (error: Error) => error.message,
        generateBank: async () => assert.fail("generateBank is not under test"),
        getPassageBankSizes: async () => [6],
        loadCollection: async () => serverCollection ? structuredClone(serverCollection) : assert.fail("create mode must not load a collection"),
        saveBank: async () => assert.fail("saveBank is not under test"),
        saveCollection: async (collection: any) => {
          if (!serverCollection) assert.fail("create mode saves through createDraft");
          if (options.saveError) throw options.saveError;
          saves.push({ title: collection.title, passages: collection.passages.map((p: any) => ({ id: p.id, passageText: p.passageText })), revision: collection.revision });
          serverCollection = { ...structuredClone(collection), revision: collection.revision + 1 };
        },
        passageRepository: {
          createDraft: async (_id: string, draft: { title: string; passages: { passageText: string }[] }) => {
            if (options.createError) throw options.createError;
            drafts.push({ title: draft.title, passageText: draft.passages[0].passageText });
          },
          getPublishIssues: async () => [],
        },
      };
    }
    if (id.endsWith("/auth/useAuth")) return { useAuth: () => ({ user: { id: userId } }) };
    if (id.endsWith("/ReadFlowDialog")) {
      return { confirmReadFlow: async (message: string) => { confirms.push(message); return confirm(message); } };
    }
    if (id.endsWith(".css")) return {};
    if (id.startsWith("./")) return { default: function StubComponent() { return null; } };
    // Pure M3 helpers (labels, publish-issue grouping) run for real.
    if (id.startsWith("../utils/")) return require(fileURLToPath(new URL(`../src/modules/module3/utils/${id.slice("../utils/".length).replace(/\.ts$/, "")}.ts`, import.meta.url)));
    return require(id);
  }, { window: browserWindow, document: browserDocument });

  const render = () => runtime.render(editor.default, { mode: options.edit ? "edit" : "create", workspace: options.workspace });
  render(); // the first render shows the loading state; its effect creates the draft
  const labelled = (tree: unknown, label: string) =>
    findAll(tree, (node) => node.type === "label" && [node.props.children].flat()[0] === label)[0];
  const ui = () => {
    const tree = render();
    const textarea = findAll(tree, (node) => node.type === "textarea" && node.props.className === "m3-editor-passage-text")[0];
    return {
      tree,
      text: textOf(tree),
      textarea,
      textareaFieldset: findAll(tree, (node) => node.type === "fieldset" && findAll(node, (child) => child === textarea).length > 0)[0],
      fileInput: findAll(tree, (node) => node.type === "input" && node.props.type === "file")[0],
      fileInputs: findAll(tree, (node) => node.type === "input" && node.props.type === "file"),
      textareas: findAll(tree, (node) => node.type === "textarea" && node.props.className === "m3-editor-passage-text"),
      passageTitles: findAll(tree, (node) => node.type === "input" && node.props.maxLength === 200),
      uploadNames: findAll(tree, (node) => node.props?.className === "m3-editor-upload-name").map(textOf),
      uploadStatuses: findAll(tree, (node) => typeof node.props?.className === "string" && node.props.className.startsWith("m3-editor-upload-status ")).map(textOf),
      languageSelect: findAll(labelled(tree, "Language"), (node) => node.type === "select")[0],
      levelSelect: findAll(labelled(tree, "Reading Level"), (node) => node.type === "select")[0],
      titleInput: findAll(labelled(tree, "Title"), (node) => node.type === "input")[0],
      saveDraft: findAll(tree, (node) => node.type === "button" && textOf(node) === "Save Draft")[0],
    };
  };
  const chooseFile = async (name = "story.pdf", index = 0, size = 1024) => {
    const target = { files: [{ name, size }], value: name };
    ui().fileInputs[index].props.onChange({ target });
    assert.equal(target.value, "", "the input is reset so the same file can be chosen again");
    for (let i = 0; i < 4; i++) await tick();
  };
  const choosePath = () => {
    ui().languageSelect.props.onChange({ target: { value: PATH.language } });
    ui().levelSelect.props.onChange({ target: { value: PATH.readingLevel } });
  };
  const button = (label: string) => findAll(render(), (node) => node.type === "button" && textOf(node) === label)[0];
  return { ui, published, extractCalls, drafts, chooseFile, choosePath, confirms, button, browserWindow, browserDocument, saves, server: () => serverCollection };
}

function assertEditable(textarea: any, fieldset: any) {
  assert.ok(textarea, "passage textarea is missing");
  assert.equal(typeof textarea.props.onChange, "function");
  assert.ok(!textarea.props.readOnly, "passage textarea must not be read-only");
  assert.ok(!textarea.props.disabled, "passage textarea must not be disabled");
  assert.ok(fieldset && !fieldset.props.disabled, "passage fieldset must not be disabled");
}

test("create mode shows an editable passage textarea and an optional file input", () => {
  const { textarea, textareaFieldset, fileInput } = mount().ui();
  assertEditable(textarea, textareaFieldset);
  assert.equal(textarea.props.value, "");
  assert.ok(fileInput, "file input is missing");
  assert.equal(fileInput.props.accept, ACCEPT);
  assert.ok(!fileInput.props.required, "file extraction must stay optional");
});

test("a draft saves typed passage text without any extraction", async () => {
  const m = mount();
  m.ui().languageSelect.props.onChange({ target: { value: PATH.language } });
  m.ui().levelSelect.props.onChange({ target: { value: PATH.readingLevel } });
  m.ui().titleInput.props.onChange({ target: { value: "Typed Module" } });
  m.ui().textarea.props.onChange({ target: { value: "A passage typed by hand." } });
  m.ui().saveDraft.props.onClick();
  await tick();
  assert.deepEqual(m.drafts, [{ title: "Typed Module", passageText: "A passage typed by hand." }]);
  assert.deepEqual(m.extractCalls, []);
});

test("extracted text fills the passage and stays editable before saving", async () => {
  const m = mount(async () => ({ extractedText: "Extracted story text." }));
  m.ui().languageSelect.props.onChange({ target: { value: PATH.language } });
  m.ui().levelSelect.props.onChange({ target: { value: PATH.readingLevel } });
  await m.chooseFile();
  assert.equal(m.extractCalls.length, 1);
  assert.equal(m.extractCalls[0].learningPathLanguage, "en");
  let view = m.ui();
  assert.equal(view.textarea.props.value, "Extracted story text.");
  assert.match(view.text, /Extracted text is ready to edit\. Review it before saving the draft\./);
  assertEditable(view.textarea, view.textareaFieldset);

  view.textarea.props.onChange({ target: { value: "Extracted story text, corrected." } });
  view = m.ui();
  assert.equal(view.textarea.props.value, "Extracted story text, corrected.");
  view.saveDraft.props.onClick();
  await tick();
  assert.equal(m.drafts[0].passageText, "Extracted story text, corrected.");
});

test("extracting without a learning path is refused and leaves the passage editable", async () => {
  const m = mount();
  m.ui().textarea.props.onChange({ target: { value: "Kept text." } });
  await m.chooseFile();
  const view = m.ui();
  assert.deepEqual(m.extractCalls, []);
  assert.match(view.text, /Select a learning path before extracting\./);
  assert.equal(view.textarea.props.value, "Kept text.");
  assertEditable(view.textarea, view.textareaFieldset);
});

test("a failed extraction keeps the typed passage text editable and shows the error", async () => {
  const m = mount(async () => { throw new Error("Unable to read this file."); });
  m.ui().languageSelect.props.onChange({ target: { value: PATH.language } });
  m.ui().levelSelect.props.onChange({ target: { value: PATH.readingLevel } });
  m.ui().textarea.props.onChange({ target: { value: "Text typed before extracting." } });
  await m.chooseFile();
  const view = m.ui();
  assert.equal(m.extractCalls.length, 1);
  assert.match(view.text, /Unable to read this file\./);
  assert.equal(view.textarea.props.value, "Text typed before extracting.");
  assertEditable(view.textarea, view.textareaFieldset);
});

test("the chosen file name stays visible after selection and extraction", async () => {
  const m = mount(async () => ({ extractedText: "Story text." }));
  m.choosePath();
  assert.deepEqual(m.ui().uploadNames, ["No file selected"]);
  await m.chooseFile("My Story.docx");
  const view = m.ui();
  assert.deepEqual(view.uploadNames, ["My Story.docx"]);
  assert.match(view.text, /Choose Another File/);
  assert.match(view.text, /Clear File/);
  assert.equal(view.textarea.props.value, "Story text.");
});

test("an unsupported file is refused next to the upload field without a request", async () => {
  const m = mount();
  m.choosePath();
  await m.chooseFile("notes.txt");
  const view = m.ui();
  assert.deepEqual(m.extractCalls, []);
  assert.deepEqual(view.uploadNames, ["notes.txt"]);
  assert.match(view.uploadStatuses[0], /not supported\. Choose a PDF, DOCX, JPG, JPEG or PNG file\./);
});

test("files over 25 MB and empty files are refused before upload", async () => {
  const m = mount();
  m.choosePath();
  await m.chooseFile("big.pdf", 0, 25 * 1024 * 1024 + 1);
  assert.match(m.ui().uploadStatuses[0], /25 MB/);
  await m.chooseFile("empty.pdf", 0, 0);
  assert.match(m.ui().uploadStatuses[0], /empty/);
  assert.deepEqual(m.extractCalls, []);
});

test("existing passage text is replaced only after confirmation", async () => {
  const declined = mount(async () => ({ extractedText: "New text." }), () => false);
  declined.choosePath();
  declined.ui().textarea.props.onChange({ target: { value: "Teacher's typed text." } });
  await declined.chooseFile();
  assert.equal(declined.confirms.length, 1);
  assert.deepEqual(declined.extractCalls, []);
  assert.equal(declined.ui().textarea.props.value, "Teacher's typed text.");
  assert.match(declined.ui().uploadStatuses[0], /cancelled\. The passage text was kept\./);

  const accepted = mount(async () => ({ extractedText: "New text." }));
  accepted.choosePath();
  accepted.ui().textarea.props.onChange({ target: { value: "Old text." } });
  await accepted.chooseFile();
  assert.equal(accepted.confirms.length, 1);
  assert.equal(accepted.ui().textarea.props.value, "New text.");
});

const STORY = ["The Little Garden", "", "Mia planted seeds."].join("\n");

test("an empty passage title is filled from a heading line; a typed title is kept", async () => {
  const m = mount(async () => ({ extractedText: STORY }));
  m.choosePath();
  await m.chooseFile();
  assert.equal(m.ui().passageTitles[0].props.value, "The Little Garden");
  assert.match(m.ui().uploadStatuses[0], /title was filled/);

  const typed = mount(async () => ({ extractedText: STORY }));
  typed.choosePath();
  typed.ui().passageTitles[0].props.onChange({ target: { value: "My Title" } });
  await typed.chooseFile();
  assert.equal(typed.ui().passageTitles[0].props.value, "My Title");
  assert.equal(typed.ui().textarea.props.value, STORY);

  // A sentence wrapped across lines (PDF/OCR) is not a heading.
  const wrapped = mount(async () => ({ extractedText: "The red bus stops at the gate every\nmorning." }));
  wrapped.choosePath();
  await wrapped.chooseFile();
  assert.equal(wrapped.ui().passageTitles[0].props.value, "");
  assert.doesNotMatch(wrapped.ui().uploadStatuses[0], /title was filled/);
});

test("each passage card keeps its own file and extracted text", async () => {
  const m = mount(async (input: any) => ({ extractedText: `Text from ${input.file.name}` }));
  m.choosePath();
  const add = findAll(m.ui().tree, (node) => node.type === "button" && textOf(node).includes("Add Passage Below"))[0];
  add.props.onClick();
  assert.equal(m.ui().fileInputs.length, 2);
  await m.chooseFile("second.pdf", 1);
  let view = m.ui();
  assert.deepEqual(view.textareas.map((t: any) => t.props.value), ["", "Text from second.pdf"]);
  assert.deepEqual(view.uploadNames, ["No file selected", "second.pdf"]);
  await m.chooseFile("first.docx", 0);
  view = m.ui();
  assert.deepEqual(view.textareas.map((t: any) => t.props.value), ["Text from first.docx", "Text from second.pdf"]);
  assert.deepEqual(view.uploadNames, ["first.docx", "second.pdf"]);
});

test("a network failure shows a clear message in the passage card", async () => {
  const m = mount(async () => { throw new Error("Network Error"); });
  m.choosePath();
  await m.chooseFile();
  assert.match(m.ui().uploadStatuses[0], /could not be reached/);
});

const NEW_DRAFT_KEY = "basa:m3-module-draft:v1:admin-1:new";

test("unsaved Create Reading Module work is kept on this device for this account only", () => {
  localStorage.clear();
  const m = mount();
  m.choosePath();
  m.ui().titleInput.props.onChange({ target: { value: "Unsaved Title" } });
  m.ui().textarea.props.onChange({ target: { value: "Unsaved passage text." } });
  m.ui();
  const stored = JSON.parse(localStorage.getItem(NEW_DRAFT_KEY) ?? "null");
  assert.equal(stored.title, "Unsaved Title");
  assert.equal(stored.language, "en");
  assert.equal(stored.readingLevel, "Instructional");
  assert.deepEqual(stored.passages.map((p: any) => p.passageText), ["Unsaved passage text."]);
  assert.ok(!("questions" in stored.passages[0]), "question banks are never stored locally");
  assert.deepEqual(Object.keys(stored.passages[0]).sort(), ["id", "passageText", "sourceMaterialId", "title"]);
  assert.ok(m.browserWindow.listeners.get("beforeunload")?.size, "refresh/close warns while changes are unsaved");
  assert.ok(m.browserDocument.listeners.get("click")?.size, "in-app links ask before leaving");
});

test("a remounted editor offers the unsaved draft, and Resume restores every field", () => {
  localStorage.clear();
  const first = mount();
  first.choosePath();
  first.ui().titleInput.props.onChange({ target: { value: "Recovered Title" } });
  first.ui().textarea.props.onChange({ target: { value: "Recovered text." } });
  first.ui();

  const again = mount();
  again.ui();
  assert.match(again.ui().text, /Unsaved changes found/);
  assert.equal(again.ui().textarea.props.value, "", "nothing is restored without asking");
  again.button("Resume Unsaved Changes").props.onClick();
  const view = again.ui();
  assert.doesNotMatch(view.text, /Unsaved changes found/);
  assert.equal(view.titleInput.props.value, "Recovered Title");
  assert.equal(view.textarea.props.value, "Recovered text.");
  assert.equal(view.textareas.length, 1, "the blank starting passage is replaced, not kept as an extra passage");
  assert.equal(view.languageSelect.props.value, "en");
  assert.equal(view.levelSelect.props.value, "Instructional");
  assert.equal(view.saveDraft.props.disabled, false, "restored work can be saved");
});

test("another account on the same browser never sees the draft", () => {
  localStorage.clear();
  const first = mount();
  first.ui().textarea.props.onChange({ target: { value: "Admin one's text." } });
  first.ui();
  const other = mount(undefined, undefined, "admin-2");
  other.ui();
  assert.doesNotMatch(other.ui().text, /Unsaved changes found/);
  assert.ok(localStorage.getItem(NEW_DRAFT_KEY), "admin-1's draft is untouched");
});

test("Discard Them removes the stored draft", () => {
  localStorage.clear();
  const first = mount();
  first.ui().textarea.props.onChange({ target: { value: "Throw away." } });
  first.ui();
  const again = mount();
  again.ui();
  again.button("Discard Them").props.onClick();
  assert.equal(localStorage.getItem(NEW_DRAFT_KEY), null);
  assert.doesNotMatch(again.ui().text, /Unsaved changes found/);
});

test("a successful Save Draft clears the stored draft", async () => {
  localStorage.clear();
  const m = mount();
  m.choosePath();
  m.ui().titleInput.props.onChange({ target: { value: "Saved Module" } });
  m.ui().textarea.props.onChange({ target: { value: "Saved text." } });
  m.ui();
  assert.ok(localStorage.getItem(NEW_DRAFT_KEY));
  m.ui().saveDraft.props.onClick();
  await tick();
  assert.equal(m.drafts.length, 1);
  assert.equal(localStorage.getItem(NEW_DRAFT_KEY), null);
});

test("Discard Changes asks first, then clears the form and the stored draft", async () => {
  localStorage.clear();
  const m = mount();
  m.ui().textarea.props.onChange({ target: { value: "Unwanted." } });
  m.ui();
  m.button("Discard Changes").props.onClick();
  await tick(); await tick();
  assert.match(m.confirms.at(-1) ?? "", /Discard everything entered/);
  assert.equal(localStorage.getItem(NEW_DRAFT_KEY), null);
  m.ui();
  assert.equal(m.ui().textarea.props.value, "");
});

// ---- Edit mode: recovered drafts versus newer saved modules ----

const SAVED = {
  id: "module-1", title: "Saved Title", learningPathId: PATH.id, difficulty: "Easy", revision: 7,
  status: "draft", publishedAt: null, language: "en",
  passages: [
    { id: "p1", title: "One", passageText: "Saved text one.", sourceMaterialId: null, displayOrder: 1, questions: [] },
    { id: "p2", title: "Two", passageText: "Saved text two.", sourceMaterialId: null, displayOrder: 2, questions: [] },
  ],
};
const EDIT_KEY = "basa:m3-module-draft:v1:admin-1:module-1";
const settleEdit = async () => { for (let i = 0; i < 4; i++) await tick(); };

function storeEditDraft(baseRevision: unknown, texts = ["Older unsaved one.", "Saved text two."]) {
  localStorage.setItem(EDIT_KEY, JSON.stringify({
    version: 1, userId: "admin-1", moduleKey: "module-1", savedAt: Date.now(), baseRevision,
    collectionId: "module-1", title: "Unsaved Title", learningPathId: PATH.id, difficulty: "Hard",
    language: "en", readingLevel: "Instructional",
    passages: [
      { id: "p2", title: "Two", passageText: texts[1], sourceMaterialId: null },
      { id: "p1", title: "One", passageText: texts[0], sourceMaterialId: null },
    ],
    removed: [],
  }));
}

async function mountEdit(confirm: (message: string) => boolean = () => true, extra: { saveError?: Error } = {}) {
  const m = mount(undefined, confirm, "admin-1", { edit: SAVED, ...extra });
  m.ui();
  await settleEdit();
  m.ui();
  return m;
}

test("a draft from the current saved version offers a normal Resume", async () => {
  storeEditDraft(7);
  const m = await mountEdit();
  const text = m.ui().text;
  assert.match(text, /Unsaved changes found/);
  assert.doesNotMatch(text, /Older unsaved changes/);
  m.button("Resume Unsaved Changes").props.onClick();
  const view = m.ui();
  assert.deepEqual(view.textareas.map((t: any) => t.props.value), ["Saved text two.", "Older unsaved one."], "text and order restored");
  assert.equal(view.titleInput.props.value, "Unsaved Title");
  assert.deepEqual(m.saves, [], "never saved automatically");
});

test("an older draft is flagged, and Keep Saved Version preserves the newer saved module", async () => {
  storeEditDraft(5);
  const m = await mountEdit();
  const text = m.ui().text;
  assert.match(text, /Older unsaved changes found/);
  assert.match(text, /saved again after they were made/);
  assert.doesNotMatch(text, /Resume Unsaved Changes/, "no one-click resume for older drafts");
  m.button("Keep Saved Version").props.onClick();
  const view = m.ui();
  assert.equal(localStorage.getItem(EDIT_KEY), null);
  assert.deepEqual(view.textareas.map((t: any) => t.props.value), ["Saved text one.", "Saved text two."]);
  assert.equal(view.titleInput.props.value, "Saved Title");
  assert.match(view.text, /Kept the newer saved version/);
  assert.deepEqual(m.saves, []);
});

test("using an older draft needs an explicit confirmation and is still not saved automatically", async () => {
  storeEditDraft(5);
  let answer = false;
  const m = await mountEdit(() => answer);
  m.button("Use My Older Changes…").props.onClick();
  await settleEdit();
  assert.match(m.confirms.at(-1) ?? "", /newer saved module title, settings, passage titles, passage text and passage order will be replaced/);
  assert.match(m.ui().text, /Older unsaved changes found/, "Go Back keeps the choice open");
  assert.equal(m.ui().textareas[0].props.value, "Saved text one.");

  answer = true;
  m.button("Use My Older Changes…").props.onClick();
  await settleEdit();
  const view = m.ui();
  assert.deepEqual(view.textareas.map((t: any) => t.props.value), ["Saved text two.", "Older unsaved one."]);
  assert.match(view.text, /Saving now replaces the newer saved version/);
  assert.deepEqual(m.saves, [], "nothing is saved until Save Draft");
  assert.equal(view.saveDraft.props.disabled, false);
});

test("a draft with an unknown base version is treated as older", async () => {
  storeEditDraft(null);
  const m = await mountEdit();
  assert.match(m.ui().text, /Older unsaved changes found/);
});

test("a failed save keeps the recoverable draft", async () => {
  const m = await mountEdit(() => true, { saveError: new Error("This module changed. Reload before saving.") });
  m.ui().textarea.props.onChange({ target: { value: "Work that must survive." } });
  m.ui();
  assert.ok(localStorage.getItem(EDIT_KEY));
  m.ui().saveDraft.props.onClick();
  await settleEdit();
  const view = m.ui();
  assert.match(view.text, /This module changed\. Reload before saving\./);
  const stored = JSON.parse(localStorage.getItem(EDIT_KEY) ?? "null");
  assert.equal(stored.passages[0].passageText, "Work that must survive.");
  assert.equal(view.textarea.props.value, "Work that must survive.");
});

test("a failed Create save keeps the recoverable draft", async () => {
  const m = mount(undefined, undefined, "admin-1", { createError: new Error("Network Error") });
  m.choosePath();
  m.ui().titleInput.props.onChange({ target: { value: "Unsaved Create" } });
  m.ui().textarea.props.onChange({ target: { value: "Create text." } });
  m.ui();
  m.ui().saveDraft.props.onClick();
  await settleEdit();
  assert.equal(JSON.parse(localStorage.getItem(NEW_DRAFT_KEY) ?? "null").title, "Unsaved Create");
});

test("saving other edits while a recovered draft is undecided does not delete that draft", async () => {
  storeEditDraft(7);
  const m = await mountEdit();
  assert.match(m.ui().text, /Unsaved changes found/);
  m.ui().textareas[0].props.onChange({ target: { value: "Different edit." } });
  m.ui();
  m.ui().saveDraft.props.onClick();
  await settleEdit();
  assert.equal(m.saves.length, 1);
  assert.ok(localStorage.getItem(EDIT_KEY), "the undecided draft is kept");
  assert.match(m.ui().text, /Older unsaved changes found/, "and is now flagged as older than the saved module");
});

test("Edit and Create drafts for the same account stay separate", async () => {
  storeEditDraft(7);
  const create = mount();
  create.ui();
  assert.doesNotMatch(create.ui().text, /Unsaved changes found/, "the edit draft is not offered on Create");
  create.ui().textarea.props.onChange({ target: { value: "Create-only text." } });
  create.ui();
  assert.ok(localStorage.getItem(NEW_DRAFT_KEY));
  assert.equal(JSON.parse(localStorage.getItem(EDIT_KEY) ?? "null").passages[1].passageText, "Older unsaved one.", "the edit draft is untouched");
});


test("System Admin F1/F7 uses the same create form and saves extracted, reviewed passage text", async () => {
  const m = mount(async () => ({ extractedText: "Extracted story." }), undefined, "system-1", { workspace: "system_admin" });
  m.choosePath();
  m.ui().titleInput.props.onChange({ target: { value: "System Module" } });
  await m.chooseFile();
  m.ui().textarea.props.onChange({ target: { value: "Reviewed story." } });
  m.ui().saveDraft.props.onClick(); await tick();
  assert.deepEqual(m.drafts, [{ title: "System Module", passageText: "Reviewed story." }]);
  assert.equal(m.extractCalls.length, 1);
});

test("System Admin F3/F5 uses the same edit/save and explicit publishing workflow", async () => {
  const m = mount(undefined, undefined, "system-1", { workspace: "system_admin", edit: SAVED });
  await tick(); await tick();
  m.ui().textarea.props.onChange({ target: { value: "Edited story." } });
  m.ui().saveDraft.props.onClick(); await tick(); await tick();
  assert.equal(m.saves[0].passages[0].passageText, "Edited story.");
  assert.deepEqual(m.published, [], "saving must not publish automatically");
  const publish = m.button("Publish Module"); assert.ok(publish); assert.ok(!publish.props.disabled);
  publish.props.onClick(); await tick(); await tick();
  assert.deepEqual(m.published, [m.server()!.id]);
});
