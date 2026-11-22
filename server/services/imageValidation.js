const fs = require("fs/promises");
const zlib = require("zlib");

// Image uploads are read by OCR, which decodes every pixel in memory. These limits keep one upload from exhausting
// the server: a 4000 x 3000 phone photo (12 MP) is fine; larger images must be resized first.
const MAX_IMAGE_SIDE = 10_000;
const MAX_IMAGE_PIXELS = 25_000_000;

class ImageValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ImageValidationError";
    this.code = code;
  }
}

const unreadable = () => new ImageValidationError(
  "INVALID_IMAGE",
  "This image file is damaged or incomplete, so its text cannot be read. Save or export the image again and retry.",
);

function checkDimensions(width, height) {
  if (!(width > 0 && height > 0)) throw unreadable();
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_IMAGE_PIXELS) {
    throw new ImageValidationError(
      "IMAGE_TOO_LARGE",
      `This image is too large to read (${width} x ${height} pixels). Resize it to at most 25 megapixels `
        + `(${MAX_IMAGE_SIDE.toLocaleString("en-US")} pixels on a side) and try again.`,
    );
  }
}

const PNG_CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const PNG_DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
// Adam7 passes: [xStart, yStart, xStep, yStep].
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

function pngRawSize(width, height, channels, depth, interlace) {
  const rowBytes = (w) => Math.ceil((w * channels * depth) / 8) + 1;
  if (!interlace) return height * rowBytes(width);
  return ADAM7.reduce((sum, [x0, y0, dx, dy]) => {
    const w = Math.ceil(Math.max(0, width - x0) / dx);
    const h = Math.ceil(Math.max(0, height - y0) / dy);
    return sum + (w && h ? h * rowBytes(w) : 0);
  }, 0);
}

/** Full PNG structure check: every chunk CRC, IHDR first, IDAT present, IEND last, and the pixel data inflates
 * to exactly the size its header promises (bounded, so a "decompression bomb" is refused without decoding it). */
function validatePng(buffer) {
  let offset = 8;
  let header;
  const idat = [];
  let ended = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > buffer.length || !/^[A-Za-z]{4}$/.test(type)) throw unreadable();
    const crc = buffer.readUInt32BE(offset + 8 + length);
    if (zlib.crc32(buffer.subarray(offset + 4, offset + 8 + length)) !== crc) throw unreadable();
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (!header && type !== "IHDR") throw unreadable();
    if (type === "IHDR") {
      if (header || length !== 13) throw unreadable();
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
      if (!PNG_DEPTHS[header.color]?.includes(header.depth) || data[10] !== 0 || data[11] !== 0 || header.interlace > 1) throw unreadable();
      checkDimensions(header.width, header.height);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      ended = true;
      break;
    }
    offset = end;
  }
  if (!header || !ended || !idat.length) throw unreadable();
  const expected = pngRawSize(header.width, header.height, PNG_CHANNELS[header.color], header.depth, header.interlace);
  let pixels;
  try {
    pixels = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1 });
  } catch {
    throw unreadable();
  }
  if (pixels.length !== expected) throw unreadable();
  return { width: header.width, height: header.height };
}

const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** JPEG structure check: segments within the file, a frame header (size) before the scan, and an end-of-image
 * marker after the image data. */
function validateJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) throw unreadable();
  let offset = 2;
  let size;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) throw unreadable();
    while (buffer[offset] === 0xff) offset += 1; // fill bytes
    const marker = buffer[offset];
    offset += 1;
    if (marker === undefined) throw unreadable();
    if (marker === 0xd9) break; // end of image before any scan
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) throw unreadable();
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) throw unreadable();
    if (SOF_MARKERS.has(marker)) {
      if (length < 8) throw unreadable();
      size = { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
      checkDimensions(size.width, size.height);
    }
    if (marker === 0xda) {
      // Start of scan: the compressed image follows; the file must still end the image properly.
      if (!size) throw unreadable();
      const eoi = buffer.lastIndexOf(Buffer.from([0xff, 0xd9]));
      if (eoi <= offset + length) throw unreadable();
      return size;
    }
    offset += length;
  }
  throw unreadable();
}

async function validateImageFile(filePath, fileType) {
  const buffer = await fs.readFile(filePath);
  if (fileType === "PNG") {
    if (buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) throw unreadable();
    return validatePng(buffer);
  }
  if (fileType === "JPG") return validateJpeg(buffer);
  throw unreadable();
}

module.exports = { ImageValidationError, MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE, validateImageFile, validateJpeg, validatePng };
