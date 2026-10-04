'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { evaluateQualityGate, CRITICAL_QUALITY_DIMENSIONS } = require('../lib/generation/quality-gate');
const { GenerationError } = require('../lib/generation/errors');
const { createJsonGenerationStore } = require('../lib/generation/json-store');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const { createGenerationOrchestrator } = require('../lib/generation/orchestrator');
const { hashValue } = require('../lib/generation/manifest');

function computeSha256(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

test('quality-gate: 拦截 missing / null / undefined / 空对象 / 非严格 true 的 quality', () => {
  const prose = '这是测试正文内容，必须具有足够的长度来进行文学质量门禁验证。';
  
  for (const invalidQuality of [null, undefined, {}, { passed: false }, { passed: 'true' }, { passed: 1 }]) {
    const evaluation = evaluateQualityGate({
      genre: 'fantasy',
      prose,
      quality: invalidQuality
    });
    assert.equal(evaluation.passed, false);
    assert.equal(evaluation.status, 'needs_human');
    assert.equal(evaluation.quality.status, 'NOT_MEASURED');
    assert.ok(evaluation.reason);
  }
});

test('quality-gate: 顶层 NOT_MEASURED / ESTIMATED / UNKNOWN 即使 passed 为 true 也不可通过', () => {
  const prose = '山道两旁古树参天，浓雾中隐约可见远处残破的山门牌坊。';
  
  for (const statusName of ['NOT_MEASURED', 'ESTIMATED', 'UNKNOWN', 'unmeasured', '']) {
    const evaluation = evaluateQualityGate({
      genre: '通用',
      prose,
      quality: {
        passed: true,
        status: statusName,
        qualityVector: {
          language: {
            value: 0.95,
            confidence: 0.95,
            status: 'MEASURED',
            source: 'literary_evaluator',
            quote: '山道两旁古树参天',
            start: 0,
            end: 8
          }
        }
      }
    });
    assert.equal(evaluation.passed, false);
    assert.equal(evaluation.status, 'needs_human');
    assert.match(evaluation.reason, /未真实完成测量/);
  }
});

test('quality-gate: pipeline 仅有 semantic.passed 但无独立质量证据时阻断，不冒充质量通过', () => {
  const prose = '夜色深沉，剑客静静伫立在长街尽头，等待着宿命的对决。';
  const evaluation = evaluateQualityGate({
    genre: 'wuxia',
    prose,
    semanticAudit: { passed: true, issues: [] },
    quality: null
  });
  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.status, 'needs_human');
  assert.equal(evaluation.quality.status, 'NOT_MEASURED');
  assert.match(evaluation.reason, /quality 为空或非对象/);
});

test('quality-gate: 拦截代理指标即使附带真实引文与 offset 也绝不解锁必要文学维度', () => {
  const prose = '残阳如血，古道西风中老者策马独行，马蹄踏在枯石上发出清脆碎响。';
  const proxySources = [
    'heuristic', 'presence', 'ratio', 'linguistic_metrics_analyzer', 'word_count',
    'dialogue_extractor', 'dialogue_density_evaluator', 'character_presence_verifier',
    'causal_debt_prose_verifier', 'chapter_goal_prose_verifier', 'pov_and_clue_boundary_evaluator',
    'fact_consistency_verifier', 'causal_issue_detector', 'unmeasured', 'none'
  ];

  for (const proxySource of proxySources) {
    const evaluation = evaluateQualityGate({
      genre: '通用',
      prose,
      quality: {
        passed: true,
        status: 'MEASURED',
        qualityVector: {
          language: {
            value: 0.92,
            confidence: 0.92,
            status: 'MEASURED',
            source: proxySource,
            quote: '残阳如血，古道西风',
            start: 0,
            end: 9
          }
        }
      }
    });
    assert.equal(evaluation.passed, false);
    assert.equal(evaluation.status, 'needs_human');
    assert.match(evaluation.reason, /代理来源无论是否附引文都不能独自解锁必要文学维度/);
  }
});

