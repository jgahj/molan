import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { VERSION } = require('../lib/repositories/json-file-repository');
const { readConfig } = require('../lib/postgres-repository');

function collectNames(payload, names) {
  const add = value => { const name = String(value || '').trim(); if (name.length >= 2 && name.length <= 6) names.add(name); };
  if (!payload || typeof payload !== 'object') return;
  add(payload.name);
  for (const field of ['characters', 'characterLibrary']) {
    for (const character of Array.isArray(payload[field]) ? payload[field] : []) add(character?.name);
  }
}

/** Read-only optional anonymization dictionary; configured corrupt stores fail closed. */
export async function loadCharacterLibraryNames({ env = process.env, dataDir, Pool, onFallback = message => console.warn(message) } = {}) {
  const names = new Set();
  const pg = readConfig(env);
  if (pg.enabled) {
    const Constructor = Pool || require('pg').Pool;
    const pool = new Constructor(pg.config);
    try {
      const result = await pool.query("SELECT r.payload FROM luna.project_resources r JOIN luna.projects p ON p.id = r.project_id WHERE r.kind = 'character' AND r.deleted_at IS NULL AND p.status = 'active'");
      for (const row of result.rows) collectNames(row.payload, names);
    } finally { await pool.end(); }
    return names;
  }
  const directory = path.join(dataDir || env.MOLAN_DATA_DIR || path.resolve(import.meta.dirname, '../data'), 'app-json');
  let files;
  try { files = await fs.readdir(path.join(directory, 'novels')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    onFallback('Character-name dictionary: native repository absent; using corpus-only names.');
    return names;
  }
  try { await fs.access(path.join(directory, '.commit.json')); throw new Error('Native repository recovery required before reading names'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const filename of files.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
    const document = JSON.parse(await fs.readFile(path.join(directory, 'novels', filename), 'utf8'));
    if (document.schemaVersion !== VERSION || typeof document.scope !== 'string' || !document.domains ||
        createHash('sha256').update(document.scope).digest('hex') + '.json' !== filename) throw new Error(`Invalid native repository document: ${filename}`);
    for (const row of Object.values(document.domains.novels || {})) {
      if (row.deleted) continue;
      if (row.kind === 'resource' && row.resourceKind === 'character' || row.kind === 'creation-bible') collectNames(row.payload, names);
      if (row.kind === 'novel' && row.status === 'active') collectNames(row.state, names);
    }
  }
  return names;
}
