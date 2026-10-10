'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { stableValue, hashValue, buildGenerationManifest } = require('../lib/generation/manifest');
const { assembleContext, formatStoryPlansMarkdown, formatOutlineContextMarkdown } = require('../lib/generation/context');
const { selectRelevantPlans } = require('../lib/memory-context');
const { createGenerationOrchestrator } = require('../lib/generation/orchestrator');

test('M5-ADV-01: BigInt resilience in hashValue & stableValue (No TypeError serialization crash)', () => {
  const inputWithBigInt = {
    id: 1234567890123456789n,
    chapterNo: 42n,
    meta: {
      timestamp: 9007199254740993n,
      flags: [1n, 2n, 3n]
    }
  };

  const val = stableValue(inputWithBigInt);
  assert.equal(val.id, '1234567890123456789');
  assert.equal(val.chapterNo, '42');
  assert.equal(val.meta.timestamp, '9007199254740993');
  assert.deepEqual(val.meta.flags, ['1', '2', '3']);

  const hash = hashValue(inputWithBigInt);
  assert.match(hash, /^[a-f0-9]{64}$/);

  // Determinism check: same BigInt values produce same hash
  const hash2 = hashValue({ ...inputWithBigInt });
  assert.equal(hash, hash2);
});

test('M5-ADV-02: BigInt resilience in assembleContext & resolvedChapterNo', () => {
  const result = assembleContext({
    snowflakeId: 9007199254740993n,
    chapterNo: 15n,
    currentChapterOutline: {
      title: '天命所归',
      goal: '破境突破',
      beats: ['灵气汇聚', '天雷滚滚']
    }
  }, {
    model: 'mock-model'
  });

  assert.ok(result.text, 'text should be generated');
  assert.equal(result.outlineAudit.resolvedChapterNo, 15);
  assert.match(result.contextPlan.replayManifest.inputHash, /^[a-f0-9]{64}$/);
});

test('M5-ADV-03: Symbol resilience in assembleContext (Graceful fallback, no TypeError)', () => {
  const symChapter = Symbol('prologue');
  const symId = Symbol('badId');
  const symHash = Symbol('badHash');

  assert.doesNotThrow(() => {
    const res = assembleContext({
      chapterNo: symChapter,
      chapterId: symId,
      outlineHash: symHash,
      instruction: '写一段引子'
    }, {
      model: 'mock-model'
    });

    assert.equal(res.outlineAudit.resolvedChapterNo, null);
    assert.equal(res.outlineAudit.resolvedChapterId, null);
    assert.equal(res.outlineAudit.outlineHash, null);
  });
});

test('M5-ADV-04: Symbol & BigInt resilience in memory-context:selectRelevantPlans', () => {
  const plans = [
    { id: 'p1', title: '主线暗线', chapterNo: 1, targetChapterRange: '1-3', status: 'planned' },
    { id: 'p2', title: '序章伏笔', chapterNo: 0, targetChapterRange: '0-1', status: 'planned' }
  ];

  // Symbol query values should not throw
  assert.doesNotThrow(() => {
    const res = selectRelevantPlans(plans, {
      chapterNo: Symbol('invalidChapter'),
      chapterId: Symbol('invalidId')
    });
    assert.ok(Array.isArray(res.selectedPlans));
  });

  // BigInt chapter query should correctly select matching plans
  const resBigInt = selectRelevantPlans(plans, {
    chapterNo: 1n
  });
  assert.ok(resBigInt.selectedPlans.some(p => p.id === 'p1'));
});

test('M5-ADV-05: Advanced type preservation in stableValue (Date, RegExp, Set, Map)', () => {
  const testDate = new Date('2026-10-10T12:00:00.000Z');
  const testSet = new Set(['fantasy', 'xianxia']);
  const testMap = new Map([['genre', 'xianxia'], ['era', 'ancient']]);
  const testRegex = /pattern-rule/i;

  const serialized = stableValue({
    date: testDate,
    tags: testSet,
    config: testMap,
    rule: testRegex
  });

  assert.equal(serialized.date, '2026-10-10T12:00:00.000Z');
  assert.deepEqual(serialized.tags, ['fantasy', 'xianxia']);
  assert.deepEqual(serialized.config, { era: 'ancient', genre: 'xianxia' });
  assert.equal(serialized.rule, '/pattern-rule/i');
});