test('quality-gate: 真正独立文学评估（literary_evaluator / human_expert）通过门禁且原稿不被篡改', () => {
  const prose = '细雨如丝，微风吹拂着湖畔的垂柳，水波荡漾映照着远山。';
  const originalProseCopy = String(prose);

  const validEvaluation = evaluateQualityGate({
    genre: '通用',
    prose,
    quality: {
      passed: true,
      status: 'MEASURED',
      qualityVector: {
        language: {
          value: 0.88,
          confidence: 0.90,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '细雨如丝',
          start: 0,
          end: 4
        }
      }
    }
  });

  assert.equal(validEvaluation.passed, true);
  assert.equal(validEvaluation.status, 'passed');
  assert.equal(validEvaluation.quality.status, 'MEASURED');
  assert.equal(prose, originalProseCopy, '门禁不得污染原稿内容');
});

test('quality-gate: score 与 confidence 必须为严格有限 number，拒绝布尔、null、数值字符串及非法数值', () => {
  const prose = '秋风卷起庭院里的落叶，老僧手持扫帚静静伫立在回廊下。';
  const invalidScores = [true, false, null, undefined, '0.85', '1', NaN, Infinity, -0.1, 1.1];

  for (const invalidScore of invalidScores) {
    const scoreEval = evaluateQualityGate({
      genre: '通用',
      prose,
      quality: {
        passed: true,
        status: 'MEASURED',
        qualityVector: {
          language: {
            value: invalidScore,
            confidence: 0.85,
            status: 'MEASURED',
            source: 'literary_evaluator',
            quote: '秋风卷起庭院里的落叶',
            start: 0,
            end: 11
          }
        }
      }
    });
    assert.equal(scoreEval.passed, false);
    assert.match(scoreEval.reason, /分值必须为 0..1 范围内的严格有限 number/);
  }

  const invalidConfidences = [true, false, null, undefined, '0.9', NaN, Infinity, -0.5, 1.5];
  for (const invalidConf of invalidConfidences) {
    const confEval = evaluateQualityGate({
      genre: '通用',
      prose,
      quality: {
        passed: true,
        status: 'MEASURED',
        qualityVector: {
          language: {
            value: 0.85,
            confidence: invalidConf,
            status: 'MEASURED',
            source: 'literary_evaluator',
            quote: '秋风卷起庭院里的落叶',
            start: 0,
            end: 11
          }
        }
      }
    });
    assert.equal(confEval.passed, false);
    assert.match(confEval.reason, /置信度必须为 0..1 范围内的严格有限 number/);
  }
});

test('quality-gate: start/end 偏移量必须为双边合法整数且精确匹配对应片段，拦截反向包含绕过与半缺失', () => {
  const prose = '夜半钟声到客船。姑苏城外寒山寺。';

  const halfMissing = evaluateQualityGate({
    genre: '通用',
    prose,
    quality: {
      passed: true,
      status: 'MEASURED',
      qualityVector: {
        language: {
          value: 0.88,
          confidence: 0.88,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '夜半钟声到客船',
          start: 0
        }
      }
    }
  });
  assert.equal(halfMissing.passed, false);
  assert.match(halfMissing.reason, /必须双边均为整数/);

  const nonInteger = evaluateQualityGate({
    genre: '通用',
    prose,
    quality: {
      passed: true,
      status: 'MEASURED',
      qualityVector: {
        language: {
          value: 0.88,
          confidence: 0.88,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '夜半钟声到客船',
          start: 0.5,
          end: 7
        }
      }
    }
  });
  assert.equal(nonInteger.passed, false);
  assert.match(nonInteger.reason, /必须双边均为整数/);

  const outOfRange = evaluateQualityGate({
    genre: '通用',
    prose,
    quality: {
      passed: true,
      status: 'MEASURED',
      qualityVector: {
        language: {
          value: 0.88,
          confidence: 0.88,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '夜半钟声到客船',
          start: 0,
          end: 9999
        }
      }
    }
  });
  assert.equal(outOfRange.passed, false);
  assert.match(outOfRange.reason, /越界或无效/);

  const invertedWindow = evaluateQualityGate({
    genre: '通用',
    prose,
    quality: {
      passed: true,
      status: 'MEASURED',
      qualityVector: {
        language: {
          value: 0.88,
          confidence: 0.88,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '夜半钟声到客船',
          start: 5,
          end: 2
        }
      }
    }
  });
  assert.equal(invertedWindow.passed, false);
  assert.match(invertedWindow.reason, /越界或无效/);

  const reverseContainment = evaluateQualityGate({
    genre: '通用',
    prose,
    quality: {
      passed: true,
      status: 'MEASURED',
      qualityVector: {
        language: {
          value: 0.88,
          confidence: 0.88,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '夜半钟声到客船。姑苏城外寒山寺。',
          start: 0,
          end: 7
        }
      }
    }
  });
  assert.equal(reverseContainment.passed, false);
  assert.match(reverseContainment.reason, /证据引用与正文偏移切片不一致/);
});

