import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProductionImportAudit } from '../scripts/production-import-audit.mjs';

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-storage-import-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    const filename = path.join(root, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content, 'utf8');
  }
  return root;
}

test('storage gate rejects SQL emulation even when the native SQLite driver is absent', t => {
  const root = fixture(t, {
    'server.js': "const { PureJsDatabase } = require('./lib/pure-js-database');",
    'services/runs.js': "export { store } from '../lib/generation/sqlite-store.js';",
    'routes/old.js': "const driver = require('node:sqlite');"
  });
  const result = runProductionImportAudit({ root });
  assert.equal(result.passed, false);
  assert.equal(result.violations.length, 3);
  assert.deepEqual(new Set(result.violations.map(item => item.file)), new Set(['server.js', 'services/runs.js', 'routes/old.js']));
});

test('storage gate accepts native repositories and ignores isolated migration tools', t => {
  const root = fixture(t, {
    'server.js': "const store = require('./lib/repositories/json-app-repository');",
    'lib/repositories/json-app-repository.js': "const fs = require('node:fs');",
    'scripts/sqlite-migration/export.mjs': "import { DatabaseSync } from 'node:sqlite';"
  });
  const result = runProductionImportAudit({ root });
  assert.equal(result.passed, true);
  assert.equal(result.productionFilesCount, 2);
});
