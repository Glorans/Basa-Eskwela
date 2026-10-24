import assert from "node:assert/strict";
import test from "node:test";
import { ReadingDataCache } from "../src/modules/module5/services/readingDataCache.ts";

test("reading data expires and failed requests can be retried without stale success", async () => {
  let now = 0, calls = 0;
  const cache = new ReadingDataCache(() => now, 100);
  cache.setSession("token", "reader");
  const fetch = async () => ++calls;
  assert.equal(await cache.load("token", "result", fetch), 1);
  assert.equal(await cache.load("token", "result", fetch), 1);
  now = 100;
  assert.equal(cache.peek("result", "reader"), undefined);
  await assert.rejects(cache.load("token", "result", async () => { throw Error("offline"); }), /offline/);
  assert.equal(cache.peek("result", "reader"), undefined);
  assert.equal(await cache.load("token", "result", fetch), 2);
});

test("session changes discard cached and pending data, even on sign-in as the same user", async () => {
  const cache = new ReadingDataCache();
  cache.setSession("old", "reader");
  let resolve!: (value: string) => void;
  const pending = cache.load("old", "result", () => new Promise<string>(yes => { resolve = yes; }));
  cache.setSession("", undefined);
  cache.setSession("new", "reader");
  resolve("old result");
  await pending;
  assert.equal(cache.peek("result", "reader"), undefined);
  cache.put("new", "result", "new result");
  assert.equal(cache.peek("result", "other"), undefined);
  assert.equal(cache.peek("result", "reader"), "new result");
});

test("cache shares in-flight requests and bounds retained results", async () => {
  const cache = new ReadingDataCache();
  cache.setSession("token", "reader");
  let calls = 0;
  const fetch = async () => { calls++; return "result"; };
  assert.deepEqual(await Promise.all([cache.load("token", "result", fetch), cache.load("token", "result", fetch)]), ["result", "result"]);
  assert.equal(calls, 1);
  for (let i = 0; i < 31; i++) cache.put("token", `${i}`, i);
  assert.equal(cache.peek("0", "reader"), undefined);
  assert.equal(cache.peek("30", "reader"), 30);
});
