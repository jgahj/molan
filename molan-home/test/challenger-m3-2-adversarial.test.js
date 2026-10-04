'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  evaluateQualityGate,
  CRITICAL_QUALITY_DIMENSIONS,
  INITIAL_SCORE_THRESHOLD,
  INITIAL_CONFIDENCE_THRESHOLD,
  isProxySource,
  verifyDimensionEvidence
} = require('../lib/generation/quality-gate');

const {
  createQualityAssessment,
  NEGATIVE_ABSENCE_PATTERN,
  PROXY_SOURCE_PATTERN
} = require('../lib/generation/quality-assessment');

function sha256(str) {
  return crypto.createHash('sha256').update(String(str || ''), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// SUITE 1: Boundary threshold scores (0.699 vs 0.700, 0.749 vs 0.750)
// ---------------------------------------------------------------------------

test('Challenger M3-2 Stress 1.1: Score threshold boundary (0.699 fails, 0.700 passes)', () => {
  const prose = '天边雷声轰鸣，狂风席卷着漫山遍野的枯黄落叶，暴雨倾盆而下。';
  const digest = sha256(prose);

  // 1.1.1 Score = 0.699 (< 0.700) must fail with QUALITY_THRESHOLD_NOT_MET
  const evalBelow = evaluateQualityGate({
    prose,
    genre: '通用',
    quality: {
      passed: true,
      status: 'MEASURED',
      contentDigest: digest,
      qualityVector: {
        language: {
          score: 0.699,
          confidence: 0.85,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '天边雷声轰鸣',
          start: 0,
          end: 6
        }
      }
    }
  });

  assert.equal(evalBelow.passed, false, 'Score 0.699 must fail quality gate');
  assert.equal(evalBelow.status, 'needs_human');
  assert.equal(evalBelow.code, 'QUALITY_THRESHOLD_NOT_MET');
  assert.match(evalBelow.reason, /分值「0.699」未达到门限「0.7」/);
  assert.equal(evalBelow.blockers.length, 1);
  assert.equal(evalBelow.blockers[0].code, 'QUALITY_THRESHOLD_NOT_MET');

  // 1.1.2 Score = 0.6999999999999999 (< 0.700) must fail
  const evalPrecisionBelow = evaluateQualityGate({
    prose,
    genre: '通用',
    quality: {
      passed: true,
      status: 'MEASURED',
      contentDigest: digest,
      qualityVector: {
        language: {
          score: 0.6999999999999999,
          confidence: 0.85,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '天边雷声轰鸣',
          start: 0,
          end: 6
        }
      }
    }
  });
  assert.equal(evalPrecisionBelow.passed, false, 'Score 0.6999999999999999 must fail');
  assert.equal(evalPrecisionBelow.code, 'QUALITY_THRESHOLD_NOT_MET');

  // 1.1.3 Score = 0.700 (exact threshold) must PASS score check
  const evalExact = evaluateQualityGate({
    prose,
    genre: '通用',
    quality: {
      passed: true,
      status: 'MEASURED',
      contentDigest: digest,
      qualityVector: {
        language: {
          score: 0.700,
          confidence: 0.85,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '天边雷声轰鸣',
          start: 0,
          end: 6
        }
      }
    }
  });

  assert.equal(evalExact.passed, true, 'Score 0.700 exact must pass quality gate');
  assert.equal(evalExact.status, 'passed');
  assert.equal(evalExact.code, 'OK');
  assert.equal(evalExact.quality.evaluatedDimensions.language.verifiedScore, 0.700);

  // 1.1.4 Score = 0.7000000000000001 (slightly above) must PASS
  const evalAbove = evaluateQualityGate({
    prose,
    genre: '通用',
    quality: {
      passed: true,
      status: 'MEASURED',
      contentDigest: digest,
      qualityVector: {
        language: {
          score: 0.7000000000000001,
          confidence: 0.85,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '天边雷声轰鸣',
          start: 0,
          end: 6
        }
      }
    }
  });
  assert.equal(evalAbove.passed, true);
  assert.equal(evalAbove.code, 'OK');
});

test('Challenger M3-2 Stress 1.2: Confidence threshold boundary (0.749 fails, 0.750 passes)', () => {
  const prose = '天边雷声轰鸣，狂风席卷着漫山遍野的枯黄落叶，暴雨倾盆而下。';
  const digest = sha256(prose);

  // 1.2.1 Confidence = 0.749 (< 0.750) must fail with QUALITY_CONFIDENCE_LOW
  const evalBelow = evaluateQualityGate({
    prose,
    genre: '通用',
    quality: {
      passed: true,
      status: 'MEASURED',
      contentDigest: digest,
      qualityVector: {
        language: {
          score: 0.85,
          confidence: 0.749,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '天边雷声轰鸣',
          start: 0,
          end: 6
        }
      }
    }
  });

  assert.equal(evalBelow.passed, false, 'Confidence 0.749 must fail quality gate');
  assert.equal(evalBelow.status, 'needs_human');
  assert.equal(evalBelow.code, 'QUALITY_CONFIDENCE_LOW');
  assert.match(evalBelow.reason, /置信度「0.749」低于门限「0.75」/);
  assert.equal(evalBelow.blockers.length, 1);
  assert.equal(evalBelow.blockers[0].code, 'QUALITY_CONFIDENCE_LOW');

  // 1.2.2 Confidence = 0.7499999999999999 must fail
  const evalPrecisionBelow = evaluateQualityGate({
    prose,
    genre: '通用',
    quality: {
      passed: true,
      status: 'MEASURED',
      contentDigest: digest,
      qualityVector: {
        language: {
          score: 0.85,
          confidence: 0.7499999999999999,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '天边雷声轰鸣',
          start: 0,
          end: 6
        }
      }
    }
  });
  assert.equal(evalPrecisionBelow.passed, false);
  assert.equal(evalPrecisionBelow.code, 'QUALITY_CONFIDENCE_LOW');

  // 1.2.3 Confidence = 0.750 (exact threshold) must PASS
  const evalExact = evaluateQualityGate({
    prose,
    genre: '通用',
    quality: {
      passed: true,
      status: 'MEASURED',
      contentDigest: digest,
      qualityVector: {
        language: {
          score: 0.85,
          confidence: 0.750,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '天边雷声轰鸣',
          start: 0,
          end: 6
        }
      }
    }
  });

  assert.equal(evalExact.passed, true, 'Confidence 0.750 exact must pass quality gate');
  assert.equal(evalExact.status, 'passed');
  assert.equal(evalExact.code, 'OK');
  assert.equal(evalExact.quality.evaluatedDimensions.language.verifiedConfidence, 0.750);

  // 1.2.4 Confidence = 0.7500000000000001 must PASS
  const evalAbove = evaluateQualityGate({
    prose,
    genre: '通用',
    quality: {
      passed: true,
      status: 'MEASURED',
      contentDigest: digest,
      qualityVector: {
        language: {
          score: 0.85,
          confidence: 0.7500000000000001,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '天边雷声轰鸣',
          start: 0,
          end: 6
        }
      }
    }
  });
  assert.equal(evalAbove.passed, true);
  assert.equal(evalAbove.code, 'OK');
});

test('Challenger M3-2 Stress 1.3: Simultaneous edge threshold combinations', () => {
  const prose = '暮色微苍，落照半江，轻舟缓缓自芦苇荡中荡出。';
  const digest = sha256(prose);

  // 1.3.1 Both exactly at threshold (0.700, 0.750) -> PASS
  const bothPass = evaluateQualityGate({
    prose,
    genre: '通用',
    quality: {
      passed: true,
      status: 'MEASURED',
      contentDigest: digest,
      qualityVector: {
        language: {
          score: 0.700,
          confidence: 0.750,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '暮色微苍',
          start: 0,
          end: 4
        }
      }
    }
  });
  assert.equal(bothPass.passed, true);
  assert.equal(bothPass.status, 'passed');
  assert.equal(bothPass.code, 'OK');

  // 1.3.2 Score 0.699, Confidence 0.750 -> FAIL on score
  const failScore = evaluateQualityGate({
    prose,
    genre: '通用',
    quality: {
      passed: true,
      status: 'MEASURED',
      contentDigest: digest,
      qualityVector: {
        language: {
          score: 0.699,
          confidence: 0.750,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '暮色微苍',
          start: 0,
          end: 4
        }
      }
    }
  });
  assert.equal(failScore.passed, false);
  assert.equal(failScore.code, 'QUALITY_THRESHOLD_NOT_MET');

  // 1.3.3 Score 0.700, Confidence 0.749 -> FAIL on confidence
  const failConf = evaluateQualityGate({
    prose,
    genre: '通用',
    quality: {
      passed: true,
      status: 'MEASURED',
      contentDigest: digest,
      qualityVector: {
        language: {
          score: 0.700,
          confidence: 0.749,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '暮色微苍',
          start: 0,
          end: 4
        }
      }
    }
  });
  assert.equal(failConf.passed, false);
  assert.equal(failConf.code, 'QUALITY_CONFIDENCE_LOW');

  // 1.3.4 Score 0.699, Confidence 0.749 -> FAIL (score check executes first)
  const failBoth = evaluateQualityGate({
    prose,
    genre: '通用',
    quality: {
      passed: true,
      status: 'MEASURED',
      contentDigest: digest,
      qualityVector: {
        language: {
          score: 0.699,
          confidence: 0.749,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '暮色微苍',
          start: 0,
          end: 4
        }
      }
    }
  });
  assert.equal(failBoth.passed, false);
  assert.equal(failBoth.code, 'QUALITY_THRESHOLD_NOT_MET');
});

// ---------------------------------------------------------------------------
// SUITE 2: Missing quotes, empty strings, and NEGATIVE_ABSENCE_PATTERN
// ---------------------------------------------------------------------------

test('Challenger M3-2 Stress 2.1: Missing quote, null quote, empty string, and whitespace-only quotes', () => {
  const prose = '剑出如龙，寒光照彻了幽暗的长廊，风声呼啸不绝。';
  const digest = sha256(prose);

  const invalidQuoteCases = [
    { desc: 'quote omitted entirely', entry: { score: 0.85, confidence: 0.85, status: 'MEASURED', source: 'literary_evaluator' } },
    { desc: 'quote is undefined', entry: { quote: undefined, score: 0.85, confidence: 0.85, status: 'MEASURED', source: 'literary_evaluator' } },
    { desc: 'quote is null', entry: { quote: null, score: 0.85, confidence: 0.85, status: 'MEASURED', source: 'literary_evaluator' } },
    { desc: 'quote is empty string', entry: { quote: '', score: 0.85, confidence: 0.85, status: 'MEASURED', source: 'literary_evaluator' } },
    { desc: 'quote is whitespace only', entry: { quote: '    \t\n  ', score: 0.85, confidence: 0.85, status: 'MEASURED', source: 'literary_evaluator' } },
    { desc: 'quote is number', entry: { quote: 12345, score: 0.85, confidence: 0.85, status: 'MEASURED', source: 'literary_evaluator' } },
    { desc: 'quote is boolean', entry: { quote: true, score: 0.85, confidence: 0.85, status: 'MEASURED', source: 'literary_evaluator' } },
    { desc: 'quote is non-existent in prose', entry: { quote: '这段文字完全没有在小说正文出现过', score: 0.85, confidence: 0.85, status: 'MEASURED', source: 'literary_evaluator' } },
    { desc: 'quote is too short (< 4 chars for long prose)', entry: { quote: '剑出', score: 0.85, confidence: 0.85, status: 'MEASURED', source: 'literary_evaluator' } },
    { desc: 'evidence array is empty', entry: { evidence: [], score: 0.85, confidence: 0.85, status: 'MEASURED', source: 'literary_evaluator' } },
    { desc: 'evidence array contains empty strings', entry: { evidence: ['', '  '], score: 0.85, confidence: 0.85, status: 'MEASURED', source: 'literary_evaluator' } }
  ];

  for (const tc of invalidQuoteCases) {
    const res = evaluateQualityGate({
      prose,
      genre: '通用',
      quality: {
        passed: true,
        status: 'MEASURED',
        contentDigest: digest,
        qualityVector: {
          language: tc.entry
        }
      }
    });

    assert.equal(res.passed, false, `Failed case: ${tc.desc}`);
    assert.equal(res.status, 'needs_human');
    assert.equal(res.code, 'QUALITY_EVIDENCE_INVALID');
    assert.match(res.reason, /缺少可定位的正文逐字证据|条目非有效对象|非有效/);
  }
});

test('Challenger M3-2 Stress 2.2: NEGATIVE_ABSENCE_PATTERN tokens in quotes are strictly rejected', () => {
  // Even if the prose literally contains the phrase!
  const negativePhrases = [
    '未检测到违规描写',
    '未检出任何冲突',
    '未发现异常逻辑',
    '未见异常情况',
    '无异常记录',
    '无违规表述',
    '无问题段落',
    '零越界描写',
    '无明确冲突点',
    '初筛完成符合规范',
    '暂无冲突发生',
    '符合规范标准'
  ];

  for (const phrase of negativePhrases) {
    // Construct prose containing the negative absence phrase
    const prose = `窗外寒风阵阵，案前烛火摇曳。卷轴上明确写道：「${phrase}」，令人心生疑虑。`;
    const digest = sha256(prose);

    // Direct quote test
    const directEval = evaluateQualityGate({
      prose,
      genre: '通用',
      quality: {
        passed: true,
        status: 'MEASURED',
        contentDigest: digest,
        qualityVector: {
          language: {
            score: 0.88,
            confidence: 0.90,
            status: 'MEASURED',
            source: 'literary_evaluator',
            quote: phrase
          }
        }
      }
    });

    assert.equal(directEval.passed, false, `Negative phrase "${phrase}" must be rejected as quote`);
    assert.equal(directEval.code, 'QUALITY_EVIDENCE_INVALID');
    assert.match(directEval.reason, /缺少可定位的正文逐字证据或引用不存在于正文/);

    // With start/end offset pointing directly to the negative phrase
    const startIdx = prose.indexOf(phrase);
    const endIdx = startIdx + phrase.length;
    const offsetEval = evaluateQualityGate({
      prose,
      genre: '通用',
      quality: {
        passed: true,
        status: 'MEASURED',
        contentDigest: digest,
        qualityVector: {
          language: {
            score: 0.88,
            confidence: 0.90,
            status: 'MEASURED',
            source: 'literary_evaluator',
            quote: phrase,
            start: startIdx,
            end: endIdx
          }
        }
      }
    });

    assert.equal(offsetEval.passed, false, `Negative phrase "${phrase}" with offset must be rejected`);
    assert.equal(offsetEval.code, 'QUALITY_EVIDENCE_INVALID');

    // In evidence array with "引文「...」"
    const evidenceEval = evaluateQualityGate({
      prose,
      genre: '通用',
      quality: {
        passed: true,
        status: 'MEASURED',
        contentDigest: digest,
        qualityVector: {
          language: {
            score: 0.88,
            confidence: 0.90,
            status: 'MEASURED',
            source: 'literary_evaluator',
            evidence: [`引文「${phrase}」`]
          }
        }
      }
    });

    assert.equal(evidenceEval.passed, false, `Negative phrase "${phrase}" in evidence array must be rejected`);
    assert.equal(evidenceEval.code, 'QUALITY_EVIDENCE_INVALID');
  }
});

test('Challenger M3-2 Stress 2.3: verifyDimensionEvidence low-level function direct testing', () => {
  const prose = '残阳如血，古道西风中老者策马独行，马蹄踏在枯石上发出清脆碎响。';

  // 1. null / undefined entry
  assert.equal(verifyDimensionEvidence('lang', null, prose).ok, false);
  assert.equal(verifyDimensionEvidence('lang', undefined, prose).ok, false);
  assert.equal(verifyDimensionEvidence('lang', 'string_entry', prose).ok, false);

  // 2. proxy sources
  for (const p of ['word_count', 'dialogue_extractor', 'heuristic', 'character_presence_verifier']) {
    const res = verifyDimensionEvidence('lang', { source: p, quote: '残阳如血' }, prose);
    assert.equal(res.ok, false);
    assert.match(res.reason, /来源于代理指标/);
  }

  // 3. invalid start/end types
  assert.equal(verifyDimensionEvidence('lang', { source: 'literary_evaluator', start: '0', end: 4, quote: '残阳如血' }, prose).ok, false);
  assert.equal(verifyDimensionEvidence('lang', { source: 'literary_evaluator', start: 0, end: '4', quote: '残阳如血' }, prose).ok, false);
  assert.equal(verifyDimensionEvidence('lang', { source: 'literary_evaluator', start: -1, end: 4, quote: '残阳如血' }, prose).ok, false);
  assert.equal(verifyDimensionEvidence('lang', { source: 'literary_evaluator', start: 0, end: 9999, quote: '残阳如血' }, prose).ok, false);
  assert.equal(verifyDimensionEvidence('lang', { source: 'literary_evaluator', start: 4, end: 4, quote: '残阳如血' }, prose).ok, false);
  assert.equal(verifyDimensionEvidence('lang', { source: 'literary_evaluator', start: 5, end: 2, quote: '残阳如血' }, prose).ok, false);

  // 4. valid start/end slice
  const validSliceRes = verifyDimensionEvidence('lang', {
    source: 'literary_evaluator',
    start: 0,
    end: 4,
    quote: '残阳如血'
  }, prose);
  assert.equal(validSliceRes.ok, true);
  assert.equal(validSliceRes.locatedQuote, '残阳如血');

  // 5. quote mismatch with start/end slice
  const mismatchRes = verifyDimensionEvidence('lang', {
    source: 'literary_evaluator',
    start: 0,
    end: 4,
    quote: '古道西风'
  }, prose);
  assert.equal(mismatchRes.ok, false);
  assert.match(mismatchRes.reason, /证据引用与正文偏移切片不一致/);

  // 6. negative absence in quote
  const negRes = verifyDimensionEvidence('lang', {
    source: 'literary_evaluator',
    quote: '未检测到违规'
  }, '这是带有未检测到违规的正文');
  assert.equal(negRes.ok, false);
  assert.match(negRes.reason, /缺少可定位的正文逐字证据/);
});

// ---------------------------------------------------------------------------
// SUITE 3: De-confliction & Clean Transition to passed: true, status: 'passed'
// ---------------------------------------------------------------------------

test('Challenger M3-2 Stress 3.1: Legitimate prose with passing compliance (with proxy checks) and passing literary cleanly passes', () => {
  const prose = '石阶两旁生满了苍苔，林间泉水淙淙流淌，清脆悦耳。远处的钟声悠扬传来，惊起了林间栖息的飞鸟。';
  const digest = sha256(prose);

  // Real world assessment generated via createQualityAssessment
  // Compliance has 4 proxy analyzers (wordCount, dialogue, presence, formatting)
  // Literary has genuine narrative evaluator
  // Style and aiFlavor pass cleanly
  const assessment = createQualityAssessment({
    contentDigest: digest,
    genre: '通用',
    compliance: {
      passed: true,
      checks: {
        wordCount: { source: 'word_count', value: 2600, target: 2500, passed: true },
        dialogueMetrics: { source: 'dialogue_extractor', value: 0.18, evidence: ['对白占比=18%'] },
        characterPresence: { source: 'character_presence_verifier', value: 1.0, evidence: ['主角出场验证通过'] },
        formatting: { source: 'linguistic_metrics_analyzer', value: 0.95, evidence: ['字符数=2600', '平均句长=20字'] }
      },
      blockerCount: 0,
      issues: []
    },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.88,
      confidence: 0.90,
      evaluator: { mode: 'single', modelId: 'literary-judge-v1' },
      dimensions: {
        language: {
          score: 0.88,
          confidence: 0.90,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '石阶两旁生满了苍苔',
          start: 0,
          end: 9
        }
      }
    },
    style: {
      passed: true,
      score: 0.85,
      metrics: { sentenceVariance: 0.42 }
    },
    aiFlavor: {
      passed: true,
      risk: 'clean',
      score: 0.05
    }
  });

  const gateResult = evaluateQualityGate({
    prose,
    genre: '通用',
    quality: assessment
  });

  // Strict verification of all returned contract fields
  assert.equal(gateResult.passed, true, 'gateResult.passed must be true');
  assert.equal(gateResult.status, 'passed', 'gateResult.status must be "passed"');
  assert.equal(gateResult.code, 'OK', 'gateResult.code must be "OK"');
  assert.equal(gateResult.reason, '全题材必要维度质检与正文证据核验通过');
  assert.equal(gateResult.blockers, undefined, 'No blockers should exist');

  // Verify internal quality structure
  assert.equal(gateResult.quality.passed, true);
  assert.equal(gateResult.quality.status, 'MEASURED');
  assert.equal(gateResult.quality.contentDigest, digest);
  assert.equal(gateResult.quality.contentHash, digest);
  assert.equal(gateResult.quality.compliance.passed, true);
  assert.equal(gateResult.quality.literary.passed, true);
  assert.equal(gateResult.quality.evaluatedDimensions.language.verifiedScore, 0.88);
  assert.equal(gateResult.quality.evaluatedDimensions.language.verifiedConfidence, 0.90);
  assert.equal(gateResult.quality.evaluatedDimensions.language.verifiedQuote, '石阶两旁生满了苍苔');
  
  // Verify that proxy checks in compliance.checks remained preserved without leaking into evaluatedDimensions
  assert.equal(gateResult.quality.compliance.checks.wordCount.source, 'word_count');
  assert.equal(gateResult.quality.compliance.checks.dialogueMetrics.source, 'dialogue_extractor');
  assert.equal(gateResult.quality.evaluatedDimensions.language.source, 'literary_evaluator');
  assert.equal(gateResult.quality.evaluatedDimensions.wordCount, undefined);
  assert.equal(gateResult.quality.evaluatedDimensions.dialogueMetrics, undefined);
});

test('Challenger M3-2 Stress 3.2: Multi-genre de-confliction (玄幻, 言情, 悬疑, 科幻)', () => {
  const genres = [
    {
      genre: '玄幻',
      dims: ['causality', 'consistency', 'language'],
      quotes: {
        causality: '吞服了九叶灵芝，体内灵力奔涌',
        consistency: '筑基初期的修为境界',
        language: '紫气东来三千里'
      }
    },
    {
      genre: '言情',
      dims: ['emotionalArc', 'relationshipDynamics', 'language'],
      quotes: {
        emotionalArc: '眼角滑落一滴晶莹的泪水',
        relationshipDynamics: '两人的目光在空中交汇',
        language: '庭院深深深几许'
      }
    },
    {
      genre: '悬疑',
      dims: ['clueIntegrity', 'povBoundary', 'language'],
      quotes: {
        clueIntegrity: '地毯上残留着一枚沾泥的纽扣',
        povBoundary: '他只能看见门缝里透出的微光',
        language: '暗夜中钟摆沉闷作响'
      }
    },
    {
      genre: '科幻',
      dims: ['speculativeConsistency', 'logic', 'language'],
      quotes: {
        speculativeConsistency: '反物质约束力场维持稳定',
        logic: '跃迁引擎的能耗符合热力学定律',
        language: '星舰滑过寂静的柯伊伯带'
      }
    }
  ];

  for (const g of genres) {
    const prose = Object.values(g.quotes).join('。') + '。这是结尾句。';
    const digest = sha256(prose);

    const literaryDimensions = {};
    for (const d of g.dims) {
      literaryDimensions[d] = {
        score: 0.85,
        confidence: 0.88,
        status: 'MEASURED',
        source: 'literary_evaluator',
        quote: g.quotes[d]
      };
    }

    const assessment = createQualityAssessment({
      contentDigest: digest,
      genre: g.genre,
      compliance: {
        passed: true,
        checks: {
          wordCount: { source: 'word_count', value: 3000, passed: true },
          dialogueRatio: { source: 'dialogue_extractor', value: 0.25 }
        },
        blockerCount: 0,
        issues: []
      },
      literary: {
        passed: true,
        status: 'MEASURED',
        score: 0.85,
        confidence: 0.88,
        dimensions: literaryDimensions
      },
      style: { passed: true, score: 0.85 },
      aiFlavor: { passed: true, risk: 'clean', score: 0.05 }
    });

    const result = evaluateQualityGate({ prose, genre: g.genre, quality: assessment });
    assert.equal(result.passed, true, `Genre "${g.genre}" should cleanly pass`);
    assert.equal(result.status, 'passed');
    assert.equal(result.code, 'OK');

    for (const d of g.dims) {
      assert.ok(result.quality.evaluatedDimensions[d], `Dimension "${d}" must be verified`);
      assert.equal(result.quality.evaluatedDimensions[d].verifiedScore, 0.85);
      assert.equal(result.quality.evaluatedDimensions[d].verifiedQuote, g.quotes[d]);
    }
  }
});

test('Challenger M3-2 Stress 3.3: Strict provenance guard - proxy metric placed directly into literary.dimensions fails closed', () => {
  const prose = '石阶两旁生满了苍苔，林间泉水淙淙流淌，清脆悦耳。';
  const digest = sha256(prose);

  // An attacker or buggy pipeline tries to put proxy metric directly into literary.dimensions
  const maliciousAssessment = {
    schemaVersion: 'quality-assessment-v1',
    passed: true,
    status: 'MEASURED',
    contentDigest: digest,
    compliance: { passed: true, checks: {}, blockerCount: 0, issues: [] },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.95,
      confidence: 0.95,
      dimensions: {
        language: {
          score: 0.95,
          confidence: 0.95,
          status: 'MEASURED',
          source: 'linguistic_metrics_analyzer', // PROXY!
          quote: '石阶两旁生满了苍苔',
          start: 0,
          end: 9
        }
      }
    },
    style: { passed: true, score: 0.85 },
    aiFlavor: { passed: true, risk: 'clean', score: 0.05 }
  };

  const evalRes = evaluateQualityGate({ prose, genre: '通用', quality: maliciousAssessment });
  assert.equal(evalRes.passed, false, 'Proxy in literary.dimensions must fail');
  assert.equal(evalRes.status, 'needs_human');
  assert.equal(evalRes.code, 'QUALITY_EVIDENCE_INVALID');
  assert.match(evalRes.reason, /来源于代理指标「linguistic_metrics_analyzer」/);
});

