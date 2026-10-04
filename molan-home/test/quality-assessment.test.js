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

test('QualityAssessment: 创建符合规范的 4 层解耦结构', () => {
  const assessment = createQualityAssessment({
    compliance: {
      passed: true,
      checks: {
        wordCount: { passed: true, charCount: 2200, targetChars: 2000 },
        povBoundary: { passed: true, violations: 0 }
      },
      blockerCount: 0,
      issues: []
    },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.85,
      confidence: 0.90,
      evaluator: { mode: 'single', modelId: 'literary-judge-v1', judgeId: 'judge-1' },
      dimensions: {
        language: {
          score: 0.86,
          status: 'MEASURED',
          confidence: 0.90,
          source: 'literary_evaluator',
          quote: '陈寻俯身检查断裂的青石板，指节擦过缝隙里的黑灰。',
          evidence: ['引文「陈寻俯身检查断裂的青石板，指节擦过缝隙里的黑灰。」动作凝练，画面感强']
        },
        characterVoice: {
          score: 0.84,
          status: 'MEASURED',
          confidence: 0.90,
          source: 'single_judge',
          quote: '“三叔，阵盘偏了半寸。”他低声开口，目光未曾移开分毫。',
          evidence: ['对白冷静克制，符合阵法学者人设']
        }
      }
    },
    style: {
      passed: true,
      score: 0.88,
      metrics: { sentenceLengthVariance: 12.5, rhythmScore: 0.85 },
      evidence: ['句长起伏自然']
    },
    aiFlavor: {
      passed: true,
      risk: 'clean',
      score: 0.08,
      status: 'MEASURED',
      source: 'ai_flavor_detector',
      evidence: ['无 AI 特征模板']
    },
    contentDigest: sha256('测试正文内容'),
    genre: '玄幻'
  });

  // 1. Schema 根字段
  assert.equal(assessment.schemaVersion, SCHEMA_VERSION);
  assert.equal(assessment.passed, true);
  assert.equal(assessment.status, 'MEASURED');
  assert.equal(typeof assessment.score, 'number');
  assert.ok(assessment.score >= 0.70);
  assert.equal(typeof assessment.confidence, 'number');
  assert.ok(assessment.confidence >= 0.75);
  assert.equal(assessment.genre, '玄幻');
  assert.equal(assessment.contentDigest, sha256('测试正文内容'));

  // 2. Layer 1: compliance
  assert.equal(assessment.compliance.passed, true);
  assert.equal(assessment.compliance.blockerCount, 0);
  assert.ok(assessment.compliance.checks.wordCount);
  assert.ok(assessment.compliance.checks.povBoundary);
  assert.ok(Array.isArray(assessment.compliance.issues));

  // 3. Layer 2: literary
  assert.equal(assessment.literary.passed, true);
  assert.equal(assessment.literary.status, 'MEASURED');
  assert.equal(assessment.literary.evaluator.judgeId, 'judge-1');
  assert.ok(assessment.literary.dimensions.language);
  assert.ok(assessment.literary.dimensions.characterVoice);
  assert.equal(assessment.literary.dimensions.language.value, 0.86);

  // 4. Layer 3: style
  assert.equal(assessment.style.passed, true);
  assert.equal(assessment.style.score, 0.88);
  assert.equal(assessment.style.metrics.sentenceLengthVariance, 12.5);

  // 5. Layer 4: aiFlavor
  assert.equal(assessment.aiFlavor.passed, true);
  assert.equal(assessment.aiFlavor.risk, 'clean');
  assert.equal(assessment.aiFlavor.score, 0.08);

  // 6. 向后兼容 qualityVector 投影
  assert.ok(assessment.qualityVector);
  assert.ok(assessment.qualityVector.language);
  assert.equal(assessment.qualityVector.language.value, 0.86);
  assert.equal(assessment.qualityVector.language.status, 'MEASURED');
  assert.equal(assessment.qualityVector.language.source, 'literary_evaluator');

  // 7. 来源真实性状态
  assert.equal(assessment.provenance.valid, true);
  assert.equal(assessment.provenance.literarySourcesGenuine, true);
  assert.equal(assessment.provenance.violations.length, 0);

  // 8. 校验器验证
  const validation = validateQualityAssessment(assessment);
  assert.equal(validation.valid, true);
  assert.equal(validation.passed, true);
  assert.equal(validation.code, 'OK');
});

