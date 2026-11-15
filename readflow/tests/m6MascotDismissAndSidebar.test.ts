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

test("Admin sidebar: vertical scrolling kept, no horizontal scrolling, and no Admin-only scrollbar rule", () => {
  const css = readFileSync(new URL("../src/modules/module3/styles/module3.css", import.meta.url), "utf8");
  const start = css.indexOf(".m3-shell--admin .m3-sidebar {");
  assert.ok(start > 0);
  const rule = css.slice(start, css.indexOf("}", start));
  for (const declaration of ["overflow-y: auto;", "overflow-x: hidden;"]) {
    assert.ok(rule.includes(declaration), declaration);
  }
  // No Admin-only scrollbar rule: sidebar scrollbar visibility is decided once, for every role, in responsive-shell.css.
  assert.doesNotMatch(css, /scrollbar-width: none|-ms-overflow-style: none/);
  assert.doesNotMatch(css, /\.m3-shell--admin \.m3-sidebar::-webkit-scrollbar/);
  // Not a global rule, and scrolling is never disabled.
  assert.doesNotMatch(css, /(^|\n)\s*(\*|html|body)\s*(::-webkit-scrollbar)?\s*\{[^}]*scrollbar-width: none/);
  assert.doesNotMatch(css, /\.m3-shell--admin \.m3-sidebar \{[^}]*overflow(-y)?: hidden/);
  // The base sidebar still scrolls for every role.
  assert.match(css, /\.m3-sidebar \{[^}]*overflow-y: auto;/);
});

test("every role's sidebar uses one shared navigation scroller with the brand and Logout outside it", () => {
  const shell = readFileSync(new URL("../src/styles/responsive-shell.css", import.meta.url), "utf8");
  const scroller = shell.slice(shell.indexOf(".rf-shell .rf-sidebar-scroll {"), shell.indexOf("}", shell.indexOf(".rf-shell .rf-sidebar-scroll {")));
  for (const declaration of ["overflow-y: auto;", "overflow-x: hidden;", "min-height:", "margin-right: calc(-1 * var(--rf-sidebar-pad-x));"]) {
    assert.ok(scroller.includes(declaration), declaration);
  }
  // Every role's sidebar (rail and drawer) hides its scrollbar but keeps scrolling; nothing else is affected.
  assert.match(shell, /\.rf-shell :is\(aside\.rf-sidebar, \.rf-sidebar-scroll\) \{ scrollbar-width: none; \}/);
  assert.match(shell, /\.rf-shell :is\(aside\.rf-sidebar, \.rf-sidebar-scroll\)::-webkit-scrollbar \{ display: none; width: 0; height: 0; \}/);
  const hiding = [...shell.matchAll(/([^{}]+)\{[^}]*(scrollbar-width: none|display: none; width: 0)/g)].map((m) => m[1].trim());
  assert.equal(hiding.length, 2, "exactly the two sidebar rules hide a scrollbar");
  for (const selector of hiding) assert.doesNotMatch(selector, /rf-content-scroll|basa-content|m3-content|(^|[\s,])(\*|html|body)([\s,{]|$)/, selector);
  const aside = shell.slice(shell.indexOf(".rf-shell aside.rf-sidebar {"), shell.indexOf("}", shell.indexOf(".rf-shell aside.rf-sidebar {")));
  assert.ok(aside.includes("overflow-y: auto;"), "the sidebar itself can still scroll on very short screens");
  assert.doesNotMatch(shell, /rf-content-scroll[^{]*\{[^}]*scrollbar-width/, "the page content keeps its scrollbar");
  // Students (BasaSidebar) and Teachers, Admins and Independent Learners (M3Layout) share the same classes.
  for (const file of ["../src/components/basa/BasaSidebar.tsx", "../src/modules/module3/components/M3Layout.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /<nav className="[^"]*\brf-sidebar-scroll\b/, file);
    assert.match(source, /className="[^"]*\brf-sidebar-main\b/, file);
    assert.match(source, /className="[^"]*\brf-sidebar-footer\b/, file);
    // The brand stays outside the scroller: it comes before the <nav> inside the fixed part of the sidebar.
    assert.ok(source.indexOf("Basa Eskwela, go to Dashboard") < source.indexOf("rf-sidebar-scroll"), file);
  }
});
