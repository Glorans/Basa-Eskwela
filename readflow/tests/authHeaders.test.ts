import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, test } from "node:test";

// getSessionAuthHeaders is shared by several services, so it is tested on its own.

let sessionReply: { data: { session: { access_token?: string } | null }; error: unknown };
let sessionCalls = 0;
const client = {
  auth: {
    getSession() {
      sessionCalls++;
      return Promise.resolve(sessionReply);
    },
  },
};

const globals = globalThis as typeof globalThis & { __authHeadersClient?: typeof client };
globals.__authHeadersClient = client;
const url = new URL("../src/services/authHeaders.ts", import.meta.url).href;
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL === url && specifier.endsWith("/supabaseClient")) {
    return { url: "data:text/javascript,export const supabase = globalThis.__authHeadersClient", shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
const { getSessionAuthHeaders } = await import(url) as typeof import("../src/services/authHeaders.ts");

after(() => {
  hooks.deregister();
  delete globals.__authHeadersClient;
});

test("a getSession error throws a plain Error with the caller's message", async () => {
  sessionReply = { data: { session: { access_token: "token" } }, error: new Error("network") };
  await assert.rejects(getSessionAuthHeaders("Please sign in again."), (error: unknown) => {
    assert.equal(Object.getPrototypeOf(error), Error.prototype);
    assert.equal((error as Error).message, "Please sign in again.");
    return true;
  });
});

test("a missing session or access token throws the caller's message", async () => {
  for (const session of [null, {}, { access_token: "" }]) {
    sessionReply = { data: { session }, error: null };
    await assert.rejects(
      getSessionAuthHeaders("Your session could not be verified. Please sign in again."),
      { message: "Your session could not be verified. Please sign in again." },
    );
  }
});

test("a valid session returns exactly the Bearer authorization header", async () => {
  sessionCalls = 0;
  sessionReply = { data: { session: { access_token: "abc.def.ghi" } }, error: null };
  assert.deepEqual(await getSessionAuthHeaders("unused"), { Authorization: "Bearer abc.def.ghi" });
  assert.equal(sessionCalls, 1);
});
