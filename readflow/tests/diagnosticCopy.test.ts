import assert from "node:assert/strict";
import test from "node:test";
import { diagnosticCopy } from "../src/modules/module2/utils/diagnosticCopy.ts";
import { readFileSync } from "node:fs";

test("Filipino UI translates required labels and preserves technical classifications", () => {
 const labels = {"Reading Level":"Antas sa Pagbasa","Difficulty Level":"Antas ng Hirap",Easy:"Madali",Medium:"Katamtaman",Hard:"Mahirap","Oral Reading Score":"Iskor sa Pasalitang Pagbasa","Comprehension Score":"Iskor sa Pag-unawa","Reading Speed":"Bilis ng Pagbasa","Reading Levels":"Mga Antas sa Pagbasa","What does my reading level mean?":"Ano ang ibig sabihin ng antas ko sa pagbasa?",Reassessment:"Muling Pagtataya"};
 for(const [en,fil] of Object.entries(labels)) {assert.equal(diagnosticCopy("fil",en),fil);assert.equal(diagnosticCopy("en",en),en);}
 for(const label of ["Independent","Instructional","Frustration","Non-reader"]) assert.equal(diagnosticCopy("fil",label),label);
});

test("all recorder status messages have Filipino interface wording", () => {
 const recorder=readFileSync(new URL("../src/modules/module2/hooks/useAudioRecorder.ts",import.meta.url),"utf8");
 const blocks=Array.from(recorder.matchAll(/setMessage\(([\s\S]*?)\);/g),m=>m[1]).join("\n");
 const messages=Array.from(blocks.matchAll(/"([^"\n]+)"/g),m=>m[1]).filter(s=>s.includes(" "));
 assert.ok(messages.length>10);
 for(const message of messages) assert.notEqual(diagnosticCopy("fil",message),message,message);
});
