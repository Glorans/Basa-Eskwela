// M2 uploads a long reading in ~25-second parts. A part with only silence or background noise (e.g. the pause after
// the learner finished) used to fail the whole diagnostic with NO_SPEECH (HTTP 422), and every retry re-sent the same
// silent part. Real speech service (mocked SDK, no Azure), real route, real receipts and real result verification.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const realSdk = require('microsoft-cognitiveservices-speech-sdk');
const { transcribeWav } = require('../services/azureSpeechService');
const { createDiagnosticAudioHandler } = require('../routes/diagnosticAudio');
const { createTranscriptReceiptService } = require('../services/diagnosticTranscriptReceipts');
const { verifyReading } = require('../services/diagnosticResultService');
const { DIAGNOSTIC_ASSESSMENTS, getDiagnosticAssessmentBinding } = require('../services/diagnosticAssessments');

const ENV = { AZURE_SPEECH_KEY: 'a'.repeat(32), AZURE_SPEECH_REGION: 'southeastasia' };
const USER = '00000000-0000-4000-8000-000000000001';
const RID = '00000000-0000-4000-8000-0000000000b1';
const assessment = DIAGNOSTIC_ASSESSMENTS.en;
const binding = getDiagnosticAssessmentBinding('en', assessment.id, assessment.version);
const receipts = createTranscriptReceiptService({ getSecret: () => 'k'.repeat(64) });

function wav() {
  const b = Buffer.alloc(44 + 32000); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(32000, 40);
  return b;
}
function sdkFor(results) {
  return { ...realSdk,
    SpeechConfig: { fromSubscription: () => ({ setProperty() {} }) },
    AudioInputStream: { createPushStream: () => ({ write() {}, close() {} }) },
    AudioConfig: { fromStreamInput: () => ({ turnOff: async () => {} }) },
    SpeechRecognizer: class {
      static enableTelemetry() {}
      startContinuousRecognitionAsync(ok) { setImmediate(() => { ok(); for (const result of results) this.recognized?.(this, { result }); this.sessionStopped?.(this, {}); }); }
      close(ok) { ok(); }
    },
    NoMatchDetails: { fromResult: r => ({ reason: r.noMatchReason }) },
  };
}
const speech = text => ({ reason: realSdk.ResultReason.RecognizedSpeech, text });
const noMatch = noMatchReason => ({ reason: realSdk.ResultReason.NoMatch, noMatchReason, text: '' });
const SILENCE = noMatch(realSdk.NoMatchReason.InitialSilenceTimeout);
const NOISE = noMatch(realSdk.NoMatchReason.InitialBabbleTimeout);
const UNRECOGNIZED = noMatch(realSdk.NoMatchReason.NotRecognized);

async function uploadPart(results, segmentIndex, { diagnostic = true } = {}) {
  const logs = [];
  const handler = createDiagnosticAudioHandler({
    transcribe: (file, locale) => transcribeWav(file, locale, { env: ENV, sdkFactory: () => sdkFor(results), readFile: async () => wav(), log: (...a) => logs.push(a) }),
    remove: async () => {}, receipts, log: (...a) => logs.push(a),
  });
  const res = Object.assign(new EventEmitter(), { statusCode: 200, locals: { speechRequester: { user: { id: USER } } },
    status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; }, set() { return this; } });
  const body = diagnostic ? { language: 'en', recordingId: RID, segmentIndex: String(segmentIndex), assessmentId: assessment.id, assessmentVersion: assessment.version } : { language: 'en' };
  await handler({ body, file: { path: 'part.wav', size: wav().length, mimetype: 'audio/wav' } }, res);
  return { status: res.statusCode, body: res.body, logs };
}
const verify = tokens => verifyReading({ tokens, userId: USER, language: 'en', binding, receiptService: receipts });