test('QualityAssessment: 严格来源门禁 - 合规通过绝不能单独解锁文学通过状态', () => {
  // 场景：只有 compliance 通过，未进行真实文学评估 (literary 为空或 NOT_MEASURED)
  const assessment = createQualityAssessment({
    compliance: {
      passed: true,
      checks: {
        wordCount: { passed: true, charCount: 3000 },
        characterPresence: { passed: true, characters: ['陈寻', '三叔'] }
      },
      blockerCount: 0,
      issues: []
    },
    literary: {
      passed: false,
      status: 'NOT_MEASURED',
      dimensions: {}
    },
    style: { passed: true },
    aiFlavor: { passed: true, risk: 'clean' }
  });

  // compliance 虽为 true，但 literary 为 false，全局绝对不能为 true
  assert.equal(assessment.compliance.passed, true);
  assert.equal(assessment.literary.passed, false);
  assert.equal(assessment.passed, false);
  assert.equal(assessment.status, 'NOT_MEASURED');

  // 篡改测试：若有人强行修改 assessment.passed = true，validateQualityAssessment 必须拦截不变式违规
  const tamperedAssessment = {
    ...assessment,
    passed: true
  };
  const valResult = validateQualityAssessment(tamperedAssessment);
  assert.equal(valResult.valid, false);
  assert.equal(valResult.passed, false);
  assert.equal(valResult.code, 'SCHEMA_INVARIANT_VIOLATION');
  assert.ok(valResult.violations.some(v => v.code === 'SCHEMA_INVARIANT_VIOLATION'));
});

test('QualityAssessment: 严格来源门禁 - 代理/规则检查器仅能作为合规证据，严禁伪造文学层评分', () => {
  const proxySources = [
    'linguistic_metrics_analyzer',
    'dialogue_extractor',
    'character_presence_verifier',
    'chapter_goal_prose_verifier',
    'causal_debt_prose_verifier',
    'pov_and_clue_boundary_evaluator',
    'word_count',
    'fact_consistency_verifier',
    'heuristic',
    'presence'
  ];

  // 验证每个代理来源均被 isProxySource 准确识别
  for (const src of proxySources) {
    assert.equal(isProxySource(src), true, `来源「${src}」应被判定为代理来源`);
  }

  // 尝试在 literary.dimensions 中传入代理指标以企图冒充文学评分
  const assessment = createQualityAssessment({
    compliance: { passed: true, checks: {} },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.95,
      confidence: 0.95,
      dimensions: {
        language: {
          value: 0.95,
          status: 'MEASURED',
          confidence: 0.95,
          source: 'linguistic_metrics_analyzer',
          evidence: ['字符数=2400', '句子数=40']
        },
        dialogue: {
          value: 0.90,
          status: 'MEASURED',
          confidence: 0.90,
          source: 'dialogue_extractor',
          evidence: ['对白提取总句数=14']
        },
        causality: {
          value: 0.88,
          status: 'MEASURED',
          confidence: 0.90,
          source: 'causal_debt_prose_verifier',
          evidence: ['初筛完成']
        }
      }
    }
  });

  // 来源门禁约束生效：代理来源被强制剥离文学层，转入 compliance.checks
  assert.equal(Object.keys(assessment.literary.dimensions).length, 0);
  assert.equal(assessment.literary.passed, false);
  assert.equal(assessment.passed, false);
  assert.ok(assessment.compliance.checks.language);
  assert.ok(assessment.compliance.checks.dialogue);
  assert.ok(assessment.compliance.checks.causality);

  // provenance 记录侵入违规
  assert.equal(assessment.provenance.valid, false);
  assert.equal(assessment.provenance.violations.length, 3);
  assert.equal(assessment.provenance.literarySourcesGenuine, false);

  // 校验器同样拦截潜藏在 literary.dimensions 的代理来源
  const rawWithProxy = {
    schemaVersion: SCHEMA_VERSION,
    passed: true,
    status: 'MEASURED',
    score: 0.9,
    confidence: 0.9,
    compliance: { passed: true, checks: {}, blockerCount: 0, issues: [] },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.9,
      confidence: 0.9,
      dimensions: {
        language: {
          score: 0.9,
          value: 0.9,
          status: 'MEASURED',
          confidence: 0.9,
          source: 'linguistic_metrics_analyzer',
          quote: '正文片段测试'
        }
      }
    },
    style: { passed: true },
    aiFlavor: { passed: true, risk: 'clean' }
  };
  const rawVal = validateQualityAssessment(rawWithProxy);
  assert.equal(rawVal.valid, false);
  assert.equal(rawVal.code, 'LITERARY_PROVENANCE_VIOLATION');
  assert.ok(rawVal.violations.some(v => v.code === 'LITERARY_PROVENANCE_VIOLATION'));
});

