const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const { randomUUID } = require('node:crypto');
const { multiPagePdf, multiPageDocx, imagePage } = require('./fixtures/multiPageDocuments');
const { extractReadingMaterial } = require('../services/materialExtractionService');
const { extractTeacherMaterial } = require('../services/teacherMaterialExtraction');
const { MAX_MATERIAL_FILE_SIZE, validateMaterialFile } = require('../services/materialValidation');
const { MAX_MATERIAL_TEXT_LENGTH } = require('../services/materialTextLimits');
const { materialFinalizeBody } = require('../services/materialFinalizeBody');
const { createMaterialsRouter } = require('../routes/materials');
const { generateMaterialQuestionSet } = require('../services/materialQuestionSetService');
const { createDatabase, requester, TEACHER_A, TEACHER_B } = require('./fixtures/materialDatabase');
const { SupabaseAuthenticationError } = require('../services/supabaseAdmin');

async function fixture(t, bytes, extension, run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'readflow-multipage-'));
  t.after(() => fs.rm(directory, { recursive:true, force:true }));
  const filePath = path.join(directory, 'reading.'+extension); await fs.writeFile(filePath, bytes);
  return run(filePath);
}
for (const count of [1,3,5]) test(`text PDF extracts all ${count} pages once, in order, without generated markers`, async t => {
  const pages = Array.from({length:count}, (_,i) => `PAGE ${i+1} UNIQUE READING CONTENT`);
  const result = await fixture(t, multiPagePdf(pages), 'pdf', filePath => extractTeacherMaterial({filePath,fileType:'PDF',language:'en'}));
  assert.equal(result.extractedText,pages.join('\n\n')); assert.equal(result.pageCount,count); assert.deepEqual(result.pagesWithoutText,[]);
});
test('blank PDF page is reported without losing or duplicating adjacent page text', async t => {
  const result = await fixture(t,multiPagePdf(['FIRST PAGE',null,'THIRD PAGE']),'pdf',filePath=>extractReadingMaterial({filePath,fileType:'PDF'}));
  assert.equal(result.extractedText,'FIRST PAGE\n\nTHIRD PAGE'); assert.equal(result.pageCount,3); assert.deepEqual(result.pagesWithoutText,[2]);
});
test('scanned PDF is rejected instead of mistaking page markers for reading text', async t => {
  await fixture(t,multiPagePdf([imagePage('SCANNED READING'),imagePage('SECOND SCAN')]),'pdf',filePath => assert.rejects(
    extractTeacherMaterial({filePath,fileType:'PDF',language:'en'}), error => error.code==='EMPTY_EXTRACTED_TEXT' && /scanned images/.test(error.message)));
});
test('mixed scanned/text PDF identifies the page needing manual review', async t => {
  const result = await fixture(t,multiPagePdf(['FIRST PAGE',imagePage('SCANNED READING'),'LAST PAGE']),'pdf',filePath => extractReadingMaterial({filePath,fileType:'PDF'}));
  assert.equal(result.extractedText,'FIRST PAGE\n\nLAST PAGE'); assert.deepEqual(result.pagesWithoutText,[2]);
});
test('multi-page DOCX extracts every section in order without inventing physical page count', async t => {
  const pages = ['FIRST DOCX PAGE','SECOND DOCX PAGE','THIRD DOCX SECTION'];
  const result = await fixture(t,await multiPageDocx(pages),'docx',filePath=>extractTeacherMaterial({filePath,fileType:'DOCX',language:'en'}));
  assert.equal(result.extractedText,pages.join('\n\n')); assert.equal(result.pageCount,undefined);
});
test('near-25 MB PDF retains all pages and size validation still rejects oversized files', async t => {
  const bytes = multiPagePdf(['NEAR LIMIT FIRST','NEAR LIMIT LAST'],MAX_MATERIAL_FILE_SIZE-4096);
  assert.ok(bytes.length<MAX_MATERIAL_FILE_SIZE && bytes.length>MAX_MATERIAL_FILE_SIZE-8192);
  validateMaterialFile({originalname:'large.pdf',mimetype:'application/pdf',size:bytes.length});
  const result = await fixture(t,bytes,'pdf',filePath=>extractTeacherMaterial({filePath,fileType:'PDF',language:'en'}));
  assert.equal(result.extractedText,'NEAR LIMIT FIRST\n\nNEAR LIMIT LAST');
  assert.throws(()=>validateMaterialFile({originalname:'large.pdf',mimetype:'application/pdf',size:MAX_MATERIAL_FILE_SIZE+1}),{statusCode:413});
});
test('long DOCX is extracted in full; document storage ceiling rejects rather than truncates', async t => {
  const text = 'Complete reading text. '.repeat(6000)+'FINAL SENTENCE';
  const result = await fixture(t,await multiPageDocx([text]),'docx',filePath=>extractTeacherMaterial({filePath,fileType:'DOCX',language:'en'}));
  assert.equal(result.extractedText,text);
  await fixture(t,await multiPageDocx(['X'.repeat(MAX_MATERIAL_TEXT_LENGTH+1)]),'docx',filePath=>assert.rejects(
    extractTeacherMaterial({filePath,fileType:'DOCX',language:'en'}),{code:'MATERIAL_TEXT_TOO_LONG'}));
});
test('document timeout terminates parsing and returns a safe retry message', async t => {
  await fixture(t,multiPagePdf(['READING']),'pdf',filePath=>assert.rejects(extractTeacherMaterial({filePath,fileType:'PDF',language:'en'},{timeoutMs:1}),{code:'EXTRACTION_TIMEOUT'}));
});
test('upload, Teacher edit, long save, reopen, new session and question source preserve complete text', async t => {
  const db = createDatabase({profiles:[{id:TEACHER_A,role:'teacher',full_name:'Teacher'}]});
  const originalFrom = db.from.bind(db);
  db.from = table => {
    const query = originalFrom(table), originalInsert = query.insert.bind(query);
    query.insert = value => originalInsert(table==='uploaded_materials' ? {id:randomUUID(),created_at:new Date().toISOString(),...value} : value);
    const execute = query.execute.bind(query);
    query.execute = async () => {
      const result = await execute();
      if (query.action === "insert" && query.singleMode && Array.isArray(result.data)) result.data = result.data[0];
      return result;
    };
    return query;
  };
  const storage = new Map(); db.storage.from = () => ({info:async key=>({data:storage.get(key),error:null}),remove:async()=>({error:null})});
  let user = requester(TEACHER_A,'teacher');
  const app = express(); app.post('/api/materials/finalize',materialFinalizeBody); app.use(express.json());
  app.use('/api/materials',createMaterialsRouter({getSupabaseAdmin:()=>db,authorizeMaterialRequest:async()=>{if(!user)throw new SupabaseAuthenticationError();return user;}}));
  const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r)); t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}/api/materials`;
  const pages=['PAGE ONE COMPLETE','PAGE TWO COMPLETE','PAGE THREE COMPLETE'], bytes=multiPagePdf(pages);
  const form=new FormData();form.append('file',new Blob([bytes],{type:'application/pdf'}),'three.pdf');form.append('title','Three pages');form.append('language','en');
  const upload=await fetch(base+'/upload',{method:'POST',body:form}); assert.equal(upload.status,201);
  const {material}=await upload.json(); assert.equal(material.extractedText,pages.join('\n\n')); assert.equal(material.pageCount,3);
  const storagePath=`${TEACHER_A}/${randomUUID()}.pdf`; storage.set(storagePath,{size:bytes.length,contentType:'application/pdf'});
  const approved=material.extractedText.replace('TWO','TWO EDITED')+'\n\n'+'Long approved paragraph. '.repeat(6000)+'END OF FULL MATERIAL';
  const finalizeBody={temporaryMaterialId:material.id,storagePath,contentText:approved};
  // Client attempts beyond the explicit limit do not create any material.
  const oversized=await fetch(base+'/finalize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...finalizeBody,contentText:'X'.repeat(MAX_MATERIAL_TEXT_LENGTH+1)})});
  assert.equal(oversized.status,413); assert.equal(db.tables.uploaded_materials.length,0);
  const saved=await fetch(base+'/finalize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(finalizeBody)});
  assert.equal(saved.status,201); const id=(await saved.json()).material.id;
  assert.equal(db.tables.uploaded_materials[0].raw_extracted_text,pages.join('\n\n'));
  user=null; assert.equal((await fetch(base+'/'+id)).status,401);
  user=requester(TEACHER_A,'teacher');
  for(let i=0;i<3;i++) assert.equal((await (await fetch(base+'/'+id)).json()).material.contentText,approved);
  user=requester(TEACHER_B,'teacher'); assert.equal((await fetch(base+'/'+id)).status,403);
  user=requester(TEACHER_A,'teacher');
  await assert.rejects(generateMaterialQuestionSet(user,id,null,null,()=>{throw Error('Must not generate partial content');},{getSupabaseAdmin:()=>db}), error=>error.statusCode===413 && /too long to generate questions/.test(error.message));
  assert.equal(db.tables.uploaded_materials[0].content_text,approved);
  db.tables.uploaded_materials[0].content_text=pages.join('\n\n');
  const marker=new Error('Full source verified');
  await assert.rejects(generateMaterialQuestionSet(user,id,null,null,async input=>{assert.equal(input.contentText,pages.join('\n\n'));throw marker;},{getSupabaseAdmin:()=>db}),error=>error===marker);
});
test('finalize body parser returns JSON for oversized or malformed input', async t => {
  const app=express(); app.post('/finalize',materialFinalizeBody,(_req,res)=>res.json({success:true}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  for(const [body,status] of [['{',400],[JSON.stringify({text:'X'.repeat(8*1024*1024)}),413]]){
    const result=await fetch(`http://127.0.0.1:${server.address().port}/finalize`,{method:'POST',headers:{'Content-Type':'application/json'},body});
    assert.equal(result.status,status);const error=await result.json();assert.equal(error.success,false);assert.equal('stack' in error,false);
  }
});
test('Teacher rejects PDF over 5 pages before extracting text', async t => {
  // Blank pages make the page-limit error distinguishable from empty-text extraction.
  await fixture(t, multiPagePdf(Array(6).fill(null)), 'pdf', filePath => assert.rejects(
    extractTeacherMaterial({ filePath, fileType: 'PDF', language: 'en' }), {
      code: 'MATERIAL_PAGE_LIMIT',
      message: 'Reading materials are limited to 5 pages for this prototype.',
    }));
});
