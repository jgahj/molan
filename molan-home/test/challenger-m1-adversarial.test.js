'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  SCHEMA_VERSION,
  CRITICAL_QUALITY_DIMENSIONS,
  isProxySource,
  computeSha256,
  createQualityAssessment,
  validateQualityAssessment
} = require('../lib/generation/quality-assessment');

const { validateGenerationAuditEvidence } = require('../lib/generation/audit-evidence');

function sha256(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

// ============================================================================
// SUITE 1: Proxy Source Name Spoofing & Evasion
// ============================================================================
test('ADV-01: Proxy Source Identification - Substring and Pattern Evasion', (t) => {
  // Test variations that should semantically be recognized as proxies/heuristics
  const evasionCandidates = [
    { name: 'linguistic_metric_analyzer', reason: 'singular metric instead of metrics' },
    { name: 'proxy', reason: 'explicit proxy token' },
    { name: 'proxy_evaluator', reason: 'explicit proxy token with evaluator' },
    { name: 'proxy_source', reason: 'explicit proxy source token' },
    { name: 'rule_based_evaluator', reason: 'rule-based heuristic' },
    { name: 'regex_scanner', reason: 'regex pattern scanner' },
    { name: 'regex_analyzer', reason: 'regex analyzer' },
    { name: 'statistical_analyzer', reason: 'statistical proxy' },
    { name: 'density_evaluator', reason: 'density proxy without dialogue prefix' },
    { name: 'dialogue_density_analyzer', reason: 'analyzer suffix instead of evaluator' },
    { name: 'wordcount', reason: 'wordcount without underscore' },
    { name: 'char_count', reason: 'character count proxy' },
    { name: 'char_counter', reason: 'character counter' },
    { name: 'fact_consistency_verifier_v1', reason: 'versioned verifier missing from includes' },
    { name: 'causal_issue_detector_v1', reason: 'versioned detector missing from includes' },
    { name: 'dialogue_density_evaluator_v1', reason: 'versioned density evaluator missing from includes' }
  ];

  const leakedSources = [];
  for (const candidate of evasionCandidates) {
    const detected = isProxySource(candidate.name);
    if (!detected) {
      leakedSources.push(candidate);
    }
  }

  // Record empirical findings
  t.diagnostic(`Total candidates: ${evasionCandidates.length}, Leaked as genuine: ${leakedSources.length}`);
  for (const leaked of leakedSources) {
    t.diagnostic(`LEAKED PROXY: "${leaked.name}" (${leaked.reason})`);
  }

  // The challenger asserts that all these proxy/heuristic names SHOULD be detected as proxies.
  // We document which ones fail.
  assert.equal(leakedSources.length, 0, `Proxy evasion detected: ${leakedSources.map(s => s.name).join(', ')} were not recognized as proxy sources`);
});

test('ADV-02: Spoofed Proxy Source can Penetrate createQualityAssessment and Unlock Literary Quality', () => {
  const spoofedSource = 'linguistic_metric_analyzer'; // missing 's' in metrics

  const assessment = createQualityAssessment({
    compliance: { passed: true, checks: { wordCount: { passed: true } } },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.85,
      confidence: 0.90,
      dimensions: {
        language: {
          score: 0.85,
          status: 'MEASURED',
          confidence: 0.90,
          source: spoofedSource,
          quote: '真实存在的一句话正文。',
          evidence: ['统计合格']
        }
      }
    }
  });

  // Check if proxy penetrated into literary dimensions
  const penetrated = Boolean(assessment.literary.dimensions.language);
  const literaryPassed = assessment.literary.passed;
  const overallPassed = assessment.passed;

  // Challenger assertion: proxy MUST NOT penetrate literary dimensions or unlock passing status
  assert.equal(penetrated, false, 'Spoofed proxy penetrated into literary.dimensions');
  assert.equal(literaryPassed, false, 'Spoofed proxy unlocked literary.passed');
  assert.equal(overallPassed, false, 'Spoofed proxy unlocked assessment.passed');
});