test('QualityAssessment: 真实文学评测证据（有效引文、分数>=0.70、置信度>=0.75）被无误报接纳', () => {
  const proseText = `林晨推开锈蚀的铁门，冷风裹挟着湿泥的腥气扑面而来。
身后的老陈握紧了短刀，刀锋在昏黄的路灯下泛着微光。
“目标在三号仓库。”林晨压低声音，目光穿过雨幕锁定远处的铁皮棚。`;

  const assessment = createQualityAssessment({
    compliance: {
      passed: true,
      checks: { wordCount: { passed: true, count: 120 } }
    },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.85,
      confidence: 0.90,
      evaluator: { mode: 'single', modelId: 'claude-3-5-sonnet', promptVersion: 'judge-v2' },
      dimensions: {
        language: {
          score: 0.85,
          value: 0.85,
          status: 'MEASURED',
          confidence: 0.90,
          source: 'literary_evaluator',
          quote: '冷风裹挟着湿泥的腥气扑面而来',
          evidence: ['引文「冷风裹挟着湿泥的腥气扑面而来」感官描写细腻真实']
        },
        dialogue: {
          score: 0.82,
          value: 0.82,
          status: 'MEASURED',
          confidence: 0.88,
          source: 'single_judge',
          quote: '目标在三号仓库。',
          evidence: ['人物对话简练精准，符合潜入紧张情境']
        },
        logic: {
          score: 0.80,
          value: 0.80,
          status: 'MEASURED',
          confidence: 0.85,
          source: 'literary_evaluator',
          quote: '目光穿过雨幕锁定远处的铁皮棚',
          evidence: ['空间推进行动线合理']
        }
      }
    },
    style: { passed: true, score: 0.85 },
    aiFlavor: { passed: true, risk: 'clean', score: 0.05 },
    contentDigest: sha256(proseText),
    genre: '都市'
  });

  assert.equal(assessment.passed, true);
  assert.equal(assessment.status, 'MEASURED');
  assert.equal(assessment.literary.passed, true);

  // 结合正文严格校验引文可定位性
  const validation = validateQualityAssessment(assessment, {
    prose: proseText,
    genre: '都市'
  });
  assert.equal(validation.valid, true);
  assert.equal(validation.passed, true);
  assert.equal(validation.code, 'OK');
  assert.equal(validation.errors.length, 0);
  assert.equal(validation.violations.length, 0);
});

