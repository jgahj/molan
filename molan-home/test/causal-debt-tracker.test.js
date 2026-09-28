'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { CausalDebtTracker } = require('../lib/causal-debt-tracker');

const testDir = path.join(__dirname, '../data/test-causal-debts');

test('CausalDebtTracker 基础记账与三主三辅容量控制', () => {
  const tracker = new CausalDebtTracker({ storeDir: testDir, maxMajorDebts: 3, maxArcDebts: 3, maxMicroDebts: 3, microExpirationSpan: 5 });
  const bookId = 'test-book-01';
  tracker.clearDebts(bookId);

  // 1. 记录 1 项主线债，1 项支线债，1 项微观风味账
  const debt1 = tracker.recordDebt(bookId, { originChapter: 1, type: 'major', seed: '杀父之仇卷宗被常委私藏', maturationChapter: 25 });
  const debt2 = tracker.recordDebt(bookId, { originChapter: 1, type: 'arc', seed: '官牙少算一钱剪口银', maturationChapter: 10 });
  const debt3 = tracker.recordDebt(bookId, { originChapter: 1, type: 'micro', seed: '弄丢了半块硬烧饼', maturationChapter: 3 });

  assert.equal(debt1.type, 'major');
  assert.equal(debt2.type, 'arc');
  assert.equal(debt3.type, 'micro');

  // 2. 检查第 1 章的活跃债务
  const ch1Debts = tracker.getActiveDebts(bookId, 1);
  assert.equal(ch1Debts.allActiveCount, 3);
  assert.equal(ch1Debts.matured.length, 0);
  assert.equal(ch1Debts.active.length, 3);

  // 3. 跨越到第 4 章：debt3（micro）应该成熟
  const ch4Debts = tracker.getActiveDebts(bookId, 4);
  assert.equal(ch4Debts.matured.length, 1);
  assert.equal(ch4Debts.matured[0].id, debt3.id);

  // 4. 跨越到第 7 章：debt3（micro，origin 1）超过 5 章，应该自动沉降为 settled
  const ch7Debts = tracker.getActiveDebts(bookId, 7);
  assert.equal(ch7Debts.allActiveCount, 2); // micro 超期自动沉降

  // 5. 跨越到第 10 章：debt2（arc）应该成熟
  const ch10Debts = tracker.getActiveDebts(bookId, 10);
  assert.ok(ch10Debts.matured.some(d => d.id === debt2.id));

  // 6. 兑现 debt2
  const redeemed = tracker.redeemDebt(bookId, debt2.id, 10, '玉娘拿出官税底联打脸官牙');
  assert.equal(redeemed.status, 'redeemed');
  assert.equal(redeemed.redeemedChapter, 10);

  // 7. 测试提示词注入输出
  const promptInjection = tracker.buildDebtPromptInjection(bookId, 10);
  assert.ok(promptInjection.includes('【跨章节因果债务与细节复利'));
  assert.ok(promptInjection.includes('杀父之仇卷宗被常委私藏'));

  // 8. 连续录入超出上限，验证三主三辅严格截断
  tracker.recordDebt(bookId, { originChapter: 10, type: 'major', seed: '大债2' });
  tracker.recordDebt(bookId, { originChapter: 10, type: 'major', seed: '大债3' });
  tracker.recordDebt(bookId, { originChapter: 10, type: 'major', seed: '大债4 (应淘汰大债1)' });

  const finalMajor = tracker.getActiveDebts(bookId, 10).active.filter(d => d.type === 'major');
  assert.equal(finalMajor.length, 3, '主线大债不能超过3条上限');

  // 清理测试数据
  tracker.clearDebts(bookId);
  try { fs.rmdirSync(testDir); } catch (_) {}
});

test('CausalDebtTracker 从正文中启发式提取潜在因果债务', () => {
  const tracker = new CausalDebtTracker({ storeDir: testDir });
  const sampleText = `
    县衙后堂内，书吏冷笑道：“少了一钱碎银，大魏律例，折色少二钱不准立户。”
    顾沉舟翻开勘验笔录，3号检材未登记提取工具，这分明是个程序瑕疵。
    许青看着腰间短刀，刃口缺了三处，磨石早已经受潮发黑。
  `;

  const extracted = tracker.extractPotentialDebts(sampleText, 2);
  assert.ok(extracted.length >= 2);
  assert.ok(extracted.some(e => e.seed.includes('少了一钱') || e.seed.includes('折色')));
  assert.ok(extracted.some(e => e.seed.includes('未登记') || e.seed.includes('瑕疵')));
});
