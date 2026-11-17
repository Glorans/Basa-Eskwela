// Grade 5 M2 reading scenarios, end to end on the real server code: the diagnostic audio route, the Azure speech
// service (SDK mocked, no Azure calls), signed per-part receipts, verifyReading and the approved scoring rubric.
// Each recording is split into ~25-second parts the way the browser uploads it. Comprehension is answered fully
// correctly so the reading level reflects word reading. Scoring formulas and Phil-IRI thresholds are not changed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const realSdk = require('microsoft-cognitiveservices-speech-sdk');
const { transcribeWav } = require('../services/azureSpeechService');
const { createDiagnosticAudioHandler } = require('../routes/diagnosticAudio');
const { createTranscriptReceiptService } = require('../services/diagnosticTranscriptReceipts');
const { verifyReading } = require('../services/diagnosticResultService');
const { scoreDiagnostic } = require('../services/diagnosticScoring');
const { DIAGNOSTIC_ASSESSMENTS, getDiagnosticAssessmentBinding, getDiagnosticPassageText } = require('../services/diagnosticAssessments');

const assessment = DIAGNOSTIC_ASSESSMENTS.en;
const passage = getDiagnosticPassageText(assessment);
const binding = getDiagnosticAssessmentBinding('en', assessment.id, assessment.version);
const USER = '00000000-0000-4000-8000-000000000001';
const receipts = createTranscriptReceiptService({ getSecret: () => 'k'.repeat(64) });
const ENV = { AZURE_SPEECH_KEY: 'a'.repeat(32), AZURE_SPEECH_REGION: 'southeastasia' };
const answers = Object.fromEntries(assessment.questions.map((question) => [question.id, question.correctChoiceId]));
const [P1, P2, P3] = assessment.paragraphs; // 10 + 20 + 30 = 60 words
const words = passage.split(/\s+/);

function wav() {
  const b = Buffer.alloc(44 + 32000); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(32000, 40);
  return b;
}
const sdkFor = (results) => ({ ...realSdk,
  SpeechConfig: { fromSubscription: () => ({ setProperty() {} }) },
  AudioInputStream: { createPushStream: () => ({ write() {}, close() {} }) },
  AudioConfig: { fromStreamInput: () => ({ turnOff: async () => {} }) },
  SpeechRecognizer: class {
    static enableTelemetry() {}
    startContinuousRecognitionAsync(ok) { setImmediate(() => { ok(); for (const result of results) this.recognized?.(this, { result }); this.sessionStopped?.(this, {}); }); }
    close(ok) { ok(); }
  },
  NoMatchDetails: { fromResult: (result) => ({ reason: result.noMatchReason }) },
});
const say = (text) => ({ reason: realSdk.ResultReason.RecognizedSpeech, text });
const noMatch = (reason) => ({ reason: realSdk.ResultReason.NoMatch, noMatchReason: reason, text: '' });
const SILENCE = noMatch(realSdk.NoMatchReason.InitialSilenceTimeout);
const NOISE = noMatch(realSdk.NoMatchReason.InitialBabbleTimeout);
const UNRECOGNIZED = noMatch(realSdk.NoMatchReason.NotRecognized);
const CORRUPT = Symbol('corrupt');
const SKIPPED = Symbol('never submitted');

let recordings = 0;
async function upload(recordingId, segmentIndex, results) {
  const file = results === CORRUPT ? Buffer.from('this is not a wav file') : wav();
  const handler = createDiagnosticAudioHandler({
    receipts, log() {}, remove: async () => {},
    transcribe: (path, locale) => transcribeWav(path, locale, { env: ENV, sdkFactory: () => sdkFor(results === CORRUPT ? [] : results), readFile: async () => file, log() {} }),
  });
  const res = Object.assign(new EventEmitter(), { statusCode: 200, locals: { speechRequester: { user: { id: USER } } },
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, set() { return this; } });
  await handler({ body: { language: 'en', recordingId, segmentIndex: String(segmentIndex), assessmentId: assessment.id, assessmentVersion: assessment.version },
    file: { path: 'part.wav', size: file.length, mimetype: 'audio/wav' } }, res);
  return res;
}

