import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  anonymizeText,
  bucketFor,
  buildSourceRecord,
  inferArchetype,
  inferContext,
  inferHtl,
  parseArgs,
  parseFilename,
  qualityStatusForQuota,
  selectRuntimeSamples,
} from '../scripts/rebuild-character-material-from-original.mjs';

test('原始文件名解析会去掉编号和站点噪声并保留作者字段', () => {
  assert.deepEqual(parseFilename('21131-蛊真人【搜笔趣阁www.sobqg.com】.txt'), {
    title: '蛊真人',
    author: '未署名',
  });
  assert.deepEqual(parseFilename('人前禁欲，夜里沉溺 - 林某.txt'), {
    title: '人前禁欲，夜里沉溺',
    author: '林某',
  });
});

test('来源记录只绑定原始语料并生成可追溯的自动元数据', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-original-source-'));
  const filePath = path.join(root, '悬疑灵异', '雨城档案 - 林某.txt');
  const content = Array.from({ length: 3 }, (_, index) => `第${index + 1}章\n${'章节正文。'.repeat(3200)}`).join('\n');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  try {
    const source = buildSourceRecord(filePath, root, content, {}, 1);
    assert.equal(source.platform, '本地原本');
    assert.equal(source.sourceKind, 'original-local-corpus');
    assert.equal(source.sourceFilePath, '悬疑灵异/雨城档案 - 林某.txt');
    assert.equal(source.genreBucket, '悬疑');
    assert.equal(source.quality.eligibleForAdvancedAnalysis, true);
    assert.equal(source.completionStatus, 'completed');
    assert.equal(source.authorization.permissions.runtimeUseAllowed, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('题材桶优先使用配置映射，未知分类不会把已知题材降为 raw 桶', () => {
  const config = { sourceBucketMap: { 悬疑: '悬疑', 惊险: '悬疑' } };
  assert.equal(bucketFor('诸天无限', '悬疑', config), '悬疑');
  assert.equal(bucketFor('军事', '惊险', config), '悬疑');
  assert.equal(bucketFor('游戏', '游戏', config), 'raw/游戏');
});

test('质量报告状态会如实标记配额诊断缺口', () => {
  const passing = { hardFloorCells: [], perBookCapViolations: [], platformCoverage: { pass: true }, byArchetype: {} };
  const failing = { ...passing, hardFloorCells: [{ cellKey: '冷静理智型|悬疑' }] };
  assert.equal(qualityStatusForQuota(passing), 'auto-complete');
  assert.equal(qualityStatusForQuota(failing), 'auto-complete-with-diagnostics');
});

test('自动标签先保留可观察证据，再推断类型、情境和 Human Texture', () => {
  const text = '她移开视线，指尖在杯沿停了一下，才问：“你是不是早就知道？”';
  const context = inferContext(text, 'dialogue');
  const htl = inferHtl(text, 'dialogue', context);
  const archetype = inferArchetype('他核对证据后才抬头，冷静地问了一句。', 'dialogue', 'work-1');
  assert.ok(context.scene.includes('试探'));
  assert.equal(context.subtext, '试探');
  assert.ok(context.subtextEvidence.length > 0);
  assert.ok(htl.signals.includes('avoidance'));
  assert.ok(Object.values(htl.evidence).flat().length > 0);
  assert.equal(archetype.primaryArchetype, '冷静理智型');
});

test('匿名化移除作品与人物专名但保留可读的句子结构', () => {
  const result = anonymizeText('林某看着张三，先把雨伞靠到门边，才问他是不是已经到了。', {
    title: '雨城档案',
    author: '林某',
  });
  assert.equal(result.rawText.includes('张三'), true);
  assert.equal(result.safeText.includes('张三'), false);
  assert.equal(result.safeText.includes('林某'), false);
  assert.equal(result.residualTerms.length, 0);
  assert.match(result.safeText, /先把雨伞靠到门边/);
});

function runtimeRecord(id, text, workId = id) {
  return {
    source: {
      sourceWorkId: workId,
      canonicalWorkId: workId,
      platform: '本地原本',
      audience: '未指定',
      primaryGenre: '悬疑',
      rawGenres: ['悬疑'],
      genreBucket: '悬疑',
      author: '匿名作者',
      sourceFilePath: `${workId}.txt`,
    },
    person: { primaryArchetype: '冷静理智型' },
    sample: {
      id,
      rawText: text,
      safeText: text,
      dimension: 'dialogue',
      humanTextureSignals: ['pause'],
      scene: ['试探'],
      relationship: ['普通朋友'],
      emotionalState: ['紧张'],
      surfaceIntent: '确认对方态度',
    },
    quality: { grade: 'A', confidence: 0.9 },
  };
}

test('运行时选择器阻止连续十二字重合并保留合法样本', () => {
  const shared = '她把门锁检查了一遍才抬头看';
  const result = selectRuntimeSamples([
    runtimeRecord('first', `${shared}，才抬头看向走廊。`, 'work-1'),
    runtimeRecord('overlap', `备用记录写着：${shared}，随后退到墙边。`, 'work-2'),
    runtimeRecord('third', '他把纸页折好，放进口袋后才继续往前走。', 'work-3'),
  ], { cellMinChars: 1000, cellHardFloor: 1, perBookCellCapPct: 1 });
  assert.equal(result.samples.length, 2);
  assert.equal(result.rejected.some(item => item.id === 'overlap' && item.reason === 'twelve_character_overlap'), true);
  assert.equal(result.samples.every(item => item.text.length >= 12 && item.text.length <= 140), true);
});

test('重建参数支持显式发布新运行时索引', () => {
  assert.equal(parseArgs(['--publish-runtime']).publishRuntime, true);
  assert.equal(parseArgs(['--max-works', '10']).maxWorks, 10);
});
