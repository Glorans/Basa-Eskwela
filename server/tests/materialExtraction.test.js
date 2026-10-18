const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const JSZip = require("jszip");
const {
  extractDocxText,
  extractPdfText,
  normalizeExtractedText,
} = require("../services/materialExtractionService");

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
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
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
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>",
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>",
  );
  zip.file(
    "word/document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

test("normalizes whitespace while preserving paragraph breaks", () => {
  assert.equal(
    normalizeExtractedText(" First   paragraph.\r\n\r\n\r\n Second\tparagraph. "),
    "First paragraph.\n\nSecond paragraph.",
  );
});

test("extracts readable text from a small generated PDF fixture", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "readflow-pdf-"));
  const filePath = path.join(directory, "fixture.pdf");

  try {
    await fs.writeFile(filePath, createSimplePdf("ReadFlow PDF fixture"));
    assert.match(await extractPdfText(filePath), /ReadFlow PDF fixture/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("extracts readable text from a small generated DOCX fixture", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "readflow-docx-"));
  const filePath = path.join(directory, "fixture.docx");

  try {
    await fs.writeFile(filePath, await createSimpleDocx("ReadFlow DOCX fixture"));
    assert.equal(await extractDocxText(filePath), "ReadFlow DOCX fixture");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
