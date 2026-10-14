'use strict';

/**
 * ExperimentEngine 持久化韧性专项测试
 * 覆盖：失败计数指标、有界补写重试（Outbox）、成功写入后自动补写积压、
 *       队列容量上限与丢弃计数、快照刷盘失败计数。
 * 背景：实验数据即知识资产，写失败不得静默丢失。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ExperimentEngine } = require('../lib/composition/evaluation/experiment-engine');

const INVALID_PATH = process.platform === 'win32'
  ? 'Z:\\non_existent_drive_999\\forbidden\\synergy.jsonl'
  : '/root/forbidden/synergy.jsonl';

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'molan-exp-')), name);
}

test('追加写失败：计数指标 + dirty + 队列，不静默', () => {
  const engine = new ExperimentEngine({ persistencePath: INVALID_PATH });
  engine.appendSynergyRecord({ key: 'k1', observedLift: 0.1 });
  const metrics = engine.getPersistenceMetrics();
  assert.equal(metrics.attempts, 1);
  assert.equal(metrics.failures, 1);
  assert.equal(metrics.pending, 1);
  assert.equal(metrics.dirty, true);
  assert.equal(engine.getFailedRecords()[0].key, 'k1');
});

test('补写重试：磁盘恢复后积压记录落盘并清队', () => {
  const file = tmpFile('synergy.jsonl');
  const engine = new ExperimentEngine({ persistencePath: INVALID_PATH });
  engine.appendSynergyRecord({ key: 'k1', observedLift: 0.1 });
  engine.appendSynergyRecord({ key: 'k2', observedLift: 0.2 });
  assert.equal(engine.getPersistenceMetrics().pending, 2);

  // 模拟磁盘恢复：切到可用路径后补写
  engine.persistencePath = file;
  const recovered = engine.retryFailedRecords();
  assert.equal(recovered, 2);
  assert.equal(engine.getPersistenceMetrics().pending, 0);
  assert.equal(engine.getPersistenceMetrics().dirty, false);
  assert.equal(engine.getPersistenceMetrics().recovered, 2);

  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).key, 'k1');
  assert.equal(JSON.parse(lines[1]).key, 'k2');
});

test('写入成功后自动补写积压（有界 drain）', () => {
  const file = tmpFile('synergy.jsonl');
  const engine = new ExperimentEngine({ persistencePath: INVALID_PATH });
  engine.appendSynergyRecord({ key: 'queued', observedLift: 0.3 });
  assert.equal(engine.getPersistenceMetrics().pending, 1);

  engine.persistencePath = file;
  engine.appendSynergyRecord({ key: 'fresh', observedLift: 0.4 });
  assert.equal(engine.getPersistenceMetrics().pending, 0, '成功后应自动补写积压');
  assert.equal(engine.getPersistenceMetrics().recovered, 1);

  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.deepEqual(lines.map(l => JSON.parse(l).key), ['queued', 'fresh']);
});

test('队列容量上限：溢出丢弃最旧记录并计数', () => {
  const engine = new ExperimentEngine({ persistencePath: INVALID_PATH, failedRecordsMax: 3 });
  for (let i = 0; i < 5; i += 1) engine.appendSynergyRecord({ key: `k${i}`, observedLift: i });
  const metrics = engine.getPersistenceMetrics();
  assert.equal(metrics.pending, 3);
  assert.equal(metrics.dropped, 2);
  const keys = engine.getFailedRecords().map(r => r.key);
  assert.deepEqual(keys, ['k2', 'k3', 'k4'], '应保留最新记录，丢弃最旧');
});

test('补写仍失败时停止本轮并保留队列', () => {
  const engine = new ExperimentEngine({ persistencePath: INVALID_PATH });
  engine.appendSynergyRecord({ key: 'k1', observedLift: 0.1 });
  // persistencePath 仍为不可用路径：补写失败应保留记录
  const recovered = engine.retryFailedRecords();
  assert.equal(recovered, 0);
  assert.equal(engine.getPersistenceMetrics().pending, 1);
  assert.equal(engine.getPersistenceMetrics().retries, 1);
});

test('快照刷盘失败计入指标', () => {
  const engine = new ExperimentEngine({ persistencePath: INVALID_PATH });
  const written = engine.flushSynergyRecords();
  assert.equal(written, 0);
  const metrics = engine.getPersistenceMetrics();
  assert.equal(metrics.failures, 1);
  assert.equal(metrics.dirty, true);
});

test('recordCompatibilitySynergy 正常路径落盘且指标干净', async () => {
  const file = tmpFile('synergy.jsonl');
  const engine = new ExperimentEngine({ persistencePath: file });
  const result = await engine.recordCompatibilitySynergy({
    tuple: { genre: 'xuanhuan', style: 'compact', chapterGoal: 'escalate', focus: 'conflict', hook: 'reveal' },
    strategyId: 's1',
    observedLift: 0.12
  });
  assert.equal(result.persisted, true);
  const metrics = engine.getPersistenceMetrics();
  assert.equal(metrics.attempts, 1);
  assert.equal(metrics.failures, 0);
  assert.equal(metrics.pending, 0);
  assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 1);
});
