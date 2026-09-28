import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CausalDebtTracker } from '../lib/causal-debt-tracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDir = path.join(__dirname, '../data/test-multi-genre-debts');

test('CausalDebtTracker 支持多流派债务范式与平账', () => {
  const tracker = new CausalDebtTracker({
    storeDir: testDir,
    maxMajorDebts: 5,
    maxArcDebts: 5,
    maxMicroDebts: 5,
    microExpirationSpan: 5
  });
  const bookId = 'test-multi-genre-book';
  tracker.clearDebts(bookId);

  // 1. 录入多流派特化因果债务
  const debtComedy = tracker.recordDebt(bookId, {
    originChapter: 1,
    type: 'arc',
    debtCategory: 'comedy_mess',
    seed: '张拂潇把队伍的干粮和信件偷塞进族长包裹',
    immediateCost: '全队以为闹鬼，人心惶惶',
    suggestedPayoffAction: '族长当众拆包发现罪魁祸首尴尬社死',
    maturationChapter: 4
  });

  const debtRomance = tracker.recordDebt(bookId, {
    originChapter: 1,
    type: 'arc',
    debtCategory: 'emotional_tension',
    seed: '女主给男主系上红绳，随口许诺“活着回来就告诉你秘密”',
    immediateCost: '男主耳根泛红心神不定',
    maturationChapter: 3
  });

  const debtRule = tracker.recordDebt(bookId, {
    originChapter: 1,
    type: 'major',
    debtCategory: 'rule_violation',
    seed: '在怪谈公寓午夜违规开门放生了一只黑猫',
    immediateCost: '公寓楼层规则出现裂痕，红字警告',
    maturationChapter: 6
  });

  assert.equal(debtComedy.debtCategory, 'comedy_mess');
  assert.equal(debtRomance.debtCategory, 'emotional_tension');
  assert.equal(debtRule.debtCategory, 'rule_violation');

  // 2. 验证提示词注入包含流派前缀
  const ch4Prompt = tracker.buildDebtPromptInjection(bookId, 4);
  assert.ok(ch4Prompt.includes('【烂摊子/误会喜剧债】'), '应包含喜剧债提示');
  assert.ok(ch4Prompt.includes('【情感拉扯/承诺暧昧债】'), '应包含情感债提示');

  // 3. 验证平账 settleDebt
  const settled = tracker.settleDebt(bookId, debtComedy.id, '第4章族长拆包当场识破，完成爆笑打闹平账');
  assert.ok(settled, '应成功平账');
  assert.equal(settled.status, 'settled');
  assert.equal(settled.settledReason, '第4章族长拆包当场识破，完成爆笑打闹平账');

  // 4. 再次获取活跃债务，已平账债务不再属于 active
  const debtsAfter = tracker.getActiveDebts(bookId, 4);
  assert.ok(!debtsAfter.active.some(d => d.id === debtComedy.id));
  assert.ok(!debtsAfter.matured.some(d => d.id === debtComedy.id));

  // 清理
  tracker.clearDebts(bookId);
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
});

test('CausalDebtTracker 启发式提取多题材文本中的代价与承诺', () => {
  const tracker = new CausalDebtTracker({ storeDir: testDir });

  const multiGenreText = `
    第1章 惊变
    
    林玄服下九转焚血丹，冷喝道：“以此丹代价，强开气海，三个月内必遭反噬！”
    
    走廊尽头，门上的规则血字格外刺目：“切记不可在午夜给任何人开门。”
    
    张拂潇叼着草笑了笑：“抢劫抢到老娘头上来了？这笔账我记下了，洗干净脖子等我回来！”
  `;

  const extracted = tracker.extractPotentialDebts(multiGenreText, 1);
  assert.ok(extracted.length >= 2, `应提取出至少 2 条因果代价，实际: ${extracted.length}`);

  const seeds = extracted.map(e => e.seed).join(' ');
  assert.ok(seeds.includes('九转焚血丹') || seeds.includes('反噬') || seeds.includes('开气海'), '应捕捉到玄幻/武侠功法代价');
  assert.ok(seeds.includes('开门') || seeds.includes('血字') || seeds.includes('记下') || seeds.includes('等我回来'), '应捕捉到规则或发狠承诺');

  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
});
