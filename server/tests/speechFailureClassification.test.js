const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const realSdk = require('microsoft-cognitiveservices-speech-sdk');
const { transcribeWav } = require('../services/azureSpeechService');
const { createDiagnosticAudioHandler } = require('../routes/diagnosticAudio');
const { createReadAloudAudioHandler } = require('../routes/readAloudAudio');
const ENV = { AZURE_SPEECH_KEY: 'a'.repeat(32), AZURE_SPEECH_REGION: 'southeastasia' };
function wav() {
 const b=Buffer.alloc(44+32000); b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);
 b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);
 b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(32000,40);
 for(let i=44;i<b.length;i+=2)b.writeInt16LE((i%100)*100-5000,i);
 return b;
}
function sdkFor(scenario, captured) {
 return { ...realSdk,
 SpeechConfig:{fromSubscription:()=>({setProperty(){}})},
 AudioInputStream:{createPushStream:()=>({write(pcm){captured.push(Buffer.from(pcm));},close(){}})},
 AudioConfig:{fromStreamInput:()=>({turnOff:async()=>{}})},
 SpeechRecognizer:class {
  static enableTelemetry(){}
  startContinuousRecognitionAsync(ok) {setImmediate(()=>{ok();
   for(const result of scenario.results??[])this.recognized?.(this,{result});
   if(scenario.cancel!==undefined)this.canceled?.(this,{reason:realSdk.CancellationReason.Error,errorCode:scenario.cancel,errorDetails:scenario.details});
   this.sessionStopped?.(this,{});
  });}
  close(ok){ok();}
 },
 NoMatchDetails:{fromResult:r=>({reason:r.noMatchReason})},
 };
}
const recognized={reason:realSdk.ResultReason.RecognizedSpeech,text:'Ana reads a book.'};
const noMatch={reason:realSdk.ResultReason.NoMatch,noMatchReason:realSdk.NoMatchReason.InitialSilenceTimeout,text:''};
const E=realSdk.CancellationErrorCode;
const scenarios=[
 ['recognized',{results:[recognized]},200,undefined],
 ['genuine silence',{results:[noMatch]},422,'NO_SPEECH'],
 ['speech not recognized',{results:[{...noMatch,noMatchReason:realSdk.NoMatchReason.NotRecognized}]},422,'NO_SPEECH'],
 ['empty session without NoMatch',{},502,'STT_PROVIDER_ERROR'],
 ['empty recognized result',{results:[{...recognized,text:'   '}]},502,'STT_PROVIDER_ERROR'],
 ['invalid local WAV',{invalid:true},422,'STT_INVALID_AUDIO'],
 ['bad request unknown',{cancel:E.BadRequestParameters,details:'Invalid recognition parameter; secret-detail'},503,'STT_BAD_REQUEST'],
 ['bad request ambiguous SDK message',{cancel:E.BadRequestParameters,details:'Invalid parameter or unsupported audio format in the request.'},503,'STT_BAD_REQUEST'],
 ['explicit invalid audio',{cancel:E.BadRequestParameters,details:'Invalid audio format. websocket error code: 1007'},422,'STT_INVALID_AUDIO'],
 ['authentication or region mismatch',{cancel:E.AuthenticationFailure,details:'secret-detail'},503,'STT_PERMISSION'],
 ['concurrent requests',{cancel:E.TooManyRequests},503,'STT_QUOTA'],
 ['documented quota enum',{cancel:E.Forbidden},503,'STT_QUOTA'],
 ['quota over websocket 1007',{cancel:E.BadRequestParameters,details:'Quota exceeded. Cid: secret-detail websocket error code: 1007'},503,'STT_QUOTA'],
 ['network interruption',{cancel:E.ConnectionFailure},502,'STT_PROVIDER_ERROR'],
 ['provider timeout',{cancel:E.ServiceTimeout},504,'STT_DEADLINE'],
 ['NoMatch followed by network failure',{results:[noMatch],cancel:E.ConnectionFailure},502,'STT_PROVIDER_ERROR'],
 ['partial speech followed by bad request',{results:[recognized],cancel:E.BadRequestParameters},503,'STT_BAD_REQUEST'],
];
for(const endpoint of ['M2','M5'])for(const [name,scenario,status,code] of scenarios){
 test(`${endpoint}: ${name}`,async()=>{
  const captured=[],logs=[];let receipts=0,removed=0;
  const handler=(endpoint==='M2'?createDiagnosticAudioHandler:createReadAloudAudioHandler)({
   transcribe:(file,locale,options)=>transcribeWav(file,locale,{...options,env:ENV,sdkFactory:()=>sdkFor(scenario,captured),readFile:async()=>scenario.invalid?Buffer.from('bad'):wav(),log:(...args)=>logs.push(args)}),
   remove:async()=>{removed++;},log:(...args)=>logs.push(args),timing(){},contextArchived:async()=>false,recordReceipt:async()=>{receipts++;},
  });
  const res=Object.assign(new EventEmitter(),{statusCode:200,locals:{},writableFinished:true,headers:{},set(k,v){this.headers[k]=v;return this;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}});
  await handler({body:{language:'en'},query:{},file:{path:'fixture.wav',size:wav().length,mimetype:'audio/wav'}},res);
  assert.equal(res.statusCode,status);assert.equal(res.body.code,code);assert.equal(removed,1);
  assert.equal(receipts,endpoint==='M5'&&status===200?1:0);
  assert.doesNotMatch(JSON.stringify({body:res.body,logs}),/secret-detail|Cid:/);
  if(!scenario.invalid)assert.deepEqual(captured,[wav().subarray(44)],'only exact PCM bytes, without header, reach Azure');
  if(status!==200)assert.equal(res.body.transcription,undefined,'no partial transcript or score on failure');
 });
}
test('same recording succeeds on explicit retry after a temporary failure',async()=>{
 const captured=[];let scenario={cancel:E.TooManyRequests};const audio=wav();
 const deps={env:ENV,readFile:async()=>audio,sdkFactory:()=>sdkFor(scenario,captured),log(){}};
 await assert.rejects(transcribeWav('same.wav','en-US',deps),e=>e.code==='STT_QUOTA');
 scenario={results:[recognized]};assert.equal((await transcribeWav('same.wav','en-US',deps)).text,recognized.text);
 assert.deepEqual(captured[0],captured[1]);assert.deepEqual(audio,wav());
});


test('empty transcription diagnostics distinguish explicit silence without leaking recordings or transcripts',async()=>{
 const logs=[];
 await assert.rejects(transcribeWav('fixture.wav','en-US',{env:ENV,sdkFactory:()=>sdkFor({results:[noMatch]},[]),readFile:async()=>wav(),log:(...args)=>logs.push(args)}),e=>e.code==='NO_SPEECH');
 assert.deepEqual(logs,[["Azure Speech empty transcription",{code:'NO_SPEECH',audioBytes:32044,durationSeconds:1,locale:'en-US',recognition:{phrases:0,unrecognized:0,silence:1,noise:0,firstPhraseOffsetMs:null,firstUnrecognizedOffsetMs:null}}]]);
});
