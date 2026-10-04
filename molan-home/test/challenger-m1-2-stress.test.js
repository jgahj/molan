'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  SCHEMA_VERSION,
  CRITICAL_QUALITY_DIMENSIONS,
  NEGATIVE_ABSENCE_PATTERN,
  isProxySource,
  computeSha256,
  createQualityAssessment,
  validateQualityAssessment
} = require('../lib/generation/quality-assessment');

const { validateGenerationAuditEvidence } = require('../lib/generation/audit-evidence');

function sha256(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

function deepFreeze(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const val = obj[key];
    if (val && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

// ============================================================================
// SUITE 1: Empty Strings and Whitespace Handling
// ============================================================================
test('STRESS-01: Empty, whitespace, null, and undefined proxy source names', () => {
  const emptySources = ['', '   ', '\t\n\r', null, undefined, 'none', 'unmeasured', 'NONE', 'Unmeasured'];
  for (const src of emptySources) {
    assert.equal(isProxySource(src), true, `isProxySource should fail-closed (return true) for "${src}"`);
  }
});

test('STRESS-02: Empty strings in options, contentDigest, and genre in createQualityAssessment', () => {
  const qa = createQualityAssessment({
    contentDigest: '',
    genre: '   ',
    compliance: { passed: true, checks: {} },
    literary: { passed: false, dimensions: {} }
  });

  assert.equal(qa.contentDigest, '');
  assert.equal(qa.genre, '');
  assert.equal(qa.passed, false);
});

test('STRESS-03: Dimension quotes with whitespace-only or empty strings', () => {
  const whitespaceQuotes = ['', ' ', '   ', '\t\t', '\n\r'];
  for (const emptyQuote of whitespaceQuotes) {
    const qa = createQualityAssessment({
      compliance: { passed: true },
      literary: {
        passed: true,
        status: 'MEASURED',
        score: 0.85,
        confidence: 0.85,
        dimensions: {
          language: {
            score: 0.85,
            confidence: 0.85,
            status: 'MEASURED',
            source: 'literary_evaluator',
            quote: emptyQuote,
            evidence: []
          }
        }
      }
    });

    const validation = validateQualityAssessment(qa);
    assert.equal(validation.valid, false, `Validation should reject whitespace-only quote "${emptyQuote}"`);
    assert.ok(validation.errors.some(e => e.includes('有效正文逐字引文') || e.includes('长度 >= 4')));
  }
});

test('STRESS-04: Dimension quote shorter than 4 characters is rejected', () => {
  const shortQuotes = ['a', 'ab', 'abc', '字', '两字', '三个字'];
  for (const short of shortQuotes) {
    const forgedQA = {
      schemaVersion: SCHEMA_VERSION,
      passed: true,
      status: 'MEASURED',
      score: 0.85,
      confidence: 0.85,
      compliance: { passed: true, checks: {}, blockerCount: 0, issues: [] },
      literary: {
        passed: true,
        status: 'MEASURED',
        score: 0.85,
        confidence: 0.85,
        dimensions: {
          language: {
            score: 0.85,
            confidence: 0.85,
            status: 'MEASURED',
            source: 'literary_evaluator',
            quote: short,
            evidence: [short]
          }
        }
      },
      style: { passed: true },
      aiFlavor: { passed: true, risk: 'clean' }
    };

    const val = validateQualityAssessment(forgedQA);
    assert.equal(val.valid, false, `Quote "${short}" with length < 4 must be rejected`);
    assert.ok(val.errors.some(e => e.includes('有效正文逐字引文') || e.includes('长度 >= 4')));
  }

  // Length 4 quote must be accepted if valid
  const validLengthQuote = '四个字啊';
  const validLengthQA = {
    schemaVersion: SCHEMA_VERSION,
    passed: true,
    status: 'MEASURED',
    score: 0.85,
    confidence: 0.85,
    compliance: { passed: true, checks: {}, blockerCount: 0, issues: [] },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.85,
      confidence: 0.85,
      dimensions: {
        language: {
          score: 0.85,
          confidence: 0.85,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: validLengthQuote,
          evidence: [validLengthQuote]
        }
      }
    },
    style: { passed: true },
    aiFlavor: { passed: true, risk: 'clean' }
  };
  const valValid = validateQualityAssessment(validLengthQA);
  assert.equal(valValid.valid, true, 'Length 4 quote should be accepted when valid');
});

// ============================================================================
// SUITE 2: NaN, Infinity, and Numeric Edge Cases
// ============================================================================
test('STRESS-05: NaN, Infinity, -Infinity in createQualityAssessment sanitized to 0', () => {
  const nanValues = [NaN, Infinity, -Infinity, undefined, null, 'invalid_number', {}, []];
  for (const badVal of nanValues) {
    const qa = createQualityAssessment({
      compliance: { passed: true },
      literary: {
        passed: true,
        status: 'MEASURED',
        score: badVal,
        confidence: badVal,
        dimensions: {
          language: {
            score: badVal,
            confidence: badVal,
            status: 'MEASURED',
            source: 'literary_evaluator',
            quote: '真实有效正文段落'
          }
        }
      }
    });

    assert.equal(Number.isFinite(qa.literary.dimensions.language.score), true);
    assert.equal(qa.literary.dimensions.language.score, 0);
    assert.equal(qa.literary.passed, false, 'Bad score must never pass literary threshold');
    assert.equal(qa.passed, false, 'Bad score must never pass assessment');
  }
});

test('STRESS-06: NaN and non-finite values in validateQualityAssessment', () => {
  const badNumbers = [NaN, Infinity, -Infinity];

  for (const bad of badNumbers) {
    // 1. Root score is bad
    const badRootScore = {
      schemaVersion: SCHEMA_VERSION,
      passed: false,
      status: 'NOT_MEASURED',
      score: bad,
      confidence: 0.8,
      compliance: { passed: true, checks: {}, blockerCount: 0, issues: [] },
      literary: { passed: false, status: 'NOT_MEASURED', score: 0, confidence: 0, dimensions: {} },
      style: { passed: true },
      aiFlavor: { passed: true, risk: 'clean' }
    };
    const valRoot = validateQualityAssessment(badRootScore);
    assert.equal(valRoot.valid, false, `Root score ${bad} must be rejected`);

    // 2. Compliance blockerCount is bad
    const badBlocker = {
      schemaVersion: SCHEMA_VERSION,
      passed: false,
      status: 'NOT_MEASURED',
      compliance: { passed: true, checks: {}, blockerCount: bad, issues: [] },
      literary: { passed: false, status: 'NOT_MEASURED', score: 0, confidence: 0, dimensions: {} },
      style: { passed: true },
      aiFlavor: { passed: true, risk: 'clean' }
    };
    const valBlocker = validateQualityAssessment(badBlocker);
    assert.equal(valBlocker.valid, false, `blockerCount ${bad} must be rejected`);

    // 3. Dimension confidence is bad
    const badDimConf = {
      schemaVersion: SCHEMA_VERSION,
      passed: true,
      status: 'MEASURED',
      score: 0.85,
      confidence: 0.85,
      compliance: { passed: true, checks: {}, blockerCount: 0, issues: [] },
      literary: {
        passed: true,
        status: 'MEASURED',
        score: 0.85,
        confidence: 0.85,
        dimensions: {
          language: {
            score: 0.85,
            confidence: bad,
            status: 'MEASURED',
            source: 'literary_evaluator',
            quote: '真实有效正文段落'
          }
        }
      },
      style: { passed: true },
      aiFlavor: { passed: true, risk: 'clean' }
    };
    const valDimConf = validateQualityAssessment(badDimConf);
    assert.equal(valDimConf.valid, false, `Dimension confidence ${bad} must be rejected`);
  }
});

test('STRESS-07: Floating point boundary precision around 0.70 and 0.75 thresholds', () => {
  // Score: 0.6999999999999999 should FAIL (approx 0.6999999999999999 < 0.70)
  const justBelowScore = createQualityAssessment({
    compliance: { passed: true },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.6999999999999999,
      confidence: 0.80,
      dimensions: {
        language: { score: 0.6999999999999999, confidence: 0.80, status: 'MEASURED', source: 'literary_evaluator', quote: '真实有效正文' }
      }
    }
  });
  assert.equal(justBelowScore.literary.passed, false, 'Score 0.6999999999999999 must not pass');

  // Confidence: 0.7499999999999999 should FAIL
  const justBelowConf = createQualityAssessment({
    compliance: { passed: true },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.80,
      confidence: 0.7499999999999999,
      dimensions: {
        language: { score: 0.80, confidence: 0.7499999999999999, status: 'MEASURED', source: 'literary_evaluator', quote: '真实有效正文' }
      }
    }
  });
  assert.equal(justBelowConf.literary.passed, false, 'Confidence 0.7499999999999999 must not pass');
});

