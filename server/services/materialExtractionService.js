const fs = require("fs/promises");
const mammoth = require("mammoth");
const { PDFParse } = require("pdf-parse");
const { MaterialOcrError, extractImageText } = require("./materialOcrService");
const { ImageValidationError, validateImageFile } = require("./imageValidation");
const {
  hasReadableText,
  normalizeExtractedText,
} = require("./materialTextNormalization");

class MaterialExtractionError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "MaterialExtractionError";
    this.code = code;
  }
}

function requireReadableText(value) {
  const text = normalizeExtractedText(value);

  if (!hasReadableText(text)) {
    throw new MaterialExtractionError(
      "EMPTY_EXTRACTED_TEXT",
      "No readable text could be extracted from this file.",
    );
  }

  return text;
}

async function extractPdfDocument(filePath, maxPages) {
  const data = await fs.readFile(filePath);
  const parser = new PDFParse({ data });

  try {
    if (maxPages !== undefined) {
      const info = await parser.getInfo();
      if (info.total > maxPages) {
        throw new MaterialExtractionError('MATERIAL_PAGE_LIMIT',
          'Reading materials are limited to 5 pages for this prototype.');
      }
    }
    const result = await parser.getText();
    // Page bodies exclude synthetic markers that can make scanned PDFs look readable.
    if (result.pages.length !== result.total || result.pages.some((page, i) => page.num !== i + 1)) {
      throw new MaterialExtractionError('INCOMPLETE_PDF', 'We could not read every PDF page. Please try another file.');
    }
    const pages = result.pages.map(page => normalizeExtractedText(page.text));
    const extractedText = normalizeExtractedText(pages.join('\n\n'));
    if (!hasReadableText(extractedText)) {
      throw new MaterialExtractionError('EMPTY_EXTRACTED_TEXT',
        'This PDF appears to contain scanned images or blank pages and no readable text. Please upload a text-based PDF/DOCX or a JPG/PNG image.');
    }
    return { extractedText, pageCount: result.total,
      pagesWithoutText: result.pages.filter((page, i) => !hasReadableText(pages[i])).map(page => page.num) };
  } catch (error) {
    if (error instanceof MaterialExtractionError) {
      throw error;
    }

    throw new MaterialExtractionError(
      "PDF_EXTRACTION_FAILED",
      "The PDF could not be read. It may be corrupt or password-protected.",
      error,
    );
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function extractPdfText(filePath) {
  return (await extractPdfDocument(filePath)).extractedText;
}

async function extractDocxText(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return requireReadableText(result.value);
  } catch (error) {
    if (error instanceof MaterialExtractionError) {
      throw error;
    }

    throw new MaterialExtractionError(
      "DOCX_EXTRACTION_FAILED",
      "The DOCX file could not be read. It may be corrupt or unsupported.",
      error,
    );
  }
}

async function extractReadingMaterial({ filePath, fileType, language, maxPages }) {
  if (fileType === "PDF") {
    return {
      status: "completed",
      ...await extractPdfDocument(filePath, maxPages),
      ocrConfidence: null,
    };
  }

  if (fileType === "DOCX") {
    return {
      status: "completed",
      extractedText: await extractDocxText(filePath),
      ocrConfidence: null,
    };
  }

  if (fileType === "JPG" || fileType === "PNG") {
    try {
      // Damaged, incomplete or oversized images are refused before OCR decodes them.
      await validateImageFile(filePath, fileType);
      const result = await extractImageText({ filePath, language });
      return {
        status: "completed",
        extractedText: result.extractedText,
        ocrConfidence: result.ocrConfidence,
      };
    } catch (error) {
      if (error instanceof MaterialOcrError || error instanceof ImageValidationError) {
        throw new MaterialExtractionError(error.code, error.message, error);
      }

      throw error;
    }
  }

  throw new MaterialExtractionError(
    "UNSUPPORTED_EXTRACTION_TYPE",
    "This material type cannot be processed.",
  );
}

module.exports = {
  MaterialExtractionError,
  extractDocxText,
  extractPdfText,
  extractPdfDocument,
  extractReadingMaterial,
  normalizeExtractedText,
};
