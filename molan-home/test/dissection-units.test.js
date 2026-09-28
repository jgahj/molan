'use strict';
// 阶段0 回归测试：统一单元模型 / 无标题不丢 / 覆盖校验 / 聚合门禁 / validation 真实 / needs_review
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { __test } = require('../server');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// —— 单元模型：无标题长文本生成 segment，绝不按 0 章丢弃 ——
test('builds stable segment units for title-less text without dropping content', () => {
  const long = Array.from({ length: 400 }, (_, i) => '这是第 ' + i + ' 段内容。' + '他们继续赶路，天黑了又亮。'.repeat(30)).join('\n\n');
  const units = __test.buildDissectionUnits(long);
  assert.ok(units.length >= 5, '无标题文本应产出多个 segment 单元，实际 ' + units.length);
  assert.ok(units.every(u => u.unitType === 'segment'));
  assert.ok(units.every(u => /^segment-\d{4}$/.test(u.unitId)), 'unitId 需稳定且有序');
  // 偏移连续不重叠
  for (let i = 1; i < units.length; i += 1) {
    assert.ok(units[i].sourceStart >= units[i - 1].sourceEnd, '单元偏移应连续递增');
  }
  assert.ok(units[units.length - 1].sourceEnd <= long.length, '末单元不应越界');
});

// —— 单元模型：卷 + 章，chapter 挂到 volume 父节点 ——
test('builds volume + chapter hierarchy with stable parentId', () => {
  const text = '第一卷 风起\n\n第一章 少年\n\n他醒来。\n\n第二章 崛起\n\n他修炼。\n\n第三章 决战\n\n他获胜。';
  const units = __test.buildDissectionUnits(text);
  const volume = units.find(u => u.unitType === 'volume');
  const chapters = units.filter(u => u.unitType === 'chapter');
  assert.ok(volume, '应识别卷');
  assert.ok(chapters.length === 3, '应识别 3 章，实际 ' + chapters.length);
  assert.ok(chapters.every(c => c.parentId === volume.unitId), 'chapter 应挂到 volume 父节点');
  assert.ok(chapters.every(c => c.sourceStart >= volume.sourceEnd), 'chapter 应位于 volume 单元之后');
});

// —— 单元模型：preface（首章前的正文）不被丢弃 ——
test('keeps preface content before the first chapter heading', () => {
  const text = '楔子：传说。\n\n第一章 开始\n\n正文。';
  const units = __test.buildDissectionUnits(text);
  assert.ok(units.some(u => u.unitType === 'preface'), '首章前的 preface 应保留');
});

// —— 标题行区分 卷/章 ——
test('dissectionUnitHeader distinguishes volume from chapter', () => {
  assert.equal(__test.dissectionUnitHeader('第三卷 血与火').type, 'volume');
  assert.equal(__test.dissectionUnitHeader('第十二章 归来').type, 'chapter');
  assert.equal(__test.dissectionUnitHeader('Chapter 12 The Return').type, 'chapter');
  assert.equal(__test.dissectionUnitHeader('他走着走着'), null);
});

// —— 覆盖校验：模型漏返回单元时批次必须失败（不静默完成）——
test('batch coverage check fails the batch when units are missing', () => {
  assert.match(serverSource, /const missing = slice\.map\(u => u\.unitId\)\.filter\(id => !gotIds\.has\(id\)\)/);
  assert.match(serverSource, /模型漏返回/);
  assert.match(serverSource, /已标记失败待重试/);
});

// —— 聚合门禁：聚合空 / 缺结构 → 不标记完整成功 ——
test('aggregation gate: empty result must not mark the task completed', () => {
  assert.match(serverSource, /const aggregationMissingFields = aggregated \? pipelineAggregationMissingFields\(aggregated\) : \['aggregation'\]/);
  assert.match(serverSource, /const aggOk = !!aggregated && unitsComplete && batchesComplete && aggregationMissingFields\.length === 0/);
  assert.match(serverSource, /record\.status = terminalFailure \? 'failed' : \(needsReview \? 'needs_review' : 'completed'\)/);
  assert.match(serverSource, /validationStatus: conclusion, needsReview/);
});