test('a silence-only or noise-only part of an M2 recording gets a signed empty receipt instead of failing the diagnostic', async () => {
  const first = await uploadPart([speech('The cat sat on the mat.')], 1);
  assert.equal(first.status, 200);
  for (const quiet of [[SILENCE], [NOISE], [SILENCE, NOISE]]) {
    const part = await uploadPart(quiet, 2);
    assert.equal(part.status, 200, JSON.stringify(part.body));
    assert.equal(part.body.transcription.text, '');
    assert.equal(part.body.transcription.noSpeech, true);
    assert.ok(part.body.transcription.receipt);
    assert.doesNotMatch(JSON.stringify(part.logs), /cat sat/, 'logs carry no transcript');
    // The whole reading is scored from the parts that had speech.
    const reading = verify([first.body.transcription.receipt, part.body.transcription.receipt]);
    assert.equal(reading.text, 'The cat sat on the mat.');
    assert.equal(reading.segments, 2, 'the silent part still counts toward the recording length bound');
  }
});

test('speech Azure heard but could not recognize is never dropped: that part still fails with NO_SPEECH', async () => {
  for (const results of [[UNRECOGNIZED], [SILENCE, UNRECOGNIZED]]) {
    const part = await uploadPart(results, 2);
    assert.equal(part.status, 422); assert.equal(part.body.code, 'NO_SPEECH'); assert.equal(part.body.transcription, undefined);
  }
});

test('a recording that is silent everywhere is still refused (no reading words), and nothing is scored', async () => {
  const one = await uploadPart([SILENCE], 1), two = await uploadPart([NOISE], 2);
  assert.equal(one.status, 200); assert.equal(two.status, 200);
  assert.throws(() => verify([one.body.transcription.receipt, two.body.transcription.receipt]), e => e.code === 'NO_SPEECH' && e.statusCode === 422);
});

test('only M2 diagnostic parts get this treatment; a request without a diagnostic part keeps NO_SPEECH', async () => {
  const plain = await uploadPart([SILENCE], 1, { diagnostic: false });
  assert.equal(plain.status, 422); assert.equal(plain.body.code, 'NO_SPEECH');
});

test('an empty receipt can only be issued for an uploaded part explicitly marked as having no speech', () => {
  const claims = { userId: USER, language: 'en', binding, recordingId: RID, segmentIndex: 1, source: 'upload', text: '' };
  assert.throws(() => receipts.issue(claims), /Invalid transcript receipt claims/);
  assert.throws(() => receipts.issue({ ...claims, source: 'stream', noSpeech: true }), /Invalid transcript receipt claims/);
  assert.equal(receipts.verify(receipts.issue({ ...claims, noSpeech: true })).ns, true);
});

test('an empty phrase between recognized phrases is skipped (original behaviour), not a failure', async () => {
  const part = await uploadPart([speech('The cat sat.'), speech('   '), speech('It was happy.')], 1);
  assert.equal(part.status, 200); assert.equal(part.body.transcription.text, 'The cat sat. It was happy.');
});

test('only the pause AFTER the reading may be silent: a silent part before speech (microphone dropout) is refused', async () => {
  const spoken = async (text, seg) => (await uploadPart([speech(text)], seg)).body.transcription.receipt;
  const quiet = async seg => (await uploadPart([SILENCE], seg)).body.transcription.receipt;
  const middle = [await spoken('The cat sat', 1), await quiet(2), await spoken('on the mat.', 3)];
  const leading = [await quiet(1), await spoken('The cat sat on the mat.', 2)];
  for (const tokens of [middle, leading]) {
    assert.throws(() => verify(tokens), e => e.code === 'NO_SPEECH' && e.statusCode === 422);
  }
  // Several trailing silent parts are still fine, and only the spoken words are scored.
  const trailing = verify([await spoken('The cat sat on the mat.', 1), await quiet(2), await quiet(3)]);
  assert.equal(trailing.text, 'The cat sat on the mat.');
});

test('silent receipts never change the scored transcript compared with the same reading without the pause', async () => {
  const withPause = verify([(await uploadPart([speech('The cat sat on the mat.')], 1)).body.transcription.receipt,
    (await uploadPart([NOISE], 2)).body.transcription.receipt]);
  const without = verify([(await uploadPart([speech('The cat sat on the mat.')], 1)).body.transcription.receipt]);
  assert.equal(withPause.text, without.text);
  assert.equal(withPause.confidence, without.confidence, 'an empty part adds no confidence value');
});