test('Challenger M3-2 Stress 3.4: Compliance failure blocks gate even if literary is perfect (Fail-Closed)', () => {
  const prose = '夜半钟声到客船。姑苏城外寒山寺。';
  const digest = sha256(prose);

  // Literary has perfect 1.0 score and confidence, but compliance failed on blocker
  const failedCompliance = {
    schemaVersion: 'quality-assessment-v1',
    passed: false,
    status: 'needs_human',
    contentDigest: digest,
    compliance: {
      passed: false,
      blockerCount: 1,
      issues: [{ code: 'WORD_COUNT_SHORT', message: '正文字数仅 16 字，严重不足', severity: 'blocker' }],
      checks: { wordCount: { passed: false, value: 16 } }
    },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 1.0,
      confidence: 1.0,
      dimensions: {
        language: {
          score: 1.0,
          confidence: 1.0,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '夜半钟声到客船',
          start: 0,
          end: 7
        }
      }
    },
    style: { passed: true, score: 0.85 },
    aiFlavor: { passed: true, risk: 'clean', score: 0.05 }
  };

  const evalRes = evaluateQualityGate({ prose, genre: '通用', quality: failedCompliance });
  assert.equal(evalRes.passed, false);
  assert.equal(evalRes.status, 'needs_human');
  assert.equal(evalRes.code, 'COMPLIANCE_CHECK_FAILED');
  assert.match(evalRes.reason, /正文字数仅 16 字/);
});

