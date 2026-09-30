'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { VERSION } = require('../lib/repositories/json-file-repository');
const { readConfig, createPostgresRepository } = require('../lib/postgres-repository');

async function readLabJob({ owner, actorUserId, kind = 'reading', id, directory, env = process.env }) {
  if (typeof owner !== 'string' || !owner.trim() || owner.length > 256) throw new Error('Explicit lab owner is required');
  if (!['reading', 'blind'].includes(kind)) throw new Error('Invalid lab kind');
  if (readConfig(env).enabled) {
    const repository = createPostgresRepository(env);
    try {
      if (typeof repository.loadLabJob !== 'function') throw new Error('Native PostgreSQL lab migration is required');
      if (id) return (await repository.loadLabJob({ owner, actorUserId, kind, id }))?.job || null;
      return (await repository.listLabJobs({ owner, actorUserId, kind, limit: 1 }))[0]?.job || null;
    } finally { await repository.close(); }
  }
  const digest = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  const scope = `__molan_lab_owner_${digest(owner)}`;
  const journal = path.join(directory, '.commit.json');
  async function assertRecovered() {
    try { await fs.access(journal); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    throw new Error('Lab repository requires recovery before auditing');
  }
  await assertRecovered();
  const filename = path.join(directory, 'novels', digest(scope) + '.json');
  let document;
  try { document = JSON.parse(await fs.readFile(filename, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (document.schemaVersion !== VERSION || document.scope !== scope || !Number.isSafeInteger(document.revision) ||
      !document.domains || typeof document.domains.generation !== 'object' || Array.isArray(document.domains.generation)) {
    throw new Error('Invalid native lab repository document');
  }
  const records = Object.values(document.domains.generation).filter(row => row.kind === 'lab-job' && row.owner === owner &&
    row.jobKind === kind && row.payload?.owner === owner && row.payload?.id === row.jobId && (!id || row.jobId === id));
  records.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  await assertRecovered();
  return records[0]?.payload || null;
}
module.exports = { readLabJob };