test('QualityAssessment: 消极缺省词与不存在引文被严格拦截', () => {
  const proseText = '真实的章节正文内容，主角正在观察四周环境。';

  // 1. 引文包含消极缺省词（如“未检测到违规”）
  const negativeAssessment = createQualityAssessment({
    compliance: { passed: true },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.85,
      confidence: 0.90,
      dimensions: {
        language: {
          score: 0.85,
          value: 0.85,
          status: 'MEASURED',
          confidence: 0.90,
          source: 'literary_evaluator',
          quote: '未检测到违规内容',
          evidence: ['未检测到违规内容']
        }
      }
    }
  });

  const valNeg = validateQualityAssessment(negativeAssessment, { prose: proseText });
  assert.equal(valNeg.valid, false);
  assert.ok(valNeg.errors.some(e => e.includes('消极缺省/无违规词汇')));

  // 2. 引文不存在于正文中
  const fictitiousAssessment = createQualityAssessment({
    compliance: { passed: true },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.85,
      confidence: 0.90,
      dimensions: {
        language: {
          score: 0.85,
          value: 0.85,
          status: 'MEASURED',
          confidence: 0.90,
          source: 'literary_evaluator',
          quote: '这是完全编造的虚假正文引文片段',
          evidence: ['这是完全编造的虚假正文引文片段']
        }
      }
    }
  });

  const valFict = validateQualityAssessment(fictitiousAssessment, { prose: proseText });
  assert.equal(valFict.valid, false);
  assert.ok(valFict.errors.some(e => e.includes('不存在于正文中')));
});

test('QualityAssessment: 低评分与低置信度无法解锁文学通过状态', () => {
  // 分数未达 0.70
  const lowScoreAssessment = createQualityAssessment({
    compliance: { passed: true },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.65,
      confidence: 0.90,
      dimensions: {
        language: {
          score: 0.65,
          status: 'MEASURED',
          confidence: 0.90,
          source: 'literary_evaluator',
          quote: '测试文本正文'
        }
      }
    }
  });
  assert.equal(lowScoreAssessment.literary.passed, false);
  assert.equal(lowScoreAssessment.passed, false);

  // 置信度未达 0.75
  const lowConfAssessment = createQualityAssessment({
    compliance: { passed: true },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.85,
      confidence: 0.60,
      dimensions: {
        language: {
          score: 0.85,
          status: 'MEASURED',
          confidence: 0.60,
          source: 'literary_evaluator',
          quote: '测试文本正文'
        }
      }
    }
  });
  assert.equal(lowConfAssessment.literary.passed, false);
  assert.equal(lowConfAssessment.passed, false);
});

test('QualityAssessment: AI 笔调 Critical 风险拦截评估通过', () => {
  const criticalAiAssessment = createQualityAssessment({
    compliance: { passed: true },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.85,
      confidence: 0.85,
      dimensions: {
        language: { score: 0.85, status: 'MEASURED', confidence: 0.85, source: 'literary_evaluator' }
      }
    },
    aiFlavor: {
      passed: false,
      risk: 'critical',
      score: 0.92,
      status: 'MEASURED'
    }
  });

  assert.equal(criticalAiAssessment.aiFlavor.passed, false);
  assert.equal(criticalAiAssessment.passed, false);
  assert.equal(criticalAiAssessment.status, 'needs_human');

  const valResult = validateQualityAssessment(criticalAiAssessment);
  assert.equal(valResult.passed, false);
});

test('QualityAssessment: Style 层失败拦截评估通过', () => {
  const styleFailedAssessment = createQualityAssessment({
    compliance: { passed: true },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.85,
      confidence: 0.85,
      dimensions: {
        language: { score: 0.85, status: 'MEASURED', confidence: 0.85, source: 'literary_evaluator' }
      }
    },
    style: {
      passed: false,
      score: 0.35,
      evidence: ['句式极度机械单一']
    }
  });

  assert.equal(styleFailedAssessment.style.passed, false);
  assert.equal(styleFailedAssessment.passed, false);
});

