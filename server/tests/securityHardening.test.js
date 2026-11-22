// Pre-defense security hardening: damaged/oversized image handling (no backend crash), upload rate limit, and the
// database content screen surfaced as 422 (m3_content_screen_v1). Synthetic images and mocked database replies only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const test = require("node:test");
const { createCanvas } = require("@napi-rs/canvas");
const express = require("express");
const { createMaterialsRouter, materialUploadDirectory } = require("../routes/materials");
const { terminateOcrWorker, ocrWorkerErrorHandler } = require("../services/materialOcrService");
const { validatePng, validateJpeg, MAX_IMAGE_PIXELS } = require("../services/imageValidation");
const screen = require("../services/contentScreen");
const { personalMaterialAccess } = require("../services/personalMaterialService");
const { createRequestLimiter } = require("../services/speechAccess");

const USER = "11111111-1111-4111-8111-111111111111";

function textImage(mime) {
  const canvas = createCanvas(900, 240);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "black";
  context.font = "bold 64px Arial";
  context.fillText("MAYA READS BOOKS", 60, 140);
  return canvas.toBuffer(mime);
}
const chunk = (type, data) => {
  const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), data])));
  return Buffer.concat([head, Buffer.from(type), data, crc]);
};
const ihdr = (w, h) => { const d = Buffer.alloc(13); d.writeUInt32BE(w, 0); d.writeUInt32BE(h, 4); d[8] = 8; d[9] = 2; return chunk("IHDR", d); };
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (w, h, idat) => Buffer.concat([PNG_SIG, ihdr(w, h), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);

test("image structure: real PNG and JPEG accepted with their size", () => {
  assert.deepEqual(validatePng(textImage("image/png")), { width: 900, height: 240 });
  assert.deepEqual(validateJpeg(textImage("image/jpeg")), { width: 900, height: 240 });
});

test("image structure: damaged, truncated and oversized images are refused before OCR", () => {
  const good = textImage("image/png");
  const badCrc = Buffer.from(good); badCrc[30] ^= 0xff;
  assert.throws(() => validatePng(badCrc), { code: "INVALID_IMAGE" }, "chunk CRC mismatch");
  assert.throws(() => validatePng(png(200, 100, Buffer.from("not zlib data at all"))), { code: "INVALID_IMAGE" }, "pixel data not a zlib stream");
  assert.throws(() => validatePng(png(200, 100, zlib.deflateSync(Buffer.alloc(10)))), { code: "INVALID_IMAGE" }, "pixel data shorter than the header promises");
  assert.throws(() => validatePng(good.subarray(0, good.length - 20)), { code: "INVALID_IMAGE" }, "missing IEND");
  assert.throws(() => validatePng(png(30000, 30000, zlib.deflateSync(Buffer.alloc(100)))), { code: "IMAGE_TOO_LARGE" }, "huge header refused without decoding");
  assert.throws(() => validatePng(png(9000, 3000, zlib.deflateSync(Buffer.alloc(100)))), { code: "IMAGE_TOO_LARGE" }, `over ${MAX_IMAGE_PIXELS} pixels`);
  const jpeg = textImage("image/jpeg");
  assert.throws(() => validateJpeg(jpeg.subarray(0, Math.floor(jpeg.length / 2))), { code: "INVALID_IMAGE" }, "truncated JPEG");
  assert.throws(() => validateJpeg(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(Array.from({ length: 2000 }, (_, i) => i % 256))])), { code: "INVALID_IMAGE" }, "garbage after JPEG marker");
});

test("OCR worker errors are handled (no uncaught exception) and logged without payloads", () => {
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    assert.doesNotThrow(() => ocrWorkerErrorHandler(new Error("Error attempting to read image.")));
  } finally {
    console.error = original;
  }
  assert.match(logged[0], /OCR worker job failed: Error attempting to read image\./);
});

function appFor(role, extra = {}) {
  const app = express();
  app.use(express.json());
  app.use("/api/materials", createMaterialsRouter({
    authorizeMaterialRequest: async () => ({ user: { id: USER }, profile: { id: USER, role } }),
    screenText: async () => ({ checked: true, flagged: false, categories: [], firstLine: null }),
    ...extra,
  }));
  return app;
}
async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}
async function upload(baseUrl, buffer, name, mime) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mime }), name);
  form.append("title", "Security test");
  form.append("language", "en");
  const response = await fetch(`${baseUrl}/api/materials/upload`, { method: "POST", body: form });
  return { status: response.status, body: await response.json() };
}