test('quality-gate: 首尾空白正文采用完整既有 SHA256 语义，trim 仅判空不改变摘要与 offset 校验', () => {
  const proseWithWhitespace = '  \n\n寒风凛冽呼啸，雪花纷纷扬扬落下。\n  ';
  const fullDigest = computeSha256(proseWithWhitespace);
  const trimmedDigest = computeSha256(proseWithWhitespace.trim());
  assert.notEqual(fullDigest, trimmedDigest, '首尾空白必须计入正文摘要');

  const sliceTarget = proseWithWhitespace.slice(4, 10);
  assert.equal(sliceTarget, '寒风凛冽呼啸');

  const validEvaluation = evaluateQualityGate({
    genre: '通用',
    prose: proseWithWhitespace,
    contentHash: fullDigest,
    contentDigest: fullDigest,
    outputHash: fullDigest,
    quality: {
      passed: true,
      status: 'MEASURED',
      contentDigest: fullDigest,
      contentHash: fullDigest,
      qualityVector: {
        language: {
          value: 0.88,
          confidence: 0.88,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '寒风凛冽呼啸',
          start: 4,
          end: 10
        }
      }
    }
  });
  assert.equal(validEvaluation.passed, true);
  assert.equal(validEvaluation.quality.contentHash, fullDigest);

  const tamperedEvaluation = evaluateQualityGate({
    genre: '通用',
    prose: proseWithWhitespace,
    contentHash: trimmedDigest,
    quality: {
      passed: true,
      status: 'MEASURED',
      qualityVector: {
        language: {
          value: 0.88,
          confidence: 0.88,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '寒风凛冽呼啸',
          start: 4,
          end: 10
        }
      }
    }
  });
  assert.equal(tamperedEvaluation.passed, false);
  assert.match(tamperedEvaluation.reason, /正文内容摘要不一致/);
});

test('quality-gate: contentHash / contentDigest / outputHash 及 expected 字段出现多个时必须全部严格一致且拒绝多摘要矛盾', () => {
  const prose = '石阶两旁生满了苍苔，林间泉水淙淙流淌。';
  const correctDigest = computeSha256(prose);
  const mismatchedDigest = computeSha256('完全不同的正文内容');

  const hashFieldKeys = [
    'contentDigest', 'contentHash', 'outputHash',
    'expectedContentDigest', 'expectedContentHash', 'expectedOutputOutputHash'
  ];

  for (const optionKey of ['contentDigest', 'contentHash', 'outputHash', 'expectedContentDigest', 'expectedContentHash', 'expectedOutputHash']) {
    const optionsObj = {
      genre: '通用',
      prose,
      quality: {
        passed: true,
        status: 'MEASURED',
        qualityVector: {
          language: {
            value: 0.88,
            confidence: 0.88,
            status: 'MEASURED',
            source: 'literary_evaluator',
            quote: '石阶两旁生满了苍苔',
            start: 0,
            end: 9
          }
        }
      }
    };
    optionsObj[optionKey] = mismatchedDigest;
    const evaluation = evaluateQualityGate(optionsObj);
    assert.equal(evaluation.passed, false);
    assert.match(evaluation.reason, /正文内容摘要不一致/);
  }

  const contradictionEvaluation = evaluateQualityGate({
    genre: '通用',
    prose,
    contentHash: correctDigest,
    expectedContentHash: correctDigest,
    quality: {
      passed: true,
      status: 'MEASURED',
      contentHash: correctDigest,
      contentDigest: mismatchedDigest,
      qualityVector: {
        language: {
          value: 0.88,
          confidence: 0.88,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '石阶两旁生满了苍苔',
          start: 0,
          end: 9
        }
      }
    }
  });
  assert.equal(contradictionEvaluation.passed, false);
  assert.match(contradictionEvaluation.reason, /正文内容摘要不一致/);
});

