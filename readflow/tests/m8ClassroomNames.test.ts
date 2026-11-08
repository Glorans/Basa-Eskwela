// M8 F4 classroom display names on the real Leaderboard page (the database decides the names; the page shows them).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createHookRuntime, findAll, loadComponentModule, textOf, tick } from "./helpers/hookRuntime.ts";
import { rankByXp } from "../src/modules/module8/leaderboardRanking.ts";

const require = createRequire(import.meta.url);

async function mountLeaderboard(rankings: unknown[] | null, legacy: unknown[] = []) {
  const runtime = createHookRuntime(require("react"));
  const page = loadComponentModule(new URL("../src/pages/Leaderboard.tsx", import.meta.url), (id) => {
    if (id === "react") return runtime.react;
    if (id.endsWith("/gamificationService") || id.endsWith("/classroomService")) {
      return {
        rankByXp,
        getStudentClassrooms: async () => [{ id: "room", room_name: "Reading class", section: null }],
        getClassroomRankings: async () => (rankings ? rankByXp(rankings as never[]) : null),
        getClassroomLeaderboard: async () => rankByXp(legacy as never[]),
        getWeeklyLeaderboard: async () => [],
      };
    }
    if (id.endsWith("/supabaseClient")) return { supabase: { auth: { getUser: async () => ({ data: { user: { id: "reader" } }, error: null }) } } };
    if (id.endsWith(".css")) return {};
    return require(id);
  }, { Error, console: { error() {} } });
  const view = () => runtime.render(page.default, {});
  for (let i = 0; i < 4; i++) { view(); await tick(); }
  return findAll(view(), (node) => node.type === "li").map(textOf);
}

test("classmates' short names and 'You (First)' are shown exactly as the database sends them", async () => {
  const rows = await mountLeaderboard([
    { user_id: "a1", display_name: "Jose M.", xp: 150, rank: 0, is_me: false },
    { user_id: "a2", display_name: "You (Maria)", xp: 90, rank: 0, is_me: true },
    { user_id: "a3", display_name: "Ana · 03DF2F", xp: 40, rank: 0, is_me: false },
    { user_id: "a4", display_name: "Reader 8A21C0", xp: 0, rank: 0, is_me: false },
  ]);
  assert.equal(rows.length, 4);
  assert.match(rows[0], /^1.*Jose M\..*150/);
  assert.match(rows[1], /^2.*You \(Maria\).*90/);
  assert.doesNotMatch(rows.join(), /You \(You/, "never wrapped twice");
  assert.match(rows[2], /Ana · 03DF2F/);
  assert.match(rows[3], /Reader 8A21C0/, "pseudonym fallback still shown");
});

test("a viewer without a safe name stays 'You'; the older room function's own name is still wrapped", async () => {
  const plain = await mountLeaderboard([{ user_id: "me", display_name: "You", xp: 10, rank: 0, is_me: true }]);
  assert.match(plain[0], /You/); assert.doesNotMatch(plain[0], /You \(/);
  const legacy = await mountLeaderboard(null, [{ user_id: "reader", display_name: "maria", xp: 5, rank: 0 }]);
  assert.match(legacy[0], /You \(maria\)/);
});
