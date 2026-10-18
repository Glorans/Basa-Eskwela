import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Minimal React hook emulator for rendering one component function at a time
// without a DOM. Like React, useCallback/useMemo return the previous value
// until a dependency changes, and effects run after a render when their
// dependencies change. State updates do not re-render; call render() again.

type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: unknown };

const sameDeps = (a?: readonly unknown[], b?: readonly unknown[]) =>
  !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

export function createHookRuntime(realReact: Record<string, unknown>) {
  const slots: Slot[] = [];
  let cursor = 0;
  let pending: (() => void)[] = [];

  const react = {
    ...realReact,
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof initial === "function" ? (initial as () => unknown)() : initial };
      const slot = slots[index];
      const set = (next: unknown) => {
        slot.value = typeof next === "function" ? (next as (value: unknown) => unknown)(slot.value) : next;
      };
      return [slot.value, set];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: { current: initial } };
      return slots[index].value;
    },
    useCallback(fn: unknown, deps: readonly unknown[]) {
      const index = cursor++;
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) slots[index] = { value: fn, deps };
      return slots[index].value;
    },
    useMemo(factory: () => unknown, deps: readonly unknown[]) {
      const index = cursor++;
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) slots[index] = { value: factory(), deps };
      return slots[index].value;
    },
    useEffect(effect: () => unknown, deps?: readonly unknown[]) {
      const index = cursor++;
      const previous = slots[index];
      if (previous && sameDeps(previous.deps, deps)) return;
      pending.push(() => {
        if (typeof previous?.cleanup === "function") previous.cleanup();
        slots[index] = { deps, cleanup: effect() };
      });
    },
  };

  function render<P>(component: (props: P) => unknown, props: P) {
    cursor = 0;
    const tree = component(props);
    const effects = pending;
    pending = [];
    effects.forEach((run) => run());
    return tree as any;
  }

  return { react, render };
}

/**
 * Transpiles a .ts/.tsx source file and runs it with the given require.
 * `globals` adds or replaces sandbox globals (for example `window` or `console`).
 */
export function loadComponentModule(url: URL, requireStub: (id: string) => unknown, globals: Record<string, unknown> = {}) {
  const source = readFileSync(url, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} as any };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: requireStub,
    console,
    crypto: globalThis.crypto,
    AbortController,
    ...globals,
  });
  return module.exports;
}

export const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Depth-first search of a rendered element tree (children are not rendered). */
export function findAll(tree: any, predicate: (node: any) => boolean, found: any[] = []): any[] {
  if (!tree || typeof tree !== "object") return found;
  if (Array.isArray(tree)) {
    tree.forEach((child) => findAll(child, predicate, found));
    return found;
  }
  if (predicate(tree)) found.push(tree);
  findAll(tree.props?.children, predicate, found);
  return found;
}

/** Concatenated text content of a rendered element tree. */
export function textOf(tree: any): string {
  if (tree === null || tree === undefined || typeof tree === "boolean") return "";
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (Array.isArray(tree)) return tree.map(textOf).join("");
  return textOf(tree.props?.children);
}