// ============================================================================
// SUITE 3: Negative Absence Phrases Stress Testing
// ============================================================================
test('STRESS-08: All 12 negative absence phrases systematically rejected across create and validate', () => {
  const negativePhrases = [
    '未检测到',
    '未检出',
    '未发现',
    '未见异常',
    '无异常',
    '无违规',
    '无问题',
    '零越界',
    '无明确冲突',
    '初筛完成',
    '暂无冲突',
    '符合规范'
  ];

  for (const phrase of negativePhrases) {
    // 1. Direct quote in createQualityAssessment
    const testQuote = `巡查结论：${phrase}，可以通行。`;
    const qaQuote = createQualityAssessment({
      compliance: { passed: true },
      literary: {
        passed: true,
        status: 'MEASURED',
        score: 0.85,
        confidence: 0.85,
        dimensions: {
          language: {
            score: 0.85,
            confidence: 0.85,
            status: 'MEASURED',
            source: 'literary_evaluator',
            quote: testQuote,
            evidence: [testQuote]
          }
        }
      }
    });

    assert.equal(qaQuote.literary.passed, false, `Phrase "${phrase}" in quote must not unlock literary.passed in createQualityAssessment`);

    // 2. Direct evidence array in createQualityAssessment
    const qaEvidence = createQualityAssessment({
      compliance: { passed: true },
      literary: {
        passed: true,
        status: 'MEASURED',
        score: 0.85,
        confidence: 0.85,
        dimensions: {
          language: {
            score: 0.85,
            confidence: 0.85,
            status: 'MEASURED',
            source: 'literary_evaluator',
            quote: '纯正文描写句子',
            evidence: [`规则审计：${phrase}`]
          }
        }
      }
    });

    assert.equal(qaEvidence.literary.passed, false, `Phrase "${phrase}" in evidence must not unlock literary.passed in createQualityAssessment`);

    // 3. In validateQualityAssessment
    const forgedWithNeg = {
      schemaVersion: SCHEMA_VERSION,
      passed: true,
      status: 'MEASURED',
      score: 0.85,
      confidence: 0.85,
      compliance: { passed: true, checks: {}, blockerCount: 0, issues: [] },
      literary: {
        passed: true,
        status: 'MEASURED',
        score: 0.85,
        confidence: 0.85,
        dimensions: {
          language: {
            score: 0.85,
            confidence: 0.85,
            status: 'MEASURED',
            source: 'literary_evaluator',
            quote: testQuote,
            evidence: [testQuote]
          }
        }
      },
      style: { passed: true },
      aiFlavor: { passed: true, risk: 'clean' }
    };

    const val = validateQualityAssessment(forgedWithNeg, { prose: testQuote });
    assert.equal(val.valid, false, `validateQualityAssessment must reject negative phrase "${phrase}"`);
    assert.ok(val.errors.some(e => e.includes('消极缺省/无违规词汇')));
  }
});

