// M8 leaderboard privacy choice (m8_leaderboard_privacy_v1): the panel on both leaderboards. The database enforces the
// rules; the panel only shows the learner's own choice and saves it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";
import { ownLeaderboardLabel } from "../src/modules/module8/leaderboardRanking.ts";

const require = createRequire(import.meta.url);
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

type Privacy = { visibility: "nickname" | "anonymous" | "hidden"; alias: string | null; namesAllowed: boolean };

async function mountPanel(start: Privacy | null, audience: "classroom" | "independent" = "classroom", saveResult?: (v: string, a: string | null) => Privacy) {
  const runtime = createHookRuntime(require("react"));
  const saves: [string, string | null][] = [];
  const changes: [string, string][] = [];
  const panel = loadComponentModule(new URL("../src/modules/module8/LeaderboardPrivacyPanel.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id === "lucide-react") return { ShieldCheck: "ShieldCheck" };
    if (id.endsWith("/gamificationService")) return {
      getMyLeaderboardPrivacy: async () => start,
      setMyLeaderboardPrivacy: async (v: string, a: string | null) => {
        saves.push([v, a]);
        return saveResult ? saveResult(v, a) : { visibility: v, alias: a, namesAllowed: start?.namesAllowed ?? false };
      },
    };
    return require(id);
  }, { Error, String, console: { error() {} } });
  const props = { audience, onChange: (p: Privacy, reason: string) => changes.push([p.visibility, reason]) };
  const view = async () => { for (let i = 0; i < 3; i++) { runtime.render(panel.default, props); await tick(); } return runtime.render(panel.default, props); };
  return { view, saves, changes };
}
const radios = (tree: unknown) => findAll(tree, (n) => n.type === "input" && n.props?.type === "radio");
const button = (tree: unknown) => findAll(tree, (n) => n.type === "button")[0];

test("nothing is shown until the privacy migration is deployed", async () => {
  const { view } = await mountPanel(null);
  assert.equal(await view(), null);
});

test("default: anonymous selected; the nickname option is disabled until nicknames are approved", async () => {
  const { view, changes } = await mountPanel({ visibility: "anonymous", alias: null, namesAllowed: false });
  const tree = await view();
  const text = textOf(tree);
  for (const label of ["Display my chosen leaderboard nickname", "Participate anonymously", "Hide my leaderboard participation"]) assert.match(text, new RegExp(label));
  assert.match(text, /waiting for privacy approval/);
  assert.match(text, /Changing this never changes your XP, badges, achievements or reading streak\./, "always explained, before saving");
  const [nickname, anonymous, hidden] = radios(tree);
  assert.equal(nickname.props.disabled, true);
  assert.equal(anonymous.props.checked, true);
  assert.equal(hidden.props.disabled, false);
  assert.equal(findAll(tree, (n) => n.type === "input" && n.props?.type === "text").length, 0, "no nickname field while not approved");
  assert.equal(button(tree).props.disabled, true, "nothing to save yet");
  assert.deepEqual(changes, [["anonymous", "loaded"]]);
});

test("choosing hidden and saving sends only the learner's own choice and reports it", async () => {
  const { view, saves, changes } = await mountPanel({ visibility: "anonymous", alias: null, namesAllowed: false }, "independent");
  let tree = await view();
  radios(tree)[2].props.onChange();
  tree = await view();
  assert.equal(button(tree).props.disabled, false);
  button(tree).props.onClick();
  tree = await view();
  assert.deepEqual(saves, [["hidden", null]]);
  assert.deepEqual(changes.at(-1), ["hidden", "saved"]);
  assert.match(textOf(tree), /Saved\. Your XP, badges, achievements and reading streak stay the same\./);
  assert.match(textOf(tree), /Other learners do not see you/);
});

test("with approval, a nickname is typed and saved (trimmed); a database refusal is shown", async () => {
  const { view, saves } = await mountPanel({ visibility: "anonymous", alias: null, namesAllowed: true }, "independent", (v, a) => {
    if (a === "kid@example.com") throw { code: "22023", message: "Use 2 to 20 letters or numbers, starting with a letter. No e-mail, link or long number." };
    return { visibility: v as Privacy["visibility"], alias: a, namesAllowed: true };
  });
  let tree = await view();
  radios(tree)[0].props.onChange();
  tree = await view();
  const field = findAll(tree, (n) => n.type === "input" && n.props?.type === "text")[0];
  assert.equal(field.props.maxLength, 20);
  field.props.onChange({ target: { value: "kid@example.com" } });
  tree = await view(); button(tree).props.onClick(); tree = await view();
  assert.match(textOf(findAll(tree, (n) => n.props?.role === "alert")[0]), /No e-mail/);
  findAll(tree, (n) => n.type === "input" && n.props?.type === "text")[0].props.onChange({ target: { value: "  ReadingStar " } });
  tree = await view(); button(tree).props.onClick(); tree = await view();
  assert.deepEqual(saves.at(-1), ["nickname", "ReadingStar"]);
  assert.match(textOf(tree), /Other learners see the nickname you type below, never your real name or e-mail\./);
});

