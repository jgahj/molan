'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertJsonSource } = require('../lib/repositories/assert-json-source');

test('legacy binary and corrupt JSON are rejected without changing source bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-json-source-'));
  try {
    const filename = path.join(dir, 'legacy.db');
    for (const [bytes, code] of [
      [Buffer.from('SQLite format 3\0legacy data'), 'LEGACY_SQLITE_REQUIRES_MIGRATION'],
      [Buffer.from('{broken'), 'JSON_STORE_CORRUPT'],
      [Buffer.from('{"novels":{}}'), 'JSON_STORE_CORRUPT']
    ]) {
      fs.writeFileSync(filename, bytes);
      assert.throws(() => assertJsonSource(filename), { code });
      assert.deepEqual(fs.readFileSync(filename), bytes);
    }
    fs.writeFileSync(filename, JSON.stringify({ novels: { columns: ['id'], rows: [{ id: 'a' }] } }));
    assert.doesNotThrow(() => assertJsonSource(filename));
    assert.doesNotThrow(() => assertJsonSource(path.join(dir, 'missing.json')));
    assert.doesNotThrow(() => assertJsonSource(':memory:'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
