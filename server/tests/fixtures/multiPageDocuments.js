const JSZip = require('jszip');
const { createCanvas } = require('@napi-rs/canvas');

function imagePage(text, format = 'image/jpeg') {
  const canvas = createCanvas(1100, 300), ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1100, 300);
  ctx.fillStyle = 'black'; ctx.font = 'bold 72px Arial'; ctx.fillText(text, 40, 170);
  return canvas.toBuffer(format);
}
// Small valid PDF fixtures with explicit page trees; no external binary dependency.
// Each entry is text, null for blank, or a JPEG buffer for a scanned page.
function multiPagePdf(pages, minimumBytes = 0) {
  const objects = [null, null, Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')];
  const add = value => { objects.push(Buffer.isBuffer(value) ? value : Buffer.from(value)); return objects.length; };
  const stream = (header, data) => Buffer.concat([Buffer.from(`<< ${header} /Length ${data.length} >>\nstream\n`), data, Buffer.from('\nendstream')]);
  const ids = [];
  for (const page of pages) {
    let commands, resources = '/Font << /F1 3 0 R >>';
    if (Buffer.isBuffer(page)) {
      const image = add(stream('/Type /XObject /Subtype /Image /Width 1100 /Height 300 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', page));
      resources += ` /XObject << /Scan ${image} 0 R >>`;
      commands = 'q 500 0 0 136 50 550 cm /Scan Do Q';
    } else {
      const lines = String(page ?? '').split('\n');
      commands = 'BT /F1 12 Tf 50 740 Td 16 TL\n' + lines.map(line => `(${line.replace(/[\\()]/g, '\\$&')}) Tj T*`).join('\n') + '\nET';
    }
    const content = add(stream('', Buffer.from(commands)));
    ids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << ${resources} >> /Contents ${content} 0 R >>`));
  }
  objects[0] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>');
  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${ids.map(id => `${id} 0 R`).join(' ')}] /Count ${ids.length} >>`);
  // Valid unused stream exercises the file-size boundary without inflating text.
  if (minimumBytes) add(stream('', Buffer.alloc(minimumBytes, 32)));
  const chunks = [Buffer.from('%PDF-1.4\n')], offsets = [0]; let size = chunks[0].length;
  objects.forEach((object, i) => { offsets.push(size); const chunk = Buffer.concat([Buffer.from(`${i+1} 0 obj\n`), object, Buffer.from('\nendobj\n')]); chunks.push(chunk); size += chunk.length; });
  chunks.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n` + offsets.slice(1).map(n => `${String(n).padStart(10,'0')} 00000 n \n`).join('') + `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`));
  return Buffer.concat(chunks);
}
async function multiPageDocx(pages) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const escape = text => text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + pages.map((text,i) => `${i ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : ''}<w:p><w:r><w:t>${escape(text)}</w:t></w:r></w:p>`).join('') + '<w:sectPr/></w:body></w:document>');
  return zip.generateAsync({ type:'nodebuffer' });
}
module.exports = { multiPagePdf, multiPageDocx, imagePage };
