// The M2/M8 safety migration and its rollback preserve live M8 function bodies byte-for-byte (the live bodies contain
// CRLF; new code uses LF). Git must store them exactly as written: no line-ending conversion on commit or checkout.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const ROOT = resolve(__dirname, '../..');
const FILES = ['m2_m8_reassessment_safety_PROPOSED.sql', 'm2_m8_reassessment_safety_ROLLBACK_PROPOSED.sql']
  .map((f) => `supabase/proposed/${f}`);
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

test('M8-preserving SQL files are excluded from line-ending conversion', () => {
  for (const file of FILES) {
    assert.match(git('check-attr', 'text', '--', file), /: text: unset$/, file);
    assert.equal(git('hash-object', `--path=${file}`, file), git('hash-object', '--no-filters', file), `${file} would be rewritten on commit`);
  }
});

test('the preserved bodies still contain both CRLF (live M8 code) and LF (new code)', () => {
  for (const file of FILES) {
    const bytes = readFileSync(resolve(ROOT, file));
    const crlf = bytes.toString('latin1').split('\r\n').length - 1;
    const lf = bytes.toString('latin1').split('\n').length - 1 - crlf;
    assert.ok(crlf > 0 && lf > 0, `${file}: crlf=${crlf} lf=${lf}`);
  }
});
