'use strict';
const { JsonFileRepository } = require('../repositories/json-file-repository');
const { canonicalJson, hashJson } = require('./replay-manifest');

/** 原生 JSON 评测结算仓储；幂等索引与记录在同一项目文件事务内提交。 */
function createJsonQualityLoopStore(directory) {
  const repository = new JsonFileRepository(directory);
  const scope = 'quality-loop';
  const required = value => {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError('评测标识与摘要必填');
    return value.trim();
  };
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  const publicRun = row => row && {
    runId: row.id, idempotencyKey: row.idempotencyKey, inputHash: row.inputHash,
    state: row.state, report: row.report, reportHash: row.reportHash,
    createdAt: row.createdAt, settledAt: row.settledAt
  };
  async function beginRun(input) {
    const runId = required(input.runId), idempotencyKey = required(input.idempotencyKey), inputHash = required(input.inputHash);
    return repository.transaction([scope], tx => {
      const existing = tx.list(scope, 'generation').find(row => row.idempotencyKey === idempotencyKey);
      if (existing) {
        if (existing.inputHash !== inputHash) fail('QUALITY_LOOP_IDEMPOTENCY_CONFLICT');
        return { run: publicRun(existing), created: false };
      }
      if (tx.get(scope, 'generation', runId)) fail('QUALITY_LOOP_IDEMPOTENCY_CONFLICT');
      const row = tx.put(scope, 'generation', {
        id: runId, idempotencyKey, inputHash, state: 'running', report: null,
        reportHash: '', createdAt: Number(input.createdAt) || Date.now(), settledAt: null
      }, 0);
      return { run: publicRun(row), created: true };
    });
  }
  async function settleRun(input) {
    const runId = required(input.runId), inputHash = required(input.inputHash);
    const report = JSON.parse(canonicalJson(input.report));
    const reportHash = hashJson(report);
    return repository.transaction([scope], tx => {
      const row = tx.get(scope, 'generation', runId);
      if (!row) fail('QUALITY_LOOP_RUN_NOT_FOUND');
      if (row.inputHash !== inputHash) fail('QUALITY_LOOP_INPUT_MISMATCH');
      if (row.state === 'settled') {
        if (row.reportHash !== reportHash) fail('QUALITY_LOOP_SETTLED_IMMUTABLE');
        return { run: publicRun(row), report: row.report, idempotent: true };
      }
      const updated = tx.put(scope, 'generation', {
        ...row, state: 'settled', report, reportHash, settledAt: Number(input.settledAt) || Date.now()
      }, row.revision);
      tx.put(scope, 'ledger', { id: runId, reportHash, inputHash, settledAt: updated.settledAt }, 0);
      return { run: publicRun(updated), report: updated.report, idempotent: false };
    });
  }
  async function getByIdempotencyKey(key) {
    const rows = await repository.generation.list(scope);
    return publicRun(rows.find(row => row.idempotencyKey === String(key)) || null);
  }
  return { beginRun, settleRun, getByIdempotencyKey, close: () => repository.close() };
}

module.exports = { createJsonQualityLoopStore };
