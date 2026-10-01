import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');
const { JsonFileRepository } = require('../../lib/repositories/json-file-repository');
const INDEX = '__molan_lab_job_index_v1__';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const ownerScope = owner => `__molan_lab_owner_${hash(owner)}`;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const contentHash = value => hash(JSON.stringify(canonical(value)));
function identifier(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new Error('Invalid legacy identifier');
  return value;
}
function outputPath(value, allowDirectory = false) {
  const resolved = path.resolve(value);
  if (resolved.split(/[\\/]/).some(part => /^(?:books|raws|deploy_tmp|tmp-booktest)$/i.test(part))) {
    throw new Error('Refusing to write into a protected data directory');
  }
  if (fs.existsSync(resolved) && !(allowDirectory && fs.statSync(resolved).isDirectory())) throw new Error('Output already exists; refusing to overwrite: ' + resolved);
  return resolved;
}

/** Explicit, offline import. Inserts require revision zero and never overwrite votes. */
export async function migrateLabJobs(options) {
  if (!['reading', 'blind'].includes(options.kind)) throw new Error('--kind must be reading or blind');
  for (const key of ['source', 'backup', 'target', 'report']) if (!options[key]) throw new Error('--' + key + ' is required');
  const source = path.resolve(options.source);
  const backup = outputPath(options.backup);
  const target = outputPath(options.target, options.merge === true);
  const reportPath = outputPath(options.report);
  if (new Set([source, backup, target, reportPath]).size !== 4) throw new Error('Source and output paths must be distinct');
  for (const output of [backup, reportPath]) if (output.startsWith(target + path.sep)) throw new Error('Backup and report must be outside the new target');
  if (!fs.statSync(source).isFile()) throw new Error('Source must be an existing SQLite file');
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  const original = new DatabaseSync(source, { readOnly: true });
  try {
    const check = original.prepare('PRAGMA quick_check').get();
    if (check?.quick_check !== 'ok') throw new Error('Source integrity check failed');
    original.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  } finally { original.close(); }

  const snapshot = new DatabaseSync(backup, { readOnly: true });
  let jobs, votes;
  try {
    if (snapshot.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new Error('Backup integrity check failed');
    const table = options.kind === 'reading' ? 'reading_jobs' : 'jobs';
    const tables = snapshot.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name);
    const expectedTables = options.kind === 'reading' ? ['reading_jobs'] : ['jobs', 'reference_votes'];
    if (tables.length !== expectedTables.length || tables.some(name => !expectedTables.includes(name))) throw new Error('Unrecognized legacy schema; refusing a partial migration');
    jobs = snapshot.prepare(`SELECT id, owner, payload, updated FROM ${table} ORDER BY owner, id`).all().map(row => {
      identifier(row.id); identifier(row.owner);
      if (!Number.isSafeInteger(row.updated) || row.updated < 0) throw new Error('Invalid legacy timestamp');
      const payload = JSON.parse(row.payload);
      if (!payload || payload.id !== row.id || payload.owner !== row.owner) throw new Error('Job payload identity or ownership mismatch');
      if (options.kind === 'blind') {
        if (!Array.isArray(payload.cases) || !payload.votes || typeof payload.votes !== 'object' || Array.isArray(payload.votes)) throw new Error('Invalid blind cases/votes');
        const ids = payload.cases.map(item => identifier(item.id));
        if (new Set(ids).size !== ids.length || Object.keys(payload.votes).some(id => !ids.includes(id))) throw new Error('Blind vote has missing or duplicate case association');
      }
      return { id: row.id, owner: row.owner, payload, updated: row.updated };
    });
    votes = options.kind === 'blind'
      ? snapshot.prepare('SELECT owner, scene_id, scores, updated FROM reference_votes ORDER BY owner, scene_id').all().map(row => {
        identifier(row.owner); identifier(row.scene_id);
        const scores = JSON.parse(row.scores);
        if (!scores || typeof scores !== 'object' || Array.isArray(scores) || !Number.isSafeInteger(row.updated) || row.updated < 0) throw new Error('Invalid legacy reference vote');
        return { owner: row.owner, sceneId: row.scene_id, scores, updated: row.updated };
      }) : [];
  } finally { snapshot.close(); }

  const owners = [...new Set([...jobs.map(row => row.owner), ...votes.map(row => row.owner)])].sort();
  const report = { protocol: 'molan-lab-migration-v1', kind: options.kind, source, backup, target,
    backupHash: hash(fs.readFileSync(backup)), jobs: jobs.length, referenceVotes: votes.length,
    owners: owners.length, sourceContentHash: contentHash({ jobs, votes }), applied: false,
    checks: { integrity: true, ownership: true, voteAssociations: true, counts: null, contentHash: null },
    limitations: votes.length ? ['External corpus scene existence is not verified; reference scene IDs and votes are preserved unchanged.'] : [] };
  if (options.apply) {
    const repository = new JsonFileRepository(target);
    const existingRows = [];
    try {
      await repository.transaction([INDEX, ...owners.map(ownerScope)], tx => {
        for (const owner of owners) {
          const scope = ownerScope(owner);
          for (const row of tx.list(scope, 'generation')) existingRows.push({ scope, row });
          const existingOwner = tx.get(INDEX, 'generation', scope);
          if (existingOwner && (existingOwner.kind !== 'lab-owner-index' || existingOwner.owner !== owner)) throw new Error('Existing owner index conflicts with the source');
          if (!existingOwner) tx.put(INDEX, 'generation', { id: scope, kind: 'lab-owner-index', owner }, 0);
        }
        for (const row of jobs) tx.put(ownerScope(row.owner), 'generation', {
          id: `lab:${options.kind}:${row.id}`, kind: 'lab-job', owner: row.owner, jobKind: options.kind,
          jobId: row.id, payload: row.payload, updatedAt: row.updated
        }, 0);
        for (const row of votes) tx.put(ownerScope(row.owner), 'generation', {
          id: `reference:${row.sceneId}`, kind: 'lab-reference-vote', owner: row.owner,
          sceneId: row.sceneId, scores: row.scores, updatedAt: row.updated
        }, 0);
      });
    } finally { await repository.close(); }
    // Verify persisted data after closing and reopening, including all payload evidence.
    const reopened = new JsonFileRepository(target);
    try {
      const savedJobs = [], savedVotes = [];
      const importedJobIds = new Set(jobs.map(row => JSON.stringify([row.owner, row.id])));
      const importedVoteIds = new Set(votes.map(row => JSON.stringify([row.owner, row.sceneId])));
      for (const owner of owners) {
        const rows = await reopened.generation.list(ownerScope(owner));
        for (const row of rows) {
          if (row.kind === 'lab-job' && row.jobKind === options.kind && importedJobIds.has(JSON.stringify([row.owner, row.jobId]))) savedJobs.push({ id: row.jobId, owner: row.owner, payload: row.payload, updated: row.updatedAt });
          else if (row.kind === 'lab-reference-vote' && importedVoteIds.has(JSON.stringify([row.owner, row.sceneId]))) savedVotes.push({ owner: row.owner, sceneId: row.sceneId, scores: row.scores, updated: row.updatedAt });
        }
      }
      savedJobs.sort((a, b) => a.owner.localeCompare(b.owner) || a.id.localeCompare(b.id));
      savedVotes.sort((a, b) => a.owner.localeCompare(b.owner) || a.sceneId.localeCompare(b.sceneId));
      // Use the same ordering on both sides, independent of SQL collation.
      jobs.sort((a, b) => a.owner.localeCompare(b.owner) || a.id.localeCompare(b.id));
      votes.sort((a, b) => a.owner.localeCompare(b.owner) || a.sceneId.localeCompare(b.sceneId));
      report.sourceContentHash = contentHash({ jobs, votes });
      report.targetContentHash = contentHash({ jobs: savedJobs, votes: savedVotes });
      report.checks.counts = savedJobs.length === jobs.length && savedVotes.length === votes.length;
      report.checks.contentHash = report.sourceContentHash === report.targetContentHash;
      report.checks.existingRecordsPreserved = true;
      for (const entry of existingRows) {
        const current = await reopened.generation.get(entry.scope, entry.row.id);
        if (contentHash(current) !== contentHash(entry.row)) report.checks.existingRecordsPreserved = false;
      }
      if (!report.checks.counts || !report.checks.contentHash || !report.checks.existingRecordsPreserved) throw new Error('Persisted target reconciliation failed; preserve backup and target for review');
      report.applied = true;
    } finally { await reopened.close(); }
  }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  return report;
}

async function main() {
  const options = {};
  for (let index = 2; index < process.argv.length; index++) {
    const key = process.argv[index];
    if (key === '--apply') options.apply = true;
    else if (key === '--merge') options.merge = true;
    else if (['--kind', '--source', '--backup', '--target', '--report'].includes(key) && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) options[key.slice(2)] = process.argv[++index];
    else throw new Error('Unknown or incomplete argument: ' + key);
  }
  const report = await migrateLabJobs(options);
  process.stdout.write(JSON.stringify({ ok: true, applied: report.applied, jobs: report.jobs, referenceVotes: report.referenceVotes }) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(JSON.stringify({ ok: false, error: error.message }) + '\n'); process.exitCode = 1; });
}
