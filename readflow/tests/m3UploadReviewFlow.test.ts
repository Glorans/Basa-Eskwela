import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";

const require = createRequire(import.meta.url);

const temporary = {
  id: "temp-1", originalFilename: "story.pdf", fileType: "PDF", mimeType: "application/pdf", size: 2048,
  language: "en", extractionStatus: "completed", extractedText: "Extracted story text", pageCount: 1,
};

function mountForm({ failRefresh = false } = {}) {
  const runtime = createHookRuntime(require("react"));
  (runtime.react as Record<string, unknown>).useId = () => "file-input";
  const calls = { upload: 0, persist: [] as string[], saved: [] as string[], unsaved: [] as boolean[], viewed: 0, cancelled: 0 };
  let persistImpl: () => Promise<{ id: string }> = async () => ({ id: "material-1" });
  const listeners = new Set<string>();
  const fakeWindow = {
    addEventListener: (name: string) => listeners.add(name),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const form = loadComponentModule(new URL("../src/modules/module3/components/UploadMaterialForm.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id === "lucide-react") return new Proxy({}, { get: (_target, name) => String(name) });
    if (id === "./M3StatusBadge") return { default: "status-badge" };
    if (id === "../services/materialUpload") return {
      MAX_MATERIAL_UPLOAD_BYTES: 25 * 1024 * 1024,
      MAX_MATERIAL_TEXT_LENGTH: 1_000_000,
      getMaterialRequestError: () => "Upload failed.",
      getMaterialPersistenceError: (error: unknown) => (error instanceof Error ? error.message : "Unknown error."),
      uploadReadingMaterial: async (_input: unknown, onUploaded: () => void) => { calls.upload++; onUploaded(); return temporary; },
      persistUploadedMaterial: async ({ contentText }: { contentText: string }) => { calls.persist.push(contentText); return persistImpl(); },
    };
    return require(id);
  }, { window: fakeWindow, Error, Boolean, Promise });
  const props = {
    onCancel: () => { calls.cancelled++; },
    onSaved: async (materialId: string) => {
      calls.saved.push(materialId);
      if (failRefresh) throw new Error("list refresh failed");
    },
    onViewMaterials: () => { calls.viewed++; },
    onUnsavedChange: (value: boolean) => { calls.unsaved.push(value); },
  };
  const view = () => runtime.render(form.default, props);
  return { view, calls, listeners, setPersist(fn: () => Promise<{ id: string }>) { persistImpl = fn; } };
}

const byText = (tree: any, text: string) => findAll(tree, (node) => node?.type === "button" && textOf(node).trim() === text)[0];

async function extract(f: ReturnType<typeof mountForm>) {
  let tree = f.view();
  assert.match(textOf(tree), /Step 1 of 2: Upload & Extract Text/);
  findAll(tree, (node) => node?.props?.placeholder === "Give this reading material a title")[0]
    .props.onChange({ target: { value: "The Lost Kite" } });
  tree = f.view();
  findAll(tree, (node) => node?.props?.type === "file")[0]
    .props.onChange({ target: { files: [{ name: "story.pdf", size: 2048, type: "application/pdf" }] } });
  tree = f.view();
  findAll(tree, (node) => node?.type === "form")[0].props.onSubmit({ preventDefault() {} });
  await tick();
  return f.view();
}

test("after extraction the teacher sees a review step that is clearly not saved yet", async () => {
  const f = mountForm();
  const tree = await extract(f);
  const text = textOf(tree);
  for (const phrase of [
    "Step 2 of 2: Text Extracted Successfully",
    "Review & Save Material",
    "Review the extracted text and correct any errors before saving.",
    "Not saved yet.",
    "Save Reviewed Material",
  ]) assert.ok(text.includes(phrase), `missing: ${phrase}`);
  assert.doesNotMatch(text, /Upload complete|Material Saved Successfully/);
  const badge = findAll(tree, (node) => node?.type === "status-badge")[0];
  assert.deepEqual({ value: badge.props.value, label: badge.props.label }, { value: "pending", label: "Ready for Review" });
  assert.equal(findAll(tree, (node) => node?.type === "textarea")[0].props.value, "Extracted story text");
  assert.equal(f.calls.unsaved.at(-1), true);
  assert.ok(f.listeners.has("beforeunload"), "leaving with unsaved text is warned");
  assert.deepEqual(f.calls.persist, []);
});

test("a failed save keeps the teacher's edits and shows a clear error, never success", async () => {
  const f = mountForm();
  let tree = await extract(f);
  findAll(tree, (node) => node?.type === "textarea")[0].props.onChange({ target: { value: "Edited story text" } });
  f.setPersist(async () => { throw new Error("The original file could not be saved. Please try again."); });
  tree = f.view();
  byText(tree, "Save Reviewed Material").props.onClick();
  await tick();
  tree = f.view();
  const text = textOf(tree);
  assert.match(text, /Your material was not saved\. The original file could not be saved\. Please try again\. Your edits are still here/);
  assert.doesNotMatch(text, /Material Saved Successfully/);
  assert.equal(findAll(tree, (node) => node?.type === "textarea")[0].props.value, "Edited story text");
  assert.deepEqual(f.calls.saved, []);
  assert.equal(f.calls.unsaved.at(-1), true);
  assert.equal(byText(tree, "Save Reviewed Material").props.disabled, false, "the teacher can retry");
});

test("repeated Save clicks create one material, and success appears only after the save succeeds", async () => {
  const f = mountForm();
  let tree = await extract(f);
  let finish!: (value: { id: string }) => void;
  f.setPersist(() => new Promise((resolve) => { finish = resolve; }));
  const save = byText(tree, "Save Reviewed Material").props.onClick;
  save(); save(); save();
  tree = f.view();
  assert.equal(f.calls.persist.length, 1, "only one save request");
  assert.match(textOf(tree), /Saving your reviewed material\.\.\./);
  assert.match(textOf(tree), /Saving Reviewed Material\.\.\./);
  assert.doesNotMatch(textOf(tree), /Material Saved Successfully/);
  finish({ id: "material-7" });
  await tick(); await tick();
  tree = f.view();
  const text = textOf(tree);
  assert.match(text, /Material Saved Successfully/);
  assert.match(text, /"The Lost Kite" is saved and now appears in My Materials\./);
  assert.deepEqual(f.calls.saved, ["material-7"], "the material list is refreshed once, after saving");
  assert.equal(f.calls.unsaved.at(-1), false);
  assert.equal(f.listeners.has("beforeunload"), false, "no leave warning once saved");
  byText(tree, "Go to My Materials").props.onClick();
  assert.equal(f.calls.viewed, 1);
  save();
  await tick();
  assert.equal(f.calls.persist.length, 1, "a stale Save after success creates nothing");
});

test("a list-refresh failure after a successful save still reports the material as saved", async () => {
  const f = mountForm({ failRefresh: true });
  const tree = await extract(f);
  f.setPersist(async () => ({ id: "material-9" }));
  const save = byText(tree, "Save Reviewed Material").props.onClick;
  save();
  await tick(); await tick();
  assert.deepEqual(f.calls.saved, ["material-9"]);
  assert.match(textOf(f.view()), /Material Saved Successfully/);
  save();
  await tick();
  assert.equal(f.calls.persist.length, 1, "a failed refresh never leads to a second material");
});