test('quality-gate: 摘要字段拒绝显式 null、空串、false、0 等无效类型，不能冒充缺省绕过', () => {
  const prose = '松间明月照，清泉石上流。竹喧归浣女，莲动下渔舟。';
  const correctDigest = computeSha256(prose);
  const invalidValues = [null, '', '   ', false, true, 0, 12345, 'short-hash-string'];

  const optionHashKeys = [
    'contentDigest', 'contentHash', 'outputHash',
    'expectedContentDigest', 'expectedContentHash', 'expectedOutputHash'
  ];

  for (const optionKey of optionHashKeys) {
    for (const invalidValue of invalidValues) {
      const evaluation = evaluateQualityGate({
        genre: '通用',
        prose,
        [optionKey]: invalidValue,
        quality: {
          passed: true,
          status: 'MEASURED',
          qualityVector: {
            language: {
              value: 0.88,
              confidence: 0.88,
              status: 'MEASURED',
              source: 'literary_evaluator',
              quote: '松间明月照',
              start: 0,
              end: 5
            }
          }
        }
      });
      assert.equal(evaluation.passed, false, `options.${optionKey} 为「${invalidValue}」时必须阻断`);
      assert.match(evaluation.reason, /格式非法|必须为 64 位 SHA-256 字符串/);
    }
  }

  const qualityHashKeys = ['contentDigest', 'contentHash', 'outputHash'];
  for (const qualityKey of qualityHashKeys) {
    for (const invalidValue of invalidValues) {
      const evaluation = evaluateQualityGate({
        genre: '通用',
        prose,
        contentHash: correctDigest,
        quality: {
          passed: true,
          status: 'MEASURED',
          [qualityKey]: invalidValue,
          qualityVector: {
            language: {
              value: 0.88,
              confidence: 0.88,
              status: 'MEASURED',
              source: 'literary_evaluator',
              quote: '松间明月照',
              start: 0,
              end: 5
            }
          }
        }
      });
      assert.equal(evaluation.passed, false, `quality.${qualityKey} 为「${invalidValue}」时必须阻断`);
      assert.match(evaluation.reason, /格式非法|必须为 64 位 SHA-256 字符串/);
    }
  }
});

test('quality-gate: 未提供(undefined)的摘要输入在真实新评估后正确绑定完整正文 SHA256', () => {
  const prose = '斜阳草树，寻常巷陌，人道寄奴曾住。';
  const expectedDigest = computeSha256(prose);

  const evaluation = evaluateQualityGate({
    genre: '通用',
    prose,
    quality: {
      passed: true,
      status: 'MEASURED',
      qualityVector: {
        language: {
          value: 0.88,
          confidence: 0.88,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '斜阳草树',
          start: 0,
          end: 4
        }
      }
    }
  });

  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.quality.contentHash, expectedDigest);
  assert.equal(evaluation.quality.contentDigest, expectedDigest);
  assert.equal(evaluation.quality.outputHash, expectedDigest);
});

test('quality-gate: 真实测量但低分状态保持 MEASURED 真实性，不伪称 NOT_MEASURED', () => {
  const prose = '天边雷声轰鸣，狂风席卷着漫山遍野的枯黄落叶。';

  const lowScoreEvaluation = evaluateQualityGate({
    genre: '通用',
    prose,
    quality: {
      passed: true,
      status: 'MEASURED',
      qualityVector: {
        language: {
          value: 0.55,
          confidence: 0.88,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '天边雷声轰鸣',
          start: 0,
          end: 6
        }
      }
    }
  });

  assert.equal(lowScoreEvaluation.passed, false);
  assert.equal(lowScoreEvaluation.status, 'needs_human');
  assert.equal(lowScoreEvaluation.quality.status, 'MEASURED');
  assert.equal(lowScoreEvaluation.code, 'QUALITY_THRESHOLD_NOT_MET');
});

test('quality-gate: 手动 revision 缺失 fresh quality 或绑定旧正文摘要时阻断', () => {
  const revisedProse = '修改后的第二版章节正文，内容与原版完全不同。';
  const oldText = '旧版正文';
  const oldDigest = hashValue(oldText);

  const revisionMissingFresh = evaluateQualityGate({
    genre: 'fantasy',
    prose: revisedProse,
    isRevision: true,
    expectedContentDigest: hashValue(revisedProse),
    quality: {
      passed: true,
      status: 'MEASURED',
      contentDigest: oldDigest,
      qualityVector: {
        language: {
          value: 0.9, confidence: 0.9, status: 'MEASURED',
          source: 'literary_evaluator',
          evidence: [{ quote: '修改后的第二版章节正文', start: 0, end: 11 }]
        }
      }
    }
  });
  assert.equal(revisionMissingFresh.passed, false);
  assert.match(revisionMissingFresh.reason, /正文内容摘要不一致/);
});

