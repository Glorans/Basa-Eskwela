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

function mount(
  extract: (input: { file: unknown; learningPathLanguage: string }) => Promise<unknown> = async () => ({ extractedText: "" }),
  confirm: (message: string) => boolean = () => true,
) {
  const confirms: string[] = [];
  const extractCalls: { file: unknown; learningPathLanguage: string }[] = [];
  const drafts: { passageText: string; title: string }[] = [];
  const runtime = createHookRuntime(require("react"));
  const editor = loadComponentModule(editorUrl, (id) => {
    if (id === "react") return runtime.react;
    if (id === "react-router-dom") {
      return {
        Link: "a",
        useParams: () => ({}),
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
          publishModule: async () => ({ ok: true }),
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
        loadCollection: async () => assert.fail("create mode must not load a collection"),
        saveBank: async () => assert.fail("saveBank is not under test"),
        saveCollection: async () => assert.fail("create mode saves through createDraft"),
        passageRepository: {
          createDraft: async (_id: string, draft: { title: string; passages: { passageText: string }[] }) => {
            drafts.push({ title: draft.title, passageText: draft.passages[0].passageText });
          },
          getPublishIssues: async () => [],
        },
      };
    }
    if (id.endsWith("/ReadFlowDialog")) {
      return { confirmReadFlow: async (message: string) => { confirms.push(message); return confirm(message); } };
    }
    if (id.endsWith(".css")) return {};
    if (id.startsWith("./")) return { default: function StubComponent() { return null; } };
    // Pure M3 helpers (labels, publish-issue grouping) run for real.
    if (id.startsWith("../utils/")) return require(fileURLToPath(new URL(`../src/modules/module3/utils/${id.slice("../utils/".length).replace(/\.ts$/, "")}.ts`, import.meta.url)));
    return require(id);
  });

  const render = () => runtime.render(editor.default, { mode: "create" });
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
  return { ui, extractCalls, drafts, chooseFile, choosePath, confirms };
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