test('ADV-03: Versioned Checker (fact_consistency_verifier_v2) Unlocks Literary Dimensions', () => {
  const versionedSource = 'fact_consistency_verifier_v2';

  const assessment = createQualityAssessment({
    compliance: { passed: true, checks: { wordCount: { passed: true } } },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.85,
      confidence: 0.90,
      dimensions: {
        consistency: {
          score: 0.85,
          status: 'MEASURED',
          confidence: 0.90,
          source: versionedSource,
          quote: '真实存在的一句话正文。',
          evidence: ['验证完成']
        }
      }
    }
  });

  assert.equal(Boolean(assessment.literary.dimensions.consistency), false, 'Versioned proxy penetrated into literary.dimensions');
  assert.equal(assessment.literary.passed, false, 'Versioned proxy unlocked literary.passed');
});

// ============================================================================
// SUITE 2: Schema Invariant & Fail-Closed Validation Hole
// ============================================================================
test('ADV-04: validateQualityAssessment Fail-Closed Hole - Forged Object with All Layers False but passed:true', () => {
  const forged = {
    schemaVersion: SCHEMA_VERSION,
    passed: true,
    status: 'passed',
    score: 0.9,
    confidence: 0.9,
    compliance: { passed: false, checks: {}, blockerCount: 5, issues: [{ severity: 'blocker', message: '合规严重阻断' }] },
    literary: { passed: false, status: 'NOT_MEASURED', score: 0, confidence: 0, dimensions: {} },
    style: { passed: false },
    aiFlavor: { passed: false, risk: 'high' }
  };

  const validation = validateQualityAssessment(forged);

  // Challenger assertion: A forged object with passed: true but compliance=false and literary=false MUST be rejected!
  assert.equal(validation.valid, false, 'Validation marked completely forged assessment as valid: true');
  assert.equal(validation.passed, false, 'Validation marked completely forged assessment as passed: true');
  assert.notEqual(validation.code, 'OK', 'Validation returned code OK for forged assessment');
});

test('ADV-05: validateQualityAssessment Hole - compliance.passed=false with literary.passed=true & passed=true', () => {
  const forged = {
    schemaVersion: SCHEMA_VERSION,
    passed: true,
    status: 'passed',
    score: 0.85,
    confidence: 0.9,
    compliance: { passed: false, checks: {}, blockerCount: 3, issues: [{ severity: 'blocker', message: '字数越界' }] },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.85,
      confidence: 0.9,
      dimensions: {
        language: { score: 0.85, status: 'MEASURED', confidence: 0.9, source: 'literary_evaluator' }
      }
    },
    style: { passed: true },
    aiFlavor: { passed: true, risk: 'clean' }
  };

  const validation = validateQualityAssessment(forged);

  // Challenger assertion: If compliance.passed is false, assessment.passed cannot be valid/true!
  assert.equal(validation.valid, false, 'Validation allowed compliance.passed=false to pass when assessment.passed=true');
  assert.equal(validation.passed, false, 'Overall passed should be false when compliance fails');
});

test('ADV-06: validateQualityAssessment Hole - style.passed=false with assessment.passed=true', () => {
  const forged = {
    schemaVersion: SCHEMA_VERSION,
    passed: true,
    status: 'passed',
    score: 0.85,
    confidence: 0.9,
    compliance: { passed: true, checks: {}, blockerCount: 0, issues: [] },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.85,
      confidence: 0.9,
      dimensions: {
        language: { score: 0.85, status: 'MEASURED', confidence: 0.9, source: 'literary_evaluator' }
      }
    },
    style: { passed: false, score: 0.2 },
    aiFlavor: { passed: true, risk: 'clean' }
  };

  const validation = validateQualityAssessment(forged);

  // Challenger assertion: If style failed, assessment.passed cannot be valid/true!
  assert.equal(validation.valid, false, 'Validation allowed style.passed=false to pass when assessment.passed=true');
  assert.equal(validation.passed, false, 'Overall passed should be false when style fails');
});