test('QualityAssessment: 双评委 (Dual Judge) 共识元数据留存', () => {
  const dualJudgeAssessment = createQualityAssessment({
    compliance: { passed: true },
    literary: {
      passed: true,
      status: 'JUDGED',
      score: 0.86,
      confidence: 0.91,
      evaluator: {
        mode: 'dual',
        consensus: true,
        judgeA: { judgeId: 'judge-a', modelId: 'claude-3-5-sonnet', score: 0.85 },
        judgeB: { judgeId: 'judge-b', modelId: 'gpt-4o', score: 0.87 },
        scoreDelta: 0.02
      },
      dimensions: {
        language: { score: 0.86, status: 'JUDGED', confidence: 0.91, source: 'dual_judge_consensus' },
        causality: { score: 0.85, status: 'JUDGED', confidence: 0.90, source: 'dual_judge_consensus' },
        consistency: { score: 0.87, status: 'JUDGED', confidence: 0.92, source: 'dual_judge_consensus' }
      }
    },
    genre: '玄幻'
  });

  assert.equal(dualJudgeAssessment.passed, true);
  assert.equal(dualJudgeAssessment.status, 'JUDGED');
  assert.equal(dualJudgeAssessment.literary.evaluator.mode, 'dual');
  assert.equal(dualJudgeAssessment.literary.evaluator.judgeA.judgeId, 'judge-a');
  assert.equal(dualJudgeAssessment.literary.evaluator.judgeB.judgeId, 'judge-b');
  assert.equal(dualJudgeAssessment.qualityVector.language.source, 'dual_judge_consensus');
});

test('QualityAssessment: validateGenerationAuditEvidence 无缝接纳 QualityAssessment 实体', () => {
  const content = '林晨站在空旷的青石道上，长刀出鞘半寸。风吹草动间，杀意森然。';
  const contentHash = sha256(content);

  const genuineAssessment = createQualityAssessment({
    compliance: {
      passed: true,
      checks: { wordCount: { passed: true } }
    },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.88,
      confidence: 0.90,
      dimensions: {
        causality: { score: 0.88, value: 0.88, status: 'MEASURED', confidence: 0.90, source: 'literary_evaluator' },
        consistency: { score: 0.85, value: 0.85, status: 'MEASURED', confidence: 0.90, source: 'literary_evaluator' },
        language: { score: 0.86, value: 0.86, status: 'MEASURED', confidence: 0.90, source: 'literary_evaluator' }
      }
    },
    style: { passed: true },
    aiFlavor: { passed: true, risk: 'clean' },
    contentDigest: contentHash,
    genre: '玄幻'
  });

  const validEvidence = validateGenerationAuditEvidence({
    generationId: 'gen-qa-test-1',
    chapterNo: 2,
    content,
    contentHash,
    genre: '玄幻',
    result: {
      draft: content,
      outputHash: contentHash,
      contract: { chapterNo: 2 },
      audit: { passed: true, blockerCount: 0, issues: [] },
      semanticAudit: { passed: true, audit: { passed: true, issues: [] } },
      quality: genuineAssessment
    }
  });

  assert.equal(validEvidence.ok, true);
  assert.equal(validEvidence.evidence.quality.schemaVersion, SCHEMA_VERSION);
  assert.equal(validEvidence.evidence.qualityAssessment.passed, true);
  assert.ok(validEvidence.evidence.quality.qualityVector.causality);

  // 当文学层为 false 时，validateGenerationAuditEvidence 阻断
  const failedLiteraryAssessment = createQualityAssessment({
    compliance: { passed: true },
    literary: {
      passed: false,
      status: 'NOT_MEASURED',
      dimensions: {}
    }
  });

  const invalidEvidence = validateGenerationAuditEvidence({
    generationId: 'gen-qa-test-2',
    chapterNo: 2,
    content,
    contentHash,
    genre: '玄幻',
    result: {
      draft: content,
      outputHash: contentHash,
      contract: { chapterNo: 2 },
      audit: { passed: true },
      semanticAudit: { passed: true, audit: { passed: true } },
      quality: failedLiteraryAssessment
    }
  });

  assert.equal(invalidEvidence.ok, false);
  assert.equal(invalidEvidence.code, 'LITERARY_QUALITY_REQUIRED');
});

