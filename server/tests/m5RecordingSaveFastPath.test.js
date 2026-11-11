// M5 recording save: the route's verified attempt is reused (one attempt load per upload), the archive and
// existing-recording checks run together but keep their order, and ownership, no-replace and retry hold.
// In-memory fakes only (no network, no Storage).
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createOralReadingRouter } = require("../routes/oralReading");
const { saveOralReadingRecording } = require("../services/oralReadingRecordingService");

const OWNER = { user: { id: "owner-1" }, profile: { role: "student" } };
const ATTEMPT = "11111111-1111-4111-8111-111111111111";
const ROOM = "22222222-2222-4222-8222-222222222222";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const file = (text = "webm") => ({ buffer: Buffer.from(text), mimetype: "audio/webm", originalname: "segment-000" });

function fakeDb({ existing = null, recordingError = null, recordingMs = 0 } = {}) {
  const state = { uploads: [], inserts: [], removed: [], recordingReads: 0, existing };
  const client = {
    from(table) {
      assert.equal(table, "oral_reading_recordings");
      let row = null;
      const query = {
        select() { return query; }, eq() { return query; },
        insert(value) { row = value; return query; },
        async maybeSingle() {
          state.recordingReads++;
          await sleep(recordingMs);
          return recordingError ? { data: null, error: recordingError } : { data: state.existing, error: null };
        },
        then(resolve, reject) {
          state.inserts.push(row); state.existing = { segments: row.segments };
          return Promise.resolve({ error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    storage: { from: () => ({
      upload: async (path) => { state.uploads.push(path); return { error: null }; },
      remove: async (paths) => { state.removed.push(...paths); return { error: null }; },
    }) },
  };
  return { state, client };
}

const attemptOf = (overrides = {}) => ({ id: ATTEMPT, userId: OWNER.user.id, roomId: ROOM, ...overrides });

test("the upload route loads the attempt once and the save reuses it", async (t) => {
  const { state, client } = fakeDb();
  let loads = 0;
  const app = express();
  app.use(createOralReadingRouter({
    authorizeOralReadingPracticeRequest: async () => OWNER,
    getOralReadingAttempt: async (requester, id) => { loads++; assert.equal(requester, OWNER); assert.equal(id, ATTEMPT); return attemptOf(); },
    isRoomArchived: async () => false,
    getSupabaseAdmin: () => client,
  }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));
  const form = new FormData();
  form.append("audio", new Blob([Buffer.from("webm-bytes")], { type: "audio/webm" }), "segment-000");
  const response = await fetch(`http://127.0.0.1:${server.address().port}/attempts/${ATTEMPT}/recording`, { method: "POST", body: form });
  assert.equal(response.status, 200);
  assert.equal(loads, 1, "one attempt load per upload (was two)");
  assert.equal(state.uploads.length, 1);
  assert.equal(state.inserts.length, 1);
  assert.equal(state.uploads[0].startsWith(`${OWNER.user.id}/${ATTEMPT}/`), true, "stored under the owner's path");
});

test("a verified attempt of another user or another attempt is never trusted", async () => {
  for (const verifiedAttempt of [attemptOf({ userId: "someone-else" }), attemptOf({ id: "33333333-3333-4333-8333-333333333333" }), { roomId: null }]) {
    const { client } = fakeDb();
    let loads = 0;
    await assert.rejects(saveOralReadingRecording(OWNER, ATTEMPT, [file()], {
      verifiedAttempt, getSupabaseAdmin: () => client, isRoomArchived: async () => false,
      getOralReadingAttempt: async () => { loads++; throw Object.assign(new Error("not yours"), { statusCode: 403 }); },
    }), (error) => error.statusCode === 403);
    assert.equal(loads, 1, "fell back to the ownership-checked load");
  }
});

test("an archived room still wins over a recording-storage error, whatever finishes first", async () => {
  for (const [archiveMs, recordingMs] of [[30, 0], [0, 30]]) {
    const { state, client } = fakeDb({ recordingError: { code: "XX000" }, recordingMs });
    await assert.rejects(saveOralReadingRecording(OWNER, ATTEMPT, [file()], {
      verifiedAttempt: attemptOf(), getSupabaseAdmin: () => client,
      isRoomArchived: async () => { await sleep(archiveMs); return true; },
    }), { code: "CLASSROOM_ARCHIVED", statusCode: 409 });
    assert.deepEqual(state.uploads, [], "nothing uploaded");
  }
});

test("a failed archive check fails closed before any upload", async () => {
  const { state, client } = fakeDb();
  const failure = Object.assign(new Error("Unable to check the classroom."), { statusCode: 503 });
  await assert.rejects(saveOralReadingRecording(OWNER, ATTEMPT, [file()], {
    verifiedAttempt: attemptOf(), getSupabaseAdmin: () => client, isRoomArchived: async () => { throw failure; },
  }), (error) => error === failure);
  assert.deepEqual(state.uploads, []);
});

test("no-replace and retry: an existing recording is kept and a retry uploads nothing", async () => {
  const { state, client } = fakeDb({ existing: { segments: ["owner-1/a/0/000"] } });
  await saveOralReadingRecording(OWNER, ATTEMPT, [file("retry")], { verifiedAttempt: attemptOf(), getSupabaseAdmin: () => client, isRoomArchived: async () => false });
  assert.deepEqual(state.uploads, []);
  assert.deepEqual(state.inserts, []);
  assert.deepEqual(state.existing, { segments: ["owner-1/a/0/000"] });
});

test("invalid files are refused before any storage read or upload", async () => {
  const { state, client } = fakeDb();
  await assert.rejects(saveOralReadingRecording(OWNER, ATTEMPT, [], { verifiedAttempt: attemptOf(), getSupabaseAdmin: () => client, isRoomArchived: async () => false }),
    { code: "INVALID_RECORDING" });
  assert.equal(state.recordingReads, 0);
  assert.deepEqual(state.uploads, []);
});