// ============================================================================
// SUITE 4: Frozen and Immutable Objects
// ============================================================================
test('STRESS-09: Deeply frozen objects in createQualityAssessment, validateQualityAssessment, and validateGenerationAuditEvidence', () => {
  const content = '李道玄抬起右手，袖中铁剑微鸣。狂风卷起残叶，四下俱静。';
  const contentHash = sha256(content);

  // 1. Deeply frozen input options to createQualityAssessment
  const frozenOptions = deepFreeze({
    contentDigest: contentHash,
    genre: '玄幻',
    compliance: {
      passed: true,
      checks: { wordCount: { passed: true, charCount: 2000 } },
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
        causality: { score: 0.88, status: 'MEASURED', confidence: 0.90, source: 'literary_evaluator', quote: '李道玄抬起右手' },
        consistency: { score: 0.85, status: 'MEASURED', confidence: 0.90, source: 'literary_evaluator', quote: '袖中铁剑微鸣' },
        language: { score: 0.86, status: 'MEASURED', confidence: 0.90, source: 'literary_evaluator', quote: '四下俱静' }
      }
    },
    style: { passed: true, score: 0.85, metrics: {}, evidence: [] },
    aiFlavor: { passed: true, risk: 'clean', score: 0.05, status: 'MEASURED', source: 'ai_flavor_detector', evidence: [] }
  });

  assert.doesNotThrow(() => {
    const qa = createQualityAssessment(frozenOptions);
    assert.equal(qa.passed, true);
  });

  // 2. Deeply frozen QualityAssessment in validateQualityAssessment
  const qa = createQualityAssessment(frozenOptions);
  deepFreeze(qa);

  assert.doesNotThrow(() => {
    const val = validateQualityAssessment(qa, { prose: content, genre: '玄幻' });
    assert.equal(val.valid, true);
    assert.equal(val.passed, true);
  });

  // 3. Deeply frozen input to validateGenerationAuditEvidence
  const frozenAuditInput = deepFreeze({
    generationId: 'gen-frozen-stress',
    chapterNo: 1,
    content,
    contentHash,
    genre: '玄幻',
    result: {
      draft: content,
      outputHash: contentHash,
      contract: { chapterNo: 1 },
      audit: { passed: true, blockerCount: 0, issues: [] },
      semanticAudit: { passed: true, audit: { passed: true, blockerCount: 0, issues: [] } },
      quality: qa
    }
  });

  assert.doesNotThrow(() => {
    const auditRes = validateGenerationAuditEvidence(frozenAuditInput);
    assert.equal(auditRes.ok, true);
    assert.equal(auditRes.evidence.passed, true);
  });
});

