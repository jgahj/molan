'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { createGenerationOrchestrator } = require('../lib/generation/orchestrator');
const { createJsonGenerationStore } = require('../lib/generation/json-store');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const {
  createQualityAssessment,
  validateQualityAssessment,
  validateGenerationAuditEvidence,
  CRITICAL_QUALITY_DIMENSIONS
} = require('../lib/generation/quality-assessment');
const { evaluateQualityGate } = require('../lib/generation/quality-gate');
const { evaluateDualJudgeConsensus, createJudgeEvaluationRecord } = require('../lib/quality/dual-judge');
const { hashValue, buildGenerationManifest } = require('../lib/generation/manifest');
const { contractHash } = require('../lib/generation/contract');
const { GenerationError } = require('../lib/generation/errors');

function computeSha256(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

/**
 * ==============================================================================
 * ADVERSARIAL SUITE 1: AC4 - Quality Gate Provenance Guard
 * ==============================================================================
 */

test('AC4-ADV-1: Combinatorial Proxy Score Flood - arbitrary combinations of proxy analyzers NEVER unlock literary passing status', () => {
  const prose = '雪山之巅，狂风卷积着冰晶拍打在面具上。白夜拔出腰间短刃，刀锋在昏暗日光下泛着幽蓝的微光。山谷下方的黑色潮水正在悄然上涨。';
  const digest = computeSha256(prose);

  // 包含 15 种不同命名、变体及大小写的代理指标
  const proxyAnalyzers = [
    'linguistic_metrics_analyzer',
    'linguistic_metric_analyzer_v2',
    'dialogue_extractor',
    'character_presence_verifier',
    'word_count',
    'char_counter',
    'heuristic_density',
    'causal_debt_prose_verifier',
    'chapter_goal_prose_verifier',
    'pov_and_clue_boundary_evaluator',
    'dialogue_density_evaluator',
    'fact_checker_verifier',
    'presence_scanner',
    'rule_checker',
    'proxy_heuristic_evaluator'
  ];

  // 1. 单独与组合构造伪造 literary dimensions
  for (let i = 0; i < proxyAnalyzers.length; i++) {
    const analyzer = proxyAnalyzers[i];
    const assessment = createQualityAssessment({
      genre: '通用',
      contentDigest: digest,
      compliance: { passed: true, checks: { base: { passed: true, score: 1.0 } } },
      literary: {
        passed: true,
        score: 0.99,
        confidence: 0.99,
        dimensions: {
          language: {
            score: 0.99,
            confidence: 0.99,
            status: 'MEASURED',
            source: analyzer,
            quote: '刀锋在昏暗日光下泛着幽蓝的微光',
            evidence: '代理指标分析计算得出极佳分数'
          }
        }
      }
    });

    // createQualityAssessment 必须将代理来源降级/驱逐到 compliance，绝不能让 literary.passed 为 true
    assert.equal(assessment.literary.passed, false, `代理指标 [${analyzer}] 绝不能让 assessment.literary.passed 为 true`);
    assert.equal(assessment.passed, false, `代理指标 [${analyzer}] 绝不能让 assessment.passed 为 true`);

    // evaluateQualityGate 必须阻断
    const gateRes = evaluateQualityGate({
      draft: prose,
      genre: '通用',
      quality: assessment
    });
    assert.equal(gateRes.passed, false, `质量门禁必须拦截代理指标 [${analyzer}]`);
    assert.equal(gateRes.status, 'needs_human');
  }

  // 2. 伪造多个代理指标同时提供不同维度的满分数据
  const multiProxyDimensions = {};
  for (const analyzer of proxyAnalyzers) {
    multiProxyDimensions[analyzer] = {
      score: 1.0,
      confidence: 1.0,
      status: 'MEASURED',
      source: analyzer,
      quote: '雪山之巅，狂风卷积着冰晶拍打在面具上',
      evidence: '完美匹配统计特征'
    };
  }

  const multiProxyAssessment = createQualityAssessment({
    genre: '科幻',
    contentDigest: digest,
    compliance: { passed: true, checks: { full: { passed: true, score: 1.0 } } },
    literary: {
      passed: true,
      score: 1.0,
      confidence: 1.0,
      dimensions: multiProxyDimensions
    }
  });

  assert.equal(multiProxyAssessment.literary.passed, false, '多重代理指标联合泛洪绝不能解锁文学层通过');
  assert.equal(multiProxyAssessment.passed, false);

  const multiGateRes = evaluateQualityGate({
    draft: prose,
    genre: '科幻',
    quality: multiProxyAssessment
  });
  assert.equal(multiGateRes.passed, false);
  assert.equal(multiGateRes.status, 'needs_human');
});

test('AC4-ADV-2: Negative Absence Trap - negative absence claims in quotes or evidence NEVER pass literary gate', () => {
  const prose = '荒原上只有枯树与碎石。李寻按下探测仪的红色按钮，屏幕上没有任何电磁反应，四周一片死寂。';
  const digest = computeSha256(prose);

  const negativeAbsencePhrases = [
    '未检测到逻辑异常',
    '未检出违规内容',
    '未发现剧情漏洞',
    '未见异常波动',
    '无异常记录',
    '无违规行为',
    '无问题发现',
    '零越界情况',
    '无明确冲突',
    '初筛完成无警报',
    '暂无冲突记录',
    '符合规范无瑕疵'
  ];

  for (const phrase of negativeAbsencePhrases) {
    const assessment = createQualityAssessment({
      genre: '通用',
      contentDigest: digest,
      compliance: { passed: true },
      literary: {
        passed: true,
        score: 0.95,
        confidence: 0.95,
        dimensions: {
          language: {
            score: 0.95,
            confidence: 0.95,
            status: 'MEASURED',
            source: 'literary_evaluator',
            quote: phrase,
            evidence: phrase
          }
        }
      }
    });

    assert.equal(assessment.literary.passed, false, `消极缺省短语 [${phrase}] 绝不能通过 createQualityAssessment`);

    const gateRes = evaluateQualityGate({
      draft: prose,
      genre: '通用',
      quality: assessment
    });
    assert.equal(gateRes.passed, false, `消极缺省短语 [${phrase}] 绝不能通过 evaluateQualityGate`);
    assert.equal(gateRes.status, 'needs_human');
  }
});

test('AC4-ADV-3: Root Flag Spoofing Defense - root passed/status cannot bypass missing or invalid literary dimensions', () => {
  const prose = '青石板路上响起了清脆的马蹄声。少年按了按头上的斗笠，将佩剑藏入灰色的长袍下。';
  const digest = computeSha256(prose);

  // 1. 根级别伪造 passed: true, status: 'MEASURED', 但 literary 缺失
  const missingLiteraryQuality = {
    passed: true,
    status: 'MEASURED',
    contentDigest: digest,
    compliance: { passed: true, checks: { length: { passed: true } } }
  };
  const gateRes1 = evaluateQualityGate({
    draft: prose,
    genre: '通用',
    quality: missingLiteraryQuality
  });
  assert.equal(gateRes1.passed, false);
  assert.equal(gateRes1.status, 'needs_human');
  assert.equal(gateRes1.code, 'QUALITY_UNMEASURED');

  // 2. 根级别伪造 passed: true, 但 literary.passed 为 false
  const literaryFailedQuality = {
    passed: true,
    status: 'MEASURED',
    contentDigest: digest,
    compliance: { passed: true },
    literary: {
      passed: false,
      status: 'MEASURED',
      score: 0.85,
      confidence: 0.90,
      dimensions: {
        language: {
          score: 0.85,
          confidence: 0.90,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '青石板路上响起了清脆的马蹄声',
          evidence: '描写生动自然'
        }
      }
    }
  };
  const gateRes2 = evaluateQualityGate({
    draft: prose,
    genre: '通用',
    quality: literaryFailedQuality
  });
  assert.equal(gateRes2.passed, false);
  assert.equal(gateRes2.status, 'needs_human');
  assert.equal(gateRes2.code, 'LITERARY_QUALITY_REQUIRED');

  // 3. 根级别伪造 independentEvidence: false
  const noIndependentQuality = {
    passed: true,
    status: 'MEASURED',
    independentEvidence: false,
    contentDigest: digest,
    compliance: { passed: true },
    literary: {
      passed: true,
      status: 'MEASURED',
      score: 0.88,
      confidence: 0.90,
      dimensions: {
        language: {
          score: 0.88,
          confidence: 0.90,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '青石板路上响起了清脆的马蹄声',
          evidence: '意境清澈'
        }
      }
    }
  };
  const gateRes3 = evaluateQualityGate({
    draft: prose,
    genre: '通用',
    quality: noIndependentQuality
  });
  assert.equal(gateRes3.passed, false);
  assert.equal(gateRes3.code, 'QUALITY_UNMEASURED');
});

test('AC4-ADV-4: Authentic Literary Recognition across Genres despite Heavy Compliance Proxy Noise', () => {
  const genresToTest = [
    {
      genre: '科幻',
      prose: '曲率引擎的冷却管路喷出淡淡的白雾。陈院士紧盯着全息光谱仪上的干涉条纹，重力透镜的坍缩曲率已超出理论极限。如果质能守恒定律在微观奇点处失效，整座星港都将在三秒内被撕裂成基本粒子。',
      dimensions: {
        speculativeConsistency: {
          score: 0.90,
          confidence: 0.92,
          quote: '如果质能守恒定律在微观奇点处失效，整座星港都将在三秒内被撕裂成基本粒子。',
          evidence: '科幻硬设定前后一致，奇点灾变推论严密'
        },
        logic: {
          score: 0.88,
          confidence: 0.90,
          quote: '曲率引擎的冷却管路喷出淡淡的白雾。陈院士紧盯着全息光谱仪上的干涉条纹',
          evidence: '危机处置因果逻辑连贯'
        },
        language: {
          score: 0.86,
          confidence: 0.88,
          quote: '重力透镜的坍缩曲率已超出理论极限。',
          evidence: '科学术语与叙事节奏融合自然'
        }
      }
    },
    {
      genre: '悬疑',
      prose: '旧钟楼的铜钟敲响了第十三下。苏桐蹲在满是煤灰的地板前，手电筒的光斑定格在半枚带血的黄铜纽扣上。死者生前紧抓着窗棂，但窗锁是从内侧被反锁的，屋里没有第三个人的脚印。',
      dimensions: {
        clueIntegrity: {
          score: 0.92,
          confidence: 0.95,
          quote: '手电筒的光斑定格在半枚带血的黄铜纽扣上。',
          evidence: '物证线索真实可信且有正文锚定'
        },
        povBoundary: {
          score: 0.89,
          confidence: 0.91,
          quote: '苏桐蹲在满是煤灰的地板前，手电筒的光斑定格在半枚带血的黄铜纽扣上。',
          evidence: '第一人称/受限视点严格守界无全知越界'
        },
        language: {
          score: 0.87,
          confidence: 0.90,
          quote: '死者生前紧抓着窗棂，但窗锁是从内侧被反锁的',
          evidence: '密室疑云渲染凝练有力'
        }
      }
    },
    {
      genre: '历史',
      prose: '残阳如血，古老的雁门关在飞雪中巍然矗立。裴将军扶着斑驳的雉堞，俯瞰着塞外如蚁附般的骑兵大阵。三十门红夷大炮已经在关城之上就位，火药包覆着厚厚的油布以防受潮。',
      dimensions: {
        historicalPlausibility: {
          score: 0.91,
          confidence: 0.93,
          quote: '三十门红夷大炮已经在关城之上就位，火药包覆着厚厚的油布以防受潮。',
          evidence: '火器形制与古代战地防潮细节严谨考据'
        },
        logic: {
          score: 0.88,
          confidence: 0.90,
          quote: '裴将军扶着斑驳的雉堞，俯瞰着塞外如蚁附般的骑兵大阵。',
          evidence: '战守攻防态势逻辑自洽'
        },
        language: {
          score: 0.89,
          confidence: 0.92,
          quote: '残阳如血，古老的雁门关在飞雪中巍然矗立。',
          evidence: '边塞苍凉气象跃然纸上'
        }
      }
    },
    {
      genre: '通用',
      prose: '雨后的泥土散发着青草的清香。陆先生合上手中的书卷，静静看着庭院中纷落的杏花。岁月流转，故人已乘长风远去。',
      dimensions: {
        language: {
          score: 0.85,
          confidence: 0.90,
          quote: '雨后的泥土散发着青草的清香。陆先生合上手中的书卷',
          evidence: '写景寄情，文字清朗素雅'
        }
      }
    }
  ];

  for (const { genre, prose, dimensions } of genresToTest) {
    const digest = computeSha256(prose);

    const heavyComplianceChecks = {
      wordCount: { passed: true, score: 1.0, source: 'word_count' },
      charCounter: { passed: true, score: 1.0, source: 'char_counter' },
      dialogueExtractor: { passed: true, score: 0.85, source: 'dialogue_extractor' },
      linguisticMetrics: { passed: true, score: 0.90, source: 'linguistic_metrics_analyzer' },
      characterPresence: { passed: true, score: 1.0, source: 'character_presence_verifier' },
      causalDebt: { passed: true, score: 0.95, source: 'causal_debt_prose_verifier' },
      dialogueDensity: { passed: true, score: 0.80, source: 'dialogue_density_evaluator' },
      factScanner: { passed: true, score: 0.92, source: 'fact_checker_verifier' },
      boundaryCheck: { passed: true, score: 1.0, source: 'pov_and_clue_boundary_evaluator' },
      heuristicCheck: { passed: true, score: 0.88, source: 'heuristic' }
    };

    const literaryDimsFormatted = {};
    for (const [dimKey, dimVal] of Object.entries(dimensions)) {
      literaryDimsFormatted[dimKey] = {
        score: dimVal.score,
        confidence: dimVal.confidence,
        status: 'MEASURED',
        source: 'literary_evaluator',
        quote: dimVal.quote,
        evidence: dimVal.evidence
      };
    }

    const assessment = createQualityAssessment({
      genre,
      contentDigest: digest,
      compliance: {
        passed: true,
        checks: heavyComplianceChecks
      },
      literary: {
        passed: true,
        score: 0.89,
        confidence: 0.92,
        evaluator: { mode: 'single', modelId: 'test-evaluator' },
        dimensions: literaryDimsFormatted
      },
      style: { passed: true, score: 0.85, status: 'MEASURED' },
      aiFlavor: { passed: true, risk: 'clean', score: 5, status: 'MEASURED' }
    });

    assert.equal(assessment.passed, true, `题材 [${genre}] 在真实文学证据完备时评估必须为 passed`);
    assert.equal(assessment.literary.passed, true);

    const gateRes = evaluateQualityGate({
      draft: prose,
      genre,
      quality: assessment
    });

    assert.equal(gateRes.passed, true, `题材 [${genre}] 虽有大量合规代理指标，但真实文学证据绝对不能发生误报拦截`);
    assert.equal(gateRes.status, 'passed');
    assert.equal(gateRes.code, 'OK');
  }
});

test('AC4-ADV-5: Boundary Threshold Stress - exact 0.70 score and 0.75 confidence boundaries', () => {
  const prose = '晨曦刺破浓雾，露水顺着青绿的竹叶滑落，滴入幽深的山溪中。';
  const digest = computeSha256(prose);

  // 1. 0.6999 分数在 createQualityAssessment 中即被标记为未通过且未测量
  const subScoreQuality = createQualityAssessment({
    genre: '通用',
    contentDigest: digest,
    compliance: { passed: true },
    literary: {
      passed: true,
      score: 0.6999,
      confidence: 0.80,
      dimensions: {
        language: {
          score: 0.6999,
          confidence: 0.80,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '晨曦刺破浓雾',
          evidence: '描写尚可'
        }
      }
    }
  });
  assert.equal(subScoreQuality.literary.passed, false);
  assert.equal(subScoreQuality.passed, false);
  const gateResSubScore = evaluateQualityGate({ draft: prose, genre: '通用', quality: subScoreQuality });
  assert.equal(gateResSubScore.passed, false);
  assert.equal(gateResSubScore.status, 'needs_human');

  // 直接送入 evaluateQualityGate 时的细分拦截码为 QUALITY_THRESHOLD_NOT_MET
  const rawSubScoreQuality = {
    passed: true,
    status: 'MEASURED',
    contentDigest: digest,
    compliance: { passed: true },
    literary: {
      passed: true,
      status: 'MEASURED',
      dimensions: {
        language: {
          score: 0.6999,
          confidence: 0.85,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '晨曦刺破浓雾',
          evidence: '描写尚可'
        }
      }
    }
  };
  const gateResRawScore = evaluateQualityGate({ draft: prose, genre: '通用', quality: rawSubScoreQuality });
  assert.equal(gateResRawScore.passed, false);
  assert.equal(gateResRawScore.code, 'QUALITY_THRESHOLD_NOT_MET');

  // 2. 0.7499 置信度必须被拦截
  const rawSubConfQuality = {
    passed: true,
    status: 'MEASURED',
    contentDigest: digest,
    compliance: { passed: true },
    literary: {
      passed: true,
      status: 'MEASURED',
      dimensions: {
        language: {
          score: 0.75,
          confidence: 0.7499,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '晨曦刺破浓雾',
          evidence: '描写尚可'
        }
      }
    }
  };
  const gateResSubConf = evaluateQualityGate({ draft: prose, genre: '通用', quality: rawSubConfQuality });
  assert.equal(gateResSubConf.passed, false);
  assert.equal(gateResSubConf.code, 'QUALITY_CONFIDENCE_LOW');

  // 3. 恰好 0.70 分数与 0.75 置信度必须顺利通过
  const boundaryQuality = createQualityAssessment({
    genre: '通用',
    contentDigest: digest,
    compliance: { passed: true },
    literary: {
      passed: true,
      score: 0.70,
      confidence: 0.75,
      dimensions: {
        language: {
          score: 0.70,
          confidence: 0.75,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '晨曦刺破浓雾',
          evidence: '描写符合标准'
        }
      }
    }
  });
  const gateResBoundary = evaluateQualityGate({ draft: prose, genre: '通用', quality: boundaryQuality });
  assert.equal(gateResBoundary.passed, true);
  assert.equal(gateResBoundary.code, 'OK');
});

/**
 * ==============================================================================
 * ADVERSARIAL SUITE 2: AC5 - Commit Fencing & Stress-Testing
 * ==============================================================================
 */

test('AC5-ADV-1: Hash Tampering Matrix - text or hash modifications are categorically rejected', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-adv-ac5-tamper-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-adv-1', projectId: 'proj-adv-1', actorUserId: 'author-adv-1' };
  const runId = 'run-adv-tamper';
  const authenticProse = '秋风萧瑟，黄叶铺满了青石小径。老道士手持拂尘，站在道观门前默诵经文。';
  const authenticHash = hashValue(authenticProse);

  let commitInvoked = false;
  const deps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '通用' }),
    resolveStyle: async () => ({ status: 'resolved', style: '传统白描' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 'snap-adv-1', storyContext: {} }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 'snap-adv-1' }),
    planScenes: async () => [{ id: 's1', goal: '道观守静' }],
    writer: async () => ({
      text: authenticProse,
      manifest: buildGenerationManifest({
        generationId: runId,
        projectId: scope.projectId,
        chapterId: 'ch-adv-01',
        pipelineVersion: 'content-engine-v2',
        contextHash: 'c-hash',
        contractHash: 'ct-hash',
        promptHash: 'p-hash',
        outputHash: authenticHash
      })
    }),
    deterministicAudit: async () => ({ passed: true, blockerCount: 0, issues: [] }),
    semanticAudit: async () => ({ passed: true, status: 'MEASURED', issues: [] }),
    qualityAudit: async () => createQualityAssessment({
      genre: '通用',
      contentDigest: authenticHash,
      compliance: { passed: true },
      literary: {
        passed: true,
        score: 0.85,
        confidence: 0.90,
        dimensions: {
          language: {
            score: 0.85,
            confidence: 0.90,
            status: 'MEASURED',
            source: 'literary_evaluator',
            quote: '秋风萧瑟，黄叶铺满了青石小径。',
            evidence: '意象清雅'
          }
        }
      }
    }),
    commit: async () => {
      commitInvoked = true;
      return { committed: true, snapshotId: 'snap-committed-1', contentHash: authenticHash, version: 1 };
    }
  };

  const orchestrator = createGenerationOrchestrator({ store, db: repository, dependencies: deps });
  await orchestrator.create({
    ...scope,
    id: runId,
    chapterId: 'ch-adv-01',
    idempotencyKey: 'idem-adv-tamper',
    requestHash: '1'.repeat(64),
    request: { chapterId: 'ch-adv-01', prompt: '秋风道观' }
  });

  // 等待达成 waiting_author
  let waitingRun = null;
  for (let i = 0; i < 80; i++) {
    waitingRun = await store.getRun({}, { ...scope, id: runId });
    if (waitingRun && waitingRun.state === 'waiting_author') break;
    await new Promise(r => setTimeout(r, 20));
  }
  assert.ok(waitingRun);
  assert.equal(waitingRun.state, 'waiting_author');

  // 攻击场景 A: 正确正文 + 篡改的 outputHash -> 必须拒绝
  await assert.rejects(
    async () => {
      await orchestrator.commit({
        ...scope,
        id: runId,
        text: authenticProse,
        outputHash: 'f'.repeat(64)
      });
    },
    /STATE_CONFLICT|不一致/
  );
  assert.equal(commitInvoked, false, '后端 commit 绝不能被触发');

  // 攻击场景 B: 篡改正文（仅变动 1 个标点） + 原 outputHash -> 必须拒绝
  const tamperedProse1 = authenticProse.replace('。', '！');
  await assert.rejects(
    async () => {
      await orchestrator.commit({
        ...scope,
        id: runId,
        text: tamperedProse1,
        outputHash: authenticHash
      });
    },
    /STATE_CONFLICT|不一致/
  );
  assert.equal(commitInvoked, false);

  // 攻击场景 C: 篡改正文 + 篡改正文自计算的 outputHash (两边匹配，但与 run.result.outputHash 不符) -> 必须拒绝
  const tamperedHash = hashValue(tamperedProse1);
  await assert.rejects(
    async () => {
      await orchestrator.commit({
        ...scope,
        id: runId,
        text: tamperedProse1,
        outputHash: tamperedHash
      });
    },
    /STATE_CONFLICT|不一致/
  );
  assert.equal(commitInvoked, false);

  // 攻击场景 D: 空正文 / 空 outputHash -> 必须拒绝
  await assert.rejects(
    async () => {
      await orchestrator.commit({
        ...scope,
        id: runId,
        text: '',
        outputHash: authenticHash
      });
    },
    /STATE_CONFLICT|不一致/
  );
  assert.equal(commitInvoked, false);
});