test('QualityAssessment: 向后兼容 - 从 legacy qualityVector 输入正确迁移与投影', () => {
  // 历史调用方直接传入 options.qualityVector，包含部分代理指标和部分真实指标
  const legacyVector = {
    wordCountProxy: {
      value: 0.9,
      status: 'MEASURED',
      confidence: 0.9,
      source: 'word_count',
      evidence: ['字数符合要求']
    },
    language: {
      value: 0.85,
      score: 0.85,
      status: 'MEASURED',
      confidence: 0.9,
      source: 'literary_evaluator',
      quote: '陈寻走过长廊',
      evidence: ['引文「陈寻走过长廊」描写清晰']
    }
  };

  const assessment = createQualityAssessment({
    compliance: { passed: true },
    qualityVector: legacyVector
  });

  // wordCountProxy 作为代理来源被移入 compliance.checks
  assert.ok(assessment.compliance.checks.wordCountProxy);
  // language 作为真实来源保留在 literary.dimensions
  assert.ok(assessment.literary.dimensions.language);
  assert.equal(assessment.literary.dimensions.language.value, 0.85);

  // projected qualityVector 保留真实文学维度供历史代码访问
  assert.ok(assessment.qualityVector.language);
  assert.equal(assessment.qualityVector.language.score, 0.85);
  assert.equal(assessment.qualityVector.language.value, 0.85);
  assert.equal(assessment.qualityVector.wordCountProxy, undefined);
});

test('QualityAssessment: validateGenerationAuditEvidence 严查 QualityAssessment 来源违规与合规层阻断', () => {
  const content = '正文文本内容示例，章节描述。';
  const contentHash = sha256(content);

  // 1. QualityAssessment 合规层未通过
  const failedComplianceQA = createQualityAssessment({
    compliance: {
      passed: false,
      blockerCount: 1,
      issues: [{ severity: 'blocker', message: '格式错误' }]
    },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.85,
      confidence: 0.9,
      dimensions: {
        language: { score: 0.85, status: 'MEASURED', confidence: 0.9, source: 'literary_evaluator' }
      }
    }
  });

  const res1 = validateGenerationAuditEvidence({
    generationId: 'gen-qa-comp-fail',
    chapterNo: 1,
    content,
    contentHash,
    result: {
      draft: content,
      outputHash: contentHash,
      contract: { chapterNo: 1 },
      audit: { passed: true },
      semanticAudit: { passed: true, audit: { passed: true } },
      quality: failedComplianceQA
    }
  });
  assert.equal(res1.ok, false);
  assert.equal(res1.code, 'COMPLIANCE_AUDIT_REQUIRED');

  // 2. 伪造 QualityAssessment 中包含代理指标
  const provenanceViolationQA = {
    schemaVersion: SCHEMA_VERSION,
    passed: true,
    status: 'MEASURED',
    score: 0.88,
    confidence: 0.90,
    compliance: { passed: true, checks: {}, blockerCount: 0, issues: [] },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.88,
      confidence: 0.90,
      dimensions: {
        language: { score: 0.88, value: 0.88, status: 'MEASURED', confidence: 0.90, source: 'linguistic_metrics_analyzer' }
      }
    },
    qualityVector: {
      language: { score: 0.88, value: 0.88, status: 'MEASURED', confidence: 0.90, source: 'linguistic_metrics_analyzer' }
    }
  };

  const res2 = validateGenerationAuditEvidence({
    generationId: 'gen-qa-prov-fail',
    chapterNo: 1,
    content,
    contentHash,
    result: {
      draft: content,
      outputHash: contentHash,
      contract: { chapterNo: 1 },
      audit: { passed: true },
      semanticAudit: { passed: true, audit: { passed: true } },
      quality: provenanceViolationQA
    }
  });
  assert.equal(res2.ok, false);
  assert.equal(res2.code, 'CRITICAL_QUALITY_DIMENSION_PROVENANCE_VIOLATION');
});

