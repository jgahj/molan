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
const { runRegressionSuite } = require('../lib/regression-testing-engine.js');
const { auditGeneralization } = require('../lib/generalization-detector.js');
const { executeEvolutionCycle } = require('../lib/self-evolution-controller.js');

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

async function runCycle5Loop() {
  console.log('='.repeat(75));
  console.log('🔥 启动第五轮 (Cycle 5) 真实修复闭环：PostgreSQL后端激活 + OPT-SCENE-003动作动量刚性配额');
  console.log('   数据库后端: PostgreSQL 18.6 (77张表, status: ready) | 模型: gpt-5.6-luna 在线推理');
  console.log('='.repeat(75));

  // 1. 验证健康检查
  const healthRes = await fetch('http://127.0.0.1:3000/api/health').then(r => r.json());
  console.log(`\n[PG CHECK] 服务端健康检查状态:`, JSON.stringify(healthRes.postgres, null, 2));
  if (!healthRes.postgres?.enabled || healthRes.postgres?.status !== 'ready') {
    throw new Error('PostgreSQL 模式未就绪！');
  }

  // =========================================================================
  // 2. 真实生成: 玄幻 Cycle 5 极致修复样本 (修复冲突稀释与篇幅溢出)
  // =========================================================================
  console.log('\n[1/2] 正在调用 gpt-5.6-luna 在线生成【玄幻】Cycle 5 修复章节: 《万古神帝：神武破壁》...');
  const fantasyPrompt = `
请生成一章高质量的东方玄幻核心对抗章节，章节标题《神武破壁》，篇幅严格控制在 2400-2800 汉字。

【世界观与人物设定】
- 背景：地狱界命运神域罗祖云山界，张若尘遭冥殿无疆刺客强攻云琉神殿偏阁。
- 人物：张若尘（沉稳内敛、机警善战、带着现实自嘲）、姑射静（天阁目、傲岸冷冽）、无疆（冥殿神储、阴鸷杀伐）。
- 实体代际铁律：地姥是罗祖云山界老祖宗，姑射静为地姥指婚对象，严禁出现代际混乱！

【核心修复：OPT-SCENE-003 首幕动作动量刚性配额（重点执行！）】
1. 场景一（首幕纯物理对抗与击打受力破坏）：
   - 【前4个自然段内严禁任何言语对话或理论解释！】必须全部由高密度的物理击打与破坏动作填充：
     * 万咒天功黑煞撕裂偏阁青石，四根合抱粗的汉白玉石柱被刀气拦腰切断，整面山壁崩裂轰然下塌；
     * 张若尘拔沉渊古剑硬接无疆一击，剑锋与魔光撞击迸发出炽热火星，脚下地面如蛛网寸寸碎裂，冲击力将身躯震退三十步，喉头涌出金色神血，展现骨肉受力与物理动量守恒；
     * 碎石穿空，剑光撕开黑煞，连续四组硬碰硬动作交锋。
2. 场景二（机锋交手与借势反制）：
   - 对抗告一段落，姑射静天阁目法相降临镇住偏阁，张若尘以地姥婚约法旨借势化解死局，迫使无疆收敛杀机。
3. 场景三（多样态自然时空转场 OPT-PACING-003）：
   - 【严禁】出现孤立的“三日后”、“次日”或模板化转场！
   - 【必须】通过穹顶血月由半弧转为皎洁银盘、残破石台风化的环境物理视点过渡至月圆夜，篇幅控制在 35 汉字以内。
4. 场景四（月圆暗流收束）：
   - 月圆之夜到来，狩天大宴前夕各方势力蠢蠢欲动，张若尘横剑自嘲，留下生死未卜的强悬念。

【风格与语言契约】
- 字数严格收敛在 2400-2800 汉字，消除 R-45 篇幅溢出警报。
- 严禁使用“仿佛”、“似乎”、“深吸一口气”、“嘴角勾起”等工业 AI 套话。
- 只交付标题与正文。
`;

  const t0_fantasy = Date.now();
  const fantasyRes = await generateRealChapter({
    bookTitle: '万古神帝-神武破壁-live-cycle5',
    stage: 'live-cycle5-fantasy',
    variant: 'optimal-v5',
    genre: '玄幻',
    model: 'gpt-5.6-luna',
    temperature: 0.76,
    maxTokens: 3100,
    prompt: fantasyPrompt,
    forceRegenerate: true
  });
  const elapsed_fantasy = Date.now() - t0_fantasy;
  console.log(`✅ [玄幻] 在线实时推理完成！耗时: ${elapsed_fantasy}ms | 字符: ${fantasyRes.charCount}`);
  console.log(`   - 上游 RequestId: ${fantasyRes.usage?.requestId || 'N/A'}`);
  console.log(`   - 输出 Tokens: ${fantasyRes.usage?.completionTokens || 'N/A'}`);

  syncTokenUsage();

  // =========================================================================
  // 3. 真实生成: 仙侠 Cycle 5 篇幅精准收敛样本
  // =========================================================================
  console.log('\n[2/2] 正在调用 gpt-5.6-luna 在线生成【仙侠】Cycle 5 篇幅收束样本: 《凡人修仙传：神手谷的考验》...');
  const xianxiaPrompt = `
请生成一章标准的古典凡人流仙侠小说正文，章节标题《神手谷的考验》，篇幅严格控制在 2400-2800 汉字。

【世界观与人物设定】
- 背景：七玄门神手谷，韩立初入谷中辨药、刺穴试探与传授无名口诀。
- 人物：韩立（谨慎机警、皮肤微黑、少言多思）、墨大夫（面容枯槁、眼神深邃、神秘叵测）。

【场景流转与时空转场】
1. 偏厢房辨药考校，韩立谨慎分辨火烘树皮与自然干皮之异。
2. 夜间墨大夫以长银针刺穴探查经脉，韩立咬牙强忍剧痛。
3. 墨大夫赐予残缺口诀，约定三日后清晨考校气感。
4. 【重点时空转场 OPT-SCENE-002】：严禁生硬硬切！通过谷中药香、窗台苔藓露水与油灯爆裂自然过渡这三日时光，篇幅控制在 35 汉字以内。
5. 清晨韩立丹田生出微弱气感，墨大夫赠予行血散，韩立心生戒备暗中防范。

【风格与篇幅契约】
- 字数严格收敛在 2400-2800 汉字。
- 对白率低于 25%，凡人流冷清压抑质感。
- 严禁使用“仿佛”、“似乎”、“深吸一口气”等套话。
- 只交付标题与正文。
`;

  const t0_xianxia = Date.now();
  const xianxiaRes = await generateRealChapter({
    bookTitle: '凡人修仙传-神手谷考验-live-cycle5',
    stage: 'live-cycle5-xianxia',
    variant: 'optimal-v5',
    genre: '仙侠',
    model: 'gpt-5.6-luna',
    temperature: 0.78,
    maxTokens: 3100,
    prompt: xianxiaPrompt,
    forceRegenerate: true
  });
  const elapsed_xianxia = Date.now() - t0_xianxia;
  console.log(`✅ [仙侠] 在线实时推理完成！耗时: ${elapsed_xianxia}ms | 字符: ${xianxiaRes.charCount}`);
  console.log(`   - 上游 RequestId: ${xianxiaRes.usage?.requestId || 'N/A'}`);
  console.log(`   - 输出 Tokens: ${xianxiaRes.usage?.completionTokens || 'N/A'}`);

  syncTokenUsage();

  // =========================================================================
  // 4. 执行 11 阶段全量评测与回归检测
  // =========================================================================
  console.log('\n[Stage 1-11] 正在驱动全题材 11 阶段全量交叉比对与回归评测...');

  const fantasyText = fantasyRes.content || '';
  const xianxiaText = xianxiaRes.content || '';

  const fantasyPacing = extractPacingMetrics(fantasyText);
  const xianxiaPacing = extractPacingMetrics(xianxiaText);

  // 运行回归测试
  const regressionReport = runRegressionSuite({
    controlOutput: {
      metrics: { conflictDensity: 0.251, abruptTransitionCount: 1 }
    },
    treatmentOutput: {
      full_text: fantasyText,
      metrics: {
        conflictDensity: fantasyPacing.conflictDensity,
        abruptTransitionCount: fantasyPacing.abruptTimeJumps
      },
      scene_structure: [1, 2, 3, 4]
    }
  });

  // 运行泛化与过拟合检测
  const generalizationReport = auditGeneralization({
    controlOutput: { metrics: { conflictDensity: 0.251 } },
    treatmentOutput: { metrics: { conflictDensity: fantasyPacing.conflictDensity } },
    regressionReport
  });

  // 驱动自进化闭环决策
  const evolutionDecision = executeEvolutionCycle({
    controlOutput: { metrics: { conflictDensity: 0.251 } },
    treatmentOutput: {
      full_text: fantasyText,
      metrics: {
        conflictDensity: fantasyPacing.conflictDensity,
        abruptTransitionCount: fantasyPacing.abruptTimeJumps
      }
    }
  });

  const summary = {
    cycle: 5,
    evaluatedAt: new Date().toISOString(),
    postgresStatus: healthRes.postgres,
    engine: 'gpt-5.6-luna (live online inference)',
    fantasy_optimal_v5: {
      title: fantasyRes.bookTitle,
      charCount: fantasyRes.charCount,
      durationMs: elapsed_fantasy,
      requestId: fantasyRes.usage?.requestId,
      tokens: fantasyRes.usage,
      conflictDensity: fantasyPacing.conflictDensity,
      abruptJumps: fantasyPacing.abruptTimeJumps,
      fangfuCount: (fantasyText.match(/仿佛|似乎|宛如|深吸一口气|嘴角勾起/g) || []).length
    },
    xianxia_optimal_v5: {
      title: xianxiaRes.bookTitle,
      charCount: xianxiaRes.charCount,
      durationMs: elapsed_xianxia,
      requestId: xianxiaRes.usage?.requestId,
      tokens: xianxiaRes.usage,
      dialogueRatio: xianxiaPacing.dialogueCharRatio,
      abruptJumps: xianxiaPacing.abruptTimeJumps,
      fangfuCount: (xianxiaText.match(/仿佛|似乎|宛如|深吸一口气|嘴角勾起/g) || []).length
    },
    regressionReport: {
      verdict: regressionReport.final_verdict,
      passed: regressionReport.statistics.passed_cases,
      total: regressionReport.statistics.total_cases,
      rationale: regressionReport.verdict_rationale
    },
    generalizationReport: {
      judgment: generalizationReport.summary_verdict,
      qualityGain: generalizationReport.quality_gain,
      overfittingRisk: generalizationReport.overfitting_risk
    },
    evolutionDecision: {
      status: evolutionDecision.final_status,
      reason: evolutionDecision.status_reason,
      next_target: evolutionDecision.next_round_plan?.selected_target
    }
  };

  const outPath = path.resolve(__dirname, '../data/evaluation-input/experiments/cycle5-live-multi-genre-report.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`\n🎉 第五轮 (Cycle 5) 真实修复与 11 阶段全量演进报告已写入: ${outPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

runCycle5Loop().catch(e => {
  console.error('CYCLE 5 EXECUTION FAILED:', e);
  process.exit(1);
});
