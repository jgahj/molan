import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const { extractPacingMetrics } = require('../lib/experiment-controller.js');
const { computeAiFlavorScore } = require('../lib/ai-flavor-detector.js');

const GENRES = ['都市', '仙侠', '玄幻', '青春甜宠', '悬疑灵异', '历史脑洞'];

const FORBIDDEN_AI_CLICHES = [
  '倒吸一口凉气', '倒吸凉气', '眼神一凝', '双眼微眯', '瞳孔微缩',
  '嘴角勾起', '扯了扯嘴角', '深吸一口气', '不由得一愣', '愣了一下',
  '脑海中轰然作响', '气血翻涌', '喉头一甜', '虎口发麻', '后背冷汗直流',
  '第一息', '第二息', '第三息', '恐怖如斯', '这一刻，他',
  '仿佛', '似乎', '宛如'
];

const SENSORY_PATTERNS = /(红|赤|金|白|青|紫|蓝|黑|碧|黄|亮|暗|冷|热|温|凉|烫|寒|冰|苦|甜|酸|辣|涩|香|臭|腥|焦|气味|刺鼻|清香|轰鸣|破空|剑鸣|风声|碎石|脚步|沙沙|滴答|脆响|嘶鸣|咆哮|黏稠|粗糙|滑腻|坚硬|柔软|颤动|发麻|僵硬|刺痛|剧痛|滚烫|灼热)/g;

function computeDialogueRatio(text) {
  const quoteMatches = text.match(/“[^”]*”|"[^"]*"|「[^」]*」/g) || [];
  const dialogueChars = quoteMatches.reduce((s, m) => s + m.length, 0);
  return text.length > 0 ? Number((dialogueChars / text.length).toFixed(3)) : 0;
}

function computeSensoryDensity(text) {
  const matches = text.match(SENSORY_PATTERNS) || [];
  return text.length > 0 ? Number((matches.length / (text.length / 100)).toFixed(2)) : 0;
}

function analyzeText(text) {
  const metrics = extractPacingMetrics(text);
  let aiScore = { overallScore: 0 };
  try {
    aiScore = computeAiFlavorScore(text);
  } catch (_) {}
  
  let clicheCount = 0;
  for (const c of FORBIDDEN_AI_CLICHES) {
    const matches = text.match(new RegExp(c, 'g'));
    if (matches) clicheCount += matches.length;
  }

  return {
    charCount: text.length,
    dialogueRatio: computeDialogueRatio(text),
    conflictDensity: metrics.conflictDensity || 0,
    sensoryDensity: computeSensoryDensity(text),
    abruptTimeJumps: metrics.abruptTransitionCount || 0,
    aiFlavorScore: aiScore.overallScore || 0,
    clicheCount
  };
}

