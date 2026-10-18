const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const test = require("node:test");
const { createCanvas } = require("@napi-rs/canvas");
const express = require("express");
const JSZip = require("jszip");
const {
  createAdminModuleExtractionRouter,
} = require("../routes/adminModuleExtraction");
const { MaterialExtractionError } = require("../services/materialExtractionService");
const { materialUploadDirectory } = require("../services/materialFileUpload");
const { terminateOcrWorker } = require("../services/materialOcrService");
const { SupabaseAuthenticationError } = require("../services/supabaseAdmin");

const TEST_USER_ID = "11111111-1111-4111-8111-111111111111";

function createAppForRole(role, overrides = {}) {
  const app = express();
  app.use(express.json());
  app.use("/api/admin/modules", createAdminModuleExtractionRouter({
    authorizeMaterialRequest: async () => {
      if (!role) throw new SupabaseAuthenticationError();
      return { user: { id: TEST_USER_ID }, profile: { id: TEST_USER_ID, role } };
    },
    ...overrides,
  }));
  return app;
}

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function postFile(baseUrl, contents, type, filename, language = "en") {
  const formData = new FormData();
  formData.append("file", new Blob([contents], { type }), filename);
  formData.append("language", language);
  return fetch(`${baseUrl}/api/admin/modules/extract`, {
    method: "POST",
    body: formData,
  });
}

function createSimplePdf(text) {
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${text}) Tj\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}

async function createSimpleDocx(text) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + "</Types>",
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
      + "</Relationships>",
  );
  zip.file(
    "word/document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

function createTextImage() {
  const canvas = createCanvas(1000, 260);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "black";
  context.font = "bold 74px Arial";
  context.fillText("ADMIN READING PASSAGE", 35, 155);
  return canvas.toBuffer("image/png");
}

test("Admin extracts PDF text without retaining a material upload", async (context) => {
  const { server, baseUrl } = await listen(createAppForRole("admin"));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const filesBefore = await fs.readdir(materialUploadDirectory);

  const response = await postFile(
    baseUrl,
    createSimplePdf("Admin PDF passage"),
    "application/pdf",
    "lesson.pdf",
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.match(body.extraction.extractedText, /Admin PDF passage/);
  assert.equal(body.extraction.fileType, "PDF");
  assert.equal(Object.hasOwn(body.extraction, "id"), false);
  assert.deepEqual(await fs.readdir(materialUploadDirectory), filesBefore);
});

test("Admin extracts DOCX text into the passage response", async (context) => {
  const { server, baseUrl } = await listen(createAppForRole("admin"));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await postFile(
    baseUrl,
    await createSimpleDocx("Admin DOCX passage"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "lesson.docx",
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.extraction.extractedText, "Admin DOCX passage");
  assert.equal(body.extraction.fileType, "DOCX");
});

test("Admin image extraction uses the existing OCR path", async (context) => {
  const { server, baseUrl } = await listen(createAppForRole("admin"));
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await terminateOcrWorker();
  });
  const response = await postFile(
    baseUrl,
    createTextImage(),
    "image/png",
    "page.png",
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.match(body.extraction.extractedText, /ADMIN READING PASSAGE/i);
  assert.equal(typeof body.extraction.ocrConfidence, "number");
});

test("Admin module extraction rejects unsupported, invalid-signature, and empty files", async (context) => {
  const { server, baseUrl } = await listen(createAppForRole("admin"));
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const unsupported = await postFile(baseUrl, "plain text", "text/plain", "lesson.txt");
  assert.equal(unsupported.status, 415);
  assert.match((await unsupported.json()).message, /only PDF, DOCX, JPG, JPEG, and PNG/i);

  const invalid = await postFile(baseUrl, "not a PDF", "application/pdf", "lesson.pdf");
  assert.equal(invalid.status, 415);
  assert.match((await invalid.json()).message, /contents do not match/i);

  const empty = await postFile(baseUrl, Buffer.alloc(0), "application/pdf", "empty.pdf");
  assert.equal(empty.status, 400);
  assert.match((await empty.json()).message, /file is empty/i);
});

test("an extraction failure returns a safe retryable error and cleans up the upload", async (context) => {
  const { server, baseUrl } = await listen(createAppForRole("admin", {
    extractReadingMaterial: async () => {
      throw new MaterialExtractionError(
        "EMPTY_EXTRACTED_TEXT",
        "No readable text could be extracted from this file.",
      );
    },
  }));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const filesBefore = await fs.readdir(materialUploadDirectory);
  const response = await postFile(
    baseUrl,
    createSimplePdf("Unreadable fixture"),
    "application/pdf",
    "unreadable.pdf",
  );
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.extractionStatus, "failed");
  assert.match(body.message, /No readable text/i);
  assert.equal(Object.hasOwn(body, "stack"), false);
  assert.deepEqual(await fs.readdir(materialUploadDirectory), filesBefore);
});

for (const [role, expectedStatus] of [
  [undefined, 401],
  ["student", 403],
  ["teacher", 403],
  ["general_user", 403],
  ["admin", 400],
]) {
  test(`${role ?? "unauthenticated"} Admin extraction authorization returns ${expectedStatus}`, async (context) => {
    const { server, baseUrl } = await listen(createAppForRole(role));
    context.after(() => new Promise((resolve) => server.close(resolve)));
    const response = await fetch(`${baseUrl}/api/admin/modules/extract`, {
      method: "POST",
      body: new FormData(),
    });
    assert.equal(response.status, expectedStatus);
  });
}
