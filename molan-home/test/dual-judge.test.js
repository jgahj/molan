'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateDualJudgeConsensus, MAX_ALLOWED_DISCREPANCY_DELTA } = require('../lib/quality/dual-judge');
const { evaluateQualityGate } = require('../lib/generation/quality-gate');

test('P1 Quality - Dual Judge flags discrepancy when score delta > 0.18', () => {
  const judgeA = {
    passed: true,
    score: 0.85,
    qualityVector: {
      language: { score: 0.88, source: 'judge_a', evidence: '描写生动细腻' },
      character: { score: 0.82, source: 'judge_a', evidence: '主角行动明确' }
    }
  };

  const judgeB = {
    passed: true,
    score: 0.60, // 0.85 - 0.60 = 0.25 > 0.18
    qualityVector: {
      language: { score: 0.62, source: 'judge_b', evidence: '有部分空洞形容词' },
      character: { score: 0.58, source: 'judge_b', evidence: '配角动机不足' }
    }
  };

  const result = evaluateDualJudgeConsensus(judgeA, judgeB);
  assert.equal(result.consensus, false);
  assert.equal(result.passed, false);
  assert.equal(result.status, 'needs_human');
  assert.equal(result.code, 'DUAL_JUDGE_DISCREPANCY');
  assert.ok(result.maxDelta > MAX_ALLOWED_DISCREPANCY_DELTA);
  assert.ok(result.discrepancies.length >= 1);
});

test('P1 Quality - Dual Judge flags discrepancy when pass/fail conclusions conflict', () => {
  const judgeA = {
    passed: true,
    score: 0.72,
    qualityVector: { language: { score: 0.72, source: 'judge_a' } }
  };

  const judgeB = {
    passed: false,
    score: 0.68, // delta = 0.04 <= 0.18, 但结论冲突
    qualityVector: { language: { score: 0.68, source: 'judge_b' } }
  };

  const result = evaluateDualJudgeConsensus(judgeA, judgeB);
  assert.equal(result.consensus, false);
  assert.equal(result.passed, false);
  assert.equal(result.code, 'DUAL_JUDGE_DISCREPANCY');
  assert.ok(result.discrepancies.some(d => d.dimension === 'pass_fail_consensus'));
});

test('P1 Quality - Dual Judge merges consensus when evaluations align within tolerance', () => {
  const judgeA = {
    passed: true,
    score: 0.80,
    qualityVector: {
      language: { score: 0.82, source: 'judge_a', evidence: '文笔流畅' },
      character: { score: 0.78, source: 'judge_a', evidence: '人设鲜明' }
    }
  };

  const judgeB = {
    passed: true,
    score: 0.75, // delta = 0.05 <= 0.18
    qualityVector: {
      language: { score: 0.76, source: 'judge_b', evidence: '节奏紧凑' },
      character: { score: 0.74, source: 'judge_b', evidence: '对话生动' }
    }
  };

  const result = evaluateDualJudgeConsensus(judgeA, judgeB);
  assert.equal(result.consensus, true);
  assert.equal(result.passed, true);
  assert.equal(result.status, 'MEASURED');
  assert.equal(result.score, 0.775); // (0.80 + 0.75) / 2
  assert.equal(result.qualityVector.language.score, 0.79);
  assert.equal(result.qualityVector.character.score, 0.76);
  assert.equal(result.discrepancies.length, 0);
});

test('P1 Quality - Quality Gate integration with Dual Judge', () => {
  const draft = '演武场四周古树参天，狂风呼啸而过。叶凌天长剑出鞘，剑鸣声清越如龙吟。石砖在狂暴的剑气激荡下寸寸龟裂。';
  const crypto = require('node:crypto');
  const hash = crypto.createHash('sha256').update(draft, 'utf8').digest('hex');

  // 1. 双评委发生分歧时的门禁阻断
  const conflictingQuality = {
    judgeA: { passed: true, score: 0.90, qualityVector: { language: { score: 0.90, source: 'model_a' } } },
    judgeB: { passed: false, score: 0.50, qualityVector: { language: { score: 0.50, source: 'model_b' } } },
    contentDigest: hash
  };

  const gateResultConflicting = evaluateQualityGate({
    draft,
    quality: conflictingQuality,
    contentDigest: hash
  });
  assert.equal(gateResultConflicting.passed, false);
  assert.equal(gateResultConflicting.status, 'needs_human');
  assert.equal(gateResultConflicting.code, 'DUAL_JUDGE_DISCREPANCY');

  // 2. 双评委达成共识时的门禁通过
  const consensusQuality = {
    judgeA: { passed: true, score: 0.85, qualityVector: { language: { score: 0.85, source: 'model_a', evidence: '剑气激荡下寸寸龟裂' } } },
    judgeB: { passed: true, score: 0.80, qualityVector: { language: { score: 0.80, source: 'model_b', evidence: '长剑出鞘，剑鸣声清越如龙吟' } } },
    contentDigest: hash
  };

  const gateResultConsensus = evaluateQualityGate({
    draft,
    quality: consensusQuality,
    contentDigest: hash
  });
  assert.equal(gateResultConsensus.passed, true);
  assert.equal(gateResultConsensus.quality.status, 'MEASURED');
  assert.ok(gateResultConsensus.quality.dualJudge.consensus);
});
