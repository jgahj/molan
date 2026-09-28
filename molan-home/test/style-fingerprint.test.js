'use strict';

// 风格指纹库单元测试：题材匹配（仙侠双向命中）、无匹配回退全局均值、
// 节奏目标指令块格式，以及数据缺失/损坏时的安静降级行为。

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const fingerprints = require('../lib/style-fingerprint.js');

// 题材匹配：请求“仙侠”应双向命中“仙侠”与“东方仙侠”两个桶，且画像字段齐全。
test('resolveFingerprintProfile matches xianxia buckets bidirectionally', () => {
  const resolved = fingerprints.resolveFingerprintProfile('仙侠');
  assert.ok(resolved, '应成功解析画像');
  assert.ok(resolved.matchedBucket.includes('仙侠'), 'matchedBucket 应包含“仙侠”');
  assert.ok(resolved.matchedBucket.includes('东方仙侠'), 'matchedBucket 应包含“东方仙侠”');
  assert.ok(resolved.bookCount > 0, '命中的题材应至少包含一本书');
  const profile = resolved.profile;
  for (const field of fingerprints._internals.PROFILE_FIELDS) {
    assert.ok(Number.isFinite(profile[field]), `字段 ${field} 应为有限数值`);
  }
  assert.ok(profile.sentenceLenMean > 10 && profile.sentenceLenMean < 60, '句长均值应落在合理区间');
  // 忽略空格：带空格的请求应得到同样结果。
  const spaced = fingerprints.resolveFingerprintProfile(' 仙侠 ');
  assert.equal(spaced.bookCount, resolved.bookCount);
  assert.deepEqual(spaced.profile, resolved.profile);
});

// 无匹配回退：查不到的题材应回退全局全部书均值，matchedBucket 为 null。
test('resolveFingerprintProfile falls back to the global baseline when nothing matches', () => {
  const resolved = fingerprints.resolveFingerprintProfile('量子力学不存在的题材');
  assert.ok(resolved, '回退也应成功解析画像');
  assert.equal(resolved.matchedBucket, null);
  const data = fingerprints.loadStyleFingerprints();
  assert.equal(resolved.bookCount, data.books.length);
  assert.ok(resolved.bookCount > 0, '全局回退应包含已有指纹书');
  assert.ok(Number.isFinite(resolved.profile.sentenceLenMean));
});

// 节奏目标指令块：非空、含前导换行、6-8 行、总字数小于 300。
test('buildRhythmTargetBlock emits a compact non-empty instruction block', () => {
  const block = fingerprints.buildRhythmTargetBlock('仙侠');
  assert.equal(typeof block, 'string');
  assert.ok(block.length > 0, '指令块非空');
  assert.equal(block.charAt(0), '\n', '应含前导换行');
  assert.match(block, /节奏目标/);
  assert.match(block, /句长均值约 \d+ 字/);
  assert.match(block, /对话占比约 \d+%/);
  assert.match(block, /每千字比喻词不超过/);
  assert.match(block, /不要机械凑数/);
  assert.ok(block.length < 300, `总字数应小于 300，实际 ${block.length}`);
  const lineCount = block.split('\n').filter(line => line.trim()).length;
  assert.ok(lineCount >= 6 && lineCount <= 8, `行数应为 6-8，实际 ${lineCount}`);
});

// 加载与缓存：正常数据缓存同一引用；缺失/损坏文件返回 null 且不抛错，指令块随之降级为空串。
test('loadStyleFingerprints caches payloads and degrades to null on missing or corrupt files', () => {
  const first = fingerprints.loadStyleFingerprints();
  assert.ok(first, '数据文件应加载成功');
  assert.equal(first.schemaVersion, 'style-fingerprints-1');
  assert.equal(first.bookCount, first.books.length);
  assert.ok(first.bookCount > 0, '指纹库应包含已有书目');
  assert.equal(fingerprints.loadStyleFingerprints(), first, '二次调用应命中缓存（同一引用）');

  const internals = fingerprints._internals;
  assert.ok(internals, '应暴露 _internals 便于测试');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-style-fp-'));
  try {
    // 场景一：文件缺失。
    internals.setFingerprintFilePath(path.join(tempDir, 'missing.json'));
    assert.equal(fingerprints.loadStyleFingerprints(), null, '缺失文件应返回 null');
    assert.equal(fingerprints.resolveFingerprintProfile('仙侠'), null);
    assert.equal(fingerprints.buildRhythmTargetBlock('仙侠'), '', '画像缺失时指令块应为空串');

    // 场景二：文件损坏（非法 JSON）。
    const corruptPath = path.join(tempDir, 'corrupt.json');
    fs.writeFileSync(corruptPath, '{ 不是合法 JSON', 'utf8');
    internals.setFingerprintFilePath(corruptPath);
    assert.equal(fingerprints.loadStyleFingerprints(), null, '损坏文件应返回 null 且不抛错');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    internals.setFingerprintFilePath(internals.DEFAULT_FINGERPRINT_FILE);
  }
  assert.ok(fingerprints.loadStyleFingerprints(), '恢复默认路径后应能重新加载');
});