test('AC5-ADV-2: State Machine Gating Defense - cannot commit from non-waiting_author states or unmeasured quality', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-adv-ac5-state-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-adv-2', projectId: 'proj-adv-2', actorUserId: 'author-adv-2' };
  const runId = 'run-adv-states';
  const prose = '铁骑破关，烽烟蔽日。长戈如林，直指苍穹。';
  const proseHash = hashValue(prose);

  const orchestrator = createGenerationOrchestrator({
    store,
    db: repository,
    dependencies: {
      resolveGenre: async () => ({ status: 'resolved', genre: '历史' }),
      resolveStyle: async () => ({ status: 'resolved', style: '铁血' }),
      loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 's', storyContext: {} }),
      preGenerationGuard: async () => ({ passed: true, snapshotHash: 's' }),
      planScenes: async () => [{ id: 's1', goal: '攻城' }],
      writer: async () => ({
        text: prose,
        manifest: buildGenerationManifest({
          generationId: runId,
          projectId: scope.projectId,
          chapterId: 'ch-01',
          pipelineVersion: 'v2',
          contextHash: 'c',
          contractHash: 'ct',
          promptHash: 'p',
          outputHash: proseHash
        })
      }),
      deterministicAudit: async () => ({ passed: true, blockerCount: 0, issues: [] }),
      semanticAudit: async () => ({ passed: true, status: 'MEASURED', issues: [] }),
      qualityAudit: async () => ({
        passed: false,
        status: 'needs_human',
        contentDigest: proseHash,
        compliance: { passed: true },
        literary: { passed: false, status: 'NOT_MEASURED', dimensions: {} }
      }),
      commit: async () => ({ committed: true })
    }
  });

  await orchestrator.create({
    ...scope,
    id: runId,
    chapterId: 'ch-01',
    idempotencyKey: 'idem-adv-state',
    requestHash: '2'.repeat(64),
    request: { chapterId: 'ch-01', prompt: '铁骑破关' }
  });

  let needsHumanRun = null;
  for (let i = 0; i < 80; i++) {
    needsHumanRun = await store.getRun({}, { ...scope, id: runId });
    if (needsHumanRun && needsHumanRun.state === 'needs_human') break;
    await new Promise(r => setTimeout(r, 20));
  }
  assert.ok(needsHumanRun);
  assert.equal(needsHumanRun.state, 'needs_human');

  // 尝试对 needs_human 状态的任务直接执行 commit -> 必须被 STATE_CONFLICT 拦截
  await assert.rejects(
    async () => {
      await orchestrator.commit({
        ...scope,
        id: runId,
        text: prose,
        outputHash: proseHash
      });
    },
    err => err && err.code === 'STATE_CONFLICT'
  );
});