test('quality-gate: orchestrator.commit 拦截 waiting_author 但缺少质量证据的记录', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-qg-commit-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-1', projectId: 'proj-1', actorUserId: 'user-1' };
  const text = '这是待确认但没有质量评测的稿件正文内容。';
  const outputHash = hashValue(text);

  const created = (await store.createRun({
    ...scope, id: 'run-qg-test', chapterId: 'ch-1', idempotencyKey: 'qg-key',
    requestHash: 'b'.repeat(64), request: { chapterId: 'ch-1', genre: 'fantasy' }, now: 1700000000000
  })).run;

  const leaseOwner = '22222222-2222-4222-8222-222222222222';
  const lease = await store.acquireLease({ ...scope, id: created.id, leaseOwner, now: 1700000000001 });
  const worker = { ...scope, id: created.id, leaseOwner, fencingToken: lease.fencingToken, now: 1700000000002 };

  let currentRun = created;
  for (const stateName of [
    'request_validated', 'genre_resolved', 'style_resolved', 'context_built', 'contract_validated',
    'pre_generation_guard', 'scene_planning', 'generating', 'draft_received', 'deterministic_audit',
    'semantic_audit', 'quality_audit'
  ]) currentRun = await store.updateRun({ ...worker, state: stateName });

  await store.updateRun({
    ...worker, state: 'waiting_author',
    result: { draft: text, outputHash },
    event: { message: 'ready' }
  });
  await store.releaseLease(worker);

  const orchestrator = createGenerationOrchestrator({
    store, db: {},
    dependencies: {
      commit: async () => ({ committed: true, snapshotId: 'snap-1', stateVersion: 1, contentHash: outputHash })
    }
  });

  await assert.rejects(
    () => orchestrator.commit({ ...scope, id: created.id, text, outputHash }),
    error => error instanceof GenerationError && error.code === 'QUALITY_UNMEASURED'
  );
});

test('quality-gate: 已经 committed 的幂等回执可正常返回', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-qg-committed-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-1', projectId: 'proj-1', actorUserId: 'user-1' };
  const text = '这是已成功提交的章节正文。';
  const outputHash = hashValue(text);

  const created = (await store.createRun({
    ...scope, id: 'run-committed-test', chapterId: 'ch-1', idempotencyKey: 'comm-key',
    requestHash: 'c'.repeat(64), request: { chapterId: 'ch-1', genre: 'fantasy' }, now: 1700000000000
  })).run;

  const leaseOwner = '33333333-3333-4333-8333-333333333333';
  const lease = await store.acquireLease({ ...scope, id: created.id, leaseOwner, now: 1700000000001 });
  const worker = { ...scope, id: created.id, leaseOwner, fencingToken: lease.fencingToken, now: 1700000000002 };

  let currentRun = created;
  for (const stateName of [
    'request_validated', 'genre_resolved', 'style_resolved', 'context_built', 'contract_validated',
    'pre_generation_guard', 'scene_planning', 'generating', 'draft_received', 'deterministic_audit',
    'semantic_audit', 'quality_audit', 'waiting_author', 'committing'
  ]) currentRun = await store.updateRun({ ...worker, state: stateName });

  await store.updateRun({
    ...worker, state: 'committed',
    result: { draft: text, outputHash, commitReceipt: { committed: true, snapshotId: 'snap-existing', stateVersion: 2, contentHash: outputHash } },
    event: { message: 'committed' }
  });
  await store.releaseLease(worker);

  const orchestrator = createGenerationOrchestrator({
    store, db: {},
    dependencies: {
      commit: async () => { throw new Error('不得重复调用底层 commit 写入'); }
    }
  });

  const result = await orchestrator.commit({ ...scope, id: created.id, text, outputHash });
  assert.equal(result.run.state, 'committed');
  assert.equal(result.run.result.commitReceipt.snapshotId, 'snap-existing');
});

test('quality-gate: QUALITY_UNMEASURED 错误码不可自动重试', () => {
  const err = new GenerationError('QUALITY_UNMEASURED', '质量缺失', { status: 422 });
  assert.equal(err.code, 'QUALITY_UNMEASURED');
  assert.equal(err.retryable, false);
  assert.equal(err.status, 422);
});
