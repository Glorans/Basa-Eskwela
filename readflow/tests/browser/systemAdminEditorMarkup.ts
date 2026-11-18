// Renders the real System Admin M3 editor (create mode) to static HTML for the contrast/layout audit.
// Services and contexts are stubbed; no network or Supabase access. Usage: node tests/browser/systemAdminEditorMarkup.ts
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHookRuntime, loadComponentModule, tick } from "../helpers/hookRuntime.ts";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const editorUrl = new URL("../../src/modules/module3/components/AdminCollectionEditor.tsx", import.meta.url);

export async function renderSystemAdminEditor(): Promise<string> {
  // The hook runtime runs effects (the editor builds its new draft in one); React then serializes the result.
  const runtime = createHookRuntime(React);
  const editor = loadComponentModule(editorUrl, (id) => {
    if (id === "react") return runtime.react;
    if (id === "react/jsx-runtime") return require(id);
    if (id === "react-router-dom") return {
      Link: ({ to, children, ...rest }: any) => React.createElement("a", { href: String(to), ...rest }, children),
      useParams: () => ({}), useNavigate: () => () => {}, useLocation: () => ({ pathname: "/system-admin/content/modules/new", state: null }),
    };
    if (id.endsWith("/M3ContentContext")) return { useM3Content: () => ({
      learningPaths: [{ id: "lp1", name: "Instructional", readingLevel: "Instructional" }], learningPathsLoading: false, learningPathsError: null,
      refreshModules: async () => {}, publishModule: async () => ({ ok: true }) }) };
    if (id.endsWith("/adminModuleExtraction")) return { ADMIN_MODULE_FILE_ACCEPT: ".pdf,.docx,.jpg,.png", extractAdminModulePassage: async () => ({}) };
    if (id.endsWith("/adminCollectionService")) return new Proxy({ collectionError: (e: Error) => e.message, getPassageBankSizes: async () => [6],
      getModuleRevisions: async () => [], passageRepository: { createDraft: async () => {}, getPublishIssues: async () => [] } },
      { get: (t: any, k) => k in t ? t[k] : async () => null });
    if (id.endsWith("/auth/useAuth")) return { useAuth: () => ({ user: { id: "sa1" }, profile: { id: "sa1", role: "system_admin" } }) };
    if (id.endsWith("/ReadFlowDialog")) return { confirmReadFlow: async () => true };
    if (id.endsWith(".css")) return {};
    if (id.startsWith("./")) return { default: () => null };
    if (id.startsWith("../utils/")) return require(fileURLToPath(new URL(`../../src/modules/module3/utils/${id.slice(9).replace(/\.ts$/, "")}.ts`, import.meta.url)));
    return require(id);
  }, { window: { addEventListener() {}, removeEventListener() {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } },
    document: { addEventListener() {}, removeEventListener() {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
  const props = { mode: "create", workspace: "system_admin" };
  runtime.render(editor.default, props); await tick(); runtime.render(editor.default, props); await tick();
  return renderToStaticMarkup(runtime.render(editor.default, props));
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) process.stdout.write(await renderSystemAdminEditor());