test('AC5-ADV-3: Monotonic Fencing Token & Idempotency Replay Stress', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-adv-ac5-idemp-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-adv-4', projectId: 'proj-adv-4', actorUserId: 'author-adv-4' };
  const runId = 'run-adv-idemp';
  const prose = '翠竹摇曳，清泉石上流。山居岁月静好，无世俗纷扰。';
  const proseHash = hashValue(prose);

  let backendCommitCount = 0;
  const deps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '通用' }),
    resolveStyle: async () => ({ status: 'resolved', style: '山水诗意' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 's', storyContext: {} }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 's' }),
    planScenes: async () => [{ id: 's1', goal: '山居' }],
    writer: async () => ({
      text: prose,
      manifest: buildGenerationManifest({
        generationId: runId,
        projectId: scope.projectId,
        chapterId: 'ch-01',
        pipelineVersion: 'v2',
        contextHash: 'c',
        contractHash: 'ct',
        promptHash: 'p',
        outputHash: proseHash
      })
    }),
    deterministicAudit: async () => ({ passed: true, blockerCount: 0, issues: [] }),
    semanticAudit: async () => ({ passed: true, status: 'MEASURED', issues: [] }),
    qualityAudit: async () => createQualityAssessment({
      genre: '通用',
      contentDigest: proseHash,
      compliance: { passed: true },
      literary: {
        passed: true,
        score: 0.88,
        confidence: 0.90,
        dimensions: {
          language: {
            score: 0.88,
            confidence: 0.90,
            status: 'MEASURED',
            source: 'literary_evaluator',
            quote: '翠竹摇曳，清泉石上流。',
            evidence: '意境生动'
          }
        }
      }
    }),
    commit: async () => {
      backendCommitCount++;
      return { committed: true, snapshotId: 'snap-idemp-success', contentHash: proseHash, version: 1 };
    }
  };

  const orchestrator = createGenerationOrchestrator({ store, db: repository, dependencies: deps });
  await orchestrator.create({
    ...scope,
    id: runId,
    chapterId: 'ch-01',
    idempotencyKey: 'idem-adv-idemp',
    requestHash: '4'.repeat(64),
    request: { chapterId: 'ch-01', prompt: '山居岁月' }
  });

  let waitingRun = null;
  for (let i = 0; i < 80; i++) {
    waitingRun = await store.getRun({}, { ...scope, id: runId });
    if (waitingRun && waitingRun.state === 'waiting_author') break;
    await new Promise(r => setTimeout(r, 20));
  }
  assert.ok(waitingRun);
  const initialFencingToken = waitingRun.fencingToken;

  // 第一次正常提交
  const firstCommit = await orchestrator.commit({
    ...scope,
    id: runId,
    text: prose,
    outputHash: proseHash
  });
  assert.equal(firstCommit.idempotent, false);
  assert.equal(firstCommit.run.state, 'committed');
  assert.equal(firstCommit.run.fencingToken, initialFencingToken + 1);
  assert.equal(backendCommitCount, 1);

  // 租约已释放
  const persisted = await repository.generation.get(scope.projectId, runId);
  assert.equal(persisted.state, 'committed');
  assert.equal(persisted.leaseOwner, '');
  assert.equal(persisted.leaseUntil, null);

  // 连续 5 次发起重放提交
  for (let i = 1; i <= 5; i++) {
    const replay = await orchestrator.commit({
      ...scope,
      id: runId,
      text: prose,
      outputHash: proseHash
    });
    assert.equal(replay.idempotent, true, `第 ${i} 次重放必须标记为 idempotent`);
    assert.equal(replay.run.state, 'committed');
    assert.equal(replay.run.fencingToken, initialFencingToken + 1, '幂等重放绝不无端递增 fencingToken');
    assert.equal(backendCommitCount, 1, '后端写操作绝不能二次调用');
  }

  // 重放时尝试篡改正文 -> 即便状态为 committed，也必须严格拒绝，不因幂等而网开一面
  await assert.rejects(
    async () => {
      await orchestrator.commit({
        ...scope,
        id: runId,
        text: '篡改的正文内容',
        outputHash: proseHash
      });
    },
    /STATE_CONFLICT|不一致/
  );
});

