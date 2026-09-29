'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateQualityVector } = require('../lib/generation/content-engine');
const { validateGenerationAuditEvidence } = require('../lib/generation/audit-evidence');
const { auditTextStyle } = require('../lib/style-system');

test('P5: 每个 Quality Dimension 具备真实结构 (value, status, confidence, source, evidence)', () => {
  const text = `陈寻俯身检查断裂的青石板，指节擦过缝隙里的黑灰。
石门后方隐约传来重物拖曳的钝响，呼吸在冷冽的空气中凝成白雾。
“三叔，阵盘偏了半寸。”他低声开口，目光未曾移开分毫。
身后的老者没有应声，只是将腰间的铜符向怀里收了收。`;

  const quality = evaluateQualityVector(text, {
    genre: '玄幻',
    contract: {
      chapterGoal: '排查地宫暗道',
      causalDebt: [{ debtId: 'd1', promise: '修补阵盘' }],
      wordBudget: { targetChars: 200 }
    }
  });

  assert.equal(quality.passed, true);
  assert.ok(quality.qualityVector);

  const allowedStatuses = new Set(['NOT_MEASURED', 'ESTIMATED', 'MEASURED', 'JUDGED', 'HUMAN_REVIEWED']);

  for (const [dim, entry] of Object.entries(quality.qualityVector)) {
    assert.equal(typeof entry.value, 'number', `维度 ${dim} 缺少数值 value`);
    assert.ok(entry.value >= 0 && entry.value <= 1, `维度 ${dim} value 超出范围 [0, 1]`);
    assert.ok(allowedStatuses.has(entry.status), `维度 ${dim} status 非法: ${entry.status}`);
    assert.equal(typeof entry.confidence, 'number', `维度 ${dim} 缺少 confidence`);
    assert.equal(typeof entry.source, 'string', `维度 ${dim} 缺少 source`);
    assert.ok(Array.isArray(entry.evidence), `维度 ${dim} evidence 应为数组`);
    assert.ok(entry.evidence.length > 0, `维度 ${dim} 缺失测量依据证据链`);
  }

  // AI Flavor 必须独立为 ai_flavor_risk
  assert.ok(quality.ai_flavor_risk);
  assert.equal(typeof quality.ai_flavor_risk.score, 'number');
  assert.ok(['clean', 'warning', 'critical'].includes(quality.ai_flavor_risk.risk));
  assert.equal(quality.ai_flavor_risk.status, 'MEASURED');
  assert.equal(typeof quality.ai_flavor_risk.source, 'string');
});

test('P5: 无真实测量依据的维度标记为 NOT_MEASURED 且绝对不可通过质量门禁', () => {
  // 空文本无法测量语言
  const emptyQuality = evaluateQualityVector('', { genre: '都市' });
  assert.equal(emptyQuality.passed, false);
  assert.equal(emptyQuality.qualityVector.language.status, 'NOT_MEASURED');
  assert.equal(emptyQuality.qualityVector.language.evidence.length, 0);

  // 验证 audit-evidence 门禁精准拦截 NOT_MEASURED 维度
  const unmeasuredVector = {
    language: { value: 0.9, status: 'MEASURED', confidence: 0.9, source: 'test', evidence: ['字数合规'] },
    dialogue: { value: 0.9, status: 'NOT_MEASURED', confidence: 0, source: 'unmeasured', evidence: [] },
    logic: { value: 0.9, status: 'MEASURED', confidence: 0.9, source: 'test', evidence: ['逻辑连贯'] }
  };

  const gateResult = validateGenerationAuditEvidence({
    generationId: 'gen-test-not-measured',
    chapterNo: 1,
    content: '测试正文',
    contentHash: require('node:crypto').createHash('sha256').update('测试正文').digest('hex'),
    genre: '都市',
    result: {
      draft: '测试正文',
      outputHash: require('node:crypto').createHash('sha256').update('测试正文').digest('hex'),
      contract: { chapterNo: 1 },
      audit: { passed: true, issues: [] },
      semanticAudit: { passed: true, audit: { passed: true, issues: [] } },
      quality: { passed: true, qualityVector: unmeasuredVector }
    }
  });

  assert.equal(gateResult.ok, false);
  assert.equal(gateResult.code, 'CRITICAL_QUALITY_DIMENSION_NOT_MEASURED');
});

test('P5: style-system 不使用线性扣减，独立输出 5 大证据报告', () => {
  const sampleText = '冷孤绝拔出铁剑，向前迈出一步。雨水打湿了他的衣襟。';
  const result = auditTextStyle(sampleText);

  // 1. 独立第一级字段
  assert.ok(Array.isArray(result.hardViolations));
  assert.ok(result.styleMeasurements);
  assert.equal(typeof result.styleMeasurements.charCount, 'number');
  assert.ok(result.aiFlavorRisk);
  assert.ok(result.voiceConsistency);
  assert.equal(typeof result.voiceConsistency.passed, 'boolean');
  assert.ok(result.pacingEvidence);
  assert.equal(typeof result.pacingEvidence.passed, 'boolean');
});
