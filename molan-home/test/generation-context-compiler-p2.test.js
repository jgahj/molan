'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assembleContext } = require('../lib/generation/context');
const { calculateContextBudget, assertContextBudget, estimateTokens } = require('../lib/generation/context-budget');
const benchmarkPipeline = require('../lib/benchmark-pipeline');
const { REVIEW_DIMENSIONS } = require('../lib/evidence-review');

const roomy = { model: 'gpt-4o', hardLimit: 100000, outputReserve: 1000, reservedInputTokens: 0 };

test('场景标签取并集，只注入匹配机制与通用核心规则，并生成稳定决策清单', () => {
  const input = {
    sceneContract: { sceneTags: ['combat', 'investigation'], chapterGoal: '查清机关并脱身' },
    genreMechanisms: [
      { id: 'core', scope: 'core', rule: '人物行动必须承担代价' },
      { id: 'combat', sceneTags: ['combat'], rule: '动作交锋遵循现场空间' },
      { id: 'investigation', tags: ['investigation'], rule: '线索须能由证据复核' },
      { id: 'dialogue', tags: ['dialogue'], rule: '对白体现利益试探' },
      { id: 'untagged', rule: '没有适用标签的专项规则' }
    ]
  };
  const first = assembleContext(input, roomy);
  const second = assembleContext({ ...input }, roomy);

  assert.match(first.text, /人物行动必须承担代价/);
  assert.match(first.text, /动作交锋遵循现场空间/);
  assert.match(first.text, /线索须能由证据复核/);
  assert.doesNotMatch(first.text, /对白体现利益试探|没有适用标签的专项规则/);
  assert.deepEqual(first.contextPlan.replayManifest.scene.mechanisms.map(item => [item.id, item.decision]), [
    ['core', 'included'], ['combat', 'included'], ['investigation', 'included'], ['dialogue', 'excluded'], ['untagged', 'excluded']
  ]);
  assert.equal(first.contextPlan.replayManifest.inputHash, second.contextPlan.replayManifest.inputHash);
  assert.equal(first.contextPlan.contextHash, second.contextPlan.contextHash);
  assert.equal(first.contextPlan.replayManifest.strategyVersion, first.contextPlan.contextStrategyVersion);
});

test('场景标签缺失时只保留明确标记的通用机制', () => {
  const result = assembleContext({
    sceneContract: { chapterGoal: '完成本章目标' },
    genreMechanisms: [
      { id: 'core', generic: true, rule: '始终生效的世界核心法则' },
      { id: 'combat', tags: ['combat'], rule: '战斗专项规则' }
    ]
  }, roomy);

  assert.match(result.text, /始终生效的世界核心法则/);
  assert.doesNotMatch(result.text, /战斗专项规则/);
  assert.equal(result.contextPlan.replayManifest.scene.mechanisms[1].reason, 'scene-tags-missing');
});

test('没有显式适用标签的旧机制列表保持原样', () => {
  const result = assembleContext({
    sceneContract: { sceneTags: ['combat'], chapterGoal: '守住入口' },
    genreMechanisms: [
      { id: 'legacy-one', rule: '保留既有规则一' },
      { id: 'legacy-two', rule: '保留既有规则二' }
    ]
  }, roomy);

  assert.match(result.text, /保留既有规则一/);
  assert.match(result.text, /保留既有规则二/);
  assert.ok(result.contextPlan.replayManifest.scene.mechanisms.every(item => item.reason === 'legacy-unclassified-preserved'));
});

