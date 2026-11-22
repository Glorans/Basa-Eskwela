import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { findAll, loadComponentModule } from "./helpers/hookRuntime.ts";

// Navigation uses the same labels for every role, and each label keeps its route.
const require = createRequire(import.meta.url);
const source = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
const navItem = (label: string, to: string) =>
  new RegExp(`label: "${label.replace(/[&]/g, "\\$&")}", to: ${to.replace(/[$/{}]/g, "\\$&")}`);

test("student sidebar labels keep their routes", async () => {
  const sidebar = await source("components/basa/BasaSidebar.tsx");
  assert.match(sidebar, navItem("Reading Materials", '"/dashboard/materials"'));
  assert.match(sidebar, navItem("Badges", '"/dashboard/badges"'));
  assert.match(sidebar, navItem("Progress & Result", '"/dashboard/progress"'));
  assert.match(sidebar, navItem("Reading History", '"/dashboard/reading-history"'));
});

test("teacher, independent learner and admin navigation use the shared labels", async () => {
  const layout = await source("modules/module3/components/M3Layout.tsx");
  // Teachers and independent learners share this item; admins have their own list without it.
  assert.match(layout, navItem("Reading Materials", "`${root}/materials`"));
  assert.match(layout, navItem("Badges", '"/m3/general/badges"'));
  assert.match(layout, navItem("Reading History", '"/m3/general/reading-history"'));
});

test("old navigation wording is gone from navigation and page headings", async () => {
  const files = await Promise.all([
    "components/basa/BasaSidebar.tsx",
    "modules/module3/components/M3Layout.tsx",
    "modules/module3/pages/UploadMaterialPage.tsx",
    "modules/module3/pages/MaterialLibraryPage.tsx",
    "modules/module7/M7Pages.tsx",
    "pages/MyMaterials.tsx",
    "pages/StudentModuleViewPage.tsx",
  ].map(source));
  // The Independent Learner Reading Materials page names the learner's active list "My Materials" (as opposed to Trash;
  // requested 2026-11-18) in four short messages only. Its title, the navigation and every other page keep
  // "Reading Materials".
  assert.match(files[3], /title="Reading Materials"/);
  const learnerPhrases = /Back to My Materials|is back in My Materials\.|It leaves My Materials|It is still in My Materials\./g;
  assert.equal((files[3].match(learnerPhrases) ?? []).length, 4);
  files[3] = files[3].replace(learnerPhrases, "");
  // Document-55 (2026-11-23) names the learner Progress page heading exactly "My Progress & Results"; only that heading
  // (and the page landmark with the same name) may use it. Navigation labels are unchanged.
  assert.equal((files[4].match(/My Progress & Results/g) ?? []).length, 2);
  files[4] = files[4].replace(/My Progress & Results/g, "");
  for (const text of files) {
    assert.doesNotMatch(text, /My Materials|My Badges|My Progress|My Results|Progress & Results/);
  }
  // A heading about the teacher's own uploads keeps its descriptive wording.
  assert.match(files[3], /<h2>My Uploaded Materials<\/h2>/);
});

function renderHeader(props: Record<string, unknown>) {
  const navigations: string[] = [];
  const header = loadComponentModule(
    new URL("../src/pages/reading-activity/ActivityHeader.tsx", import.meta.url),
    (id) => {
      if (id === "react-router-dom") return { useNavigate: () => (to: string) => navigations.push(to) };
      if (id.endsWith(".css")) return {};
      if (id.endsWith('/SuggestedInterventions')) return { SuggestedInterventions: 'suggested-interventions' };
      if (id.endsWith('/LearnerSuggestions')) return { LearnerSuggestions: 'learner-suggestions' };
      if (id.endsWith("/activityLanguage")) return { getActivityText: () => ({ t: (text: string) => text }) };
      if (id === "lucide-react") return { ArrowLeft: "arrow-left", User: "user" };
      return require(id);
    },
  );
  return { tree: header.default({ title: "A Helping Hand", language: "English", ...props }), navigations };
}

test("the result page header has no account icon but keeps back, title and language", () => {
  let backs = 0;
  const { tree } = renderHeader({ showAccount: false, onBack: () => { backs++; } });
  assert.equal(findAll(tree, (node) => node.type === "user").length, 0);
  assert.equal(findAll(tree, (node) => node.props?.className === "activity-header-right").length, 0);
  findAll(tree, (node) => node.props?.className === "activity-back-button")[0].props.onClick();
  assert.equal(backs, 1);
  assert.equal(findAll(tree, (node) => node.type === "h1")[0].props.children, "A Helping Hand");
  assert.equal(findAll(tree, (node) => node.props?.className === "activity-language")[0].props.children, "English");
});

test("other activity pages keep the account icon by default", () => {
  const { tree } = renderHeader({});
  assert.equal(findAll(tree, (node) => node.type === "user").length, 1);
});

test("only the reading result page turns the account icon off", async () => {
  const result = await source("pages/reading-activity/ReadingResultPage.tsx");
  const readAloud = await source("pages/reading-activity/ReadAloudPage.tsx");
  assert.equal(result.match(/<ActivityHeader\b/g)?.length, 2);
  assert.equal(result.match(/showAccount=\{false\}/g)?.length, 2);
  assert.doesNotMatch(readAloud, /showAccount/);
});
