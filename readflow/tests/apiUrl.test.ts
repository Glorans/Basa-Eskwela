import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiUrl } from "../src/lib/apiUrl.ts";

test("VITE_API_URL is passed through unchanged in dev and production", () => {
  assert.equal(resolveApiUrl({ VITE_API_URL: "https://api.example.org", DEV: true }), "https://api.example.org");
  assert.equal(resolveApiUrl({ VITE_API_URL: "https://api.example.org", DEV: false }), "https://api.example.org");
});

test("development falls back to the local backend when VITE_API_URL is unset", () => {
  assert.equal(resolveApiUrl({ DEV: true }), "http://localhost:5000");
  assert.equal(resolveApiUrl({ VITE_API_URL: "", DEV: true }), "http://localhost:5000");
});

test("production throws instead of silently using localhost", () => {
  assert.throws(() => resolveApiUrl({ DEV: false }), /VITE_API_URL is not set/);
  assert.throws(() => resolveApiUrl({ VITE_API_URL: "", DEV: false }), /VITE_API_URL is not set/);
});