test('AC5-ADV-4: Concurrency Commit Fencing & Active Lease Conflict Defense', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-adv-ac5-race-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-adv-3', projectId: 'proj-adv-3', actorUserId: 'author-adv-3' };
  const runId = 'run-adv-race';
  const prose = '夜泊枫桥，客船微晃。寒山寺的半夜钟声穿透薄雾，在寂静的水面上回荡。';
  const proseHash = hashValue(prose);

  let backendCommitCount = 0;
  let commitGateResolver = null;
  const commitGatePromise = new Promise(resolve => { commitGateResolver = resolve; });

  const deps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '通用' }),
    resolveStyle: async () => ({ status: 'resolved', style: '古典白描' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 's', storyContext: {} }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 's' }),
    planScenes: async () => [{ id: 's1', goal: '夜泊' }],
    writer: async () => ({
      text: prose,
      manifest: buildGenerationManifest({
        generationId: runId,
        projectId: scope.projectId,
        chapterId: 'ch-01',
        pipelineVersion: 'v2',
        contextHash: 'c',
        contractHash: 'ct',
        promptHash: 'p',
        outputHash: proseHash
      })
    }),
    deterministicAudit: async () => ({ passed: true, blockerCount: 0, issues: [] }),
    semanticAudit: async () => ({ passed: true, status: 'MEASURED', issues: [] }),
    qualityAudit: async () => createQualityAssessment({
      genre: '通用',
      contentDigest: proseHash,
      compliance: { passed: true },
      literary: {
        passed: true,
        score: 0.90,
        confidence: 0.95,
        dimensions: {
          language: {
            score: 0.90,
            confidence: 0.95,
            status: 'MEASURED',
            source: 'literary_evaluator',
            quote: '夜泊枫桥，客船微晃。',
            evidence: '意境悠远'
          }
        }
      }
    }),
    commit: async () => {
      backendCommitCount++;
      await commitGatePromise;
      return { committed: true, snapshotId: 'snap-race-success', contentHash: proseHash, version: 1 };
    }
  };

  const orchestrator = createGenerationOrchestrator({ store, db: repository, dependencies: deps });
  await orchestrator.create({
    ...scope,
    id: runId,
    chapterId: 'ch-01',
    idempotencyKey: 'idem-adv-race',
    requestHash: '3'.repeat(64),
    request: { chapterId: 'ch-01', prompt: '夜泊枫桥' }
  });

  let waitingRun = null;
  for (let i = 0; i < 80; i++) {
    waitingRun = await store.getRun({}, { ...scope, id: runId });
    if (waitingRun && waitingRun.state === 'waiting_author') break;
    await new Promise(r => setTimeout(r, 20));
  }
  assert.ok(waitingRun);

  // 1. Worker 1 启动提交（此时将持有租约并停在 commitGatePromise）
  const worker1Promise = orchestrator.commit({
    ...scope,
    id: runId,
    text: prose,
    outputHash: proseHash
  });

  await new Promise(r => setTimeout(r, 50));

  // 2. Worker 2 尝试并发提交同一个任务 -> 租约已被占用，必须抛出 STATE_CONFLICT
  let worker2Error = null;
  try {
    await orchestrator.commit({
      ...scope,
      id: runId,
      text: prose,
      outputHash: proseHash
    });
  } catch (err) {
    worker2Error = err;
  }

  assert.ok(worker2Error, 'Worker 2 并发提交必须被拦截');
  assert.equal(worker2Error.code, 'STATE_CONFLICT', '错误码必须为 STATE_CONFLICT');
  assert.match(worker2Error.message, /其他 worker 中执行/, '必须指明提交任务正在其他 worker 中执行');

  // 解除 Worker 1 阻塞并回收
  commitGateResolver();
  await worker1Promise.catch(() => {});
});
