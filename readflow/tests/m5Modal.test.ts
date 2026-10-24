import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule } from "./helpers/hookRuntime.ts";

// M5Modal: the floating panel used by the reading result page's three cards.
const require = createRequire(import.meta.url);

function setup() {
  const listeners = new Map<string, (event: any) => void>();
  const body = { style: { overflow: "auto" } };
  const runtime = createHookRuntime(require("react"));
  const modal = loadComponentModule(
    new URL("../src/modules/module5/components/M5Modal.tsx", import.meta.url),
    (id) => {
      if (id === "react") return runtime.react;
      if (id.endsWith(".css")) return {};
      if (id === "lucide-react") return { X: "x-icon" };
      return require(id);
    },
    {
      window: {
        addEventListener: (type: string, listener: (event: any) => void) => listeners.set(type, listener),
        removeEventListener: (type: string) => listeners.delete(type),
      },
      document: { activeElement: null, body },
      HTMLElement: class {},
    },
  );
  let closed = 0;
  const props = { id: "m5-panel-result", title: "Result", closeLabel: "Close", open: false, onClose: () => { closed++; }, children: "content" };
  const render = (open: boolean) => runtime.render(modal.default, { ...props, open });
  return { render, listeners, body, closed: () => closed };
}

test("a closed modal stays mounted but hidden and touches nothing", () => {
  const f = setup();
  const tree = f.render(false);
  assert.equal(tree.props.hidden, true);
  assert.equal(f.body.style.overflow, "auto");
  assert.equal(f.listeners.size, 0);
  // Content is kept so a check or recording survives closing and reopening.
  assert.equal(findAll(tree, (node) => node.props?.className === "m5-modal-body")[0].props.children, "content");
});

test("an open modal is a labelled dialog that locks page scroll and closes with ESC", () => {
  const f = setup();
  const tree = f.render(true);
  assert.equal(tree.props.hidden, false);
  const dialog = findAll(tree, (node) => node.props?.role === "dialog")[0];
  assert.equal(dialog.props["aria-modal"], "true");
  assert.equal(dialog.props["aria-labelledby"], "m5-panel-result-title");
  assert.equal(findAll(tree, (node) => node.type === "h2")[0].props.id, "m5-panel-result-title");
  assert.equal(f.body.style.overflow, "hidden");

  let prevented = false;
  f.listeners.get("keydown")!({ key: "Escape", preventDefault: () => { prevented = true; } });
  assert.equal(f.closed(), 1);
  assert.equal(prevented, true);
  f.listeners.get("keydown")!({ key: "a", preventDefault() {} });
  assert.equal(f.closed(), 1, "other keys do nothing");
});

test("the X button and a backdrop click close it; a click inside does not", () => {
  const f = setup();
  const tree = f.render(true);
  findAll(tree, (node) => node.type === "button" && node.props["aria-label"] === "Close")[0].props.onClick();
  assert.equal(f.closed(), 1);
  const backdrop = tree;
  backdrop.props.onMouseDown({ target: backdrop, currentTarget: backdrop });
  assert.equal(f.closed(), 2);
  backdrop.props.onMouseDown({ target: {}, currentTarget: backdrop });
  assert.equal(f.closed(), 2);
});

test("closing restores page scrolling and removes the ESC listener", () => {
  const f = setup();
  f.render(true);
  f.render(false);
  assert.equal(f.body.style.overflow, "auto");
  assert.equal(f.listeners.has("keydown"), false);
});