// —— validation 不再硬编码 passed ——
test('validation conclusion is computed, not hardcoded passed', () => {
  assert.doesNotMatch(serverSource, /result\.validation = \{ conclusion: 'passed'/);
  assert.match(serverSource, /const missingFields = pipelineAggregationMissingFields\(result\)/);
  assert.match(serverSource, /const conclusion = incomplete \|\| failedBatchCount > 0 \|\| !facts\.length \|\| missingFields\.length \? 'needs_review' : 'passed'/);
});

// —— 完整性门禁字段 isComplete / needsReview ——
test('public record exposes isComplete and needsReview gates', () => {
  assert.match(serverSource, /const complete = record\.status === 'completed' && resultMissingFields\.length === 0/);
  assert.match(serverSource, /needsReview: record\.status === 'needs_review' \|\| \(record\.status === 'completed' && !complete\)/);
});

// —— retry 支持 needs_review（重跑失败批次）——
test('retry accepts needs_review and reruns failed batches only', () => {
  assert.match(serverSource, /\['failed', 'cancelled', 'interrupted', 'needs_review'\]/);
  assert.match(serverSource, /跳过已完成批次断点续跑/);
});

// —— 单元存储：chapter 兼容旧聚合表 + 全类型入 units ——
test('stores all unit types while keeping chapter compat rows', () => {
  assert.match(serverSource, /INSERT INTO dissection_units/);
  assert.match(serverSource, /if \(isPipelineFactUnit\(u\)\)/);
  assert.match(serverSource, /DELETE FROM dissection_claims WHERE dissection_id = \?/);
});

test('title-less deep tasks use fact units as the pipeline candidate', () => {
  assert.match(serverSource, /COUNT\(\*\) AS n FROM dissection_units/);
  assert.match(serverSource, /unit_type IN \('preface','chapter','scene','segment'\)/);
  assert.match(serverSource, /const pipelineCandidate = depth === 'deep' && chapterCount >= PIPELINE_MIN_CHAPTERS/);
});

test('coverage metadata rejects missing aggregate structure and preserves full arrays', () => {
  const covered = __test.attachPipelineCoverage([{ covered: true, status: 'ok' }, { covered: false, status: 'needs_review' }], 2);
  assert.equal(covered.coverage.complete, false);
  assert.equal(covered.coverage.completed, 1);
  assert.ok(__test.pipelineTextChunks('a'.repeat(1200), 1000).length >= 2);
  const missing = __test.pipelineAggregationMissingFields({ overview: {}, framework: {} });
  assert.ok(missing.includes('outline'));
  assert.ok(missing.includes('evidenceLedger'));
});

test('character behavior sampling keeps first, last, and evenly spaced evidence', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ chapter_no: i + 1 }));
  const sample = __test.samplePipelineCharacterAppearances(rows, 10);
  assert.equal(sample.length, 10);
  assert.equal(sample[0].chapter_no, 1);
  assert.equal(sample[sample.length - 1].chapter_no, 100);
  assert.ok(sample[1].chapter_no > 1 && sample[8].chapter_no < 100);
  assert.ok(sample.every((item, index) => index === 0 || item.chapter_no > sample[index - 1].chapter_no));
});

test('creative brief compaction preserves valid JSON instead of cutting serialized fields', () => {
  const text = __test.dissectionTransferJson({ beats: Array.from({ length: 100 }, (_, i) => ({ position: i, note: 'x'.repeat(200) })) }, 600);
  assert.doesNotThrow(() => JSON.parse(text));
  assert.ok(text.length <= 600 || text.includes('field exceeds transfer budget'));
});

test('pipeline retries clear a previously failed batch before completion', () => {
  assert.match(serverSource, /updateBatchStatus\(record, batch\.batch_no, 'completed', saved, ''\)/);
  assert.match(serverSource, /batch\.status = 'completed'/);
  // ★ 聚合门禁用「从 DB 重载」的批次状态判断失败批次，避免重试场景把已恢复批次误判为失败
  assert.match(serverSource, /const finalBatches = dbReady\(\) \? loadDissectionBatches\(record\.id\) : freshBatches;/);
  assert.match(serverSource, /const failedBatches = finalBatches\.filter\(b => b\.status === 'failed'\)/);
  assert.match(serverSource, /aggregationComplete: aggOk/);
});

test('pipeline usage is persisted by stage with exact token checks', () => {
  assert.match(serverSource, /recordPipelineUsage\(record, out\.usage, 'extract'\)/);
  assert.match(serverSource, /recordPipelineUsage\(record, out\.usage, 'aggregate'\)/);
  assert.match(serverSource, /stageUsage\[key\]/);
  assert.match(serverSource, /上游模型未返回精确 Token 用量/);
});

test('relationship state changes become relationship claims and dissection APIs enforce ownership', () => {
  assert.match(serverSource, /pushClaim\(isRelationship \? 'relationship' : 'state_change'/);
  assert.match(serverSource, /function handleDissectionUnitsPage/);
  assert.match(serverSource, /function handleDissectionEntitiesPage/);
  assert.match(serverSource, /function handleDissectionSearch/);
  assert.match(serverSource, /拆书任务不存在或无权访问/);
  assert.match(serverSource, /mention_count < \?/);
  assert.match(serverSource, /canonical_name > \?/);
});

// —— 事件类型归一化 ——
test('normalizes out-of-enum event types into conflict/upgrade buckets', () => {
  assert.equal(__test.normalizePipelineEventType('虐点'), '冲突');
  assert.equal(__test.normalizePipelineEventType('突破'), '升级');
  assert.equal(__test.normalizePipelineEventType('冲突'), '冲突');
  assert.equal(__test.normalizePipelineEventType(''), '日常');
});