/** Uploads every part, then verifies and scores the reading. Returns the refusal or the score. */
async function read(parts) {
  const recordingId = `00000000-0000-4000-8000-${String(++recordings).padStart(12, '0')}`;
  const tokens = [];
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index] === SKIPPED) continue;
    const res = await upload(recordingId, index + 1, parts[index]);
    if (res.statusCode !== 200) return { refused: 'upload', status: res.statusCode, code: res.body.code, part: index + 1 };
    tokens.push(res.body.transcription.receipt);
  }
  let reading;
  try { reading = verifyReading({ tokens, userId: USER, language: 'en', binding, receiptService: receipts }); }
  catch (error) { return { refused: 'result', status: error.statusCode, code: error.code }; }
  const score = scoreDiagnostic({ assessment, passageText: passage, transcript: reading.text, recordingDurationSeconds: parts.length * 25, answers });
  const { correctWords, omissions, substitutions, insertions } = score.oralReadingMetrics;
  return { text: reading.text, orv: Number(score.orvScore.toFixed(2)), level: score.readingLevel, correctWords, omissions, substitutions, insertions };
}
const accepted = (result) => { assert.equal(result.refused, undefined, JSON.stringify(result)); return result; };

test('fixture: the Grade 5 English passage has 60 words (10 + 20 + 30)', () => {
  assert.deepEqual([P1, P2, P3].map((paragraph) => paragraph.split(/\s+/).length), [10, 20, 30]);
  assert.equal(words.length, 60);
});

test('1. complete passage without pauses: 60/60 words, 100%, Independent', async () => {
  const result = accepted(await read([[say(P1), say(P2)], [say(P3)]]));
  assert.deepEqual([result.correctWords, result.omissions, result.orv, result.level], [60, 0, 100, 'Independent']);
});

test('2-4. long pauses never change the word-reading score; speech before and after every pause is kept', async () => {
  const baseline = accepted(await read([[say(P1), say(P2)], [say(P3)]]));
  const scenarios = {
    '2. 10-second pause (inside one part)': [[say(P1), say(P2)], [say(P3)]],
    '3a. 30-second pause across two parts': [[say(P1)], [SILENCE, say(P2)], [say(P3)]],
    '3b. 30-second pause filling a whole part': [[say(P1)], [SILENCE], [say(P2), say(P3)]],
    '4. several long pauses (silence and background noise)': [[say(P1)], [SILENCE], [say(P2)], [SILENCE, NOISE], [NOISE], [say(P3)]],
    '4b. a long wait before starting': [[SILENCE], [say(P1), say(P2), say(P3)]],
  };
  for (const [name, parts] of Object.entries(scenarios)) {
    const result = accepted(await read(parts));
    for (const key of ['text', 'orv', 'level', 'correctWords', 'omissions', 'substitutions', 'insertions']) {
      assert.deepEqual(result[key], baseline[key], `${name}: ${key}`);
    }
  }
});

test('5. complete passage followed by silence: 100%, the silence adds nothing', async () => {
  const result = accepted(await read([[say(P1), say(P2)], [say(P3)], [SILENCE]]));
  assert.deepEqual([result.correctWords, result.omissions, result.orv, result.level], [60, 0, 100, 'Independent']);
});

