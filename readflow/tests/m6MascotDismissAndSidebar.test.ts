import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as activityLanguage from "../src/pages/reading-activity/activityLanguage.ts";

const require = createRequire(import.meta.url);

/** Runs the real ReadingMascot with a minimal hook harness, so a click on X can be followed by a re-render. */
function mountMascot(props: Record<string, unknown>) {
  const slots: any[] = [];
  let cursor = 0;
  const react = {
    ...require("react"),
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [slots[index], (value: any) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial: unknown) { return slots[cursor++] ??= { current: initial }; },
    useEffect() { cursor++; },
    useLayoutEffect() { cursor++; },
  };
  const module = { exports: {} as any };
  const source = readFileSync(new URL("../src/components/reading-feedback/ReadingMascot.tsx", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    module, exports: module.exports,
    window: { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
    require: (id: string) => id === "react" ? react : id.endsWith(".png") ? { default: id } : id.endsWith(".css") ? {}
      : id.endsWith("/activityLanguage") ? activityLanguage : id === "lucide-react" ? { X: "x-icon" }
      : id === "react-dom" ? { createPortal: (node: unknown) => node } : require(id),
  });
  const Mascot = module.exports.default;
  return (next: Record<string, unknown> = {}) => { cursor = 0; return Mascot({ ...props, ...next }); };
}

function find(tree: any, predicate: (node: any) => boolean): any {
  if (!tree || typeof tree !== "object") return;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) {
    const result = find(child, predicate); if (result) return result;
  }
}

for (const [label, props] of [
  ["a scaffolding clue during questions", { mood: "tryAgain", message: "Think about it: Look at who the story names first.", eventId: "m6:q1:true:clue", live: true }],
  ["the completion message on results", { mood: "celebrate", message: "Great work finishing the questions! Here are your results.", eventId: "m6:completed" }],
] as const) {
  test(`closing ${label} removes the mascot entirely: no reopen button, no empty container`, () => {
    const render = mountMascot({ ...props, language: "en", placement: "inline" });
    const open = render();
    assert.ok(open, "the mascot shows its message");
    assert.match(JSON.stringify(open), new RegExp(props.message.slice(0, 20)));
    const close = find(open, node => node.type === "button" && node.props.className === "reading-mascot-close");
    assert.equal(close.props["aria-label"], "Close");
    assert.equal(find(open, node => node.props?.className === "reading-mascot-reopen"), undefined);
    close.props.onClick();
    assert.equal(render(), null, "nothing is rendered after X: no Show the clue again, no leftover space");
    // The next message (another question's clue, or the results) shows the mascot again.
    assert.ok(render({ eventId: "m6:q2:true:clue", message: "Think about it: Where did they go?" }));
  });
}

test("the clue-reopen option no longer exists anywhere", () => {
  const mascot = readFileSync(new URL("../src/components/reading-feedback/ReadingMascot.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/modules/module6/pages/ComprehensionPage.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/components/reading-feedback/ReadingFeedback.css", import.meta.url), "utf8");
  assert.doesNotMatch(mascot, /reopenLabel|reading-mascot-reopen/);
  assert.doesNotMatch(page, /reopenLabel|Show the clue again/);
  assert.doesNotMatch(css, /reading-mascot-reopen/);
});

test("the comprehension page has no visible Please wait message; saving is announced to screen readers only", () => {
  const page = readFileSync(new URL("../src/modules/module6/pages/ComprehensionPage.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/modules/module6/pages/ComprehensionPage.css", import.meta.url), "utf8");
  assert.doesNotMatch(page, /m6-loading/);
  assert.match(page, /<p className="m6-visually-hidden" role="status">\{busy \? t\("Please wait…"\) : ""\}<\/p>/);
  const hidden = css.slice(css.indexOf(".m6-page .m6-visually-hidden {"), css.indexOf("}", css.indexOf(".m6-page .m6-visually-hidden {")));
  for (const declaration of ["position: absolute;", "width: 1px;", "height: 1px;", "overflow: hidden;", "clip-path: inset(50%);"]) {
    assert.ok(hidden.includes(declaration), declaration);
  }
  assert.doesNotMatch(hidden, /display: none|visibility: hidden/, "still read by screen readers");
});

test("Admin sidebar: scrollbar hidden in Firefox, Chrome and Edge, vertical scrolling kept, no horizontal scrolling", () => {
  const css = readFileSync(new URL("../src/modules/module3/styles/module3.css", import.meta.url), "utf8");
  const start = css.indexOf(".m3-shell--admin .m3-sidebar {");
  assert.ok(start > 0);
  const rule = css.slice(start, css.indexOf("}", start));
  for (const declaration of ["overflow-y: auto;", "overflow-x: hidden;", "scrollbar-width: none;", "-ms-overflow-style: none;"]) {
    assert.ok(rule.includes(declaration), declaration);
  }
  assert.match(css, /\.m3-shell--admin \.m3-sidebar::-webkit-scrollbar \{[^}]*display: none;/);
  // Scoped to the Admin navigation: not a global rule, and scrolling is never disabled.
  assert.doesNotMatch(css, /(^|\n)\s*(\*|html|body)\s*(::-webkit-scrollbar)?\s*\{[^}]*scrollbar-width: none/);
  assert.doesNotMatch(css, /\.m3-shell--admin \.m3-sidebar \{[^}]*overflow(-y)?: hidden/);
  // The base sidebar still scrolls for every role.
  assert.match(css, /\.m3-sidebar \{[^}]*overflow-y: auto;/);
});