test("route: a JPEG that passes the structure check but cannot be decoded is a 422, the server keeps running", async (context) => {
  const { server, baseUrl } = await listen(appFor("teacher"));
  context.after(async () => { await new Promise((resolve) => server.close(resolve)); await terminateOcrWorker(); });
  const before = new Set(fs.readdirSync(materialUploadDirectory));
  // Valid markers and size, scrambled compressed image data: the decoder inside the OCR worker fails.
  const jpeg = Buffer.from(textImage("image/jpeg"));
  const sos = jpeg.indexOf(Buffer.from([0xff, 0xda]));
  for (let i = sos + 20; i < jpeg.length - 2; i += 1) jpeg[i] = (i * 37) & 0xfe;
  const broken = await upload(baseUrl, jpeg, "scrambled.jpg", "image/jpeg");
  assert.ok([422].includes(broken.status), `status ${broken.status}: ${broken.body.message}`);
  assert.equal(Object.hasOwn(broken.body, "stack"), false);
  const truncated = await upload(baseUrl, textImage("image/jpeg").subarray(0, 4000), "cut.jpg", "image/jpeg");
  assert.equal(truncated.status, 422);
  assert.match(truncated.body.message, /damaged or incomplete/);
  const ok = await upload(baseUrl, textImage("image/png"), "page.png", "image/png");
  assert.equal(ok.status, 201, ok.body.message);
  assert.match(ok.body.material.extractedText, /MAYA/i);
  assert.deepEqual(ok.body.material.contentScreening, { checked: true, flagged: false, categories: [], firstLine: null });
  await fetch(`${baseUrl}/api/materials/temporary/${ok.body.material.id}`, { method: "DELETE" });
  const after = fs.readdirSync(materialUploadDirectory).filter((name) => !before.has(name));
  assert.deepEqual(after, [], "no temporary files left behind");
});

test("route: per-account upload rate limit returns 429 with Retry-After", async (context) => {
  const { server, baseUrl } = await listen(appFor("teacher", { uploadLimiter: createRequestLimiter({ limit: 1, windowMs: 60_000 }) }));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const first = await fetch(`${baseUrl}/api/materials/upload`, { method: "POST", body: new FormData() });
  assert.equal(first.status, 400);
  const second = await fetch(`${baseUrl}/api/materials/upload`, { method: "POST", body: new FormData() });
  assert.equal(second.status, 429);
  assert.ok(Number(second.headers.get("retry-after")) > 0);
  assert.equal((await second.json()).code, "UPLOAD_RATE_LIMITED");
});

test("route: saving text refused by the database content screen is a 422 with its safe message; the file is removed", async (context) => {
  const removed = [];
  const supabaseAdmin = {
    storage: { from: () => ({
      info: async () => ({ data: { size: PDF.length, contentType: "application/pdf" }, error: null }),
      remove: async (paths) => { removed.push(...paths); return { error: null }; },
    }) },
    from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: {
      code: "PT422", hint: "CONTENT_SCREEN", details: "web_link",
      message: "Content check: this reading material may not be suitable for young learners (a web link). It was first found in the reading text, line 2. Please review and edit it before it is saved.",
    } }) }) }) }),
    rpc: async () => ({ data: [], error: null }),
  };
  const { server, baseUrl } = await listen(appFor("teacher", { getSupabaseAdmin: () => supabaseAdmin }));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const up = await upload(baseUrl, PDF, "story.pdf", "application/pdf");
  assert.equal(up.status, 201, up.body.message);
  const storagePath = `${USER}/${"a".repeat(8)}-aaaa-4aaa-8aaa-${"a".repeat(12)}.pdf`;
  const response = await fetch(`${baseUrl}/api/materials/finalize`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ temporaryMaterialId: up.body.material.id, contentText: "Story.\nVisit games.xyz", storagePath, language: "en" }) });
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.code, "CONTENT_SCREEN");
  assert.match(body.message, /^Content check: .*a web link/);
  assert.doesNotMatch(body.message, /games\.xyz/);
  assert.deepEqual(removed, [storagePath], "the uploaded file is cleaned up");
  await fetch(`${baseUrl}/api/materials/temporary/${up.body.material.id}`, { method: "DELETE" });
});

