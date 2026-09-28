'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { textHash } = require('./evidence-review');

/** 持久化推理请求凭证：同请求只执行一次，中断后的未知状态不自动重试。 */
async function runOnce({ directory, owner, requestId, params, execute }) {
  const filename = path.join(directory, textHash(owner + '\n' + requestId) + '.json');
  const requestHash = textHash(JSON.stringify(params));
  fs.mkdirSync(directory, { recursive: true });
  const record = { requestId, requestHash, status: 'running', startedAt: new Date().toISOString() };
  try { fs.writeFileSync(filename, JSON.stringify(record), { encoding: 'utf8', flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (existing.requestHash !== requestHash) throw Object.assign(new Error('请求标识与正文不一致'), { status: 409, code: 'request_conflict' });
    if (existing.status === 'completed') return existing.result;
    throw Object.assign(new Error('请求正在运行或结果未知，禁止自动重试'), { status: 409, code: 'request_in_progress_or_unknown' });
  }
  const persist = () => {
    const temporary = filename + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(record, null, 2), 'utf8');
    fs.renameSync(temporary, filename);
  };
  try {
    record.result = await execute();
    record.status = 'completed';
    record.finishedAt = new Date().toISOString();
    persist();
    return record.result;
  } catch (error) {
    record.status = 'failed_or_unknown';
    record.error = error && error.message || String(error);
    record.finishedAt = new Date().toISOString();
    persist();
    throw error;
  }
}

module.exports = { runOnce };