export function runFullMultiGenreComparison() {
  console.log('='.repeat(80));
  console.log('📊 全题材（6大门类）真实生成与基线真实交叉对比评估矩阵');
  console.log('='.repeat(80));

  // 1. 读取 53 本基线真实样本全量 Profile
  const baselinePath = path.resolve(__dirname, '../data/evaluation-input/all-53-real-chapters-profile.json');
  const all53Chapters = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

  // 2. 遍历真实生成的章节目录
  const generatedDir = path.resolve(__dirname, '../data/evaluation-input/ground-truth-benchmarks/real-generated-chapters');
  const files = fs.readdirSync(generatedDir).filter(f => f.endsWith('.json'));

  const generatedByGenre = {
    '都市': [],
    '仙侠': [],
    '玄幻': [],
    '青春甜宠': [],
    '悬疑灵异': [],
    '历史脑洞': []
  };

  for (const file of files) {
    try {
      const fullPath = path.join(generatedDir, file);
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      const text = data.content || '';
      if (text.length < 50) continue;

      let genre = data.genre || '';
      if (!genre) {
        if (file.includes('川菜') || file.includes('华娱') || file.includes('交警') || file.includes('半岛') || file.includes('美利坚')) genre = '都市';
        else if (file.includes('凡人') || file.includes('仙府') || file.includes('真仙') || file.includes('仙道') || file.includes('道人')) genre = '仙侠';
        else if (file.includes('万古神帝') || file.includes('一世之尊') || file.includes('万像') || file.includes('万生') || file.includes('光阴之外') || file.includes('武圣') || file.includes('月圆夜前')) genre = '玄幻';
        else if (file.includes('甜宠') || file.includes('团宠') || file.includes('强制爱') || file.includes('夏夜') || file.includes('坏兄妹') || file.includes('亲一下') || file.includes('作精')) genre = '青春甜宠';
        else if (file.includes('阴阳先生') || file.includes('灵异') || file.includes('旧楼回煞') || file.includes('任婷婷') || file.includes('诡镜')) genre = '悬疑灵异';
        else if (file.includes('三国') || file.includes('千古一帝') || file.includes('大唐') || file.includes('夺嫡')) genre = '历史脑洞';
      }

      if (generatedByGenre[genre]) {
        const stats = analyzeText(text);
        generatedByGenre[genre].push({
          file,
          bookTitle: data.bookTitle || file.split('-')[0],
          stage: data.stage || 'standard',
          variant: data.variant || 'default',
          model: data.model || 'gpt-5.6-luna',
          requestId: data.usage?.requestId || 'N/A',
          tokens: data.usage || {},
          stats,
          sampleExcerpt: text.slice(0, 180).replace(/\r?\n/g, ' ')
        });
      }
    } catch (_) {}
  }

  // 3. 构建全题材比对矩阵
  const matrix = {};
  for (const genre of GENRES) {
    const baselineItems = all53Chapters.filter(b => b.genre === genre);
    const genItems = generatedByGenre[genre] || [];

    const avgBaseline = {
      count: baselineItems.length,
      avgChars: Math.round(baselineItems.reduce((s, b) => s + (b.chars || 0), 0) / (baselineItems.length || 1)),
      avgDialogue: Number((baselineItems.reduce((s, b) => s + (b.diaRatio || 0), 0) / (baselineItems.length || 1)).toFixed(3)),
      avgSensory: Number((baselineItems.reduce((s, b) => s + (b.sensoryDensity || 0), 0) / (baselineItems.length || 1)).toFixed(3)),
      abruptJumps: baselineItems.reduce((s, b) => s + (b.hardCuts || 0), 0),
      sampleWorks: baselineItems.slice(0, 3).map(b => ({
        title: b.title,
        chars: b.chars,
        diaRatio: (b.diaRatio * 100).toFixed(1) + '%',
        reqId: b.reqId
      }))
    };

    const avgGenerated = {
      count: genItems.length,
      avgChars: Math.round(genItems.reduce((s, b) => s + b.stats.charCount, 0) / (genItems.length || 1)),
      avgDialogue: Number((genItems.reduce((s, b) => s + b.stats.dialogueRatio, 0) / (genItems.length || 1)).toFixed(3)),
      avgSensory: Number((genItems.reduce((s, b) => s + b.stats.sensoryDensity, 0) / (genItems.length || 1)).toFixed(3)),
      avgConflict: Number((genItems.reduce((s, b) => s + b.stats.conflictDensity, 0) / (genItems.length || 1)).toFixed(3)),
      avgCliches: Number((genItems.reduce((s, b) => s + b.stats.clicheCount, 0) / (genItems.length || 1)).toFixed(2)),
      abruptJumps: genItems.reduce((s, b) => s + b.stats.abruptTimeJumps, 0),
      latestCycleWorks: genItems.filter(g => g.stage.includes('cycle') || g.file.includes('cycle') || g.file.includes('神武破壁') || g.file.includes('神手谷') || g.file.includes('川菜馆') || g.file.includes('旧楼回煞')).map(g => ({
        bookTitle: g.bookTitle,
        stage: g.stage,
        requestId: g.requestId,
        charCount: g.stats.charCount,
        conflictDensity: g.stats.conflictDensity.toFixed(3),
        dialogueRatio: (g.stats.dialogueRatio * 100).toFixed(1) + '%',
        sensoryDensity: g.stats.sensoryDensity.toFixed(2),
        clicheCount: g.stats.clicheCount,
        excerpt: g.sampleExcerpt
      }))
    };

    matrix[genre] = {
      genreName: genre,
      baselineStats: avgBaseline,
      generatedStats: avgGenerated
    };
  }

  const outReportPath = path.resolve(__dirname, '../data/evaluation-input/cross-genre-all6-truth-matrix.json');
  fs.writeFileSync(outReportPath, JSON.stringify(matrix, null, 2), 'utf8');
  console.log(`\n✅ 全题材6大门类真实对比矩阵已写入: ${outReportPath}`);

  // 打印精简表格
  console.log('\n' + '-'.repeat(100));
  console.log('| 题材类别 | 样本统计 (基线/生成) | 平均篇幅(字) (基线/生成) | 对白占比 (基线/生成) | 冲突动词密度(生成) | 模板套话(生) | 硬切数(生) |');
  console.log('-'.repeat(100));
  for (const g of GENRES) {
    const item = matrix[g];
    console.log(`| ${g.padEnd(6, ' ')} | ${String(item.baselineStats.count).padStart(2)} / ${String(item.generatedStats.count).padStart(2)} 篇 | ${String(item.baselineStats.avgChars).padStart(4)} / ${String(item.generatedStats.avgChars).padStart(4)} 字 | ${(item.baselineStats.avgDialogue * 100).toFixed(1).padStart(5)}% / ${(item.generatedStats.avgDialogue * 100).toFixed(1).padStart(5)}% | ${item.generatedStats.avgConflict.toFixed(2).padStart(18)} | ${String(item.generatedStats.avgCliches).padStart(12)} | ${String(item.generatedStats.abruptJumps).padStart(10)} |`);
  }
  console.log('-'.repeat(100));

  return matrix;
}

if (process.argv[1] && process.argv[1].endsWith('multi_genre_truthful_evaluator.mjs')) {
  runFullMultiGenreComparison();
}