test("content screen helper: only the database refusal is mapped; unexpected messages fall back to a generic one", async () => {
  assert.equal(screen.isContentScreenError({ code: "PT422" }), true);
  assert.equal(screen.isContentScreenError({ code: "23505" }), false);
  assert.throws(() => screen.throwIfContentScreen({ code: "PT422", message: "Content check: x (strong language)." }), (e) => e instanceof screen.ContentScreenError && e.statusCode === 422 && /strong language/.test(e.message));
  assert.match(screen.contentScreenMessage({ code: "PT422", message: "raw database text with details" }), /^Content check: this text may not be suitable/);
  assert.doesNotThrow(() => screen.throwIfContentScreen(null));
  const db = { rpc: async (name, args) => (name === "content_screen_findings" && args.p_text ? { data: [{ category: "web_link", paragraph: 3 }, { category: "personal_information", paragraph: 2 }], error: null } : { data: null, error: {} }) };
  assert.deepEqual(await screen.screenText(db, "some text"), { checked: true, flagged: true,
    categories: ["a web link", "personal information such as a phone number, e-mail address or ID number"], firstLine: 2 });
  assert.deepEqual(await screen.screenText({ rpc: async () => ({ data: null, error: { code: "PGRST202" } }) }, "x"), { checked: false }, "not installed: advisory skipped");
  assert.deepEqual(await screen.screenText({ rpc: async () => { throw new Error("down"); } }, "x"), { checked: false });
});

test("Independent Learner private practice: a content-screen refusal reaches the learner as a 422", async () => {
  const requester = { user: { id: USER }, profile: { id: USER, role: "general_user" } };
  const deps = { getSupabaseAdmin: () => ({ rpc: async () => ({ data: null, error: { code: "PT422", message: "Content check: this question set may not be suitable for young learners (a web link)." } }) }) };
  await assert.rejects(personalMaterialAccess(requester, "22222222-2222-4222-8222-222222222222", "status", {}, deps),
    (e) => e instanceof screen.ContentScreenError && e.statusCode === 422);
});

test("SQL proposal: term list is hashes only, the screen covers every learner-facing table, rollback removes everything", () => {
  const dir = path.join(__dirname, "..", "..", "supabase", "proposed");
  const proposed = fs.readFileSync(path.join(dir, "m3_content_screen_v1_PROPOSED.sql"), "utf8");
  const rollback = fs.readFileSync(path.join(dir, "m3_content_screen_v1_ROLLBACK_PROPOSED.sql"), "utf8");
  const terms = proposed.slice(proposed.indexOf("terms constant text[] := array["), proposed.indexOf("];", proposed.indexOf("terms constant")));
  const entries = terms.match(/'[^']*'/g);
  assert.ok(entries.length >= 70);
  for (const entry of entries) assert.match(entry, /^'(strong_language|sexual_content|hateful_language|self_harm_or_threat|graphic_violence):[0-9a-f]{64}'$/);
  for (const table of ["uploaded_materials", "modules", "module_passages", "comprehension_questions", "comprehension_question_answers",
    "personal_material_question_sets", "reading_activity_assignments", "room_modules"]) {
    assert.match(proposed, new RegExp(`CREATE TRIGGER content_screen BEFORE INSERT[^;]* ON public\\.${table}\\b`), table);
    assert.match(rollback, new RegExp(`DROP TRIGGER content_screen ON public\\.${table};`), table);
  }
  assert.match(proposed, /errcode = 'PT422', hint = 'CONTENT_SCREEN'/);
  assert.doesNotMatch(proposed, /DISABLE TRIGGER|session_replication_role/, "no bypass switch");
  assert.match(proposed, /GRANT EXECUTE ON FUNCTION public\.content_screen_findings\(text\) TO authenticated, service_role;/);
});

// A one-page text PDF (the same structure the upload pipeline already accepts).
const PDF = (() => {
  const text = "BT /F1 12 Tf 40 760 Td (Maya and Leo read about whales at the library.) Tj ET";
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let body = "%PDF-1.4\n"; const offsets = [];
  objs.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
})();
