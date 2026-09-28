import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const { generateRealChapter } = require('../lib/real-novel-generator.js');
const { extractPacingMetrics } = require('../lib/experiment-controller.js');

function syncTokenUsage() {
  try {
    const dbPath = path.resolve(__dirname, '../data/molan.db');
    const jsonPath = path.resolve(__dirname, '../data/token_usage.json');
    const db = new DatabaseSync(dbPath);
    const rows = db.prepare('SELECT * FROM token_usage ORDER BY rowid DESC LIMIT 100').all();
    fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2), 'utf8');
    console.log(`[SYNC] 已将 SQLite molan.db 中最新的 ${rows.length} 条记录实时同步至 ${jsonPath}`);
  } catch (e) {
    console.warn('[SYNC ERROR]', e.message);
  }
}

async function runLiveGenerations() {
  console.log('='.repeat(70));
  console.log('🌐 启动跨题材在线大模型实时推理与实验生成引擎');
  console.log('   模型: gpt-5.6-luna | 状态: 在线流式调用 | 真实计费与DB落盘');
  console.log('='.repeat(70));

  const results = [];

  // =========================================================================
  // 1. 仙侠题材实时生成: 《凡人修仙传：神手谷的考验》 (验证时空转场 OPT-SCENE-002 与低对白压抑感)
  // =========================================================================
  console.log('\n[1/2] 正在调用 gpt-5.6-luna 实时生成仙侠小说章节...');
  const xianxiaPrompt = `
请生成一章标准的凡人流古典仙侠小说正文，章节标题《神手谷的考验》，字数控制在 2400-3000 汉字。

【世界观与人物设定】
- 题材：古典凡人流修仙体系（七玄门、神手谷、灵根资质、无名口诀/长生经入门）。
- 人物：韩立（相貌普通、皮肤微黑、性格极其谨慎机警、少言多思）、墨大夫（面容枯槁如骷髅、目光如炬、喜怒无常、神秘叵测）。
- 关键物料与道具：长生经入门残页、青玉药臼、银针、黑血蜈蚣、黄龙丹配伍药渣。

【剧情结构与场景流转】
1. 场景一（谷中孤寂与药理初试）：韩立在神手谷偏厢房内挑拣草药，墨大夫突击考校辨药之法，韩立对答谨慎，展现超常心智。
2. 场景二（夜试经脉与传授口诀）：夜深烛火摇曳，墨大夫以银针刺穴探查韩立周天经脉，韩立咬牙强忍剧痛。墨大夫神色阴晴不定，随后扔出一本无名口诀残卷，命其修行并约定三日后清晨考校气感。
3. 场景三（时空转场 - 重点指令 OPT-SCENE-002）：
   - 【严禁】出现孤立的“三日后”、“三天时间一晃而过”等生硬硬切！
   - 【必须】通过谷中熬药升腾的苦涩烟气、偏房窗台青石苔藓上凝结的秋露、油灯灯草数次爆裂燃尽等具体环境物理视点，平滑过渡这三日的苦修时光，篇幅控制在 40 汉字以内。
4. 场景四（气感初验与暗流涌动）：三日后清晨，神手谷晨雾未散，墨大夫再次切脉探查，发觉韩立下丹田微生一丝暖流。墨大夫眼神闪过一丝狂喜与深邃寒意，赐予一瓶行血药散，留下悬念。

【风格与语言契约】
- 凡人流严肃冷清质感，对白字数占比控制在 18%-23%，严禁玄幻装逼与都市废话。
- 严禁使用“仿佛”、“似乎”、“深吸一口气”、“嘴角勾起”等工业 AI 套话。
- 只交付标题与正文，严禁前言后记或自我解析。
`;

  const t0_xianxia = Date.now();
  const xianxiaRes = await generateRealChapter({
    bookTitle: '凡人修仙传-神手谷考验-live-cycle3',
    stage: 'live-cycle3-xianxia',
    variant: 'treatment',
    genre: '仙侠',
    model: 'gpt-5.6-luna',
    temperature: 0.78,
    maxTokens: 3500,
    prompt: xianxiaPrompt,
    forceRegenerate: true
  });
  const elapsed_xianxia = Date.now() - t0_xianxia;
  console.log(`✅ [仙侠] 在线实时推理完成！耗时: ${elapsed_xianxia}ms | 字符: ${xianxiaRes.charCount}`);
  console.log(`   - 上游 RequestId: ${xianxiaRes.usage?.requestId || 'N/A'}`);
  console.log(`   - 实际 Token: ${JSON.stringify(xianxiaRes.usage || {})}`);

  syncTokenUsage();

  // =========================================================================
  // 2. 都市生活题材实时生成: 《1984：从破产川菜馆开始之川味觉醒》 (验证后厨物理阻尼与对白机锋)
  // =========================================================================
  console.log('\n[2/2] 正在调用 gpt-5.6-luna 实时生成都市年代生活章节...');
  const urbanPrompt = `
请生成一章高质感的年代都市生活创业小说正文，章节标题《川味觉醒》，字数控制在 2400-3000 汉字。

【时代背景与人物设定】
- 背景：1984年秋，蓉城红星农贸市场与二轻局下属濒临倒闭的国营川菜馆。
- 人物：陈青山（重生川厨传人、稳重干练、深谙市井与体制规则）、赵大喜（农贸市场肉摊老板、精明圆滑）、林科长（二轻局改制科长、面临包袱甩不掉的政绩压力）。
- 关键道具与食材：二刀坐墩肉、郫县老豆瓣酱、生铁炒锅、二荆条青椒、菜籽油、肉票与改制承包协议草案。

【剧情结构与场景流转】
1. 场景一（市场选肉交锋）：陈青山在肉摊前用手指丈量带皮二刀肉的肥膘厚度与紧实度，针对肉票折抵比例与赵大喜展开充满市井机锋的砍价拉锯。
2. 场景二（后厨生火与刀工）：回到老川菜馆后厨，煤炉捅开旺火，冷水下锅加老姜花椒将肉煮至断生，快刀连切出薄如纸、带肉皮的灯盏窝肉片。
3. 场景三（物理阻尼与爆炒声色）：生铁锅烧透下菜籽油，肥肉下锅滋滋爆出油渣香气，下特制老豆瓣炒出色泽红亮、浓香扑鼻的红油，青椒断生，锅气席卷整条街坊。
4. 场景四（契约破局）：林科长闻香进店，品尝之后大受震动，当场将原定苛刻的“定额死缴”改制合同调整为“基准保底+超额利润提成”，签下协议。

【风格与语言契约】
- 年代生活硬质感：密集呈现手感、油泡声、火候、油脂香气、粮票肉票折算机制。
- 对白占比保持在 30%-35%，体现市井人情与时代体制机锋。
- 严禁使用“仿佛”、“似乎”、“深吸一口气”等套话。
- 只交付标题与正文。
`;

  const t0_urban = Date.now();
  const urbanRes = await generateRealChapter({
    bookTitle: '1984川菜馆-川味觉醒-live-cycle3',
    stage: 'live-cycle3-urban',
    variant: 'treatment',
    genre: '都市',
    model: 'gpt-5.6-luna',
    temperature: 0.80,
    maxTokens: 3500,
    prompt: urbanPrompt,
    forceRegenerate: true
  });
  const elapsed_urban = Date.now() - t0_urban;
  console.log(`✅ [都市] 在线实时推理完成！耗时: ${elapsed_urban}ms | 字符: ${urbanRes.charCount}`);
  console.log(`   - 上游 RequestId: ${urbanRes.usage?.requestId || 'N/A'}`);
  console.log(`   - 实际 Token: ${JSON.stringify(urbanRes.usage || {})}`);

  syncTokenUsage();

  // =========================================================================
  // 3. 提取实测特征指标
  // =========================================================================
  const xianxiaPacing = extractPacingMetrics(xianxiaRes.content);
  const urbanPacing = extractPacingMetrics(urbanRes.content);

  const summary = {
    generatedAt: new Date().toISOString(),
    engine: 'gpt-5.6-luna (live online)',
    xianxia: {
      bookTitle: xianxiaRes.bookTitle,
      charCount: xianxiaRes.charCount,
      durationMs: elapsed_xianxia,
      requestId: xianxiaRes.usage?.requestId,
      tokens: xianxiaRes.usage,
      pacing: xianxiaPacing,
      dialogueRatio: xianxiaPacing.dialogueCharRatio,
      abruptJumps: xianxiaPacing.abruptTimeJumps,
      fangfuCount: (xianxiaRes.content.match(/仿佛/g) || []).length
    },
    urban: {
      bookTitle: urbanRes.bookTitle,
      charCount: urbanRes.charCount,
      durationMs: elapsed_urban,
      requestId: urbanRes.usage?.requestId,
      tokens: urbanRes.usage,
      pacing: urbanPacing,
      dialogueRatio: urbanPacing.dialogueCharRatio,
      abruptJumps: urbanPacing.abruptTimeJumps,
      fangfuCount: (urbanRes.content.match(/仿佛/g) || []).length
    }
  };

  const outPath = path.resolve(__dirname, '../data/evaluation-input/experiments/live-multi-genre-cycle3-summary.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`\n🎉 跨题材在线实时生成与全链路特征提取完成！结果已写入: ${outPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

runLiveGenerations().catch(e => {
  console.error('CRITICAL GENERATION FAILURE:', e);
  process.exit(1);
});