test('STRESS-10: Sealed and non-extensible objects handling', () => {
  const content = '秋风萧瑟，白发老者在亭中执子沉吟。';
  const contentHash = sha256(content);

  const sealedQA = Object.seal(createQualityAssessment({
    contentDigest: contentHash,
    genre: '玄幻',
    compliance: { passed: true, checks: {} },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.85,
      confidence: 0.85,
      dimensions: {
        causality: { score: 0.85, status: 'MEASURED', confidence: 0.85, source: 'literary_evaluator', quote: '白发老者在亭中执子沉吟' },
        consistency: { score: 0.85, status: 'MEASURED', confidence: 0.85, source: 'literary_evaluator', quote: '白发老者在亭中执子沉吟' },
        language: { score: 0.85, status: 'MEASURED', confidence: 0.85, source: 'literary_evaluator', quote: '白发老者在亭中执子沉吟' }
      }
    }
  }));

  assert.doesNotThrow(() => {
    const val = validateQualityAssessment(sealedQA, { prose: content });
    assert.equal(val.valid, true);
  });
});

// ============================================================================
// SUITE 5: Genuine Literary Sources vs Proxy Sources Boundary
// ============================================================================
test('STRESS-11: Genuine literary and LLM evaluators must NOT be classified as proxy sources', () => {
  const genuineSources = [
    'literary_evaluator',
    'single_judge',
    'dual_judge_consensus',
    'claude-3-5-sonnet',
    'claude-3-opus',
    'gpt-4o',
    'deepseek-v3',
    'deepseek-r1',
    'qwen-2.5-72b',
    'human_reviewer',
    'expert_panel',
    'author_supervisor'
  ];

  for (const src of genuineSources) {
    assert.equal(isProxySource(src), false, `Genuine evaluator "${src}" must NOT be classified as a proxy source`);
  }
});

test('STRESS-12: Disguised proxy sources with tricky naming must all be intercepted', () => {
  const trickyProxies = [
    'my_custom_heuristic',
    'presence_checker',
    'token_ratio_analyzer',
    'word_count_v2',
    'wordcount_evaluator',
    'char_count_v3',
    'char_counter_v1',
    'sentence_counter',
    'style_metric_tool',
    'dialogue_extractor_v4',
    'chapter_boundary_checker',
    'fact_consistency_verifier',
    'fact-checker',
    'fact_checker',
    'regex_pattern_matcher',
    'statistical_profiler',
    'keyword_density_measurer',
    'proxy_delegator'
  ];

  for (const proxy of trickyProxies) {
    assert.equal(isProxySource(proxy), true, `Tricky proxy "${proxy}" MUST be classified as a proxy source`);
  }
});