// ============================================================================
// SUITE 3: Numeric Edge & Boundary Conditions (0.699, 0.701, NaN, Strings)
// ============================================================================
test('ADV-07: Boundary Values - 0.699 rejected, 0.700 accepted, 0.701 accepted', () => {
  // 0.699 in literary.score
  const at699 = createQualityAssessment({
    compliance: { passed: true },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.699,
      confidence: 0.80,
      dimensions: {
        language: { score: 0.699, status: 'MEASURED', confidence: 0.80, source: 'literary_evaluator' }
      }
    }
  });
  assert.equal(at699.literary.passed, false, '0.699 should be rejected by threshold');

  // 0.700 in literary.score
  const at700 = createQualityAssessment({
    compliance: { passed: true },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.700,
      confidence: 0.750,
      dimensions: {
        language: { score: 0.700, status: 'MEASURED', confidence: 0.750, source: 'literary_evaluator' }
      }
    }
  });
  assert.equal(at700.literary.passed, true, '0.700 should meet threshold (score >= 0.70, conf >= 0.75)');

  // 0.701 in literary.score
  const at701 = createQualityAssessment({
    compliance: { passed: true },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.701,
      confidence: 0.751,
      dimensions: {
        language: { score: 0.701, status: 'MEASURED', confidence: 0.751, source: 'literary_evaluator' }
      }
    }
  });
  assert.equal(at701.literary.passed, true, '0.701 should meet threshold');
});

test('ADV-08: NaN and Infinity in Dimensions - validateQualityAssessment Handling', () => {
  const assessmentWithNaN = {
    schemaVersion: SCHEMA_VERSION,
    passed: true,
    status: 'MEASURED',
    score: 0.8,
    confidence: 0.8,
    compliance: { passed: true, checks: {}, blockerCount: 0, issues: [] },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.8,
      confidence: 0.8,
      dimensions: {
        language: {
          score: NaN,
          value: NaN,
          confidence: NaN,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '测试文本正文内容'
        }
      }
    },
    style: { passed: true },
    aiFlavor: { passed: true, risk: 'clean' }
  };

  const validation = validateQualityAssessment(assessmentWithNaN, { prose: '测试文本正文内容' });
  // If score is NaN, dimScore < scoreThreshold (NaN < 0.70) is FALSE in JavaScript!
  // Therefore, validation.errors will NOT catch NaN score unless explicitly checked!
  assert.equal(validation.valid, false, 'Validation must reject NaN dimension score/confidence');
});

test('ADV-09: String Numbers ("0.85") in Dimensions - validateQualityAssessment Handling', () => {
  const assessmentWithStringNum = {
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
          score: '0.85', // String instead of number
          confidence: '0.85', // String instead of number
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '测试文本正文内容'
        }
      }
    },
    style: { passed: true },
    aiFlavor: { passed: true, risk: 'clean' }
  };

  const validation = validateQualityAssessment(assessmentWithStringNum, { prose: '测试文本正文内容' });
  assert.equal(validation.valid, false, 'Validation should reject non-number types in dimension score/confidence');
});

// ============================================================================
// SUITE 4: Negative Absence Patterns & Quote Verification Evasion
// ============================================================================
test('ADV-10: createQualityAssessment Does NOT Check Negative Absence Patterns in Quotes', () => {
  const assessment = createQualityAssessment({
    compliance: { passed: true },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.85,
      confidence: 0.85,
      dimensions: {
        language: {
          score: 0.85,
          status: 'MEASURED',
          confidence: 0.85,
          source: 'literary_evaluator',
          quote: '未检测到违规', // Negative absence quote
          evidence: ['未检测到违规']
        }
      }
    }
  });

  // Check whether createQualityAssessment accepted a negative absence quote as passing
  assert.equal(assessment.literary.passed, false, 'createQualityAssessment should reject negative absence quote at creation time');
});