test('Challenger M3-2 Stress 3.5: AI flavor critical risk blocks gate even if compliance & literary are perfect', () => {
  const prose = '夜半钟声到客船。姑苏城外寒山寺。';
  const digest = sha256(prose);

  const criticalAiFlavor = {
    schemaVersion: 'quality-assessment-v1',
    passed: true,
    status: 'MEASURED',
    contentDigest: digest,
    compliance: { passed: true, blockerCount: 0, issues: [], checks: {} },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.95,
      confidence: 0.95,
      dimensions: {
        language: {
          score: 0.95,
          confidence: 0.95,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '夜半钟声到客船',
          start: 0,
          end: 7
        }
      }
    },
    style: { passed: true, score: 0.85 },
    aiFlavor: {
      passed: false,
      risk: 'critical',
      score: 0.99
    }
  };

  const evalRes = evaluateQualityGate({ prose, genre: '通用', quality: criticalAiFlavor });
  assert.equal(evalRes.passed, false);
  assert.equal(evalRes.status, 'needs_human');
  assert.equal(evalRes.code, 'AI_FLAVOR_CRITICAL_RISK');
  assert.match(evalRes.reason, /AI笔调检测处于 critical 风险/);
});

// ---------------------------------------------------------------------------
// SUITE 4: Dual Judge, Short Prose minLen, and Genre Fallback Boundaries
// ---------------------------------------------------------------------------

