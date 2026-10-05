'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  StoryDebtLedger,
  projectDebtsForChapter,
  reconcileChapterDebts,
  DEBT_TYPES,
  DEBT_STATUSES,
  DEBT_EVENT_TYPES
} = require('../lib/composition/debt');

const { createNarrativeDebt } = require('../lib/composition/models/data-schemas');
const { IsolationManager } = require('../lib/composition/corpus/isolation-manager');
const { CheckpointManifest } = require('../lib/composition/corpus/checkpoint-manifest');
const { mineStrategiesFromFeatures } = require('../lib/composition/corpus/strategy-miner');
const { PackagePublisher } = require('../lib/composition/corpus/package-publisher');
const { EvidenceCatalog, defaultEvidenceCatalog } = require('../lib/composition/corpus/evidence-catalog');
const contentEngine = require('../lib/generation/content-engine');
const { defaultProfileRegistry } = require('../lib/composition/profiles/profile-registry');

function createTempDir(prefix = 'hardening-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('Hardening: DebtProjection 严格防御模型注意力稀释 (100条全量债务硬压缩至<=8条)', () => {
  const ledger = new StoryDebtLedger({ storyId: 'story_attention_stress' });

  // 注入 100 条待偿债务：其中 30 条逾期，20 条紧急，20 条钩子，30 条人物债
  for (let i = 1; i <= 100; i++) {
    const isOverdue = i <= 30;
    const isCritical = i > 30 && i <= 50;
    const isHook = i > 50 && i <= 70;
    const isChar = i > 70;

    ledger.createDebt({
      debtId: `debt_stress_${i}`,
      debtType: isHook ? 'hook' : (isChar ? 'character' : 'plot'),
      summary: isChar ? `主角李巡的隐秘心结_${i}` : (isHook ? `危机切断钩子_${i}` : `宗门因果案_${i}`),
      target_entity_id: isChar ? '李巡' : `npc_${i}`,
      created_at_chapter: isOverdue ? 50 : 100,
      expected_payoff_from: isOverdue ? 60 : 110,
      expected_payoff_to: isOverdue ? 70 : 120,
      priority: isCritical ? 'critical' : (isOverdue ? 'high' : 'normal'),
      weight: 0.6
    });
  }

  assert.equal(ledger.getOpenDebts().length, 100);

  // 为第 118 章执行投影，限制 maxDebts: 8
  const chapterProjection = projectDebtsForChapter(ledger, {
    currentChapter: 118,
    activeCharacters: ['李巡'],
    maxDebts: 8
  });

  assert.equal(chapterProjection.totalOpenDebts, 100);
  assert.equal(chapterProjection.selectedDebtsCount, 8);
  assert.equal(chapterProjection.debtsToAddress.length, 8);

  const p = chapterProjection.projection;
  const totalProjected = p.urgent.length + p.dueSoon.length + p.activeCharacterDebts.length + p.openHooks.length + p.longTermForeshadows.length;
  // 5 层快照债务总数必须严格等于 8，绝不可将全书 100 条债务未过滤直接倾泻入快照
  assert.equal(totalProjected, 8);

  // 提示词指引文本中的债务条目数也必须严格受控
  const guidance = chapterProjection.promptGuidance;
  assert.ok(guidance.includes('总待偿债务 100 条，精选聚焦 8 条'));
  // 校验不会出现第 9 个不同的 [CRITICAL] 或 [HIGH] 标号
  const urgentLines = (guidance.match(/  - \[/g) || []).length;
  assert.ok(urgentLines <= 8);
});

test('Hardening: StoryDebtLedger 动态相对兑现窗口与生命周期跃迁修复', () => {
  const ledger = new StoryDebtLedger({ storyId: 'story_lifecycle_hardening' });

  // 1. 在第 50 章建立债务，未显式传 payoff window 时，绝不能默认成 2~6 章导致一出生就逾期 44 章
  const debt50 = ledger.createDebt({
    debtId: 'debt_ch50',
    summary: '第50章新伏笔',
    created_at_chapter: 50
  });

  assert.equal(debt50.created_at_chapter, 50);
  assert.equal(debt50.expected_payoff_from, 51);
  assert.equal(debt50.expected_payoff_to, 55);

  // 投影第 50 章时，此债务绝不应被判定为逾期 (urgent)
  const proj50 = projectDebtsForChapter(ledger, { currentChapter: 50 });
  assert.ok(!proj50.projection.urgent.some(u => u.debtId === 'debt_ch50'));

  // 2. 向前兼容：在第 1 章建立的债务，默认窗口依然为 2~6
  const debt1 = ledger.createDebt({
    debtId: 'debt_ch1',
    summary: '第1章初始伏笔',
    created_at_chapter: 1
  });
  assert.equal(debt1.expected_payoff_from, 2);
  assert.equal(debt1.expected_payoff_to, 6);

  // 3. 延期 (DEFERRED) 债务在后续章节加深 (ESCALATED) 时，能正常跃迁回 DEVELOPING
  ledger.deferDebt('debt_ch1', { chapterNo: 5, notes: '主线转移延期' });
  assert.equal(ledger.getDebt('debt_ch1').status, 'deferred');

  ledger.escalateDebt('debt_ch1', { chapterNo: 8, notes: '矛盾重新激化' });
  assert.equal(ledger.getDebt('debt_ch1').status, 'developing');

  // 4. explainDebt 必须完整记录 DEFERRED 轨迹并给出最后结项说明
  ledger.payDebt('debt_ch1', { chapterNo: 10, evidence: '交出物证', notes: '彻底完结' });
  const explanation = ledger.explainDebt('debt_ch1');
  assert.equal(explanation.isResolved, true);
  assert.ok(explanation.auditStatement.includes('DEFERRED'));
  assert.ok(explanation.auditStatement.includes('PAID'));
});