test('ADV-11: Negative Absence Evasion - Variations Not Covered by Pattern', () => {
  const prose = '本次巡查未见异常，无任何问题，林晨转身离开。';

  // "未见异常" is a negative absence phrase, but NOT in NEGATIVE_ABSENCE_PATTERN
  const assessment = createQualityAssessment({
    compliance: { passed: true },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.85,
      confidence: 0.85,
      dimensions: {
        language: {
          score: 0.85,
          status: 'MEASURED',
          confidence: 0.85,
          source: 'literary_evaluator',
          quote: '未见异常',
          evidence: ['未见异常']
        }
      }
    }
  });

  const val = validateQualityAssessment(assessment, { prose });
  assert.equal(val.valid, false, 'Negative absence variation "未见异常" should be rejected as literary quality evidence');
});

test('ADV-12: Quote Omission When Prose is Not Provided to validateQualityAssessment', () => {
  // If options.prose is not passed to validateQualityAssessment, quotes are never checked!
  const assessment = {
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
          quote: '', // Empty quote
          evidence: [] // Empty evidence
        }
      }
    },
    style: { passed: true },
    aiFlavor: { passed: true, risk: 'clean' }
  };

  // Called without options.prose
  const valWithoutProse = validateQualityAssessment(assessment);
  assert.equal(valWithoutProse.valid, false, 'Validation should require non-empty quote even if prose is not provided');
});

// ============================================================================
// SUITE 5: Prototype Pollution Resilience
// ============================================================================
test('ADV-13: Object with null prototype should not crash createQualityAssessment or validateQualityAssessment', () => {
  const nullProtoOptions = Object.create(null);
  nullProtoOptions.compliance = Object.create(null);
  nullProtoOptions.compliance.passed = true;
  nullProtoOptions.literary = Object.create(null);
  nullProtoOptions.literary.dimensions = Object.create(null);

  assert.doesNotThrow(() => {
    const qa = createQualityAssessment(nullProtoOptions);
    validateQualityAssessment(qa);
  }, 'Should handle Object.create(null) gracefully');
});

test('ADV-14: Audit Evidence with Spoofed Proxy Source in QualityAssessment', () => {
  const content = '林晨站在空旷的青石道上，长刀出鞘半寸。风吹草动间，杀意森然。';
  const contentHash = sha256(content);

  // QualityAssessment where source is a spoofed proxy name
  const spoofedAssessment = createQualityAssessment({
    compliance: { passed: true, checks: { wordCount: { passed: true } } },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.85,
      confidence: 0.90,
      dimensions: {
        causality: { score: 0.85, status: 'MEASURED', confidence: 0.90, source: 'linguistic_metric_analyzer', quote: '长刀出鞘半寸' },
        consistency: { score: 0.85, status: 'MEASURED', confidence: 0.90, source: 'proxy_evaluator', quote: '长刀出鞘半寸' },
        language: { score: 0.85, status: 'MEASURED', confidence: 0.90, source: 'dialogue_density_analyzer', quote: '长刀出鞘半寸' }
      }
    },
    genre: '玄幻'
  });

  const res = validateGenerationAuditEvidence({
    generationId: 'gen-adv-14',
    chapterNo: 1,
    content,
    contentHash,
    genre: '玄幻',
    result: {
      draft: content,
      outputHash: contentHash,
      contract: { chapterNo: 1 },
      audit: { passed: true },
      semanticAudit: { passed: true, audit: { passed: true } },
      quality: spoofedAssessment
    }
  });

  // Audit evidence must block this!
  assert.equal(res.ok, false, 'validateGenerationAuditEvidence must block spoofed proxy sources');
});
