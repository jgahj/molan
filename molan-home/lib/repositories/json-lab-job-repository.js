'use strict';
const crypto = require('node:crypto');
const INDEX = '__molan_lab_job_index_v1__';
const KINDS = new Set(['reading', 'blind']);
const clone = value => structuredClone(value);
function fail(code, status = 409) { throw Object.assign(new Error(code), { code, status, statusCode: status }); }
function id(value) { if (typeof value !== 'string' || !value.trim() || value.length > 256) fail('INVALID_ID', 422); return value; }
function scope(owner) { return `__molan_lab_owner_${crypto.createHash('sha256').update(id(owner)).digest('hex')}`; }
function jobKey(kind, jobId) { if (!KINDS.has(kind)) fail('INVALID_JOB_KIND', 422); return `lab:${kind}:${id(jobId)}`; }
function publicRow(row) { return row ? { job: clone(row.payload), revision: row.revision } : null; }

/** Async owner-only jobs over the application's shared native JSON transaction. */
class JsonLabJobRepository {
  constructor(repository, options = {}) {
    if (!repository?.transaction) throw new TypeError('Shared JsonFileRepository is required');
    this.repository = repository;
    this.now = options.now || Date.now;
  }
  async init({ recover = true } = {}) { return recover ? this.recover() : { recovered: 0 }; }
  async load({ owner, kind, id: jobId }) {
    const row = await this.repository.generation.get(scope(owner), jobKey(kind, jobId));
    return row?.kind === 'lab-job' && row.owner === owner ? publicRow(row) : null;
  }
  async list({ owner, kind, limit = 40 }) {
    if (!KINDS.has(kind)) fail('INVALID_JOB_KIND', 422);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) fail('INVALID_LIMIT', 422);
    return (await this.repository.generation.list(scope(owner))).filter(row => row.kind === 'lab-job' && row.owner === owner && row.jobKind === kind)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).slice(0, limit).map(publicRow);
  }
  async save({ owner, kind, job, expectedRevision }) {
    if (!job || job.owner !== owner) fail('OWNER_MISMATCH', 403);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('VERSION_REQUIRED', 428);
    const recordId = jobKey(kind, job.id);
    const ownerScope = scope(owner);
    return this.repository.transaction([INDEX, ownerScope], tx => {
      const old = tx.get(ownerScope, 'generation', recordId);
      if (old && old.owner !== owner) fail('FORBIDDEN', 403);
      const payload = clone(job);
      // Votes are durable independent user input and cannot be overwritten by worker snapshots.
      if (old?.payload?.votes) {
        for (const [caseId, vote] of Object.entries(old.payload.votes)) {
          if (payload.votes?.[caseId] && JSON.stringify(payload.votes[caseId]) !== JSON.stringify(vote)) fail('VOTE_IMMUTABLE');
        }
        payload.votes = { ...payload.votes, ...old.payload.votes };
      }
      const saved = tx.put(ownerScope, 'generation', { id: recordId, kind: 'lab-job', owner, jobKind: kind,
        jobId: job.id, payload, updatedAt: this.now() }, expectedRevision);
      if (!tx.get(INDEX, 'generation', ownerScope)) tx.put(INDEX, 'generation', { id: ownerScope, kind: 'lab-owner-index', owner }, 0);
      return publicRow(saved);
    });
  }
  async vote({ owner, kind, id: jobId, caseId, vote, expectedRevision }) {
    id(caseId);
    const previous = await this.load({ owner, kind, id: jobId });
    if (!previous) fail('JOB_NOT_FOUND', 404);
    if (previous.job.votes?.[caseId]) fail('VOTE_IMMUTABLE');
    return this.save({ owner, kind, expectedRevision, job: { ...previous.job, votes: { ...previous.job.votes, [caseId]: clone(vote) } } });
  }
  async referenceVotes({ owner }) {
    return (await this.repository.generation.list(scope(owner))).filter(row => row.kind === 'lab-reference-vote').map(row => ({ sceneId: row.sceneId, scores: clone(row.scores) }));
  }
  async recordReferenceVote({ owner, sceneId, scores }) {
    const ownerScope = scope(owner);
    const recordId = `reference:${id(sceneId)}`;
    return this.repository.transaction([ownerScope], tx => {
      const old = tx.get(ownerScope, 'generation', recordId);
      if (old) fail('VOTE_IMMUTABLE');
      tx.put(ownerScope, 'generation', { id: recordId, kind: 'lab-reference-vote', owner, sceneId, scores: clone(scores), updatedAt: this.now() }, 0);
      return { ok: true };
    });
  }
  async recover() {
    const owners = (await this.repository.generation.list(INDEX)).filter(row => row.kind === 'lab-owner-index');
    let recovered = 0;
    for (const entry of owners) {
      const ownerScope = scope(entry.owner);
      await this.repository.transaction([ownerScope], tx => {
        for (const row of tx.list(ownerScope, 'generation')) {
          if (row.kind !== 'lab-job' || !['running', 'queued'].includes(row.payload.status)) continue;
          const job = clone(row.payload);
          const unresolved = (job.attempts || []).some(attempt => ['running', 'provider_started'].includes(attempt.status)) ||
            job.pendingProvider === true || Number(job.callCount || 0) > Object.keys(job.stages || {}).length;
          job.status = unresolved ? 'needs_review' : 'interrupted';
          job.error = unresolved ? 'Provider outcome or usage is unresolved; manual review required before resume.' : 'Service restarted; saved stages preserved.';
          for (const attempt of job.attempts || []) if (['running', 'provider_started'].includes(attempt.status)) {
            attempt.status = 'provider_unknown'; attempt.error = 'Service restarted while provider call was unresolved.';
          }
          tx.put(ownerScope, 'generation', { ...row, payload: job, updatedAt: this.now() }, row.revision);
          recovered++;
        }
      });
    }
    return { recovered };
  }
}
module.exports = { JsonLabJobRepository };
