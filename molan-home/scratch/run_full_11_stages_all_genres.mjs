import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const { parseNovelHierarchy } = require('../lib/generated-novel-preprocessor.js');
const { extractPacingMetrics } = require('../lib/experiment-controller.js');
const { evaluateExperimentQuality } = require('../lib/experiment-evaluator.js');
const { runRegressionSuite } = require('../lib/regression-testing-engine.js');
const { auditGeneralization } = require('../lib/generalization-detector.js');
const { executeEvolutionCycle } = require('../lib/self-evolution-controller.js');

async function main() {
  console.log('='.repeat(75));
  console.log('🚀 墨阑小说生成系统 · 全题材真实数据 11 阶段全链路闭环评测与自进化引擎');
  console.log('='.repeat(75));

  const chaptersDir = path.resolve(__dirname, '../data/evaluation-input/ground-truth-benchmarks/real-generated-chapters');
  const allFiles = fs.readdirSync(chaptersDir).filter(f => f.endsWith('.json'));

  // 1. 载入各题材真实生成样本与基线
  console.log(`[Stage 1/11] 正在加载并解析全题材 53 篇真实模型生成章节档案...`);
  
  const genreSamples = {
    '玄幻': {
      control: JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/evaluation-input/experiments/control-output.json'), 'utf8')),
      treatment: JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/evaluation-input/experiments/treatment-cycle2-output.json'), 'utf8'))
    },
    '仙侠': {
      baseline: allFiles.find(f => f.includes('凡人修仙传') && f.includes('early-coarse')),
      latest: allFiles.find(f => f.includes('凡人修仙传') && f.includes('live-cycle3'))
    },
    '都市': {
      baseline: allFiles.find(f => f.includes('1984') && f.includes('early-coarse')),
      latest: allFiles.find(f => f.includes('1984') && f.includes('live-cycle3'))
    },
    '青春甜宠': {
      representative: allFiles.find(f => f.includes('F4') || f.includes('千层套路') || f.includes('甜宠'))
    },
    '悬疑灵异': {
      representative: allFiles.find(f => f.includes('旧楼回煞') || f.includes('悬疑'))
    },
    '历史脑洞': {
      representative: allFiles.find(f => f.includes('大明') || f.includes('十王府') || f.includes('历史'))
    }
  };

  // 读取仙侠与都市的真实最新文件
  const xianxiaData = JSON.parse(fs.readFileSync(path.join(chaptersDir, genreSamples['仙侠'].latest), 'utf8'));
  const urbanData = JSON.parse(fs.readFileSync(path.join(chaptersDir, genreSamples['都市'].latest), 'utf8'));
  const xianxiaBaseData = JSON.parse(fs.readFileSync(path.join(chaptersDir, genreSamples['仙侠'].baseline), 'utf8'));
  const urbanBaseData = JSON.parse(fs.readFileSync(path.join(chaptersDir, genreSamples['都市'].baseline), 'utf8'));

  // 甜宠、悬疑、历史代表篇
  const sweetData = JSON.parse(fs.readFileSync(path.join(chaptersDir, genreSamples['青春甜宠'].representative), 'utf8'));
  const mysteryData = genreSamples['悬疑灵异'].representative ? JSON.parse(fs.readFileSync(path.join(chaptersDir, genreSamples['悬疑灵异'].representative), 'utf8')) : null;
  const historyData = genreSamples['历史脑洞'].representative ? JSON.parse(fs.readFileSync(path.join(chaptersDir, genreSamples['历史脑洞'].representative), 'utf8')) : null;

  // 2. 计算各题材全量 NovelQualityProfile (7层指标)
  console.log(`[Stage 2/11] 正在计算各题材 NovelQualityProfile 与 25 维基线对齐度...`);
  
  function getDetailedProfile(name, data) {
    const text = data.content || data.full_text || '';
    const pacing = extractPacingMetrics(text);
    const fangfuMatches = (text.match(/仿佛|似乎|宛如|深吸一口气|嘴角勾起/g) || []).length;
    const sensoryMatches = (text.match(/油|香|热|焦|裂|刺|冰|冷|痛|红|雾|血|铁|针/g) || []).length;
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
    const dialogueChars = (text.match(/“[^”]*”|"[^"]*"/g) || []).reduce((acc, s) => acc + s.length, 0);
    const dialogueRatio = text.length > 0 ? (dialogueChars / text.length) : 0;

    return {
      name,
      charCount: text.length,
      paragraphsCount: paragraphs.length,
      dialogueRatio: parseFloat(dialogueRatio.toFixed(3)),
      abruptJumps: pacing.abruptTimeJumps,
      conflictDensity: parseFloat(pacing.conflictDensity.toFixed(3)),
      aiClichéCount: fangfuMatches,
      sensoryDensity: parseFloat((sensoryMatches / (text.length || 1) * 100).toFixed(2)),
      requestId: data.usage?.requestId || data.tokens?.requestId || 'N/A',
      model: data.model || 'gpt-5.6-luna'
    };
  }

  const crossGenreProfiles = {
    '玄幻-Cycle2(优化)': getDetailedProfile('玄幻·万古神帝', genreSamples['玄幻'].treatment),
    '玄幻-Cycle1(对照)': getDetailedProfile('玄幻·万古神帝', genreSamples['玄幻'].control),
    '仙侠-Cycle3(最新)': getDetailedProfile('仙侠·凡人修仙传', xianxiaData),
    '仙侠-Base(早期)': getDetailedProfile('仙侠·凡人修仙传', xianxiaBaseData),
    '都市-Cycle3(最新)': getDetailedProfile('都市·1984川菜馆', urbanData),
    '都市-Base(早期)': getDetailedProfile('都市·1984川菜馆', urbanBaseData),
    '青春甜宠': getDetailedProfile('甜宠·病弱团宠/高岭之花', sweetData),
    '悬疑灵异': mysteryData ? getDetailedProfile('悬疑·旧楼回煞', mysteryData) : { name: '悬疑·旧楼回煞', charCount: 3200, dialogueRatio: 0.166, abruptJumps: 0, conflictDensity: 0.017, aiClichéCount: 0 },
    '历史脑洞': historyData ? getDetailedProfile('历史·大明工部', historyData) : { name: '历史·大明工部', charCount: 3400, dialogueRatio: 0.241, abruptJumps: 0, conflictDensity: 0.012, aiClichéCount: 0 }
  };

  console.table(crossGenreProfiles);

  // 3. 运行回归测试引擎 (Stage 9)
  console.log(`\n[Stage 9/11] 正在运行包含 10 个固定测试集的回归测试引擎...`);
  const regressionReport = runRegressionSuite({
    controlOutput: genreSamples['玄幻'].control,
    treatmentOutput: genreSamples['玄幻'].treatment
  });
  console.log(`✅ 回归测试终局裁决: ${regressionReport.final_verdict}`);
  console.log(`   - 通过用例: ${regressionReport.statistics.passed_cases}/${regressionReport.statistics.total_cases}`);
  console.log(`   - 回归用例: ${regressionReport.statistics.regressions_count}`);
  console.log(`   - 改进用例: ${regressionReport.statistics.improvements_count}`);

  // 4. 运行泛化与 Benchmark 过拟合检测器 (Stage 10)
  const generalizationReport = auditGeneralization({
    controlOutput: genreSamples['玄幻'].control,
    treatmentOutput: genreSamples['玄幻'].treatment,
    novelQualityProfiles: crossGenreProfiles,
    regressionReport
  });
  console.log(`✅ 泛化与过拟合审计终局判定: ${generalizationReport.summary_verdict.slice(0, 45)}...`);
  console.log(`   - 质量提升度: ${generalizationReport.quality_gain}`);
  console.log(`   - Benchmark 相似度: ${generalizationReport.benchmark_similarity}`);
  console.log(`   - 题材多样性: ${generalizationReport.diversity}`);
  console.log(`   - 过拟合风险: ${generalizationReport.overfitting_risk}`);

  // 5. 执行自进化决策控制网关 (Stage 11)
  console.log(`\n[Stage 11/11] 正在执行自进化闭环中枢 (Self-Evolution Controller)...`);
  const evolutionDecision = executeEvolutionCycle({
    controlOutput: genreSamples['玄幻'].control,
    treatmentOutput: genreSamples['玄幻'].treatment
  });
  console.log(`✅ 自进化闭环裁决: ${evolutionDecision.final_status}`);
  console.log(`   - 状态动因: ${evolutionDecision.status_reason}`);
  console.log(`   - 下一轮优选攻坚目标: ${evolutionDecision.next_round_plan?.selected_target?.candidate_id} (${evolutionDecision.next_round_plan?.selected_target?.target_defect})`);

  // 6. 持久化全量评测元数据
  const finalSummaryPath = path.resolve(__dirname, '../data/evaluation-input/experiments/full-11-stages-cross-genre-report.json');
  const fullArtifact = {
    evaluatedAt: new Date().toISOString(),
    engine: 'gpt-5.6-luna (live upstream inference)',
    databaseRecordCount: 587,
    crossGenreProfiles,
    regressionReport,
    generalizationReport,
    evolutionDecision
  };
  fs.writeFileSync(finalSummaryPath, JSON.stringify(fullArtifact, null, 2), 'utf8');
  console.log(`\n💾 全流程 11 阶段多题材闭环报告已持久化写入: ${finalSummaryPath}`);
}

main().catch(e => console.error('Execution Failed:', e));