test('当前卷、相关人物和到期债务进入窗口，远期债务只保留摘要与来源 ID', () => {
  const result = assembleContext({
    sceneContract: { chapterNo: 8, volumeId: 'volume-2', characters: ['林照'] },
    activeCausalDebt: [
      { id: 'due-now', sourceId: 'ledger-due', volumeId: 'volume-1', dueChapter: 8, promise: '交代旧伤复发的直接后果', quote: '原始证据不得带入摘要' },
      { id: 'same-volume', volumeId: 'volume-2', promise: '偿还卷内人情债' },
      { id: 'same-character', volumeId: 'volume-1', characterIds: ['林照'], promise: '解释林照为何隐瞒线索' },
      { id: 'distant', sourceId: 'ledger-distant', volumeId: 'volume-1', characterIds: ['陌生人'], promise: '多年后追查旧案', quote: '远期债务原始证据' }
    ]
  }, { ...roomy, currentVolumeId: 'volume-2', currentChapterNo: 8, currentCharacterIds: ['林照'] });

  assert.match(result.text, /due-now/);
  assert.match(result.text, /same-volume/);
  assert.match(result.text, /same-character/);
  assert.match(result.text, /ledger-distant/);
  assert.match(result.text, /多年后追查旧案/);
  assert.doesNotMatch(result.text, /远期债务原始证据/);
  assert.ok(result.contextPlan.requiredBlocks.includes('requiredCausalPayoff'));
  assert.deepEqual(result.contextPlan.replayManifest.causalDebt.decisions.map(item => item.decision), [
    'required', 'included-window', 'included-window', 'summarized'
  ]);
});

test('必要事实和世界禁令超预算时整体阻断，不静默裁剪', () => {
  assert.throws(() => assembleContext({
    sceneContract: { chapterGoal: '不可丢失'.repeat(80) },
    worldProhibitions: '不可违背的世界禁令'.repeat(80)
  }, { ...roomy, maxChars: 1000 }), { code: 'CONTEXT_OVERFLOW' });

  assert.throws(() => assembleContext({
    sceneContract: '硬性事实'.repeat(150)
  }, { model: 'gpt-4o', hardLimit: 300, outputReserve: 0, reservedInputTokens: 0 }), { code: 'CONTEXT_OVERFLOW' });
});

test('预算使用目标模型估算完整渲染文本、包装和输出预留，ContextPlan 可复核', () => {
  const result = assembleContext({
    sceneContract: { chapterGoal: '查明门锁被动过的原因' },
    characters: ['周叙']
  }, {
    model: 'gpt-4o', hardLimit: 10000, outputReserve: 1200, reservedInputTokens: 0,
    system: '你是严谨的小说创作者。',
    contextWrapperPrefix: '【只读故事上下文】\n',
    contextWrapperSuffix: '\n\n【本章任务】\n查明门锁被动过的原因。'
  });
  const budget = calculateContextBudget({ contextPlan: result.contextPlan });
  const rendered = assertContextBudget({
    messages: [
      { role: 'system', content: '你是严谨的小说创作者。' },
      { role: 'user', content: `【只读故事上下文】\n${result.text}\n\n【本章任务】\n查明门锁被动过的原因。` }
    ],
    modelId: 'gpt-4o', providerContextLimit: 10000, outputReserve: 1200
  });

  assert.equal(budget.totalRequired, result.contextPlan.totalRequired);
  assert.equal(budget.fits, true);
  assert.equal(result.contextPlan.outputReserve, 1200);
  assert.ok(result.contextPlan.renderedWrapperTokens > 0);
  assert.ok(rendered.breakdown.promptTokens > 0);
  assert.ok(result.contextPlan.replayManifest.budget.estimator.includes('model-capability'));
});

