import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateChapterHealth } from '../lib/prose-health-evaluator.js';

test('evaluateChapterHealth 基础评估与 S 级满分章节判定', () => {
  const perfectChapter = `第1章 月圆前夜

罗祖云山界的风声穿过回廊，卷起云琉神殿檐下的古铜铃铎。

张若尘站在九重玉阶上方，手中握着那卷《七曜古经》，目光落在神殿外的沉沉夜色中。白苍星的光芒如一道冰冷长弧，斜斜贯穿三千界。

“神尊若要动这方棋局，便先问过我手中这卷残页。”

姑射静自殿柱阴影中现身，罗袖微拂，掌心托出一枚泛着冷光的《天魔舍利》。两人对视一眼，未发一言，却已心照不宣。

山下魔兵集结的号角骤然撕裂了沉寂。张若尘收起经卷，转身走向神殿深处：“今夜，谁也别想走出云山界半步。”`;

  const metadata = {
    title: '月圆前夜',
    targetMin: 200,
    targetMax: 1000,
    keyProps: ['七曜古经', '天魔舍利'],
    keyQuotes: ['神尊若要动这方棋局，便先问过我手中这卷残页']
  };

  const health = evaluateChapterHealth(perfectChapter, metadata);

  assert.equal(health.ok, true);
  assert.ok(health.compositeScore >= 90, `预期 S 级评分 >=90，实际: ${health.compositeScore}`);
  assert.equal(health.grade, 'S');
  assert.equal(health.aiFlavor.passed, true);
  assert.equal(health.aiFlavor.spasmCount, 0);
  assert.equal(health.fulfillment.rate, 100);
  assert.equal(health.fulfillment.props.missing.length, 0);
  assert.equal(health.fulfillment.quotes.missing.length, 0);
  assert.equal(health.hook.hasHook, true);
  assert.equal(health.rhythm.brickParagraphCount, 0);
});

test('evaluateChapterHealth 砖石段落检测与去AI味抽搐扣分', () => {
  const brickAndSpasmChapter = `第2章 困兽之斗

他指节泛白，喉咙发紧，心跳漏了一拍。在这个呼吸一滞的瞬间，他按揉发胀的太阳穴，嘴角勾起一抹玩味的弧度，下意识地掐进掌心，牙关紧咬着不敢松懈半分。

` + '这是一段极其冗长且没有换行的大实心砖石段落。'.repeat(15) + `

他看着眼前的一切，心中充满了感慨。今天的事情就这样结束了，大家各回各家。`;

  const health = evaluateChapterHealth(brickAndSpasmChapter, {
    targetMin: 300,
    targetMax: 1200,
    keyProps: ['昆仑玄冰'],
    keyQuotes: ['你逃不掉的']
  });

  assert.equal(health.ok, true);
  assert.ok(health.rhythm.brickParagraphCount >= 1, '应检测出实心大砖块段落');
  assert.equal(health.aiFlavor.passed, false, '存在生理抽搐不应通过零抽搐');
  assert.ok(health.aiFlavor.spasmCount >= 3, '应检出多处生理抽搐词汇');
  assert.ok(health.fulfillment.props.missing.includes('昆仑玄冰'), '未出现道具应标记 missing');
  assert.ok(health.fulfillment.quotes.missing.includes('你逃不掉的'), '未出现原话应标记 missing');
  assert.ok(health.suggestions.length >= 2, '存在问题时应提供针对性修改建议');
  assert.ok(['B', 'C'].includes(health.grade), `多维问题评分应为 B 或 C，实际: ${health.grade}`);
});

test('evaluateChapterHealth 章末悬念留钩检测', () => {
  const flatEnding = `第3章 平凡一天\n\n阳光普照大地。主角吃完早饭，在院子里散了散步，然后回到房间睡下了。`;
  const hookedEnding = `第3章 危机暗涌\n\n然而就在此刻，门外突然传来了极其刺耳的破空声，一道血色符咒贴在了门缝上：“小心今夜三更，有人要取你的头！”`;

  const hFlat = evaluateChapterHealth(flatEnding);
  const hHooked = evaluateChapterHealth(hookedEnding);

  assert.ok(hHooked.hook.score > hFlat.hook.score, '带悬念章节留钩分应显著高于平淡结尾');
  assert.equal(hHooked.hook.hasHook, true);
});