test("only the Independent Learner page has the nickname panel; the Student page has the one-line choice under the rankings", () => {
  const il = read("src/pages/IndependentLeaderboard.tsx");
  assert.match(il, /<LeaderboardPrivacyPanel[\s\S]*?audience="independent"/);
  const student = read("src/pages/Leaderboard.tsx");
  assert.doesNotMatch(student, /LeaderboardPrivacyPanel/, "no nickname setup panel for Students");
  // Order: Select Classroom, Weekly Rankings (language toggle, ranked Students), then the one-line choice.
  const order = ["Select Classroom", "Weekly Rankings", "Ranking language", "<ol style={listStyle}>", "<ClassroomVisibilityControl"].map((m) => student.indexOf(m));
  assert.ok(order.every((at, n) => at > 0 && (n === 0 || at > order[n - 1])), JSON.stringify(order));
  for (const [page, note] of [[student, "Hidden from classmates. Only you see this row."], [il, "Hidden from other learners. Only you see this row."]]) {
    assert.match(page, /if \(reason === "saved"\) setRefresh\(\(n\) => n \+ 1\)/);
    assert.match(page, /, refresh\]\);/);
    assert.ok(page.includes(note), note);
  }
  const service = read("src/modules/module8/gamificationService.ts");
  assert.match(service, /db\.rpc\("m8_my_leaderboard_privacy"\)/);
  assert.match(service, /db\.rpc\("m8_set_leaderboard_privacy", \{ p_visibility: visibility, p_alias: alias \}\)/);
});

test("the learner's own row shows the nickname others see; otherwise their own profile nickname", () => {
  assert.equal(ownLeaderboardLabel("You (StorySeeker)", "Harkle"), "StorySeeker (You)");
  assert.equal(ownLeaderboardLabel("You", "Harkle"), "Harkle (You)");
  assert.equal(ownLeaderboardLabel("You", null), "You");
});

test("phones: the classroom rows give names the room (no letter-by-letter wrapping)", () => {
  const css = read("src/pages/ClassroomLeaderboard.css");
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*\.classroom-leaderboard-avatar \{\s*display: none !important;/);
  const page = read("src/pages/Leaderboard.tsx");
  assert.match(page, /import "\.\/ClassroomLeaderboard\.css";/);
  assert.match(page, /overflowWrap: "break-word"/);
  assert.doesNotMatch(page, /overflowWrap: "anywhere"/);
});

async function mountControl(start: Privacy | null, saveResult?: (v: string) => Privacy) {
  const runtime = createHookRuntime(require("react"));
  const saves: [string, string | null][] = [];
  const changes: [string, string][] = [];
  const control = loadComponentModule(new URL("../src/modules/module8/ClassroomVisibilityControl.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith("/gamificationService")) return {
      getMyLeaderboardPrivacy: async () => start,
      setMyLeaderboardPrivacy: async (v: string, a: string | null) => {
        saves.push([v, a]);
        return saveResult ? saveResult(v) : { ...start, visibility: v };
      },
    };
    return require(id);
  }, { Error, String, console: { error() {} } });
  const props = { onChange: (p: Privacy, reason: string) => changes.push([p.visibility, reason]) };
  const view = async () => { for (let i = 0; i < 3; i++) { runtime.render(control.default, props); await tick(); } return runtime.render(control.default, props); };
  return { view, saves, changes };
}
const select = (tree: unknown) => findAll(tree, (n) => n.type === "select")[0];

test("Student one-line choice: classroom nickname by default, nothing to type, saved on change", async () => {
  const { view, saves, changes } = await mountControl({ visibility: "nickname", alias: "Mila S.", namesAllowed: true });
  let tree = await view();
  assert.equal(findAll(tree, (n) => n.type === "input").length, 0, "no nickname field");
  assert.equal(findAll(tree, (n) => n.type === "button").length, 0, "no Save button");
  assert.equal(select(tree).props.value, "nickname");
  assert.deepEqual(findAll(tree, (n) => n.type === "option").map(textOf), ["My classroom nickname (Mila S.)", "A Reader code (anonymous)", "Hidden from the rankings"]);
  assert.match(textOf(tree), /Show me to classmates as/);
  assert.match(textOf(tree), /This never changes your XP, badges, achievements or reading streak\./);
  assert.deepEqual(changes, [["nickname", "loaded"]]);
  select(tree).props.onChange({ target: { value: "hidden" } });
  tree = await view();
  assert.deepEqual(saves, [["hidden", null]], "the Student's choice only, never an alias");
  assert.deepEqual(changes.at(-1), ["hidden", "saved"]);
  assert.match(textOf(findAll(tree, (n) => n.props?.role === "status")[0]), /Saved\./);
});

test("Student one-line choice explains when names are not approved yet or the nickname cannot be shown", async () => {
  let tree = await (await mountControl({ visibility: "nickname", alias: "Mila S.", namesAllowed: false })).view();
  assert.match(textOf(tree), /Classroom names appear after your school approves them\. Until then, classmates see Reader codes\./);
  tree = await (await mountControl({ visibility: "nickname", alias: null, namesAllowed: true })).view();
  assert.match(textOf(tree), /don't have a classroom nickname that can be shown/);
  tree = await (await mountControl({ visibility: "anonymous", alias: "Mila S.", namesAllowed: false })).view();
  assert.doesNotMatch(textOf(tree), /approves them/, "no approval note for an anonymous choice");
  assert.equal(await (await mountControl(null)).view(), null, "nothing until the migration is deployed");
});
