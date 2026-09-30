'use strict';

const crypto = require('node:crypto');
const { hashJson } = require('../evolution/replay-manifest');
const { accessFrom } = require('./json-app-repository');
const { canAccess, WRITE_ROLES } = require('../project-scope');
const INDEX = '__molan_dissections_v1__';
const clone = value => structuredClone(value);
const fail = (code, status = 409) => { throw Object.assign(new Error(code), { code, status, statusCode: status }); };
const key = (kind, id) => `dissection:${kind}:${id}`;
const scopeOf = job => job.projectId || INDEX;
const validKey = value => typeof value === 'string' && value.trim() && value.length <= 256;

/** Jobs, stages and immutable usage use the app's existing JSON transaction queue. */
class JsonDissectionRepository {
  constructor(repository, options = {}) {
    if (!repository?.transaction || !repository?.novels) throw new TypeError('shared JsonFileRepository required');
    this.repository = repository;
    this.inputService = options.inputService;
    this.resultService = options.resultService;
    this.phases = options.phases || [];
    this.now = options.now || Date.now;
    this.backend = 'json';
  }
  actor(tx, actorUserId) {
    const actor = tx.get(null, 'accounts', `account:${actorUserId}`);
    if (!actor || actor.kind !== 'account' || actor.deleted || actor.disabled || actor.status === 'disabled') fail('UNAUTHENTICATED', 401);
    return actor;
  }
  access(tx, job, actorUserId, write = false) {
    const actor = this.actor(tx, actorUserId);
    if (!job || job.deleted) fail('DISSECTION_NOT_FOUND', 404);
    if (job.projectId) {
      const access = accessFrom(tx.get(job.projectId, 'novels', job.projectId), actorUserId);
      if (!access || write && !canAccess(access, WRITE_ROLES)) fail('FORBIDDEN', 403);
    } else if (job.ownerUserId !== actor.userId && actor.role !== 'admin') fail('FORBIDDEN', 403);
    return actor;
  }
  async transact(input, write, action) {
    const index = await this.repository.novels.get(INDEX, key('index', input.jobId));
    if (!index || index.deleted) fail('DISSECTION_NOT_FOUND', 404);
    return this.repository.transaction([null, INDEX, index.scope], tx => {
      const job = tx.get(index.scope, 'novels', key('job', input.jobId));
      this.access(tx, job, input.actorUserId, write);
      return action(tx, job, index.scope);
    });
  }
  publicJob(job) { const out = clone(job); delete out.lease; out.id = job.jobId; return out; }
  fence(job, input) {
    if (!job.lease || job.lease.token !== input.leaseToken || job.lease.fence !== input.fence ||
        job.lease.expiresAt <= this.now() || job.lease.actorUserId !== input.actorUserId || job.cancelRequested || job.status !== 'running') fail('LEASE_FENCE_REJECTED');
  }
  revision(input) { if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('EXPECTED_REVISION_REQUIRED', 422); }
  providerUnresolved(tx, scope, jobId) {
    return tx.list(scope, 'generation').some(row => row.kind === 'provider-attempt' && row.jobId === jobId && ['inflight', 'unknown'].includes(row.status));
  }
  async create(input) {
    if (!validKey(input.requestId) || typeof input.sourceText !== 'string' || !input.sourceText.trim()) fail('INVALID_DISSECTION_INPUT', 422);
    if (!this.inputService?.cleanDissectionText || !this.inputService?.buildDissectionUnits) fail('DISSECTION_NORMALIZER_REQUIRED', 503);
    const sourceText = this.inputService.cleanDissectionText(input.sourceText);
    if (!sourceText) fail('INVALID_DISSECTION_INPUT', 422);
    const units = this.inputService.buildDissectionUnits(sourceText);
    if (!Array.isArray(units) || !units.length || new Set(units.map(unit => unit.unitId)).size !== units.length) fail('INVALID_DISSECTION_UNITS', 422);
    const body = { sourceText, title: String(input.title || '').slice(0, 200), selectedModel: String(input.selectedModel || ''),
      projectId: input.projectId || '', depth: input.depth || 'standard', purpose: input.purpose || 'new-writer', versions: input.versions || {} };
    const requestHash = hashJson(body);
    const jobId = input.id || `d_${crypto.randomUUID().replace(/-/g, '')}`;
    if (!/^d_[A-Za-z0-9_-]{1,80}$/.test(jobId)) fail('INVALID_DISSECTION_ID', 422);
    const scope = body.projectId || INDEX;
    return this.repository.transaction([null, INDEX, scope], tx => {
      const actor = this.actor(tx, input.actorUserId);
      const receiptId = key('create', `${actor.userId}:${input.requestId}`);
      const receipt = tx.get(INDEX, 'ledger', receiptId);
      if (receipt) {
        if (receipt.requestHash !== requestHash) fail('IDEMPOTENCY_CONFLICT');
        const old = tx.get(scope, 'novels', key('job', receipt.jobId));
        this.access(tx, old, actor.userId);
        return this.publicJob(old);
      }
      if (tx.get(INDEX, 'novels', key('index', jobId))) fail('DISSECTION_EXISTS');
      const now = this.now();
      const candidate = { ...body, id: key('job', jobId), jobId, kind: 'dissection-job', ownerUserId: actor.userId,
        userId: actor.userId, userEmail: actor.email, sourceHash: hashJson(sourceText), status: 'queued', phase: 'queued', phaseIndex: 0,
        progress: 0, actualCredits: 0, estimatedCredits: 0, result: {}, meta: {}, error: '', cancelRequested: false,
        unitTotal: units.length, unitCompleted: 0, leaseFence: 0, createdAt: now, updatedAt: now };
      this.access(tx, candidate, actor.userId, true);
      const saved = tx.put(scope, 'novels', candidate, 0);
      for (const unit of units) tx.put(scope, 'generation', { ...clone(unit), id: key('unit', `${jobId}:${unit.unitId}`), kind: 'dissection-unit', jobId, createdAt: now }, 0);
      tx.put(INDEX, 'novels', { id: key('index', jobId), kind: 'dissection-index', scope, jobId }, 0);
      tx.put(INDEX, 'ledger', { id: receiptId, kind: 'dissection-create', jobId, requestHash, actorUserId: actor.userId, createdAt: now }, 0);
      return this.publicJob(saved);
    });
  }
  get(input) { return this.transact(input, false, (tx, job) => this.publicJob(job)); }
  async update(input) {
    this.revision(input);
    const patch = input.patch || {};
    const allowed = ['title', 'purpose', 'depth', 'selectedModel'];
    if (Object.keys(patch).some(field => !allowed.includes(field)) || Object.values(patch).some(value => typeof value !== 'string')) fail('INVALID_DISSECTION_PATCH', 422);
    return this.transact(input, true, (tx, job, scope) => {
      if (job.lease?.expiresAt > this.now() || job.status === 'completed') fail('DISSECTION_NOT_EDITABLE');
      return this.publicJob(tx.put(scope, 'novels', { ...job, ...clone(patch), updatedAt: this.now() }, input.expectedRevision));
    });
  }
  async list({ actorUserId }) {
    const indices = await this.repository.novels.list(INDEX);
    const result = [];
    for (const index of indices.filter(row => row.kind === 'dissection-index' && !row.deleted)) {
      try { result.push(await this.get({ actorUserId, jobId: index.jobId })); }
      catch (error) { if (!['FORBIDDEN', 'DISSECTION_NOT_FOUND'].includes(error.code)) throw error; }
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async listUnits(input) {
    const cursor = Number(input.cursor || 0), limit = Number(input.limit || 50);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) fail('INVALID_PAGE', 422);
    return this.transact(input, false, (tx, job, scope) => {
      const rows = tx.list(scope, 'generation').filter(row => row.kind === 'dissection-unit' && row.jobId === job.jobId && row.ordinal > cursor).sort((a, b) => a.ordinal - b.ordinal);
      const items = rows.slice(0, limit).map(row => ({ ...row, id: row.unitId }));
      return { items, next: rows.length > limit ? items.at(-1).ordinal : '' };
    });
  }
  async acquireLease(input) {
    if (!validKey(input.workerId) || !Number.isSafeInteger(input.leaseMs) || input.leaseMs < 1 || input.leaseMs > 300000) fail('INVALID_LEASE', 422);
    return this.transact(input, true, (tx, job, scope) => {
      if (!['queued', 'running', 'failed'].includes(job.status) || job.cancelRequested) fail('DISSECTION_NOT_RUNNABLE');
      if (this.providerUnresolved(tx, scope, job.jobId)) fail('PROVIDER_ATTEMPT_UNKNOWN');
      if (job.lease?.expiresAt > this.now()) fail('LEASE_HELD');
      const lease = { token: crypto.randomUUID(), workerId: input.workerId, actorUserId: input.actorUserId, fence: job.leaseFence + 1, expiresAt: this.now() + input.leaseMs };
      const saved = tx.put(scope, 'novels', { ...job, status: 'running', lease, leaseFence: lease.fence, updatedAt: this.now() }, job.revision);
      return { ...lease, leaseToken: lease.token, revision: saved.revision };
    });
  }
  async renewLease(input) {
    if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs < 1 || input.leaseMs > 300000) fail('INVALID_LEASE', 422);
    return this.transact(input, true, (tx, job, scope) => {
      this.fence(job, input);
      const lease = { ...job.lease, expiresAt: this.now() + input.leaseMs };
      const saved = tx.put(scope, 'novels', { ...job, lease, updatedAt: this.now() }, job.revision);
      return { ...lease, leaseToken: lease.token, revision: saved.revision };
    });
  }
  async releaseLease(input) {
    return this.transact(input, true, (tx, job, scope) => {
      this.fence(job, input);
      const unresolved = this.providerUnresolved(tx, scope, job.jobId);
      return this.publicJob(tx.put(scope, 'novels', { ...job, lease: null, status: unresolved ? 'needs_review' : 'queued', error: unresolved ? 'provider_attempt_unknown' : job.error, updatedAt: this.now() }, job.revision));
    });
  }
  async failRun(input) {
    this.revision(input);
    return this.transact(input, true, (tx, job, scope) => {
      this.fence(job, input);
      return this.publicJob(tx.put(scope, 'novels', { ...job, status: this.providerUnresolved(tx, scope, job.jobId) ? 'needs_review' : 'failed', error: String(input.error || 'worker_failed').slice(0, 1000), lease: null, updatedAt: this.now() }, input.expectedRevision));
    });
  }
  async appendStageRun(input) {
    this.revision(input);
    if (!validKey(input.requestId) || !this.phases.includes(input.stageId)) fail('INVALID_STAGE', 422);
    if (!this.resultService?.normalizeDissectionStageResult || !this.resultService?.mergeDissectionResult || !this.resultService?.dissectionStageMissingFields) fail('DISSECTION_RESULT_NORMALIZER_REQUIRED', 503);
    return this.transact(input, true, (tx, job, scope) => {
      this.fence(job, input);
      if (this.providerUnresolved(tx, scope, job.jobId)) fail('PROVIDER_ATTEMPT_UNKNOWN');
      const stageId = key('stage', `${job.jobId}:${input.requestId}`);
      const old = tx.get(scope, 'ledger', stageId);
      const result = this.resultService.normalizeDissectionStageResult(input.result);
      if (!result || typeof result !== 'object' || Array.isArray(result)) fail('DISSECTION_STAGE_INVALID', 422);
      const contentHash = hashJson({ stageId: input.stageId, result });
      if (old) { if (old.contentHash !== contentHash) fail('IDEMPOTENCY_CONFLICT'); return this.publicJob(job); }
      if (this.resultService.dissectionStageMissingFields(input.stageId, result).length) fail('DISSECTION_STAGE_INCOMPLETE', 422);
      const merged = this.resultService.mergeDissectionResult(job.result, result);
      const done = new Set(tx.list(scope, 'ledger').filter(row => row.kind === 'dissection-stage' && row.jobId === job.jobId).map(row => row.stageId));
      done.add(input.stageId);
      const saved = tx.put(scope, 'novels', { ...job, result: merged, phase: input.stageId, phaseIndex: this.phases.indexOf(input.stageId), progress: Math.floor(done.size * 100 / this.phases.length), updatedAt: this.now() }, input.expectedRevision);
      tx.put(scope, 'ledger', { id: stageId, kind: 'dissection-stage', jobId: job.jobId, stageId: input.stageId, result, contentHash,
        fence: input.fence, actorUserId: input.actorUserId, createdAt: this.now() }, 0);
      return this.publicJob(saved);
    });
  }
  async recordCost(input) {
    if (!validKey(input.requestId) || !validKey(input.model) || !validKey(input.currency) || !Number.isFinite(input.amount) || input.amount < 0 ||
        !Number.isSafeInteger(input.usage?.prompt_tokens) || input.usage.prompt_tokens < 0 || !Number.isSafeInteger(input.usage?.completion_tokens) || input.usage.completion_tokens < 0) fail('INVALID_DISSECTION_COST', 422);
    return this.transact(input, true, (tx, job, scope) => {
      const attemptId = key('provider-attempt', `${job.jobId}:${input.requestId}`);
      const attempt = tx.get(scope, 'generation', attemptId);
      if (!attempt || attempt.actorUserId !== input.actorUserId || attempt.tokenHash !== hashJson(input.attemptToken || '') ||
          attempt.requestHash !== input.requestHash || attempt.model !== input.model) fail('PROVIDER_ATTEMPT_REQUIRED');
      const receipt = tx.get(scope, 'ledger', key('provider-receipt', `${job.jobId}:${input.requestId}`));
      if (!receipt || receipt.status !== 'completed' || hashJson(receipt.receipt.usage) !== hashJson(input.usage)) fail('PROVIDER_USAGE_UNVERIFIED');
      const id = key('cost', `${job.jobId}:${input.requestId}`);
      const payload = { requestId: input.requestId, model: input.model, usage: clone(input.usage), amount: input.amount, currency: input.currency };
      const contentHash = hashJson(payload), old = tx.get(scope, 'ledger', id);
      if (old) { if (old.contentHash !== contentHash) fail('IDEMPOTENCY_CONFLICT'); return old; }
      if (job.costCurrency && job.costCurrency !== input.currency) fail('COST_CURRENCY_MISMATCH');
      const saved = tx.put(scope, 'ledger', { ...payload, id, kind: 'dissection-cost', jobId: job.jobId, actorUserId: input.actorUserId,
        contentHash, fence: input.fence, createdAt: this.now() }, 0);
      tx.put(scope, 'novels', { ...job, recordedCost: (job.recordedCost || 0) + input.amount, costCurrency: input.currency, updatedAt: this.now() }, job.revision);
      return saved;
    });
  }
  async beginProvider(input) {
    if (!validKey(input.requestId) || !validKey(input.model) || !/^[a-f0-9]{64}$/.test(input.requestHash || '')) fail('INVALID_PROVIDER_ATTEMPT', 422);
    return this.transact(input, true, (tx, job, scope) => {
      this.fence(job, input);
      const id = key('provider-attempt', `${job.jobId}:${input.requestId}`);
      const old = tx.get(scope, 'generation', id);
      if (old) {
        if (old.requestHash !== input.requestHash || old.model !== input.model) fail('IDEMPOTENCY_CONFLICT');
        const receipt = tx.get(scope, 'ledger', key('provider-receipt', `${job.jobId}:${input.requestId}`));
        if (receipt?.status === 'completed') return { alreadyCompleted: true, receipt: clone(receipt) };
        fail('PROVIDER_ATTEMPT_UNKNOWN');
      }
      if (this.providerUnresolved(tx, scope, job.jobId)) fail('PROVIDER_ATTEMPT_UNKNOWN');
      const attemptToken = crypto.randomUUID();
      const attempt = { id, kind: 'provider-attempt', jobId: job.jobId, requestId: input.requestId, requestHash: input.requestHash, tokenHash: hashJson(attemptToken),
        model: input.model, status: 'inflight', actorUserId: input.actorUserId, fence: input.fence, createdAt: this.now(), updatedAt: this.now() };
      tx.put(scope, 'generation', attempt, 0);
      tx.put(scope, 'ledger', { ...attempt, id: key('provider-boundary', `${job.jobId}:${input.requestId}`), kind: 'provider-boundary' }, 0);
      return { requestId: input.requestId, requestHash: input.requestHash, attemptToken, alreadyCompleted: false };
    });
  }
  async endProvider(input) {
    if (!validKey(input.requestId) || !/^[a-f0-9]{64}$/.test(input.requestHash || '') || !input.receipt || typeof input.receipt !== 'object') fail('INVALID_PROVIDER_RECEIPT', 422);
    return this.transact(input, true, (tx, job, scope) => {
      const id = key('provider-attempt', `${job.jobId}:${input.requestId}`);
      const attempt = tx.get(scope, 'generation', id);
      if (!attempt || attempt.actorUserId !== input.actorUserId || attempt.requestHash !== input.requestHash || attempt.tokenHash !== hashJson(input.attemptToken || '')) fail('PROVIDER_ATTEMPT_REQUIRED');
      const receipt = clone(input.receipt);
      const receiptId = key('provider-receipt', `${job.jobId}:${input.requestId}`);
      const previous = tx.get(scope, 'ledger', receiptId);
      if (previous) {
        if (hashJson(previous.receipt) !== hashJson(receipt)) fail('IDEMPOTENCY_CONFLICT');
        return previous;
      }
      const usageKnown = Number.isSafeInteger(receipt.usage?.prompt_tokens) && receipt.usage.prompt_tokens >= 0 && Number.isSafeInteger(receipt.usage?.completion_tokens) && receipt.usage.completion_tokens >= 0;
      const status = receipt.status === 'succeeded' && usageKnown ? 'completed' : 'unknown';
      const saved = tx.put(scope, 'ledger', { id: receiptId, kind: 'provider-receipt', jobId: job.jobId, requestId: input.requestId,
        requestHash: input.requestHash, model: attempt.model, actorUserId: input.actorUserId, status, receipt, createdAt: this.now() }, 0);
      tx.put(scope, 'generation', { ...attempt, status, updatedAt: this.now() }, attempt.revision);
      if (status === 'unknown' && !job.cancelRequested) tx.put(scope, 'novels', { ...job, status: 'needs_review', error: 'provider_usage_or_result_unknown', lease: null, updatedAt: this.now() }, job.revision);
      return saved;
    });
  }
  async complete(input) {
    this.revision(input);
    return this.transact(input, true, (tx, job, scope) => {
      this.fence(job, input);
      if (this.providerUnresolved(tx, scope, job.jobId)) fail('PROVIDER_ATTEMPT_UNKNOWN');
      if (!this.phases.length || this.phases.some(stageId => !tx.list(scope, 'ledger').some(row => row.kind === 'dissection-stage' && row.jobId === job.jobId && row.stageId === stageId))) fail('DISSECTION_INCOMPLETE');
      return this.publicJob(tx.put(scope, 'novels', { ...job, status: 'completed', phase: 'completed', progress: 100, lease: null, updatedAt: this.now() }, input.expectedRevision));
    });
  }
  async cancel(input) {
    this.revision(input);
    return this.transact(input, true, (tx, job, scope) => this.publicJob(tx.put(scope, 'novels', { ...job, cancelRequested: true, status: 'cancelled', lease: null, updatedAt: this.now() }, input.expectedRevision)));
  }
  async delete(input) {
    this.revision(input);
    return this.transact(input, true, (tx, job, scope) => {
      const actor = this.actor(tx, input.actorUserId);
      if (job.ownerUserId !== actor.userId && actor.role !== 'admin') fail('FORBIDDEN', 403);
      if (this.providerUnresolved(tx, scope, job.jobId)) fail('PROVIDER_ATTEMPT_UNKNOWN');
      if (job.lease?.expiresAt > this.now()) fail('LEASE_HELD');
      tx.remove(scope, 'novels', job.id, input.expectedRevision);
      const index = tx.get(INDEX, 'novels', key('index', job.jobId));
      if (index) tx.remove(INDEX, 'novels', index.id, index.revision);
      return { deleted: true };
    });
  }
  listHistory(input) { return this.transact(input, false, (tx, job, scope) => tx.list(scope, 'ledger').filter(row => row.jobId === job.jobId)); }
  async listStages(input) { return (await this.listHistory(input)).filter(row => row.kind === 'dissection-stage'); }
  async listCosts(input) { return (await this.listHistory(input)).filter(row => row.kind === 'dissection-cost'); }
  async recoverExpiredLeases({ actorUserId }) {
    const jobs = await this.list({ actorUserId });
    let recovered = 0;
    for (const job of jobs) {
      recovered += await this.transact({ actorUserId, jobId: job.id }, true, (tx, current, scope) => {
        if (current.status !== 'running' || !current.lease || current.lease.expiresAt > this.now()) return 0;
        const inflight = tx.list(scope, 'generation').some(row => row.kind === 'provider-attempt' && row.jobId === current.jobId && ['inflight', 'unknown'].includes(row.status));
        tx.put(scope, 'novels', { ...current, status: inflight ? 'needs_review' : 'queued', lease: null, error: inflight ? 'provider_attempt_unknown' : current.error, updatedAt: this.now() }, current.revision);
        return 1;
      });
    }
    return { recovered };
  }
}

module.exports = { JsonDissectionRepository, DISSECTION_INDEX_SCOPE: INDEX };