test('QualityAssessment Remediation: Frozen QualityAssessment does not mutate or throw in validateGenerationAuditEvidence', () => {
  const content = '林晨站在空旷的青石道上，长刀出鞘半寸。风吹草动间，杀意森然。';
  const contentHash = sha256(content);

  const frozenQA = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    passed: true,
    status: 'MEASURED',
    score: 0.88,
    confidence: 0.90,
    genre: '玄幻',
    compliance: Object.freeze({ passed: true, checks: {}, blockerCount: 0, issues: [] }),
    literary: Object.freeze({
      passed: true,
      status: 'MEASURED',
      score: 0.88,
      confidence: 0.90,
      dimensions: Object.freeze({
        causality: Object.freeze({ score: 0.88, status: 'MEASURED', confidence: 0.90, source: 'literary_evaluator' }),
        consistency: Object.freeze({ score: 0.85, status: 'MEASURED', confidence: 0.90, source: 'literary_evaluator' }),
        language: Object.freeze({ score: 0.86, status: 'MEASURED', confidence: 0.90, source: 'literary_evaluator' })
      })
    }),
    style: Object.freeze({ passed: true, score: 0.85 }),
    aiFlavor: Object.freeze({ passed: true, risk: 'clean', score: 0.05 }),
    qualityVector: Object.freeze({
      causality: Object.freeze({ score: 0.88, status: 'MEASURED', confidence: 0.90, source: 'literary_evaluator' }),
      consistency: Object.freeze({ score: 0.85, status: 'MEASURED', confidence: 0.90, source: 'literary_evaluator' }),
      language: Object.freeze({ score: 0.86, status: 'MEASURED', confidence: 0.90, source: 'literary_evaluator' })
    })
  });

  assert.doesNotThrow(() => {
    const res = validateGenerationAuditEvidence({
      generationId: 'gen-frozen-qa',
      chapterNo: 1,
      content,
      contentHash,
      result: {
        draft: content,
        outputHash: contentHash,
        contract: { chapterNo: 1 },
        audit: { passed: true },
        semanticAudit: { passed: true, audit: { passed: true } },
        quality: frozenQA
      }
    });
    assert.equal(res.ok, true);
    assert.equal(res.evidence.qualityAssessment.passed, true);
  });
});

test('QualityAssessment Remediation: validateQualityAssessment enforces fail-closed invariants and genre fallback', () => {
  // 1. 全局 passed: true 但合规层为 false
  const forgedCompliance = {
    schemaVersion: SCHEMA_VERSION,
    passed: true,
    status: 'MEASURED',
    score: 0.85,
    confidence: 0.85,
    compliance: { passed: false, checks: {}, blockerCount: 1, issues: [{ severity: 'blocker' }] },
    literary: { passed: true, status: 'MEASURED', score: 0.85, confidence: 0.85, dimensions: { language: { score: 0.85, confidence: 0.85, status: 'MEASURED', source: 'literary_evaluator', quote: '真实正文引文' } } },
    style: { passed: true },
    aiFlavor: { passed: true, risk: 'clean' }
  };
  const val1 = validateQualityAssessment(forgedCompliance, { prose: '真实正文引文' });
  assert.equal(val1.valid, false);
  assert.equal(val1.passed, false);
  assert.equal(val1.code, 'SCHEMA_INVARIANT_VIOLATION');

  // 2. 在 options 中指定题材时触发题材关键维度核验
  const genreMissingQA = createQualityAssessment({
    genre: '玄幻',
    compliance: { passed: true },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.85,
      confidence: 0.85,
      dimensions: {
        language: { score: 0.85, status: 'MEASURED', confidence: 0.85, source: 'literary_evaluator', quote: '真实正文引文' }
      }
    }
  });
  const val2 = validateQualityAssessment(genreMissingQA, { prose: '真实正文引文', genre: '玄幻' });
  assert.equal(val2.valid, false);
  assert.ok(val2.errors.some(e => e.includes('必需关键维度')));
});


