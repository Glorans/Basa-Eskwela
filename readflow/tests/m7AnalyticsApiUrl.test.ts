import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("completion analytics requests use the configured backend URL", async () => {
  const service = await read("../src/modules/module7/services/teacherAnalyticsService.ts");
  assert.match(service, /import \{ getApiUrl \} from "\.\.\/\.\.\/\.\.\/lib\/apiUrl";/);
  assert.match(
    service,
    /`\$\{getApiUrl\(\)\.replace\(\/\\\/\+\$\/, ""\)\}\/api\/oral-reading\/teacher\/completion-analytics`/,
  );
  assert.doesNotMatch(service, /localhost/);
  // Route, bearer token and error handling are unchanged.
  assert.match(service, /Authorization: `Bearer \$\{session\.access_token\}`/);
  assert.match(service, /if \(!response\.ok \|\| !result\.success\)/);
});

test("classroom and student analytics reach the backend through the same service", async () => {
  for (const path of [
    "../src/modules/module7/services/classPerformanceService.ts",
    "../src/modules/module7/services/studentPerformanceService.ts",
  ]) {
    const source = await read(path);
    assert.match(source, /getTeacherCompletionAnalytics/, path);
    assert.doesNotMatch(source, /fetch\(|localhost/, path);
  }
});

test("no frontend source hardcodes a localhost backend outside lib/apiUrl.ts", async () => {
  const root = new URL("../src/", import.meta.url);
  const entries = await readdir(root, { recursive: true });
  const offenders: string[] = [];
  for (const entry of entries) {
    const file = entry.replaceAll("\\", "/");
    if (!/\.(ts|tsx)$/.test(file) || file === "lib/apiUrl.ts") continue;
    if (/https?:\/\/(localhost|127\.0\.0\.1)/.test(await readFile(new URL(file, root), "utf8"))) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, []);
});
