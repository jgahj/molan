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

async function runCycle4Loop() {
  console.log('='.repeat(75));
  console.log('🔥 启动小说生成系统 · 第四轮 (Cycle 4) 真实在线大模型迭代与自进化全流程闭环');
  console.log('   模型: gpt-5.6-luna (真实在线推理) | 攻坚目标: OPT-DESC-002 + OPT-PACING-003 + 篇幅精确收束');
  console.log('='.repeat(75));

  // =========================================================================
  // 1. 真实调用模型生成: 玄幻 Cycle 4 最优攻坚样本
  // =========================================================================
  console.log('\n[1/2] 正在实时调用 gpt-5.6-luna 生成【玄幻】Cycle 4 攻坚章节: 《万古神帝：月圆破局》...');
  const fantasyPrompt = `
请生成一章高质量的东方玄幻小说核心冲突章节，章节标题《月圆破局》，字数严格控制在 2400-2800 汉字。

【世界观与人物设定】
- 背景：地狱界命运神域罗祖云山界，张若尘面临无疆与冥殿暗杀危机，借宿云琉神殿。
- 人物：张若尘（沉稳内敛、机警善谋、带着现实自嘲）、姑射静（元会级大圣、罗祖云山界天阁目、傲岸凌厉）、无疆（冥殿神储、阴鸷狠绝）。
- 实体代际铁律：地姥是罗祖云山界老祖宗，姑射静为地姥指婚对象，严禁出现代际混乱！

【剧情结构与场景流转】
1. 场景一（首幕强对抗与物理受力破坏 OPT-DESC-002）：
   - 冥殿死士突袭神殿偏阁，万咒天功与神威撕裂偏殿青石，石柱被硬生生切断，碎石如雨飞射。
   - 张若尘拔沉渊古剑硬接无疆一击，剑锋摩擦迸发万丈火星，脚下青石板如蛛网碎裂，喉头翻滚金色神血，展现骨肉受力与物理动量守恒。
2. 场景二（机锋交手与借势破局）：
   - 姑射静以魔道天阁目身份降临震慑冥殿，张若尘借地姥指婚法旨反客为主，逼迫无疆退走。
3. 场景三（多样态自然时空转场 OPT-PACING-003）：
   - 【严禁】出现孤立的“三日后”、“次日”或模板化转场！
   - 【必须】通过云山界穹顶血月由弦转望的月华移动、神殿废墟石缝中凝结的焦黑魔煞风化等环境物理视点过渡至月圆夜，篇幅控制在 35 汉字以内。
4. 场景四（月圆暗流收束）：
   - 月圆夜降临，狩天大宴前夕各方神灵法相显化，张若尘整肃剑意，留下强悬念收尾。

【风格与篇幅契约】
- 字数严格收敛在 2400-2800 汉字区间，严禁拖沓注水。
- 严禁使用“仿佛”、“似乎”、“深吸一口气”、“嘴角勾起”等工业 AI 套话。
- 只交付标题与正文。
`;

  const t0_fantasy = Date.now();
  const fantasyRes = await generateRealChapter({
    bookTitle: '万古神帝-月圆破局-live-cycle4',
    stage: 'live-cycle4-fantasy',
    variant: 'optimal',
    genre: '玄幻',
    model: 'gpt-5.6-luna',
    temperature: 0.78,
    maxTokens: 3200,
    prompt: fantasyPrompt,
    forceRegenerate: true
  });
  const elapsed_fantasy = Date.now() - t0_fantasy;
  console.log(`✅ [玄幻] 在线实时推理完成！耗时: ${elapsed_fantasy}ms | 字符: ${fantasyRes.charCount}`);
  console.log(`   - 上游 RequestId: ${fantasyRes.usage?.requestId || 'N/A'}`);
  console.log(`   - 输出 Tokens: ${fantasyRes.usage?.completionTokens || 'N/A'}`);

  syncTokenUsage();

  // =========================================================================
  // 2. 真实调用模型生成: 悬疑灵异 Cycle 4 攻坚样本
  // =========================================================================
  console.log('\n[2/2] 正在实时调用 gpt-5.6-luna 生成【悬疑灵异】Cycle 4 攻坚章节: 《旧楼回煞：第七阶迷局》...');
  const suspensePrompt = `
请生成一章高质感的民俗悬疑怪谈小说章节，章节标题《第七阶迷局》，字数严格控制在 2400-2800 汉字。

【世界观与背景设定】
- 题材：民俗怪谈/规则探案。第一人称有限视点（“我”是一名旧楼巡查员，无特异功能，仅凭观察与禁忌规则求生）。
- 场景：建于八十年代的筒子楼，七楼楼道内弥漫潮湿霉味与生石灰气味，每逢回煞夜楼梯会出现第七级断头阶。
- 关键物料：生锈的手电筒、粗瓷碗、一炷倒插的青香、门缝下的朱砂红线。

【剧情结构与场景流转】
1. 场景一（环境压迫与感官细节）：
   - “我”在午夜踏入七楼楼道，水磨石台阶冰冷刺骨，手电筒光柱昏黄，照见墙壁脱落的灰皮与潮湿黑霉斑。
2. 场景二（规则禁忌与心理对抗）：
   - 按照旧时阴阳先生留下的训诫：回煞夜不能踏实第七阶，逢风声须闭眼默数三息。“我”在台阶前停步，听见上方传来拖拽湿麻袋的声音。
3. 场景三（时空转场与危机收束）：
   - 青香燃尽三寸，楼道穿堂风猛然灌入，吹灭残火，时间在极度紧绷中滑向后半夜丑时，篇幅控制在 35 汉字以内。
4. 场景四（悬念揭晓与危机未平）：
   - 手电光扫过门缝，朱砂红线断裂，“我”在门洞阴影中摸到一块湿漉漉的麻布，留下生死未卜的强悬念。

【风格与语言契约】
- 严格限制对白在 18% 以下，强化第一人称有限视角的未知感与感官压迫。
- 严禁使用“仿佛”、“似乎”、“深吸一口气”等套话。
- 字数严格控制在 2400-2800 汉字。
- 只交付标题与正文。
`;

  const t0_suspense = Date.now();
  const suspenseRes = await generateRealChapter({
    bookTitle: '旧楼回煞-第七阶迷局-live-cycle4',
    stage: 'live-cycle4-suspense',
    variant: 'optimal',
    genre: '悬疑灵异',
    model: 'gpt-5.6-luna',
    temperature: 0.78,
    maxTokens: 3200,
    prompt: suspensePrompt,
    forceRegenerate: true
  });
  const elapsed_suspense = Date.now() - t0_suspense;
  console.log(`✅ [悬疑] 在线实时推理完成！耗时: ${elapsed_suspense}ms | 字符: ${suspenseRes.charCount}`);
  console.log(`   - 上游 RequestId: ${suspenseRes.usage?.requestId || 'N/A'}`);
  console.log(`   - 输出 Tokens: ${suspenseRes.usage?.completionTokens || 'N/A'}`);

  syncTokenUsage();

  // =========================================================================
  // 3. 执行 11 阶段全量评测与回归检测
  // =========================================================================
  console.log('\n[Stage 1-11] 正在驱动全题材 11 阶段全量交叉比对与回归评测...');

  const fantasyText = fantasyRes.content || '';
  const suspenseText = suspenseRes.content || '';

  const fantasyPacing = extractPacingMetrics(fantasyText);
  const suspensePacing = extractPacingMetrics(suspenseText);

  // 运行回归套件
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

  // 运行泛化审计
  const generalizationReport = auditGeneralization({
    controlOutput: { metrics: { conflictDensity: 0.251 } },
    treatmentOutput: { metrics: { conflictDensity: fantasyPacing.conflictDensity } },
    regressionReport
  });

  // 驱动自演进中枢
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
    cycle: 4,
    evaluatedAt: new Date().toISOString(),
    engine: 'gpt-5.6-luna (live online inference)',
    fantasy_optimal: {
      title: fantasyRes.bookTitle,
      charCount: fantasyRes.charCount,
      durationMs: elapsed_fantasy,
      requestId: fantasyRes.usage?.requestId,
      tokens: fantasyRes.usage,
      conflictDensity: fantasyPacing.conflictDensity,
      abruptJumps: fantasyPacing.abruptTimeJumps,
      fangfuCount: (fantasyText.match(/仿佛|似乎|宛如|深吸一口气|嘴角勾起/g) || []).length
    },
    suspense_optimal: {
      title: suspenseRes.bookTitle,
      charCount: suspenseRes.charCount,
      durationMs: elapsed_suspense,
      requestId: suspenseRes.usage?.requestId,
      tokens: suspenseRes.usage,
      dialogueRatio: extractPacingMetrics(suspenseText).dialogueCharRatio,
      abruptJumps: suspensePacing.abruptTimeJumps,
      fangfuCount: (suspenseText.match(/仿佛|似乎|宛如|深吸一口气|嘴角勾起/g) || []).length
    },
    regressionReport: {
      verdict: regressionReport.final_verdict,
      passed: regressionReport.statistics.passed_cases,
      total: regressionReport.statistics.total_cases
    },
    generalizationReport: {
      judgment: generalizationReport.summary_verdict,
      qualityGain: generalizationReport.quality_gain
    },
    evolutionDecision: {
      status: evolutionDecision.final_status,
      reason: evolutionDecision.status_reason,
      next_target: evolutionDecision.next_round_plan?.selected_target
    }
  };

  const outPath = path.resolve(__dirname, '../data/evaluation-input/experiments/cycle4-live-multi-genre-report.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`\n🎉 第四轮 (Cycle 4) 真实生成与 11 阶段全量演进报告已写入: ${outPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

runCycle4Loop().catch(e => {
  console.error('CYCLE 4 EXECUTION FAILED:', e);
  process.exit(1);
});