test('Hardening: DebtReconciliation 局部窗口紧邻匹配防范全人物债务雪崩误核销', () => {
  const ledger = new StoryDebtLedger({ storyId: 'story_anti_avalanche' });

  // 同一主角李巡关联的两条不同因果
  ledger.createDebt({
    debtId: 'debt_identity',
    debtType: 'character',
    summary: '李巡对师妹隐瞒身世之谜',
    target_entity_id: '李巡',
    created_at_chapter: 10
  });

  ledger.createDebt({
    debtId: 'debt_tiger',
    debtType: 'plot',
    summary: '李巡斩杀黑虎恶霸',
    target_entity_id: '李巡',
    created_at_chapter: 10
  });

  // 章节正文仅发生了斩杀黑虎的战斗，提及了主角李巡名字，但完全没有揭露身世之谜
  const battleDraftText = `
    幽谷暴雨倾盆。李巡飞身跃起，袖中精钢短刃裹挟着雷霆之势，当空斩落！
    黑虎狂吼一声，巨爪尚未拍出，已被短刃瞬间刺透咽喉，当场毙命。
    李巡终于一剑斩杀黑虎恶霸，擦拭血迹后收刃归鞘。
  `.trim();

  const reconResult = reconcileChapterDebts({
    ledger,
    chapterNo: 14,
    draftText: battleDraftText
  });

  // 必须只核销斩杀黑虎，绝不能因提及“李巡”而连带核销身世之谜
  assert.equal(reconResult.reconciledCount, 1);
  assert.equal(ledger.getDebt('debt_tiger').status, 'paid');
  assert.equal(ledger.getDebt('debt_identity').status, 'open');
});

test('Hardening: ReaderPromise / ReaderExpectation 统一规约与双向兼容', () => {
  // 1. data-schemas createNarrativeDebt 原生支持 reader_promise 与 reader_promise_debt
  const debtPromise = createNarrativeDebt({
    debtType: 'reader_promise',
    summary: '主角承诺参加年末宗门大比'
  });
  assert.equal(debtPromise.debtType, 'reader_promise');

  const debtPromise2 = createNarrativeDebt({
    debtType: 'reader_promise_debt',
    summary: '三年之约宗门决战'
  });
  assert.equal(debtPromise2.debtType, 'reader_promise_debt');

  // 2. StoryDebtLedger 统一将 reader_promise 归一化至底层 7 维中的 reader_expectation
  const ledger = new StoryDebtLedger();
  const created = ledger.createDebt({
    debtType: 'reader_promise',
    summary: '主角参加宗门大比预期'
  });
  assert.equal(created.debt_type, DEBT_TYPES.READER_EXPECTATION);
  assert.equal(created.debt_type, DEBT_TYPES.READER_PROMISE);
});

test('Hardening: StrategyMiner 零特征数据严防伪造通过质量门禁与发布', () => {
  const tmpStaging = createTempDir('miner-hardening-');
  const emptyRunDir = path.join(tmpStaging, 'run_empty');
  fs.mkdirSync(emptyRunDir, { recursive: true });
  fs.writeFileSync(path.join(emptyRunDir, 'chapter-features.jsonl'), '', 'utf8');

  // 挖掘空特征文件
  const result = mineStrategiesFromFeatures({ runDir: emptyRunDir });
  assert.equal(result.totalChaptersAnalyzed, 0);
  assert.equal(result.acceptedCount, 0);
  assert.equal(result.qualityReport.status, 'failed');

  // 发布器必须阻断质量未通过的包
  const publisher = new PackagePublisher({ targetBase: path.join(tmpStaging, 'kb') });
  fs.writeFileSync(path.join(emptyRunDir, 'manifest.json'), '{}', 'utf8');
  assert.throws(
    () => publisher.publishRun(emptyRunDir),
    /发布门禁拦截：质量检查状态为 \[failed\]/
  );
});

