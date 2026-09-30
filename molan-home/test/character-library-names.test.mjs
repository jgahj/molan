import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadCharacterLibraryNames } from '../scripts/character-library-names.mjs';

test('optional names reader uses native JSON read-only and reports absent or corrupt data', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'molan-name-reader-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let fallbacks = 0;
  assert.equal((await loadCharacterLibraryNames({ env: {}, dataDir: dir, onFallback() { fallbacks++; } })).size, 0);
  assert.equal(fallbacks, 1);
  const folder = path.join(dir, 'app-json', 'novels');
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, createHash('sha256').update('n_test').digest('hex') + '.json');
  const contents = JSON.stringify({ schemaVersion: 'molan-json-repository-v1', scope: 'n_test', revision: 1,
    domains: { novels: { character: { kind: 'resource', resourceKind: 'character', payload: { name: 'Alice' } },
      removed: { kind: 'resource', resourceKind: 'character', deleted: true, payload: { name: 'Removed' } },
      bible: { kind: 'creation-bible', payload: { characters: [{ name: 'Bob' }, { name: 'Alice' }] } } } } });
  await fs.writeFile(file, contents);
  assert.deepEqual([...await loadCharacterLibraryNames({ env: {}, dataDir: dir })].sort(), ['Alice', 'Bob']);
  assert.equal(await fs.readFile(file, 'utf8'), contents);
  await fs.writeFile(file, '{broken');
  await assert.rejects(loadCharacterLibraryNames({ env: {}, dataDir: dir }), SyntaxError);
});

test('PG names query is asynchronous, read-only, deduplicated and closes on failure', async () => {
  let ended = 0;
  class Pool {
    async connect() { return this; }
    release() {}
    async query(sql, values) {
      if (sql === 'BEGIN READ ONLY' || sql === 'ROLLBACK') return {};
      if (sql.startsWith('SET LOCAL ROLE')) return {};
      if (sql.includes('set_config')) { assert.equal(values[0], 'app.user_id'); assert.match(values[1], /^[a-f0-9-]{36}$/); return {}; }
      assert.match(sql, /^SELECT /); assert.match(sql, /deleted_at IS NULL/); return { rows: [{ payload: { name: 'Alice' } }, { payload: { name: 'Alice' } }] };
    }
    async end() { ended++; }
  }
  const env = { MOLAN_DB_BACKEND: 'postgres', MOLAN_CHARACTER_DICTIONARY_USER_ID: 'dictionary-owner' };
  await assert.rejects(loadCharacterLibraryNames({ env: { MOLAN_DB_BACKEND: 'postgres' }, Pool }), /MOLAN_CHARACTER_DICTIONARY_USER_ID/);
  assert.deepEqual([...await loadCharacterLibraryNames({ env, Pool })], ['Alice']);
  class FailingPool extends Pool { async query() { throw new Error('PG unavailable'); } }
  await assert.rejects(loadCharacterLibraryNames({ env, Pool: FailingPool }), /PG unavailable/);
  assert.equal(ended, 2);
});
