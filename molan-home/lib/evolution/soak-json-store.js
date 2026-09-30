'use strict';
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { JsonFileRepository } = require('../repositories/json-file-repository');

/** 本地单实例长篇任务仓储；租约与 fencing 检查在同一原子事务中执行。 */
function createJsonSoakStore(directory, options = {}) {
  const repository = new JsonFileRepository(directory);
  const leaseMs = Math.max(1000, Number(options.leaseMs) || 30000);
  const renewMs = Math.min(leaseMs - 1, Math.max(250, Number(options.renewMs) || Math.floor(leaseMs / 3)));
  const acquireTimeoutMs = Math.max(0, Number(options.acquireTimeoutMs) || 0);
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  const mutate = (id, action) => repository.transaction([String(id)], tx => {
    const key = String(id);
    const row = tx.get(key, 'generation', key) || { id: key, state: null, leaseOwner: '', leaseUntil: 0, fencingToken: 0 };
    const result = action(row);
    tx.put(key, 'generation', row);
    return result;
  });
  const valid = (row, lease) => row.leaseOwner === lease.leaseOwner &&
    row.fencingToken === Number(lease.fencingToken) && row.leaseUntil > Date.now();

  async function load(taskId) {
    const row = await repository.generation.get(String(taskId), String(taskId));
    return row ? row.state : null;
  }

  async function save(taskId, state, lease = {}) {
    const serialized = JSON.stringify(state);
    if (serialized === undefined) throw new TypeError('Soak 状态必须是可序列化 JSON');
    return mutate(taskId, row => {
      if (!valid(row, lease)) fail('SOAK_LEASE_LOST');
      row.state = JSON.parse(serialized);
      row.updatedAt = Date.now();
    });
  }

  async function withLease(taskId, work, leaseOptions = {}) {
    if (typeof work !== 'function') throw new TypeError('Soak lease callback 必须是函数');
    const owner = randomUUID();
    const deadline = Date.now() + acquireTimeoutMs;
    let token;
    while (token === undefined) {
      if (leaseOptions.signal?.aborted) fail('ABORT_ERR');
      token = await mutate(taskId, row => {
        const now = Date.now();
        if (row.leaseOwner && row.leaseUntil > now) return undefined;
        row.leaseOwner = owner;
        row.leaseUntil = now + leaseMs;
        row.fencingToken++;
        return row.fencingToken;
      });
      if (token !== undefined) break;
      if (Date.now() >= deadline) fail('SOAK_LEASE_HELD');
      await delay(Math.min(100, Math.max(1, deadline - Date.now())), undefined, { signal: leaseOptions.signal });
    }
    const controller = new AbortController();
    const signal = leaseOptions.signal ? AbortSignal.any([leaseOptions.signal, controller.signal]) : controller.signal;
    const lease = { fencingToken: String(token), leaseOwner: owner, signal };
    let lost = false;
    let renewing = Promise.resolve();
    const timer = setInterval(() => {
      renewing = renewing.then(() => mutate(taskId, row => {
        if (!valid(row, lease)) fail('SOAK_LEASE_LOST');
        row.leaseUntil = Date.now() + leaseMs;
      })).catch(() => { lost = true; controller.abort(); });
    }, renewMs);
    timer.unref?.();
    try {
      const result = await work(lease);
      await renewing;
      if (lost) fail('SOAK_LEASE_LOST');
      if (signal.aborted) fail('ABORT_ERR');
      await mutate(taskId, row => { if (!valid(row, lease)) fail('SOAK_LEASE_LOST'); });
      return result;
    } finally {
      clearInterval(timer);
      await renewing;
      await mutate(taskId, row => {
        if (row.leaseOwner === owner && row.fencingToken === token) {
          row.leaseOwner = '';
          row.leaseUntil = 0;
        }
      });
    }
  }
  return { load, save, withLease, close: () => repository.close() };
}

module.exports = { createJsonSoakStore };
