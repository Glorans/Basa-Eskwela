import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";

// AdminCollectionEditor: file extraction is optional and the passage text stays
// editable before and after extracting. Replaces the check that existed for the
// deleted ModuleForm (see "Found during Step 2" in docs/refactor-audit.md).

const require = createRequire(import.meta.url);
const editorUrl = new URL("../src/modules/module3/components/AdminCollectionEditor.tsx", import.meta.url);
const ACCEPT = "test-accept-list";
const PATH = { id: "path-en", name: "English Path", language: "en", readingLevel: "Instructional", difficultyTier: "Easy" };

function mount(extract: (input: { file: unknown; learningPathLanguage: string }) => Promise<unknown> = async () => ({ extractedText: "" })) {
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
    if (id.endsWith("/ReadFlowDialog")) return { confirmReadFlow: async () => true };
    if (id.endsWith(".css")) return {};
    if (id.startsWith("./")) return { default: function StubComponent() { return null; } };
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
      pathSelect: findAll(labelled(tree, "Learning path"), (node) => node.type === "select")[0],
      titleInput: findAll(labelled(tree, "Title"), (node) => node.type === "input")[0],
      saveDraft: findAll(tree, (node) => node.type === "button" && textOf(node) === "Save Draft")[0],
    };
  };
  const chooseFile = async () => {
    ui().fileInput.props.onChange({ target: { files: [{ name: "story.pdf", size: 1024 }], value: "story.pdf" } });
    await tick();
    await tick();
  };
  return { ui, extractCalls, drafts, chooseFile };
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
  m.ui().pathSelect.props.onChange({ target: { value: PATH.id } });
  m.ui().titleInput.props.onChange({ target: { value: "Typed Module" } });
  m.ui().textarea.props.onChange({ target: { value: "A passage typed by hand." } });
  m.ui().saveDraft.props.onClick();
  await tick();
  assert.deepEqual(m.drafts, [{ title: "Typed Module", passageText: "A passage typed by hand." }]);
  assert.deepEqual(m.extractCalls, []);
});

test("extracted text fills the passage and stays editable before saving", async () => {
  const m = mount(async () => ({ extractedText: "Extracted story text." }));
  m.ui().pathSelect.props.onChange({ target: { value: PATH.id } });
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
  m.ui().pathSelect.props.onChange({ target: { value: PATH.id } });
  m.ui().textarea.props.onChange({ target: { value: "Text typed before extracting." } });
  await m.chooseFile();
  const view = m.ui();
  assert.equal(m.extractCalls.length, 1);
  assert.match(view.text, /Unable to read this file\./);
  assert.equal(view.textarea.props.value, "Text typed before extracting.");
  assertEditable(view.textarea, view.textareaFieldset);
});