test('Challenger M3-2 Stress 4.1: Dual Judge discrepancy escalation & consensus pass', () => {
  const prose = '石阶两旁生满了苍苔，林间泉水淙淙流淌，清脆悦耳。';
  const digest = sha256(prose);

  // 4.1.1 Discrepancy > 0.18 delta between Judge A (0.90) and Judge B (0.65)
  const discrepantEval = evaluateQualityGate({
    prose,
    genre: '通用',
    quality: {
      passed: true,
      status: 'MEASURED',
      contentDigest: digest,
      judgeA: {
        score: 0.90,
        passed: true,
        qualityVector: {
          language: { score: 0.90, confidence: 0.90, status: 'MEASURED', source: 'judge_a', quote: '石阶两旁生满了苍苔' }
        }
      },
      judgeB: {
        score: 0.65,
        passed: false,
        qualityVector: {
          language: { score: 0.65, confidence: 0.80, status: 'MEASURED', source: 'judge_b', quote: '石阶两旁生满了苍苔' }
        }
      }
    }
  });

  assert.equal(discrepantEval.passed, false, 'Dual Judge with large discrepancy must fail gate');
  assert.equal(discrepantEval.status, 'needs_human');
  assert.equal(discrepantEval.code, 'DUAL_JUDGE_DISCREPANCY');

  // 4.1.2 Consensus agreement between Judge A (0.88) and Judge B (0.86) -> PASS
  const consensusEval = evaluateQualityGate({
    prose,
    genre: '通用',
    quality: {
      passed: true,
      status: 'MEASURED',
      contentDigest: digest,
      judgeA: {
        score: 0.88,
        passed: true,
        qualityVector: {
          language: { score: 0.88, confidence: 0.90, status: 'MEASURED', source: 'judge_a', quote: '石阶两旁生满了苍苔' }
        }
      },
      judgeB: {
        score: 0.86,
        passed: true,
        qualityVector: {
          language: { score: 0.86, confidence: 0.88, status: 'MEASURED', source: 'judge_b', quote: '石阶两旁生满了苍苔' }
        }
      }
    }
  });

  assert.equal(consensusEval.passed, true, 'Dual Judge consensus must pass gate');
  assert.equal(consensusEval.status, 'passed');
  assert.equal(consensusEval.code, 'OK');
  assert.equal(consensusEval.quality.dualJudge.consensus, true);
});

