// scripts/run-longform-eval.mjs
// 长篇连续10章稳定性评测脚本：对标7维量化门槛，评估字数、文风距离、实体积累、因果债务、AI味与躯体门禁。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const metrics = require('../lib/benchmark-metrics.js');
const experiments = require('../lib/benchmark-experiments.js');

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

// 严禁出现的典型AI套路词汇库
const FORBIDDEN_AI_CLICHES = [
  '倒吸一口凉气', '倒吸凉气', '眼神一凝', '双眼微眯', '瞳孔微缩',
  '嘴角勾起', '扯了扯嘴角', '深吸一口气', '不由得一愣', '愣了一下',
  '脑海中轰然作响', '气血翻涌', '喉头一甜', '虎口发麻', '后背冷汗直流',
  '第一息', '第二息', '第三息', '恐怖如斯', '这一刻，他'
];

const FORBIDDEN_SOMATICS = [
  '指节泛白', '指节发白', '骨节发白', '骨节泛白', '指骨发白', '指骨泛白',
  '喉咙发紧', '喉头发干', '喉头一哽', '指腹摩挲', '指肚摩挲', '反复摩挲',
  '食指轻叩', '轻叩桌面', '指尖悬停', '僵在半空', '掐进掌心', '掐入掌心',
  '呼吸一滞', '呼吸骤停', '下颌紧绷', '按揉太阳穴'
];

function parseArgs(argv) {
  const options = {
    dir: path.join(REPO_ROOT, 'data', 'genre-lab', 'fanren-10-chapters'),
    genre: '玄幻',
    output: path.join(REPO_ROOT, 'data', 'genre-lab', 'benchmark-suite', 'reports', `longform-${Date.now()}-${randomUUID()}.json`),
    verbose: false,
    expectedChapters: 10,
    semanticAudit: null,
    humanReview: null,
    baselineFile: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dir' && argv[i + 1]) options.dir = path.resolve(process.cwd(), argv[++i]);
    else if (arg === '--genre' && argv[i + 1]) options.genre = argv[++i];
    else if (arg === '--output' && argv[i + 1]) options.output = path.resolve(process.cwd(), argv[++i]);
    else if (arg === '--verbose') options.verbose = true;
    else if (arg === '--expected-chapters' && argv[i + 1]) options.expectedChapters = Number(argv[++i]);
    else if (arg === '--semantic-audit' && argv[i + 1]) options.semanticAudit = JSON.parse(fs.readFileSync(path.resolve(argv[++i]), 'utf8'));
    else if (arg === '--human-review' && argv[i + 1]) options.humanReview = JSON.parse(fs.readFileSync(path.resolve(argv[++i]), 'utf8'));
    else if (arg === '--baseline' && argv[i + 1]) options.baselineFile = path.resolve(argv[++i]);
    else throw new Error(`未知选项或缺值: ${arg}`);
  }
  return options;
}

export function evaluateChapterText(text, chapterIndex, options = {}) {
  text = String(text || '');
  const baselinePack = options.baselinePack || null;
  const chars = String(text || '').replace(/\s+/gu, '').length;
  const paragraphs = metrics.paragraphsOf(text);
  const sentences = metrics.sentencesOf(text);
  const fingerprint = metrics.computeTextFingerprint(text);
  const structure = metrics.computeStructureStats(text);

  // 风格距离计算
  const styleDistance = baselinePack ? metrics.computeStyleDistance(fingerprint, baselinePack.baseline) : null;

  // 违规套路检测
  const clicheHits = [];
  for (const c of FORBIDDEN_AI_CLICHES) {
    if (text.includes(c)) clicheHits.push(c);
  }
  const somaticHits = [];
  for (const s of FORBIDDEN_SOMATICS) {
    if (text.includes(s)) somaticHits.push(s);
  }

  // 实体与人名候选
  const nameItems = metrics.extractNameCandidates(text);
  const names = nameItems.map(item => item.name);

  // 硬约束（字数在 2000~3000 间，前缀重复段）
  const hard = metrics.hardConstraintChecks(text, {
    targetWords: 2500,
    tolerance: 0.25,
    maxNewNames: 6
  });

  // 综合判定
  let status = 'PASS';
  const issues = [];
  if (chars < 1800) {
    status = 'FAIL';
    issues.push(`字数偏少(${chars}<1800)`);
  } else if (chars > 3500) {
    status = 'WARN';
    issues.push(`字数偏多(${chars}>3500)`);
  }

  if (clicheHits.length > 0) {
    status = 'FAIL';
    issues.push(`命中AI套话: ${clicheHits.join(', ')}`);
  }
  if (somaticHits.length > 0) {
    if (status !== 'FAIL') status = 'WARN';
    issues.push(`命中躯体过度应激: ${somaticHits.join(', ')}`);
  }
  if (hard.duplicateParagraphs.length > 0) {
    status = 'FAIL';
    issues.push(`出现 ${hard.duplicateParagraphs.length} 处20字前缀重复段`);
  }
  if (hard.repeatedSentences > 0) {
    issues.push(`出现 ${hard.repeatedSentences} 个高频重复句`);
  }

  return {
    chapterIndex,
    chars,
    paragraphsCount: paragraphs.length,
    sentencesCount: sentences.length,
    singleSentenceRatio: structure.singleSentenceParagraphRatio,
    fingerprint,
    styleScore: styleDistance ? styleDistance.score : null,
    clicheHits,
    somaticHits,
    names,
    openingMode: structure.openingMode,
    endingMode: structure.endingMode,
    duplicateParagraphs: hard.duplicateParagraphs.length,
    mechanicalStatus: status,
    status: status === 'FAIL' ? 'failed' : 'pending_review',
    reviewStatus: 'pending_review',
    issues
  };
}

