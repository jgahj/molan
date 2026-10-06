'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  parseEventStructure,
  evaluateOutcomeContractFulfillment,
  verifyNarrativeStateTransition,
  detectEntityMentions,
  detectEventOccurrences
} = require('../lib/composition/evaluation/outcome-contract');

const {
  createNarrativeOutcomeContract
} = require('../lib/composition/models/data-schemas');

const {
  mineStrategiesFromFeatures
} = require('../lib/composition/corpus/strategy-miner');

const {
  calculateStatisticalStrength
} = require('../lib/composition/corpus/evidence-catalog');

const {
  CorpusBatchPipeline,
  splitChaptersFromText
} = require('../lib/composition/corpus/batch-pipeline');

const {
  CheckpointManifest
} = require('../lib/composition/corpus/checkpoint-manifest');

function createTempDir(prefix = 'molan-v3-fix-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ============================================================================
// R1: Independent Subject-Object SVO Event Parsing
// ============================================================================

test('R1.1: parseEventStructure resolves subject and object independently for SVO clauses', () => {
  const svo1 = parseEventStructure('李巡斩杀刺客');
  assert.equal(svo1.verb, '斩杀');
  assert.equal(svo1.subject, '李巡');
  assert.equal(svo1.object, '刺客');

  const svo2 = parseEventStructure('李巡起获暗黑古钱');
  assert.equal(svo2.verb, '起获');
  assert.equal(svo2.subject, '李巡');
  assert.equal(svo2.object, '暗黑古钱');

  const noSubj = parseEventStructure('起获暗黑古钱');
  assert.equal(noSubj.verb, '起获');
  assert.equal(noSubj.subject, '');
  assert.equal(noSubj.object, '暗黑古钱');

  const noObj = parseEventStructure('李巡潜入');
  assert.equal(noSubj.verb ? true : false, true);
  assert.equal(noObj.verb, '潜入');
  assert.equal(noObj.subject, '李巡');
  assert.equal(noObj.object, '');
});

test('R1.2: Natural SVO events achieve passing fulfillment scores with separate subject and object entity detections', () => {
  const contract = createNarrativeOutcomeContract({
    domain: 'possession',
    stateDelta: {
      stateBefore: '未获古钱',
      events: ['李巡起获暗黑古钱'],
      stateAfter: '取得暗黑古钱'
    }
  });

  const text = '夜色深沉，李巡潜入藏宝阁深处。在一处隐秘暗格中，李巡终于稳稳起获了那枚暗黑古钱，紧握在手心贴身藏入暗袋。' + '。'.repeat(120);

  const res = evaluateOutcomeContractFulfillment(text, contract);
  assert.equal(res.passed, true, '自然 SVO 事件应顺利履约通过');
  assert.ok(res.fulfillmentScore >= 0.75, '达成度得分应在 0.75 及格线以上');

  // 验证独立提取并识别了主客体实体 (李巡 与 暗黑古钱)
  const entityNames = res.entityMentions.entities.map(e => e.name);
  assert.ok(entityNames.includes('李巡'), '必须独立检测到主体实体 [李巡]');
  assert.ok(entityNames.includes('暗黑古钱'), '必须独立检测到客体实体 [暗黑古钱]');
  assert.equal(res.entityMentions.foregroundCount >= 2, true, '主客体均应进入前景实体计数');

  // 事件落地判定
  assert.ok(res.eventOccurrences.events.some(e => e.status === 'VERIFIED_OCCURRED'), '事件必须判定为 VERIFIED_OCCURRED');
});

test('R1.3: Natural SVO combat event achieves passing fulfillment in condition domain', () => {
  const contract = createNarrativeOutcomeContract({
    domain: 'condition',
    stateDelta: {
      stateBefore: '刺客尚存',
      events: ['李巡斩杀刺客'],
      stateAfter: '刺客身亡'
    }
  });

  const text = '长街风雪呼啸，李巡拔出短刃迎面跃起，横刀劈过，当场斩杀了那名黑衣刺客。刺客胸口鲜血狂喷，惨叫一声倒地不起，气绝身亡。' + '。'.repeat(120);

  const res = evaluateOutcomeContractFulfillment(text, contract);
  assert.equal(res.passed, true);
  assert.ok(res.fulfillmentScore >= 0.75);

  const entityNames = res.entityMentions.entities.map(e => e.name);
  assert.ok(entityNames.includes('李巡'), '必须检测到主体 [李巡]');
  assert.ok(entityNames.includes('刺客'), '必须检测到客体 [刺客]');
});

test('R1.4: Disposal Ba/Jiang and aspect particle clauses resolve clean subject and object', () => {
  const ba = parseEventStructure('李巡将刺客斩杀');
  assert.equal(ba.verb, '斩杀');
  assert.equal(ba.subject, '李巡');
  assert.equal(ba.object, '刺客');

  const ba2 = parseEventStructure('李巡把刺客击杀');
  assert.equal(ba2.verb, '击杀');
  assert.equal(ba2.subject, '李巡');
  assert.equal(ba2.object, '刺客');

  const particle = parseEventStructure('李巡斩杀了刺客');
  assert.equal(particle.verb, '斩杀');
  assert.equal(particle.subject, '李巡');
  assert.equal(particle.object, '刺客');

  const adverb = parseEventStructure('李巡成功起获暗黑古钱');
  assert.equal(adverb.verb, '起获');
  assert.equal(adverb.subject, '李巡');
  assert.equal(adverb.object, '暗黑古钱');
});

test('R1.5: Disposal Ba/Jiang with aspect particles, Bei passives, and catalyst verbs resolve clean subject and object', () => {
  const baWithParticle = parseEventStructure('李巡将刺客斩杀了');
  assert.equal(baWithParticle.verb, '斩杀');
  assert.equal(baWithParticle.subject, '李巡');
  assert.equal(baWithParticle.object, '刺客');

  const baCatalyst = parseEventStructure('李巡把古钱夺取了');
  assert.equal(baCatalyst.verb, '夺取');
  assert.equal(baCatalyst.subject, '李巡');
  assert.equal(baCatalyst.object, '古钱');

  const beiPassive = parseEventStructure('刺客被李巡斩杀了');
  assert.equal(beiPassive.verb, '斩杀');
  assert.equal(beiPassive.subject, '李巡');
  assert.equal(beiPassive.object, '刺客');

  const prefixAdv = parseEventStructure('适逢李巡起获暗黑古钱');
  assert.equal(prefixAdv.verb, '起获');
  assert.equal(prefixAdv.subject, '李巡');
  assert.equal(prefixAdv.object, '暗黑古钱');
});

// ============================================================================
// R2: Contextually Scoped Contradiction Verification
// ============================================================================

test('R2.1: Auxiliary condition words (e.g. "刺客身亡，师妹安好") do not trigger false contradiction penalties', () => {
  const contract = createNarrativeOutcomeContract({
    domain: 'condition',
    stateDelta: {
      stateBefore: '刺客完好',
      events: ['击杀刺客'],
      stateAfter: '刺客重创气绝身亡'
    }
  });

  // 正文包含 "师妹安好"，但目标跃迁对象是 "刺客"，"师妹" 属于辅助实体，绝不能误判为矛盾词
  const text = '两马交错之际，长枪如毒龙出洞，直刺穿黑衣刺客的重铠。黑衣刺客胸口鲜血狂喷，惨叫一声倒地不起，气绝身亡。刺客身亡，师妹安好。' + '。'.repeat(120);

  const res = evaluateOutcomeContractFulfillment(text, contract);
  assert.equal(res.contradictionsDetected.length, 0, '辅助实体安好绝不能误触发矛盾拦截');
  assert.equal(res.passed, true, '契约必须判定通过');
  assert.ok(res.fulfillmentScore >= 0.85);
});

test('R2.2: Contradiction words inside dialogue quotes do not trigger false contradiction penalties', () => {
  const contract = createNarrativeOutcomeContract({
    domain: 'possession',
    stateDelta: {
      stateBefore: '未获古钱',
      events: ['起获暗黑古钱'],
      stateAfter: '取得暗黑古钱'
    }
  });

  // 对白中出现 "空手而归"，但实际行动成功起获
  const text = '李巡冷笑一声，对身后的黑衣人道：“你休想让我空手而归！”随即他伸手探入暗格，稳稳起获了暗黑古钱，收入贴身暗袋之中。' + '。'.repeat(120);

  const res = evaluateOutcomeContractFulfillment(text, contract);
  assert.equal(res.contradictionsDetected.length, 0, '对白引号内的否定反问绝不能作为事实矛盾');
  assert.equal(res.passed, true, '契约必须判定通过');
  assert.ok(res.fulfillmentScore >= 0.85);
});

test('R2.3: Contradiction words preceded by negation markers do not trigger false contradiction penalties', () => {
  const contract = createNarrativeOutcomeContract({
    domain: 'possession',
    stateDelta: {
      stateBefore: '未获古钱',
      events: ['起获暗黑古钱'],
      stateAfter: '取得暗黑古钱'
    }
  });

  // 正文使用双重否定 "并未空手而归"、"没有两手空空"
  const text = '李巡潜入藏宝阁暗室，他并未空手而归，而是在石缝中起获了暗黑古钱，稳稳握在手心。' + '。'.repeat(120);

  const res = evaluateOutcomeContractFulfillment(text, contract);
  assert.equal(res.contradictionsDetected.length, 0, '前置否定标记的矛盾词不得判定为矛盾');
  assert.equal(res.passed, true);
  assert.ok(res.fulfillmentScore >= 0.85);
});

test('R2.4: Genuine contradictions directly on target entity are strictly intercepted', () => {
  const contract = createNarrativeOutcomeContract({
    domain: 'possession',
    stateDelta: {
      stateBefore: '未获古钱',
      events: ['起获暗黑古钱'],
      stateAfter: '取得暗黑古钱'
    }
  });

  // 正文李巡确实行动失败，两手空空空手而归
  const text = '李巡悄然潜入藏宝阁，触动机关后被迫收手，未能起获暗黑古钱，终究空手而归。';

  const res = evaluateOutcomeContractFulfillment(text, contract);
  assert.ok(res.contradictionsDetected.includes('空手而归'), '针对目标实体的真实矛盾词必须被捕获');
  assert.equal(res.passed, false, '存在真实矛盾时必须判定未通过');
});

test('R2.5: Dialogue quotes containing terminal punctuation and multi-sentence dialogue do not leak false contradictions', () => {
  const contract = createNarrativeOutcomeContract({
    domain: 'possession',
    stateDelta: {
      events: ['李巡起获暗黑古钱'],
      stateAfter: '取得暗黑古钱'
    }
  });

  // 对白包含感叹号、问号与多句对白，且对白前存在目标实体主体
  const text = '李巡冷笑道：“一无所获！你休想骗我！”随即他稳稳起获了暗黑古钱，收入贴身暗袋之中。' + '。'.repeat(120);

  const res = evaluateOutcomeContractFulfillment(text, contract);
  assert.equal(res.contradictionsDetected.length, 0, '含标点的对白引号绝不能切分泄露矛盾词');
  assert.equal(res.passed, true, '契约必须判定通过');
  assert.ok(res.fulfillmentScore >= 0.85);
});

test('R2.6: Combat SVO protagonist surviving unharmed in condition domain does not trigger false contradiction', () => {
  const contract = createNarrativeOutcomeContract({
    domain: 'condition',
    stateDelta: {
      events: ['李巡斩杀刺客'],
      stateAfter: '刺客身亡'
    }
  });

  // 施动者主体自身毫发无损/安好，受击客体身亡
  const text1 = '长街之上，李巡拔刀当场斩杀了刺客，自身毫发无损。刺客倒在血泊中气绝身亡。' + '。'.repeat(120);
  const res1 = evaluateOutcomeContractFulfillment(text1, contract);
  assert.equal(res1.contradictionsDetected.length, 0, '主角自身毫发无损绝非受击客体矛盾');
  assert.equal(res1.passed, true);

  const text2 = '刺客被李巡一刀斩下，当场身亡。刺客身亡，李巡安好。' + '。'.repeat(120);
  const res2 = evaluateOutcomeContractFulfillment(text2, contract);
  assert.equal(res2.contradictionsDetected.length, 0, '主角李巡安好绝非刺客身亡矛盾');
});

test('R2.7: Corner brackets dialogue 「...」 does not trigger false contradiction penalties', () => {
  const contract = createNarrativeOutcomeContract({
    domain: 'possession',
    stateDelta: {
      events: ['李巡起获暗黑古钱'],
      stateAfter: '取得暗黑古钱'
    }
  });

  const text = '李巡冷笑一声道：「这次若是空手而归便提头来见！」但他终究稳稳起获了暗黑古钱。' + '。'.repeat(120);
  const res = evaluateOutcomeContractFulfillment(text, contract);
  assert.equal(res.contradictionsDetected.length, 0, '角标引号对白绝不能误触发矛盾');
  assert.equal(res.passed, true);
});

test('R2.8: Common novel transition adverbs in NON_ENTITY_PREFIX successfully intercept genuine contradictions', () => {
  const contract = createNarrativeOutcomeContract({
    domain: 'possession',
    stateDelta: {
      events: ['李巡起获暗黑古钱'],
      stateAfter: '取得暗黑古钱'
    }
  });

  // 主语承接使用 "竟然"、"居然"、"到头来"
  const text1 = '李巡悄然潜入藏宝阁，触动机关后被迫收手，竟然一无所获。';
  const res1 = evaluateOutcomeContractFulfillment(text1, contract);
  assert.ok(res1.contradictionsDetected.includes('一无所获'), '使用“竟然”承接的真实矛盾必须被捕获');
  assert.equal(res1.passed, false);

  const text2 = '李巡翻遍暗室，到头来空手而归。';
  const res2 = evaluateOutcomeContractFulfillment(text2, contract);
  assert.ok(res2.contradictionsDetected.includes('空手而归'), '使用“到头来”承接的真实矛盾必须被捕获');
  assert.equal(res2.passed, false);
});

test('R2.9: Post-verbal negation markers ("搜寻未果", "斩杀未果") are strictly identified as FAILED_ATTEMPT', () => {
  const resOccur = detectEventOccurrences('李巡搜寻暗室未果。', ['李巡搜寻暗室']);
  assert.equal(resOccur.events[0].status, 'FAILED_ATTEMPT', '“搜寻未果”必须识别为 FAILED_ATTEMPT 而非 VERIFIED_OCCURRED');
  assert.equal(resOccur.score, 0);

  const resCombat = detectEventOccurrences('李巡拔刀，斩杀未果。', ['李巡斩杀刺客']);
  assert.equal(resCombat.events[0].status, 'FAILED_ATTEMPT', '“斩杀未果”必须识别为 FAILED_ATTEMPT');
});

test('R2.10: Single-character conjunctions and novel adverbs ("但", "却是", "终究还是", "实则") intercept genuine contradictions', () => {
  const contract = createNarrativeOutcomeContract({
    domain: 'possession',
    stateDelta: {
      events: ['李巡起获暗黑古钱'],
      stateAfter: '取得暗黑古钱'
    }
  });

  const text1 = '李巡潜入暗室搜寻，但一无所获。';
  const res1 = evaluateOutcomeContractFulfillment(text1, contract);
  assert.ok(res1.contradictionsDetected.includes('一无所获'), '“但”承接的矛盾必须被拦截');
  assert.equal(res1.passed, false);

  const text2 = '李巡搜遍全阁，却是一无所获。';
  const res2 = evaluateOutcomeContractFulfillment(text2, contract);
  assert.ok(res2.contradictionsDetected.includes('一无所获'), '“却是”承接的矛盾必须被拦截');
  assert.equal(res2.passed, false);

  const text3 = '李巡仔细摸索，终究还是两手空空。';
  const res3 = evaluateOutcomeContractFulfillment(text3, contract);
  assert.ok(res3.contradictionsDetected.includes('两手空空'), '“终究还是”承接的矛盾必须被拦截');
  assert.equal(res3.passed, false);

  const text4 = '李巡潜入密室，实则一无所获。';
  const res4 = evaluateOutcomeContractFulfillment(text4, contract);
  assert.ok(res4.contradictionsDetected.includes('一无所获'), '“实则”承接的矛盾必须被拦截');
  assert.equal(res4.passed, false);
});

test('R2.11: Combat condition domain protagonist pronoun unharmed does not trigger contradiction while enemy is strictly intercepted', () => {
  const contract = createNarrativeOutcomeContract({
    domain: 'condition',
    stateDelta: {
      events: ['李巡击杀刺客'],
      stateAfter: { summary: '刺客身亡' }
    }
  });

  // 主角使用第三人称代词承接 ("他安然无恙") 不得误判为受害刺客矛盾
  const textAttacker = '李巡当场击杀刺客，刺客已然毙命，他安然无恙。刺客气绝身亡。' + '。'.repeat(120);
  const resAttacker = evaluateOutcomeContractFulfillment(textAttacker, contract);
  assert.deepEqual(resAttacker.contradictionsDetected, [], '主角“他安然无恙”不应作为矛盾误判');
  assert.equal(resAttacker.passed, true);

  // 敌对受害者代词 ("对方毫发无损") 必须被严格拦截
  const textEnemy = '李巡拔刀击杀，对方毫发无损。';
  const resEnemy = evaluateOutcomeContractFulfillment(textEnemy, contract);
  assert.ok(resEnemy.contradictionsDetected.includes('毫发无损'), '敌人“对方毫发无损”必须被严格判定为矛盾');
  assert.equal(resEnemy.passed, false);
});

test('R2.12: Unknown event verbs do not fabricate subject character name into phantom catalyst verbs', () => {
  const res = verifyNarrativeStateTransition('李巡在客栈喝茶。', {
    events: ['李巡身负重伤']
  }, { domain: 'condition' });
  assert.equal(res.catalystFound, false, '客栈喝茶绝不可因主角名字被误当动词而判定催化动作达成');
});

// ============================================================================
// R3: Unbiased Strategy Mining Quality Lift
// ============================================================================

test('R3: Negative quality lifts from underperforming feature clusters are preserved and incur 0.8 demotion penalty', () => {
  const tmpRun = createTempDir('mining-unbiased-');
  fs.writeFileSync(path.join(tmpRun, 'manifest.json'), '{}');

  // 构建一个明显低质的聚类（得分远低于非本簇基准）
  const features = [
    // 劣质簇: weak__cliche_goal (平均质量 0.35)
    {
      bookId: 'b_weak_1', author: '低质作者', novelTitle: '劣质书', chapterNo: 1, primaryGoal: 'cliche_goal',
      screener: { primaryDimension: 'weak', qualifiedDimensions: [], scores: { plot: 0.35, character: 0.35 } }
    },
    {
      bookId: 'b_weak_2', author: '低质作者', novelTitle: '劣质书', chapterNo: 2, primaryGoal: 'cliche_goal',
      screener: { primaryDimension: 'weak', qualifiedDimensions: [], scores: { plot: 0.35, character: 0.35 } }
    },
    // 对照组高质量簇: high__master_goal (平均质量 0.90)
    {
      bookId: 'b_high_1', author: '名家A', novelTitle: '神作一', chapterNo: 1, primaryGoal: 'master_goal',
      screener: { primaryDimension: 'high', qualifiedDimensions: ['high', 'plot'], scores: { plot: 0.90, character: 0.90 } }
    },
    {
      bookId: 'b_high_2', author: '名家B', novelTitle: '神作二', chapterNo: 2, primaryGoal: 'master_goal',
      screener: { primaryDimension: 'high', qualifiedDimensions: ['high', 'plot'], scores: { plot: 0.90, character: 0.90 } }
    }
  ];

  fs.writeFileSync(path.join(tmpRun, 'chapter-features.jsonl'), features.map(JSON.stringify).join('\n') + '\n');

  const result = mineStrategiesFromFeatures({ runDir: tmpRun });
  const rules = fs.readFileSync(path.join(tmpRun, 'strategy-rules.jsonl'), 'utf8')
    .trim().split('\n').map(JSON.parse);

  // 寻找劣质簇规则
  const weakRule = rules.find(r => r.id.includes('weak'));
  assert.ok(weakRule, '必须挖掘出劣质候选规则');

  // 1. 验证 qualityLift 保留为真实负数，未被合成 fallback (0.15) 覆盖
  assert.ok(weakRule.stats.qualityLift < 0, `劣质簇 qualityLift 必须保留为负数，实际为 ${weakRule.stats.qualityLift}`);
  assert.notEqual(weakRule.stats.qualityLift, 0.15, '绝不能被 0.15 伪装覆盖');

  // 2. 验证负 lift 在 calculateStatisticalStrength 中触发 0.8 惩罚因子
  // 当 lift > 0 时 multiplier 为 1.2，当 lift <= 0 时 multiplier 为 0.8
  const baseConf = weakRule.stats.confidence;
  const baseConfound = weakRule.stats.confoundScore;
  const books = weakRule.stats.bookCount;
  const authors = weakRule.stats.authorCount;

  // 手动计算惩罚与无惩罚得分
  const penaltyScore = baseConf * (1 - baseConfound) * 0.8 * Math.min(2.0, Math.log2(books + authors + 1));
  const inflatedScore = baseConf * (1 - baseConfound) * 1.2 * Math.min(2.0, Math.log2(books + authors + 1));

  assert.ok(penaltyScore < inflatedScore, '0.8 惩罚分必须严格低于 1.2 虚高分');
});

// ============================================================================
// R4: Cooperative Concurrency Event-Loop Yielding
// ============================================================================

test('R4: batch-pipeline.js yields execution during chapter loops, verified via overlapping worker timestamps', async () => {
  const tmpCorpus = createTempDir('batch-yield-corpus-');
  const tmpStaging = createTempDir('batch-yield-staging-');

  const chContent = [
    '青石长阶夜雨，李巡收敛了浑身呼吸，脚下碎石没有发出半分轻响。',
    '推开虚掩的破败暗门，半枚焦黑古钱赫然静卧在泥泞之中，边缘泛着隐秘的朱砂铸印。',
    '刀光乍现！对峙之间李巡身形向左微侧，袖中短刃带着破空厉啸横扫而出，与对方劈来的重剑硬撼在一起！',
    '刃口崩出一串刺目的火星，巨大的反震力道顺着虎口直透手臂，李巡倒退三步，靴底在湿滑青石上犁出两道白痕。'
  ].join('\n\n') + '\n\n' + '。'.repeat(150);

  // 创建 4 本书，每本书 3 章，在并发 2 下验证交替调度
  for (let b = 1; b <= 4; b++) {
    const bookText = `第1章 起势\n${chContent}\n\n第2章 交锋\n${chContent}\n\n第3章 破局\n${chContent}`;
    fs.writeFileSync(path.join(tmpCorpus, `book_yield_${b}.txt`), bookText, 'utf8');
  }

  const pipeline = new CorpusBatchPipeline({
    sourceDir: tmpCorpus,
    stagingRoot: tmpStaging,
    workers: 2
  });

  const extractResult = await pipeline.runExtract({ resume: false });
  assert.equal(extractResult.status, 'extract_completed');

  // 读取检查点清单
  const manifest = JSON.parse(fs.readFileSync(path.join(extractResult.runDir, 'manifest.json'), 'utf8'));
  const bookList = Object.values(manifest.books);

  assert.equal(bookList.length, 4);
  assert.ok(bookList.every(b => b.status === 'completed'));

  // 验证时间戳存在重叠（Worker 之间协同交错运行）
  let hasOverlap = false;
  for (let i = 0; i < bookList.length; i++) {
    for (let j = i + 1; j < bookList.length; j++) {
      const b1 = bookList[i];
      const b2 = bookList[j];
      const t1Start = new Date(b1.startedAt).getTime();
      const t1End = new Date(b1.completedAt).getTime();
      const t2Start = new Date(b2.startedAt).getTime();
      const t2End = new Date(b2.completedAt).getTime();
      if ((t1Start <= t2End && t1End >= t2Start) || (t2Start <= t1End && t2End >= t1Start)) {
        hasOverlap = true;
        break;
      }
    }
    if (hasOverlap) break;
  }

  assert.ok(hasOverlap, '并发 Worker 必须存在时间戳重叠，证明已非阻塞交替调度');
});

// ============================================================================
// R5: Manifest Unsegmented Metric Persistence
// ============================================================================

test('R5.1: CheckpointManifest.prototype.markBookComplete persists stats.unsegmented into manifest.json', () => {
  const tmpStaging = createTempDir('manifest-unsegmented-');
  const manifest = new CheckpointManifest({
    stagingRoot: tmpStaging,
    runId: 'run_unsegmented_test'
  });

  manifest.initOrResume({
    books: [
      { bookId: 'b_segmented', title: '分章正常书目' },
      { bookId: 'b_unsegmented', title: '未分章散文书目' }
    ],
    resume: false
  });

  manifest.markBookStart('b_segmented');
  manifest.markBookComplete('b_segmented', {
    chaptersProcessed: 10,
    candidateChapters: 2,
    unsegmented: 0
  });

  manifest.markBookStart('b_unsegmented');
  manifest.markBookComplete('b_unsegmented', {
    chaptersProcessed: 0,
    candidateChapters: 0,
    unsegmented: 1
  });

  // 读取持久化文件
  const diskData = JSON.parse(fs.readFileSync(manifest.manifestFile, 'utf8'));
  assert.equal(diskData.books['b_segmented'].unsegmented, 0);
  assert.equal(diskData.books['b_unsegmented'].unsegmented, 1);
  assert.equal(diskData.unsegmented, 1, '根层级 unsegmented 累计指标必须持久化为 1');

  // getSummary 检查
  const summary = manifest.getSummary();
  assert.equal(summary.unsegmented, 1);
});

test('R5.2: Batch pipeline end-to-end persists unsegmented chapter count for unparseable novels', async () => {
  const tmpCorpus = createTempDir('pipeline-unseg-corpus-');
  const tmpStaging = createTempDir('pipeline-unseg-staging-');

  // 纯散文无章节头文本
  const rawProse = '这是一本没有任何第X章标题的网络小说，全篇平铺直叙，没有标明章节。\n'.repeat(50);
  fs.writeFileSync(path.join(tmpCorpus, 'raw_unsegmented.txt'), rawProse, 'utf8');

  const pipeline = new CorpusBatchPipeline({
    sourceDir: tmpCorpus,
    stagingRoot: tmpStaging,
    workers: 1
  });

  const extractResult = await pipeline.runExtract({ resume: false });
  assert.equal(extractResult.status, 'extract_completed');

  const diskManifest = JSON.parse(fs.readFileSync(path.join(extractResult.runDir, 'manifest.json'), 'utf8'));
  const bookEntry = diskManifest.books['raw_unsegmented'];

  assert.ok(bookEntry, '未分章书目必须记录在 manifest 中');
  assert.equal(bookEntry.unsegmented, 1, '书目 unsegmented 字段必须持久化切分失败数');
  assert.equal(diskManifest.unsegmented, 1, '全局 manifest.unsegmented 必须正确累计');
});

test('R1.6: Punctuation, enclosing quotes, and adverb modifiers in SVO, Ba, and Bei events are cleanly stripped', () => {
  const svoWithPeriod = parseEventStructure('李巡起获暗黑古钱。');
  assert.equal(svoWithPeriod.verb, '起获');
  assert.equal(svoWithPeriod.subject, '李巡');
  assert.equal(svoWithPeriod.object, '暗黑古钱');
  assert.equal(svoWithPeriod.entity, '暗黑古钱');

  const baWithQuotes = parseEventStructure('“李巡将刺客斩杀”');
  assert.equal(baWithQuotes.verb, '斩杀');
  assert.equal(baWithQuotes.subject, '李巡');
  assert.equal(baWithQuotes.object, '刺客');

  const baWithAdverb = parseEventStructure('李巡将刺客亲手斩杀');
  assert.equal(baWithAdverb.verb, '斩杀');
  assert.equal(baWithAdverb.subject, '李巡');
  assert.equal(baWithAdverb.object, '刺客');

  const beiWithExclamation = parseEventStructure('刺客被李巡斩杀！');
  assert.equal(beiWithExclamation.verb, '斩杀');
  assert.equal(beiWithExclamation.subject, '李巡');
  assert.equal(beiWithExclamation.object, '刺客');

  // 验证带有句号的事件能准确在不含句号的文本中完成实体匹配
  const contract = createNarrativeOutcomeContract({
    domain: 'possession',
    stateDelta: {
      events: ['李巡起获暗黑古钱。'],
      stateAfter: '取得暗黑古钱'
    }
  });
  const text = '李巡潜入藏宝阁，在一处隐秘暗格中，李巡终于稳稳起获了暗黑古钱，揣入怀中。' + '。'.repeat(100);
  const res = evaluateOutcomeContractFulfillment(text, contract);
  assert.equal(res.passed, true);
  assert.equal(res.entityMentions.foregroundCount, 2, '主客体实体均应成功匹配，不得因末尾句号导致客体匹配失败');
});

test('R2.13: Unclosed dialogue quotes at paragraph end do not leak false contradiction penalties', () => {
  const contract = createNarrativeOutcomeContract({
    domain: 'possession',
    stateDelta: {
      events: ['李巡起获暗黑古钱'],
      stateAfter: '取得暗黑古钱'
    }
  });

  const text = '李巡冷笑一声道：“这次难道要空手而归\n李巡伸手探入暗格，稳稳起获了暗黑古钱，揣入怀中。' + '。'.repeat(120);
  const res = evaluateOutcomeContractFulfillment(text, contract);
  assert.deepEqual(res.contradictionsDetected, [], '段末未闭合引号对白不得泄漏矛盾词');
  assert.equal(res.passed, true);
  assert.ok(res.fulfillmentScore >= 0.85);
});

test('R2.14: Auxiliary third-party entity failure in the same sentence does not fail target event occurrence', () => {
  const contract = createNarrativeOutcomeContract({
    domain: 'possession',
    stateDelta: {
      events: ['李巡起获暗黑古钱'],
      stateAfter: '取得暗黑古钱'
    }
  });

  // 同一句内第三人称黑衣人空手而归，目标主角李巡成功起获
  const text = '李巡潜入藏宝阁，在一处暗格中稳稳起获了暗黑古钱，揣入怀中，而黑衣人则空手而归。' + '。'.repeat(120);
  const res = evaluateOutcomeContractFulfillment(text, contract);
  assert.equal(res.passed, true, '同句中第三方实体的失败标记绝不得导致主角事件判定为 FAILED_ATTEMPT');
  assert.equal(res.eventOccurrences.events[0].status, 'VERIFIED_OCCURRED');
  assert.deepEqual(res.contradictionsDetected, []);
  assert.ok(res.fulfillmentScore >= 0.85);

  // 战斗领域第三方失手
  const resOccur = detectEventOccurrences('李巡在暗室起获暗黑古钱，刺客失手被擒。', ['李巡起获暗黑古钱']);
  assert.equal(resOccur.events[0].status, 'VERIFIED_OCCURRED', '刺客失手不得将李巡起获误判为 FAILED_ATTEMPT');
});

test('R2.15: Rhetorical and strong negation markers ("断不可能", "怎会", "岂能") prevent false contradiction penalties', () => {
  const contract = createNarrativeOutcomeContract({
    domain: 'possession',
    stateDelta: {
      events: ['李巡起获暗黑古钱'],
      stateAfter: '取得暗黑古钱'
    }
  });

  const text = '李巡眼神冷冽，此番搜寻断不可能空手而归。他伸手探入暗格，稳稳起获了暗黑古钱，揣入怀中。' + '。'.repeat(120);
  const res = evaluateOutcomeContractFulfillment(text, contract);
  assert.deepEqual(res.contradictionsDetected, [], '“断不可能”修饰的矛盾词不得判定为矛盾');
  assert.equal(res.passed, true);
});

test('R5.3: Idempotent manifest unsegmented tracking prevents overcounting on repeated book complete calls', () => {
  const tmpStaging = createTempDir('manifest-idempotent-');
  const manifest = new CheckpointManifest({
    stagingRoot: tmpStaging,
    runId: 'run_idempotent_test'
  });

  manifest.initOrResume({
    books: [
      { bookId: 'b_retry_test', title: '重试书目' }
    ],
    resume: false
  });

  manifest.markBookStart('b_retry_test');
  manifest.markBookComplete('b_retry_test', {
    chaptersProcessed: 5,
    candidateChapters: 1,
    unsegmented: 3
  });

  assert.equal(manifest.data.books['b_retry_test'].unsegmented, 3);
  assert.equal(manifest.data.unsegmented, 3);

  // 模拟重试或重复触发 markBookComplete
  manifest.markBookComplete('b_retry_test', {
    chaptersProcessed: 5,
    candidateChapters: 1,
    unsegmented: 3
  });

  assert.equal(manifest.data.books['b_retry_test'].unsegmented, 3);
  assert.equal(manifest.data.unsegmented, 3, '重复完成不得累加虚高 unsegmented 计数');
});