test('6-7. incomplete readings follow the existing omission rule; trailing silence is never treated as completion', async () => {
  // Exactly half the passage: 30 words read, 30 unread words counted as omissions -> 30/60 = 50%.
  const half = accepted(await read([[say(words.slice(0, 30).join(' '))], [SILENCE]]));
  assert.deepEqual([half.correctWords, half.omissions, half.substitutions, half.insertions, half.orv, half.level], [30, 30, 0, 0, 50, 'Frustration']);
  // First sentence only: 10 read, 50 omitted -> 10/60 = 16.67%.
  const first = accepted(await read([[say(P1)], [SILENCE]]));
  assert.deepEqual([first.correctWords, first.omissions, first.orv, first.level], [10, 50, 16.67, 'Frustration']);
  // A third of the passage (the earlier "half" fixture): 20 read, 40 omitted -> 33.33%.
  const third = accepted(await read([[say(`${P1} ${P2.split(' ').slice(0, 10).join(' ')}`)], [SILENCE]]));
  assert.deepEqual([third.correctWords, third.omissions, third.orv], [20, 40, 33.33]);
});

test('8. skipped and mispronounced words are miscues under the existing rubric', async () => {
  const result = accepted(await read([
    [say(P1.replace('school ', '')), say(P2.replace('tomato', 'tomahto').replace('afternoon', 'after'))],
    [say(P3.replace(' careful', ''))],
  ]));
  // 2 omissions (school, careful) + 2 substitutions (tomahto, after) = 4 miscues -> 56/60 = 93.33%, Instructional (< 97).
  assert.deepEqual([result.correctWords, result.omissions, result.substitutions, result.insertions, result.orv, result.level],
    [56, 2, 2, 0, 93.33, 'Instructional']);
});

test('9. a muted microphone cannot be told apart from a pause: the lost words are omissions (lower, never higher)', async () => {
  // A disconnected microphone is caught in the browser (m5ContinuousRecording.test.ts); a muted one still sends silence.
  const result = accepted(await read([[say(P1)], [SILENCE], [say(P3)]]));
  assert.deepEqual([result.correctWords, result.omissions, result.orv, result.level], [40, 20, 66.67, 'Frustration']);
});

test('10. missing, corrupted or borrowed parts are never accepted as silence', async () => {
  assert.deepEqual(await read([[say(P1)], CORRUPT, [say(P3)]]), { refused: 'upload', status: 422, code: 'STT_INVALID_AUDIO', part: 2 });
  assert.deepEqual(await read([[say(P1)], SKIPPED, [say(`${P2} ${P3}`)]]), { refused: 'result', status: 422, code: 'READING_NOT_VERIFIED' });
  // A silent part's receipt from ANOTHER recording cannot fill a gap.
  const otherSilent = (await upload('00000000-0000-4000-8000-0000000000ff', 2, [SILENCE])).body.transcription.receipt;
  const recordingId = '00000000-0000-4000-8000-0000000000fe';
  const tokens = [(await upload(recordingId, 1, [say(P1)])).body.transcription.receipt, otherSilent,
    (await upload(recordingId, 3, [say(P3)])).body.transcription.receipt];
  assert.throws(() => verifyReading({ tokens, userId: USER, language: 'en', binding, receiptService: receipts }), (error) => error.code === 'READING_NOT_VERIFIED');
  // Another learner cannot use this learner's silent receipt.
  const own = (await upload('00000000-0000-4000-8000-0000000000fd', 1, [SILENCE])).body.transcription.receipt;
  assert.throws(() => verifyReading({ tokens: [own], userId: '00000000-0000-4000-8000-000000000002', language: 'en', binding, receiptService: receipts }),
    (error) => error.code === 'READING_NOT_VERIFIED');
});

test('11. a completely silent recording is refused and nothing is scored', async () => {
  assert.deepEqual(await read([[SILENCE], [NOISE], [SILENCE]]), { refused: 'result', status: 422, code: 'NO_SPEECH' });
});

test('extra: a whole part of speech Azure cannot recognize still asks for a new recording (unchanged)', async () => {
  assert.deepEqual(await read([[say(P1)], [UNRECOGNIZED], [say(P3)]]), { refused: 'upload', status: 422, code: 'NO_SPEECH', part: 2 });
});