// ============================================================================
// SUITE 6: Fail-Closed Invariants and Tamper Proofing
// ============================================================================
test('STRESS-13: Invariant: Any subordinate layer failure strictly invalidates passed=true', () => {
  const baseValidQA = () => ({
    schemaVersion: SCHEMA_VERSION,
    passed: true,
    status: 'MEASURED',
    score: 0.85,
    confidence: 0.85,
    compliance: { passed: true, checks: {}, blockerCount: 0, issues: [] },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.85,
      confidence: 0.85,
      dimensions: {
        language: { score: 0.85, confidence: 0.85, status: 'MEASURED', source: 'literary_evaluator', quote: '合格正文字句段落' }
      }
    },
    style: { passed: true },
    aiFlavor: { passed: true, risk: 'clean' }
  });

  // Tamper 1: compliance.passed = false
  const t1 = baseValidQA();
  t1.compliance.passed = false;
  const val1 = validateQualityAssessment(t1, { prose: '合格正文字句段落' });
  assert.equal(val1.valid, false);
  assert.equal(val1.code, 'SCHEMA_INVARIANT_VIOLATION');

  // Tamper 2: compliance has blocker
  const t2 = baseValidQA();
  t2.compliance.blockerCount = 1;
  const val2 = validateQualityAssessment(t2, { prose: '合格正文字句段落' });
  assert.equal(val2.valid, false);
  assert.equal(val2.code, 'SCHEMA_INVARIANT_VIOLATION');

  // Tamper 3: literary.passed = false
  const t3 = baseValidQA();
  t3.literary.passed = false;
  const val3 = validateQualityAssessment(t3, { prose: '合格正文字句段落' });
  assert.equal(val3.valid, false);
  assert.equal(val3.code, 'SCHEMA_INVARIANT_VIOLATION');

  // Tamper 4: style.passed = false
  const t4 = baseValidQA();
  t4.style.passed = false;
  const val4 = validateQualityAssessment(t4, { prose: '合格正文字句段落' });
  assert.equal(val4.valid, false);
  assert.equal(val4.code, 'SCHEMA_INVARIANT_VIOLATION');

  // Tamper 5: aiFlavor.risk = 'critical'
  const t5 = baseValidQA();
  t5.aiFlavor.risk = 'critical';
  const val5 = validateQualityAssessment(t5, { prose: '合格正文字句段落' });
  assert.equal(val5.valid, false);
  assert.equal(val5.code, 'SCHEMA_INVARIANT_VIOLATION');

  // Tamper 6: status = 'needs_human' while passed = true
  const t6 = baseValidQA();
  t6.status = 'needs_human';
  const val6 = validateQualityAssessment(t6, { prose: '合格正文字句段落' });
  assert.equal(val6.valid, false);
  assert.equal(val6.code, 'SCHEMA_INVARIANT_VIOLATION');
});

test('STRESS-14: Malformed inputs to validateQualityAssessment and validateGenerationAuditEvidence', () => {
  const nonObjects = [null, undefined, 42, 'string', true, Symbol('test'), []];

  for (const item of nonObjects) {
    const valQA = validateQualityAssessment(item);
    assert.equal(valQA.valid, false);
    assert.equal(valQA.passed, false);
    assert.equal(valQA.code, 'INVALID_ASSESSMENT_OBJECT');
  }

  // validateGenerationAuditEvidence with malformed object or missing fields
  const malformedEvidenceInputs = [
    {},
    { generationId: '' },
    { generationId: 'gen-1', chapterNo: 0 },
    { generationId: 'gen-1', chapterNo: 1, content: '' },
    { generationId: 'gen-1', chapterNo: 1, content: 'txt', contentHash: 'wrong-hash' }
  ];

  for (const item of malformedEvidenceInputs) {
    const auditRes = validateGenerationAuditEvidence(item);
    assert.equal(auditRes.ok, false);
    assert.equal(auditRes.code, 'AUDIT_EVIDENCE_MISMATCH');
  }
});