export function runLongformEvaluation(targetDir, genre = '玄幻', options = {}) {
  if (!fs.existsSync(targetDir)) {
    throw new Error(`目标章节目录不存在: ${targetDir}`);
  }

  const expectedChapters = options.expectedChapters ?? 10;
  if (!Number.isInteger(expectedChapters) || expectedChapters < 10) throw new Error('长篇验收至少要求连续10章');
  const baselinePack = options.baselinePack || (options.baselineFile ? JSON.parse(fs.readFileSync(options.baselineFile, 'utf8')) : null);
  const files = fs.readdirSync(targetDir)
    .filter(name => /^(?:ch\d+|chapter[_-]?\d+).*\.md$/i.test(name))
    .sort((a, b) => {
      const numA = Number((a.match(/\d+/) || [0])[0]);
      const numB = Number((b.match(/\d+/) || [0])[0]);
      return numA - numB;
    });

  const chapterReports = [];
  const sourceChapters = [];
  const structuralFailures = [];
  const seenNumbers = new Set();
  const seenContents = new Map();
  const cumulativeEntities = new Set();
  const entityProgression = [];

  for (let idx = 0; idx < files.length; idx += 1) {
    const file = files[idx];
    const filePath = path.join(targetDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const chapterNum = Number(file.match(/\d+/)[0]);
    const textHash = experiments.hashValue(content);
    const contentHash = experiments.textContentHash(content);
    if (seenNumbers.has(chapterNum)) structuralFailures.push(`duplicate_chapter_number:${chapterNum}:${file}`);
    if (seenContents.has(contentHash)) structuralFailures.push(`duplicate_chapter_text:${seenContents.get(contentHash)}:${file}`);
    if (!content.replace(/\s+/gu, '')) structuralFailures.push(`empty_chapter:${file}`);
    if (chapterNum < 1 || chapterNum > expectedChapters) structuralFailures.push(`unexpected_chapter_number:${chapterNum}:${file}`);
    seenNumbers.add(chapterNum);
    seenContents.set(contentHash, file);
    sourceChapters.push({ chapterIndex: chapterNum, text: content, textHash });

    const evalResult = evaluateChapterText(content, chapterNum, { baselinePack });

    // 统计实体累积
    const newEntitiesInChapter = [];
    for (const name of evalResult.names) {
      if (!cumulativeEntities.has(name)) {
        cumulativeEntities.add(name);
        newEntitiesInChapter.push(name);
      }
    }

    entityProgression.push({
      chapter: chapterNum,
      newEntityCount: newEntitiesInChapter.length,
      newEntities: newEntitiesInChapter,
      cumulativeTotal: cumulativeEntities.size
    });

    chapterReports.push({
      file,
      textHash,
      contentHash,
      ...evalResult,
      newEntitiesThisChapter: newEntitiesInChapter
    });
  }

  // 跨章因果与实体连续性分析
  const totalChars = chapterReports.reduce((sum, c) => sum + c.chars, 0);
  const avgChars = chapterReports.length ? Math.round(totalChars / chapterReports.length) : 0;
  const passCount = chapterReports.filter(c => c.mechanicalStatus === 'PASS').length;
  const warnCount = chapterReports.filter(c => c.mechanicalStatus === 'WARN').length;
  const failCount = chapterReports.filter(c => c.mechanicalStatus === 'FAIL').length;
  const avgStyleScore = chapterReports.filter(c => c.styleScore !== null).length
    ? Math.round(chapterReports.reduce((sum, chapter) => sum + (chapter.styleScore || 0), 0) / chapterReports.filter(chapter => chapter.styleScore !== null).length)
    : null;

  // 检查人名两两共字冲突
  const allNamesList = [...cumulativeEntities];
  const charOverlapConflicts = metrics.nameCharacterOverlap(allNamesList);
  if (files.length < 10) structuralFailures.push(`insufficient_chapters:${files.length}<10`);
  if (files.length !== expectedChapters) structuralFailures.push(`chapter_count:${files.length}!=${expectedChapters}`);
  for (let chapterIndex = 1; chapterIndex <= expectedChapters; chapterIndex += 1) {
    if (!seenNumbers.has(chapterIndex)) structuralFailures.push(`missing_chapter:${chapterIndex}`);
  }
  const review = experiments.validateChapterReviews(sourceChapters, options.semanticAudit, options.humanReview);
  const overallVerdict = structuralFailures.length || failCount || review.failures.length ? 'failed'
    : review.missingEvidence.length ? 'pending_review' : warnCount ? 'needs_revision' : 'passed';

  const summary = {
    evaluatedAt: new Date().toISOString(),
    targetDirectory: targetDir,
    genre,
    schemaVersion: 2,
    reportKind: 'evaluation_of_existing_files',
    generationProvenance: '未证明是本轮生成；仅评估所给本地文件，不能据此宣称已跑模型或完整历史主链路',
    expectedChapters,
    structuralFailures,
    missingEvidence: review.missingEvidence,
    semanticFailures: review.failures,
    reviewStatus: review.status,
    baselineLoaded: Boolean(baselinePack),
    totalChapters: chapterReports.length,
    totalChars,
    avgCharsPerChapter: avgChars,
    mechanicalPassRate: `${chapterReports.length ? Math.round((passCount / chapterReports.length) * 100) : 0}%`,
    passRate: overallVerdict === 'passed' ? '100%' : null,
    statusBreakdown: { pass: passCount, warn: warnCount, fail: failCount },
    avgStyleScore,
    totalUniqueEntities: cumulativeEntities.size,
    entityProgression,
    charOverlapConflicts: charOverlapConflicts.slice(0, 5),
    overallVerdict
  };

  return { summary, chapterReports };
}

// 主入口执行
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  console.log('================================================================');
  console.log('【墨阑名家引擎】长篇连续多章稳定性量化评测');
  console.log(`目标目录: ${options.dir}`);
  console.log(`基准题材: ${options.genre}`);
  console.log('================================================================\n');

  try {
    const { summary, chapterReports } = runLongformEvaluation(options.dir, options.genre, options);

    console.log('----------- 逐章评测数据明细 -----------');
    console.table(chapterReports.map(c => ({
      '章序号': `第${c.chapterIndex}章`,
      '文件名': c.file,
      '字数': c.chars,
      '段数': c.paragraphsCount,
      '单句段占比': `${Math.round(c.singleSentenceRatio * 100)}%`,
      '文风得分': c.styleScore || 'N/A',
      '本章新实体': c.newEntitiesThisChapter.length,
      '开篇/收尾': `${c.openingMode} / ${c.endingMode}`,
      '评定': c.status,
      '主要问题': c.issues.slice(0, 1).join(';') || '无'
    })));

    console.log('\n----------- 综合稳定性指标汇总 -----------');
    console.log(`- 总评估章数: ${summary.totalChapters} 章`);
    console.log(`- 总正文字数: ${summary.totalChars} 字 (均章 ${summary.avgCharsPerChapter} 字)`);
    console.log(`- 纯指标达标率（不是验收通过率）: ${summary.mechanicalPassRate} (指标达标: ${summary.statusBreakdown.pass}, 预警: ${summary.statusBreakdown.warn}, 阻断: ${summary.statusBreakdown.fail})`);
    console.log(`- 风格指纹均分: ${summary.avgStyleScore !== null ? summary.avgStyleScore : '未加载基线'}`);
    console.log(`- 累计人名候选: ${summary.totalUniqueEntities} (启发式统计，不证明状态连续性)`);
    console.log(`- 结构失败: ${summary.structuralFailures.join('; ') || '无'}；缺证据: ${summary.missingEvidence.length} 项`);
    console.log(`- 综合验收结论: 【${summary.overallVerdict}】\n`);

    // 写入评测结果文件
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, JSON.stringify({ summary, chapterReports }, null, 2), { encoding: 'utf8', flag: 'wx' });
    console.log(`✓ 评测报告已完整保存至: ${options.output}`);

    if (summary.overallVerdict !== 'passed') process.exitCode = summary.overallVerdict === 'pending_review' ? 2 : 1;
  } catch (error) {
    console.error('评测执行失败:', error.message);
    process.exitCode = 1;
  }
}