test('拥堵样本的上下文 Token 估算较未编译全量输入减少至少 30%', () => {
  const input = {
    sceneContract: { chapterGoal: '夺回驿站账册', sceneTags: ['combat'] },
    genreMechanisms: [
      { id: 'core', core: true, rule: '每次夺回行动都要承担可核验的资源代价。' },
      ...Array.from({ length: 18 }, (_, index) => ({
        id: `irrelevant-${index}`,
        sceneTags: [index % 2 ? 'dialogue' : 'exploration'],
        rule: `专项机制 ${index}：${'细节约束'.repeat(40)}`
      })),
      { id: 'combat', sceneTags: ['combat'], rule: `交锋必须利用驿站现场空间。${'动作限制'.repeat(20)}` }
    ],
    activeCausalDebt: Array.from({ length: 18 }, (_, index) => ({
      id: `debt-${index}`,
      sourceId: `ledger-${index}`,
      volumeId: 'older-volume',
      characterIds: ['远方人物'],
      promise: `远期因果债务摘要 ${index}`,
      quote: `完整远期证据 ${'细节'.repeat(70)}`
    })),
    historicalFacts: `已核验历史摘要。${'较远的旧事件。'.repeat(700)}`
  };
  const options = {
    model: 'gpt-4o', hardLimit: 100000, outputReserve: 1000, reservedInputTokens: 0,
    sceneTags: ['combat'], currentVolumeId: 'current-volume', currentChapterNo: 12,
    currentCharacterIds: ['守门人'], contextWrapperPrefix: '【只读故事上下文】\n'
  };
  const compiled = assembleContext(input, options);
  const uncompiledText = Object.entries(input)
    .filter(([key]) => key !== 'sceneContract' || input.sceneContract)
    .map(([key, value]) => `[${key}]\n${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('\n\n');
  const beforeTokens = estimateTokens(options.contextWrapperPrefix + uncompiledText, options.model);
  const afterTokens = estimateTokens(options.contextWrapperPrefix + compiled.text, options.model);

  assert.ok(afterTokens <= beforeTokens * 0.7, `期望不超过 ${Math.floor(beforeTokens * 0.7)}，实际 ${afterTokens}/${beforeTokens}`);
  assert.equal(compiled.contextPlan.replayManifest.budget.estimator, 'model-capability-cjk-ratio-v1');
});

test('基准生成只把场景匹配机制送入 user context，system 不保留机制目录副本', async () => {
  const requests = [];
  const usage = { totalTokens: 120, creditCost: 0.01, status: 'completed' };
  const audit = {
    issues: [], stageChange: '守住入口', summary: '未发现已知事实冲突',
    coverage: Object.fromEntries(REVIEW_DIMENSIONS.map(dimension => [dimension, 'checked'])),
    factLedgerDelta: { newRules: [], newPromises: [], byEntity: {}, updates: [] },
    stateDelta: { timeline: [], relations: [], characters: [], world: [] },
    outlineImpact: { status: 'unplanned', addressed: [], deferred: [] }
  };

  await benchmarkPipeline.generateChapter({ callModel: async (_auth, request) => {
    requests.push(request);
    return request.jsonMode
      ? { json: audit, usage }
      : { text: '守门人守住了入口。'.repeat(180), usage };
  } }, null, {
    genre: '玄幻', prompt: '守住入口并夺回账册', targetWords: 1500, maxRounds: 0,
    contract: {
      chapterGoal: '守住入口并夺回账册', chapterNo: 4, volumeId: 'volume-1',
      characters: ['守门人'], scenes: [{ sceneType: 'combat', goal: '守住入口' }],
      wordBudget: { targetChars: 1500, minChars: 1000, maxChars: 2000 }
    },
    genreMechanisms: [
      { id: 'matching', sceneTags: ['combat'], rule: 'KEEP_MECHANISM_SENTINEL' },
      { id: 'excluded', sceneTags: ['dialogue'], rule: 'DROP_MECHANISM_SENTINEL' }
    ]
  });

  const writer = requests.find(request => !request.jsonMode);
  assert.ok(writer);
  assert.match(writer.userPrompt, /KEEP_MECHANISM_SENTINEL/);
  assert.doesNotMatch(writer.userPrompt, /DROP_MECHANISM_SENTINEL/);
  assert.doesNotMatch(writer.system, /DROP_MECHANISM_SENTINEL/);
  assert.doesNotMatch(writer.system, /KEEP_MECHANISM_SENTINEL/);
});