test('Challenger M3-2 Stress 4.2: Short prose minLen boundary calculation', () => {
  // Prose with exactly 3 characters: "白日依"
  const shortProse = '白日依';
  const digest = sha256(shortProse);

  // minLen should be Math.min(4, Math.max(1, 3)) = 3.
  // A 3-char quote should pass:
  const pass3Char = evaluateQualityGate({
    prose: shortProse,
    genre: '通用',
    quality: {
      passed: true,
      status: 'MEASURED',
      contentDigest: digest,
      qualityVector: {
        language: {
          score: 0.85,
          confidence: 0.85,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '白日依'
        }
      }
    }
  });
  assert.equal(pass3Char.passed, true);

  // A 2-char quote should fail (2 < minLen 3):
  const fail2Char = evaluateQualityGate({
    prose: shortProse,
    genre: '通用',
    quality: {
      passed: true,
      status: 'MEASURED',
      contentDigest: digest,
      qualityVector: {
        language: {
          score: 0.85,
          confidence: 0.85,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '白日'
        }
      }
    }
  });
  assert.equal(fail2Char.passed, false);
  assert.equal(fail2Char.code, 'QUALITY_EVIDENCE_INVALID');
});

test('Challenger M3-2 Stress 4.3: Unknown genre fallback to 通用 (language dimension)', () => {
  const prose = '星辰大海无边广袤，战舰引擎静静轰鸣。';
  const digest = sha256(prose);

  for (const unknownGenre of ['克苏鲁修真', '未知题材', '', null, undefined, { genre: '赛博朋克' }]) {
    const res = evaluateQualityGate({
      prose,
      genre: unknownGenre,
      quality: {
        passed: true,
        status: 'MEASURED',
        contentDigest: digest,
        qualityVector: {
          language: {
            score: 0.88,
            confidence: 0.88,
            status: 'MEASURED',
            source: 'literary_evaluator',
            quote: '星辰大海无边广袤'
          }
        }
      }
    });

    assert.equal(res.passed, true, `Unknown genre ${JSON.stringify(unknownGenre)} should fallback to 通用/language and pass`);
    assert.equal(res.status, 'passed');
    assert.equal(res.code, 'OK');
  }
});