test('M5-ADV-06: Throwing getter and Proxy resilience in stableValue', () => {
  const evilObject = {
    safeField: 'hello',
    get dangerousGetter() {
      throw new Error('Getter boom!');
    }
  };

  const val = stableValue(evilObject);
  assert.equal(val.safeField, 'hello');
  assert.equal(val.dangerousGetter, '[Unreadable]');

  assert.doesNotThrow(() => {
    const hash = hashValue(evilObject);
    assert.match(hash, /^[a-f0-9]{64}$/);
  });
});

test('M5-ADV-07: Circular reference resilience across mixed types (Object, Array, Set, Map)', () => {
  const root = { name: 'root' };
  const arr = [root];
  root.childArr = arr;

  const map = new Map();
  map.set('self', map);
  root.childMap = map;

  const set = new Set();
  set.add(root);
  root.childSet = set;

  assert.doesNotThrow(() => {
    const val = stableValue(root);
    assert.equal(val.childArr[0], '[Circular]');
    assert.equal(val.childMap.self, '[Circular]');
    assert.equal(val.childSet[0], '[Circular]');
    const hash = hashValue(root);
    assert.match(hash, /^[a-f0-9]{64}$/);
  });
});

test('M5-ADV-08: Orchestrator needs_human replay parity (Updated contextPlan & outlineAudit preserved)', async () => {
  const createdRuns = [{
    id: 'run-m5-test-1',
    projectId: 'p1',
    state: 'created',
    result: {},
    manifest: {}
  }];
  const updatedRuns = [];
  const stages = [];

  const mockStore = {
    createRun: async (db, input) => {
      const run = {
        id: 'run-m5-test-1',
        projectId: input.projectId,
        state: 'created',
        result: {},
        manifest: {}
      };
      createdRuns.push(run);
      return { run };
    },
    getRun: async (db, scope) => {
      return updatedRuns[updatedRuns.length - 1] || createdRuns[0];
    },
    getRunInput: async (db, scope) => {
      return {
        projectId: scope.projectId,
        chapterId: 'ch-m5-01',
        genre: '玄幻',
        style: '热血',
        chapterContract: {
          chapterNo: 3,
          chapterTitle: '青云门下',
          chapterGoal: '拜入仙门',
          scenes: [{ goal: '山门考核', sceneTags: ['exam'] }]
        },
        storyContext: {
          currentVolumeId: 'vol-1'
        }
      };
    },
    updateRun: async (db, update) => {
      const prev = updatedRuns[updatedRuns.length - 1] || createdRuns[0];
      const updated = {
        id: update.id,
        state: update.state,
        result: update.result !== undefined ? update.result : prev.result,
        manifest: update.manifest !== undefined ? update.manifest : prev.manifest
      };
      updatedRuns.push(updated);
      return updated;
    },
    recordStage: async (db, stage) => {
      stages.push(stage);
    }
  };

  const orchestrator = createGenerationOrchestrator({
    store: mockStore,
    db: {},
    dependencies: {
      loadAuthoritativeContext: async () => ({ ok: true, storyContext: {} }),
      preGenerationGuard: async () => ({ passed: true }),
      writer: async (promptInput) => ({
        text: '第一章 青云直上。考核开始。',
        manifest: {
          generationId: 'run-m5-test-1',
          projectId: 'p1',
          chapterId: 'ch-m5-01',
          pipelineVersion: 'generation-v2.1',
          contextHash: promptInput.contextPlan.contextHash,
          contractHash: crypto.createHash('sha256').update('contract', 'utf8').digest('hex'),
          promptHash: crypto.createHash('sha256').update('prompt', 'utf8').digest('hex'),
          outputHash: hashValue('第一章 青云直上。考核开始。')
        }
      }),
      // Simulate quality gate failure sending to needs_human
      qualityAudit: async () => ({
        passed: false,
        score: 0.5,
        status: 'UNSATISFACTORY',
        confidence: 0.9,
        evaluators: {
          compliance: { score: 0.5 },
          literary: { score: 0.5 },
          style: { score: 0.5 },
          aiFlavor: { score: 0.5 }
        }
      })
    }
  });

  const runRes = await orchestrator.execute({ projectId: 'p1' }, 'run-m5-test-1');
  assert.equal(runRes.state, 'needs_human');

  // Verify getReplay extracts updated contextPlan with scenePlanningTier and outlineAudit
  const replay = await orchestrator.getReplay({ projectId: 'p1' }, 'run-m5-test-1');
  assert.ok(replay.contextPlan, 'contextPlan must exist in replay even after needs_human');
  assert.equal(replay.contextPlan.scenePlanningTier, 'full_scenes');
  assert.ok(replay.outlineAudit, 'outlineAudit must exist in replay even after needs_human');
  assert.equal(replay.outlineAudit.resolvedChapterNo, 3);
});