test('Hardening: IsolationManager 严格 O_RDONLY 只读打开与 GBK/GB18030 编码自适应兼容', () => {
  const isolation = new IsolationManager({ workers: 2 });
  const tmp = createTempDir('encoding-test-');

  // 1. 构造 GB18030 / GBK 编码文本文件
  const gbkFile = path.join(tmp, 'gbk_book.txt');
  const chineseText = '第1章 临渊问剑\n李巡在风雪中拔剑，剑鸣如龙，寒霜侵染长阶。';
  // Node 22 TextEncoder 只支持 utf-8，但可通过 TextDecoder('gb18030') 检验
  // 利用原生缓冲区构造 Windows ANSI/GBK 汉字序列（临=c1d9, 渊=d4a8）
  const gbkBuf = Buffer.from([
    0xb5, 0xda, 0x31, 0xd5, 0xc2, 0x20, 0xc1, 0xd9, 0xd4, 0xa8, 0xce, 0xca, 0xbd, 0xa3, 0x0a, // 第1章 临渊问剑\n
    0xc0, 0xee, 0xd1, 0xb2, 0xd4, 0xda, 0xb7, 0xe7, 0xd1, 0xa9, 0xd6, 0xd0, 0xb0, 0xce, 0xbd, 0xa3 // 李巡在风雪中拔剑
  ]);
  fs.writeFileSync(gbkFile, gbkBuf);

  // 2. readReadOnlyFileText 自动捕获并无损解码 GBK
  const decoded = isolation.readReadOnlyFileText(gbkFile);
  assert.ok(decoded.includes('第1章 临渊问剑'));
  assert.ok(decoded.includes('李巡在风雪中拔剑'));
});

test('Hardening: EvidenceCatalog 自动发现并挂载已发布活跃知识包', () => {
  const tmp = createTempDir('catalog-autoload-');
  const kbDir = path.join(tmp, 'strategy-kb');
  const runDir = path.join(tmp, 'run_mock');
  fs.mkdirSync(runDir, { recursive: true });

  // 模拟生成合格的规则与质量报告
  fs.writeFileSync(path.join(runDir, 'manifest.json'), '{}');
  fs.writeFileSync(path.join(runDir, 'chapter-features.jsonl'), '{"chapter":1}\n');
  const mockRule = {
    id: 'rule_custom_published_01',
    name: '暗线交错发布律',
    type: 'goal',
    rule: '关键道具必须在前三章完成现场物证交互',
    abstractPattern: '道具出场 -> 物理交互 -> 因果锁定',
    microExample: '李巡推开暗格',
    failureMode: '凭空出世',
    evidenceStrength: 'A',
    stats: { supportCount: 15, bookCount: 3, authorCount: 3, qualityLift: 0.25, confidence: 0.95, confoundScore: 0.05 },
    applicableDimensions: ['info_reveal']
  };
  fs.writeFileSync(path.join(runDir, 'strategy-rules.jsonl'), JSON.stringify(mockRule) + '\n');
  fs.writeFileSync(path.join(runDir, 'archetypes.json'), '{}');
  fs.writeFileSync(path.join(runDir, 'evidence.json'), '{}');
  fs.writeFileSync(path.join(runDir, 'quality-report.json'), JSON.stringify({ status: 'passed', publishedRulesCount: 1 }));

  // 执行发布
  const publisher = new PackagePublisher({ targetBase: kbDir });
  publisher.publishRun(runDir, { version: 'v1.0.0' });

  // 实例化全新证据库并检索：必须自动发现并加载已发布包中的规则
  const catalog = new EvidenceCatalog();
  const loadedCount = catalog.loadActivePublishedPackage(kbDir);
  assert.equal(loadedCount, 1);

  const matched = catalog.findRelevantCards({ dimensions: ['info_reveal'], minStrength: 'A' });
  assert.ok(matched.some(c => c.id === 'rule_custom_published_01'));
});

test('Hardening: content-engine.generateDraft 完整透传 compositionSpec 与 storyDebtLedger', async () => {
  const ledger = new StoryDebtLedger({ storyId: 'story_opt_passthrough' });
  ledger.createDebt({
    debtId: 'debt_opt_01',
    debtType: 'hook',
    summary: '古井底部铁链声',
    created_at_chapter: 5
  });

  const spec = defaultProfileRegistry.resolveCompositionSpec({
    genre: 'xuanhuan_cautious',
    chapterGoal: 'info_reveal'
  });

  let capturedSystemPrompt = '';

  const result = await contentEngine.generateDraft({
    callModel: async (auth, req) => {
      capturedSystemPrompt = req.system;
      return {
        text: '古井底部忽然传来细碎铁链拖拽声，李巡终于说出当年古井铁链的隐秘。',
        usage: { totalTokens: 100 }
      };
    },
    auth: { user: { userId: 'u_opt_pass' } },
    // 在 top-level options 中传递
    compositionSpec: spec,
    storyDebtLedger: ledger,
    contract: { chapterNo: 6, chapterId: 'ch_6', chapterGoal: '信息揭示' },
    declaredResolutions: [
      { debtId: 'debt_opt_01', action: 'PAID', evidence: '说出古井铁链隐秘' }
    ]
  });

  assert.equal(result.status, 'draft_created');
  // 必须成功编译了 spec 体系并包含因果对账
  assert.ok(capturedSystemPrompt.includes('【本章钩子策略'));
  assert.ok(result.debtReconciliation !== null);
  assert.equal(result.debtReconciliation.reconciledCount, 1);
  assert.equal(ledger.getDebt('debt_opt_01').status, 'paid');
});
