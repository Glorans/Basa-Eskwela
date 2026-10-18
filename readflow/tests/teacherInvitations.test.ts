import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/modules/module1/pages/admin/TeacherInvitationsPage.tsx", import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
function find(tree: any, predicate: (node: any) => boolean): any {
  if (!tree || typeof tree !== "object") return;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) { const result = find(child, predicate); if (result) return result; }
}
async function fixture(failCreate = false) {
  const slots: any[] = []; let cursor = 0; let effects: (() => void)[] = [];
  const listeners = new Map<string, () => void>(); const copied: string[] = []; let calls = 0; let approved = true;
  let resolveCreate!: (value: any) => void;
  const invitation = { id: "invitation", active: true, createdAt: "2026-10-12T00:00:00Z", expiresAt: "2030-01-01T00:00:00Z", maxUses: 1, useCount: 0, status: "active" };
  const react = { ...require("react"),
    useState(initial: any) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], (value: any) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial: any) { return slots[cursor++] ??= { current: initial }; },
    useEffect(callback: () => any, deps: unknown[]) { const i = cursor++; const previous = slots[i];
      if (!previous || deps.some((value, j) => value !== previous.deps[j])) effects.push(() => {
        previous?.cleanup?.(); slots[i] = { deps, cleanup: callback() };
      }); },
  };
  const module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    module, exports: module.exports, Date, Error, URLSearchParams,
    window: { location: { search: "" }, addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) },
    navigator: { clipboard: { writeText: async (value: string) => { copied.push(value); } } },
    require: (id: string) => id === "react" ? react : id.includes("ReadFlowDialog") ? { confirmReadFlow: async () => approved }
      : id.includes("PendingTeacherApprovals") ? { default: () => null }
      : id.includes("services/teacherInvitations") ? {
        listTeacherInvitations: async () => [invitation], invitationError: (error: Error) => error.message,
        createTeacherInvitation: async (_expires: string, maximum: number) => {
          calls++; assert.equal(maximum, 1);
          if (failCreate) throw Error("Uncertain creation. Refresh the list.");
          return new Promise(resolve => { resolveCreate = resolve; });
        },
        revokeTeacherInvitation: async () => ({ ...invitation, active: false, status: "revoked" }),
      } : id.endsWith(".css") ? {} : require(id),
  });
  function render() { cursor = 0; const tree = module.exports.default(); const pending = effects; effects = []; pending.forEach(fn => fn()); return tree; }
  function button(label: string) { const node = find(render(), n => n.type === "button" && n.props.children === label); assert.ok(node, label); return node; }
  render(); await tick(); render();
  return { render, button, copied, listeners, calls: () => calls, approve: (value: boolean) => { approved = value; },
    submit: () => find(render(), n => n.type === "form").props.onSubmit({ preventDefault() {} }),
    resolve: () => resolveCreate({ invitation, code: "fixture-secret-never-valid-in-production" }),
    unmount: () => slots.forEach(slot => slot?.cleanup?.()),
  };
}

test("new invitation is shown once, copy is explicit, metadata refresh never restores a dismissed code", async () => {
  const f = await fixture();
  assert.equal(find(f.render(), n => n.props?.type === "number").props.value, "1");
  assert.equal(f.button("Generate invitation").props.disabled, false);
  const first = f.submit(); const second = f.submit();
  assert.equal(f.calls(), 1); f.resolve(); await Promise.all([first, second]);
  assert.match(JSON.stringify(f.render()), /fixture-secret-never-valid/);
  assert.equal(f.button("Generate invitation").props.disabled, true);
  assert.equal(f.copied.length, 0);
  await f.button("Copy Code").props.onClick(); assert.equal(f.copied.length, 1);
  f.button("Dismiss code").props.onClick();
  assert.doesNotMatch(JSON.stringify(f.render()), /fixture-secret-never-valid/);
  await f.button("Refresh list").props.onClick(); await tick();
  assert.doesNotMatch(JSON.stringify(f.render()), /fixture-secret-never-valid/);
});

test("uncertain creation blocks another generate until metadata refresh; no automatic retry", async () => {
  const f = await fixture(true); await f.submit();
  assert.equal(f.calls(), 1); assert.equal(f.button("Generate invitation").props.disabled, true);
  await f.submit(); assert.equal(f.calls(), 1);
  await f.button("Refresh list").props.onClick(); await tick();
  assert.equal(f.button("Generate invitation").props.disabled, false);
});

test("revocation requires confirmation and clears the one-time code; pagehide also clears it", async () => {
  const f = await fixture(); const request = f.submit(); f.resolve(); await request;
  f.approve(false); f.button("Revoke").props.onClick(); await tick();
  assert.match(JSON.stringify(f.render()), /fixture-secret-never-valid/);
  f.approve(true); f.button("Revoke").props.onClick(); await tick();
  assert.doesNotMatch(JSON.stringify(f.render()), /fixture-secret-never-valid/);
  assert.match(JSON.stringify(f.render()), /revoked/);
  const second = await fixture(); const pending = second.submit(); second.resolve(); await pending;
  second.listeners.get("pagehide")!();
  assert.doesNotMatch(JSON.stringify(second.render()), /fixture-secret-never-valid/);
});

test("departed page never reveals an eventual creation response; frontend has no secret persistence", async () => {
  const f = await fixture(); const pending = f.submit(); f.unmount(); f.resolve(); await pending;
  assert.doesNotMatch(JSON.stringify(f.render()), /fixture-secret-never-valid/);
  const service = readFileSync(new URL("../src/modules/module1/services/teacherInvitations.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source + service, /localStorage|sessionStorage|console\.|service_role|SERVICE_ROLE|analytics/);
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /RequireRole allowedRoles=\{\["admin"\]\}[\s\S]*path="teacher-invitations"/);
});