test('M5-ADV-09: 8-dimensional outlineAudit completeness across assembleContext', () => {
  const result = assembleContext({
    chapterId: 'ch-audit-101',
    chapterNo: 8,
    outlineRevision: 3,
    outlineHash: 'abc123hash',
    outlineDependencies: ['dep-character-arc', 'dep-sword-forge'],
    outlineImpact: {
      completed: ['reach_capital'],
      deferred: ['meet_emperor'],
      changed: ['lost_bag'],
      omitted: []
    },
    stateDeltaCommitted: true,
    currentChapterOutline: {
      title: '帝都风云',
      goal: '面见太子'
    }
  }, {
    model: 'mock-model'
  });

  const audit = result.outlineAudit;
  assert.equal(audit.resolvedChapterId, 'ch-audit-101');
  assert.equal(audit.resolvedChapterNo, 8);
  assert.equal(audit.outlineRevision, 3);
  assert.equal(audit.outlineHash, 'abc123hash');
  assert.equal(audit.requiredOutlineIncluded, true);
  assert.ok(audit.outlineBlockTokens > 0);
  assert.deepEqual(audit.outlineDependenciesIncluded, ['dep-character-arc', 'dep-sword-forge']);
  assert.deepEqual(audit.outlineImpact.completed, ['reach_capital']);
  assert.deepEqual(audit.outlineImpact.deferred, ['meet_emperor']);
  assert.deepEqual(audit.outlineImpact.changed, ['lost_bag']);
  assert.equal(audit.stateDeltaCommitted, true);
});

test('M5-ADV-10: Zero prompt pollution: internal audit & metadata keys strictly excluded from prompt text', () => {
  const internalKeys = [
    'activeCausalDebts', 'causalDebt', 'causalDebts', 'mechanisms',
    'outlineImpact', 'outlineRevision', 'outlineHash', 'stateDeltaCommitted', 'stateDelta',
    'outlineAudit', 'contextPlan', 'replayManifest', 'contextTruncationReasons',
    'outlineDependenciesIncluded', 'outlineDependencies', 'dependencies',
    'impact', 'revision', 'planRevision',
    'chapterId', 'chapterNo', 'chapterNumber', 'currentChapterNo', 'currentChapterId',
    'currentVolumeId', 'volumeId', 'volumeNo',
    'requiredOutlineIncluded', 'outlineBlockTokens'
  ];

  const payload = {
    instruction: '创作本章正文。'
  };
  for (const k of internalKeys) {
    payload[k] = `INTERNAL_LEAK_SECRET_${k}`;
  }

  const result = assembleContext(payload, { model: 'mock-model' });

  for (const k of internalKeys) {
    assert.ok(
      !result.text.includes(`INTERNAL_LEAK_SECRET_${k}`),
      `Internal metadata key "${k}" must not leak into prompt text`
    );
  }
});

test('M5-ADV-11: formatStoryPlansMarkdown handles empty, sparse and participant-mapped inputs', () => {
  const plans = [
    { id: 'sp-1', title: '收服灵宠', content: '在后山偶遇灵狐', participants: [{ id: 'hero', name: '李墨' }] },
    { id: 'sp-2', title: '', content: '探查宗门秘境', participantIds: ['hero', 'rival'] },
    null,
    'sparse string item'
  ];

  const formatted = formatStoryPlansMarkdown(plans);
  assert.ok(formatted.includes('收服灵宠'));
  assert.ok(formatted.includes('在后山偶遇灵狐'));
  assert.ok(formatted.includes('李墨'));
  assert.ok(formatted.includes('探查宗门秘境'));
  assert.ok(!formatted.includes('null'));
});

test('M5-ADV-12: formatOutlineContextMarkdown handles sparse beats & scenes without null leaks', () => {
  const outlineData = {
    chapter: {
      chapterNo: 5,
      title: '青云会武',
      goal: '击败同门对手',
      beats: [null, '擂台对峙', undefined, ''],
      scenes: [{ goal: '登上擂台' }, null, { goal: '' }]
    },
    volume: {
      volumeNo: 1,
      title: '宗门崛起'
    }
  };

  const md = formatOutlineContextMarkdown(outlineData);
  assert.ok(md.includes('第 5 章《青云会武》'));
  assert.ok(md.includes('核心目标：击败同门对手'));
  assert.ok(md.includes('关键节拍：1. 擂台对峙'));
  assert.ok(md.includes('场景规划：1. 登上擂台'));
  assert.ok(!md.includes('null'));
  assert.ok(!md.includes('undefined'));
});
