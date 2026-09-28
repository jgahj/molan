import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const metrics = require('../lib/benchmark-metrics.js');
const detector = require('../lib/ai-flavor-detector.js');
const evidenceReview = require('../lib/evidence-review.js');

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const WORKSPACE_ROOT = path.resolve(PROJECT_ROOT, '..');
const CORPUS_ROOT = path.join(WORKSPACE_ROOT, '资源库', '小说原本');
const BASELINE_DIR = path.join(PROJECT_ROOT, 'data', 'genre-baselines');
const RUNS_DIR = path.join(PROJECT_ROOT, 'data', 'benchmark-runs');
const OUTPUT_DATE = process.env.MOLAN_EVAL_DATE || new Date().toISOString().slice(0, 10);
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'data', 'evaluation-input', OUTPUT_DATE);
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'scratch', 'tmp-booktest', 'deploy_tmp', 'raws']);
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.epub']);

/** 读取 JSON 文件；文件不存在或格式错误时返回 null，避免把缺失数据伪装成空对象。 */
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/** 将路径统一为相对项目根目录的 POSIX 形式，便于跨平台复核。 */
function projectRelative(filePath) {
  return path.relative(PROJECT_ROOT, filePath).split(path.sep).join('/');
}

/** 递归枚举限定目录内的文件，排除依赖、临时区和受保护运行目录。 */
function walkFiles(root, options = {}) {
  const excluded = new Set(options.excludedDirs || EXCLUDED_DIRS);
  const output = [];
  if (!fs.existsSync(root)) return output;
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && excluded.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) output.push(fullPath);
    }
  };
  visit(root);
  return output.sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

/** 计算文件元数据；本材料包不读取语料正文，因此章节数和内容哈希保持未测量。 */
function fileMeta(filePath, root = PROJECT_ROOT) {
  const stat = fs.statSync(filePath);
  return {
    path: path.relative(root, filePath).split(path.sep).join('/'),
    bytes: stat.size,
    modifiedAt: stat.mtime.toISOString()
  };
}

/** 计算稳定的路径标识，不把原书全文复制进评测输入包。 */
function stableId(value, prefix) {
  return `${prefix}_${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)}`;
}

/** 返回一个可序列化的目录汇总，用于描述真实项目架构而不是依赖 README 猜测。 */
function summarizeArea(relativePath) {
  const absolutePath = path.join(PROJECT_ROOT, relativePath);
  const files = walkFiles(absolutePath);
  return {
    path: relativePath,
    exists: fs.existsSync(absolutePath),
    fileCount: files.length,
    totalBytes: files.reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0),
    extensions: files.reduce((map, filePath) => {
      const ext = path.extname(filePath).toLowerCase() || '[none]';
      map[ext] = (map[ext] || 0) + 1;
      return map;
    }, {})
  };
}

/** 采集关键入口和评测模块的存在性、大小和时间戳。 */
function buildArchitectureInventory() {
  const areas = ['lib', 'pages', 'data', 'scripts', 'skills', 'test', 'docs', 'editor-sources', 'ops'];
  const keyFiles = [
    'server.js', 'package.json', 'completion-editor.js', 'completion-import.js', 'completion-platform.js',
    'correction-policy.js', 'lib/benchmark-metrics.js', 'lib/benchmark-pipeline.js',
    'lib/benchmark-experiments.js', 'lib/benchmark-receipts.js', 'lib/ai-flavor-detector.js',
    'lib/evidence-review.js', 'lib/causal-debt-tracker.js', 'lib/memory-system.js',
    'lib/memory-commit-guard.js', 'lib/character-material.js', 'lib/style-system.js',
    'lib/genre-engine.js', 'pages/editor.js', 'pages/dissect.js', 'skills/humanizer/SKILL.md',
    'skills/write-high-tension-fiction/SKILL.md', 'scripts/build-industrial-benchmark-system.mjs',
    'scripts/run-local-benchmark-session.mjs', 'scripts/run-longform-eval.mjs'
  ];
  const observedModules = keyFiles.map(relativePath => {
    const absolutePath = path.join(PROJECT_ROOT, relativePath);
    return {
      path: relativePath,
      exists: fs.existsSync(absolutePath),
      ...(fs.existsSync(absolutePath) ? fileMeta(absolutePath) : {})
    };
  });
  const gitHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: PROJECT_ROOT, encoding: 'utf8' });
  const gitBranch = spawnSync('git', ['branch', '--show-current'], { cwd: PROJECT_ROOT, encoding: 'utf8' });
  const gitStatus = spawnSync('git', ['status', '--short'], { cwd: PROJECT_ROOT, encoding: 'utf8' });
  return {
    generatedAt: new Date().toISOString(),
    projectRoot: PROJECT_ROOT,
    workspaceRoot: WORKSPACE_ROOT,
    entrypoints: ['server.js', 'app.js', 'pages/editor.js', 'pages/dissect.js'],
    areas: areas.map(summarizeArea),
    excludedFromRecursiveScan: [...EXCLUDED_DIRS],
    observedModules,
    documentedFlow: [
      'resource corpus -> genre baselines -> generation runs -> deterministic metrics -> evidence review',
      'completion-editor -> character material / style / memory / causal modules',
      'pages and server -> editor workflow and benchmark endpoints'
    ],
    git: {
      head: gitHead.status === 0 ? gitHead.stdout.trim() : 'UNKNOWN',
      branch: gitBranch.status === 0 ? gitBranch.stdout.trim() : 'UNKNOWN',
      worktreeStatusLineCount: gitStatus.status === 0 ? gitStatus.stdout.split(/\r?\n/).filter(Boolean).length : null,
      worktreeStatus: gitStatus.status === 0 ? 'DIRTY_OR_MODIFIED' : 'UNKNOWN'
    }
  };
}

/** 扫描小说原本的文件元数据，提供可复核的 Book Manifest，不计算章节或文学质量。 */
function buildCorpusManifest() {
  const books = [];
  const genreEntries = fs.existsSync(CORPUS_ROOT)
    ? fs.readdirSync(CORPUS_ROOT, { withFileTypes: true }).filter(entry => entry.isDirectory())
    : [];
  for (const genreEntry of genreEntries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))) {
    const genrePath = path.join(CORPUS_ROOT, genreEntry.name);
    const files = walkFiles(genrePath, { excludedDirs: EXCLUDED_DIRS })
      .filter(filePath => TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase()));
    for (const filePath of files) {
      const stat = fs.statSync(filePath);
      const relativePath = path.relative(WORKSPACE_ROOT, filePath).split(path.sep).join('/');
      books.push({
        bookId: stableId(relativePath, 'book'),
        genre: genreEntry.name,
        sourcePath: relativePath,
        fileName: path.basename(filePath),
        extension: path.extname(filePath).toLowerCase(),
        bytes: stat.size,
        estimatedCharsUtf8: Math.round(stat.size / 2.5),
        contentHash: 'UNMEASURED',
        chapterCount: 'UNVERIFIED'
      });
    }
  }
  const genreBreakdown = {};
  for (const book of books) {
    genreBreakdown[book.genre] ||= { fileCount: 0, bytes: 0, estimatedCharsUtf8: 0 };
    genreBreakdown[book.genre].fileCount += 1;
    genreBreakdown[book.genre].bytes += book.bytes;
    genreBreakdown[book.genre].estimatedCharsUtf8 += book.estimatedCharsUtf8;
  }
  return {
    schemaVersion: 'molan-evaluation-input-corpus-v1',
    generatedAt: new Date().toISOString(),
    corpusRoot: path.relative(WORKSPACE_ROOT, CORPUS_ROOT).split(path.sep).join('/'),
    scanMethod: 'recursive file metadata scan; extensions .txt/.md/.epub; UTF-8 character count is estimated from bytes',
    totalGenres: Object.keys(genreBreakdown).length,
    totalBooks: books.length,
    totalBytes: books.reduce((sum, book) => sum + book.bytes, 0),
    totalEstimatedCharsUtf8: books.reduce((sum, book) => sum + book.estimatedCharsUtf8, 0),
    chapterCounts: { status: 'UNVERIFIED', reason: '本次只生成文件清单，没有执行章节切分。' },
    genreBreakdown,
    books
  };
}

/** 读取已经建立的题材基线，只保留分布统计和采样元信息，不把基线转成质量结论。 */
function buildBenchmarkPools() {
  const index = readJson(path.join(BASELINE_DIR, 'index.json'));
  const entries = Array.isArray(index?.genres) ? index.genres : [];
  const pools = entries.map(entry => {
    const sourcePath = path.join(BASELINE_DIR, `${entry.genre}.json`);
    const raw = readJson(sourcePath);
    if (!raw) {
      return { genre: entry.genre, status: 'MISSING_SOURCE', sourceFile: projectRelative(sourcePath) };
    }
    const sampleBooks = Array.isArray(raw.books)
      ? raw.books.map(book => book?.path || book?.file || book?.title || null).filter(Boolean).slice(0, 100)
      : [];
    return {
      genre: raw.genre || entry.genre,
      status: raw.status || entry.status || 'UNKNOWN',
      sourceFile: projectRelative(sourcePath),
      measurementVersion: raw.measurementVersion || index?.measurementVersion || 'UNKNOWN',
      generatedAt: raw.generatedAt || 'UNKNOWN',
      bookCount: raw.bookCount ?? entry.bookCount ?? null,
      chaptersPerBook: raw.chaptersPerBook ?? 'UNKNOWN',
      sampling: raw.sampling || 'UNKNOWN',
      limitations: raw.limitations || ['UNKNOWN'],
      baseline: raw.baseline || null,
      structureBaseline: raw.structureBaseline || null,
      sampleBookCountObserved: Array.isArray(raw.books) ? raw.books.length : null,
      sampleBookRefs: sampleBooks
    };
  });
  return {
    schemaVersion: 'molan-evaluation-input-benchmark-pools-v1',
    generatedAt: new Date().toISOString(),
    indexSource: projectRelative(path.join(BASELINE_DIR, 'index.json')),
    poolSelectionPolicy: {
      primary: 'same genre/subgenre when available',
      secondary: 'same narrative mode and audience when metadata exists',
      broad: 'same top-level genre',
      comparison: '留给外部比较模型，本文件不执行比较。'
    },
    pools
  };
}

/** 读取生成运行记录，提取任务协议、原文位置和审计状态，不输出优劣判断。 */
function loadGenerationRecords() {
  const files = fs.existsSync(RUNS_DIR)
    ? fs.readdirSync(RUNS_DIR).filter(name => name.endsWith('.json')).sort()
    : [];
  return files.map(fileName => {
    const filePath = path.join(RUNS_DIR, fileName);
    const raw = readJson(filePath);
    const result = raw?.result || {};
    const text = String(result.text || '');
    const protocol = result.protocol || raw?.protocol || {};
    const audit = result.audit || raw?.audit || {};
    return {
      runId: fileName.replace(/\.json$/u, ''),
      sourceFile: projectRelative(filePath),
      requestId: raw?.requestId || 'UNKNOWN',
      sourceStatus: raw?.status || 'UNKNOWN',
      startedAt: raw?.startedAt || 'UNKNOWN',
      finishedAt: raw?.finishedAt || 'UNKNOWN',
      genre: protocol.genre || 'UNSPECIFIED',
      protocol: {
        taskId: protocol.taskId || protocol.generationTaskId || 'UNKNOWN',
        targetAudience: protocol.targetAudience || 'UNKNOWN',
        premisePresent: Boolean(protocol.premise),
        contractPresent: Boolean(protocol.contract || protocol.chapterContract),
        knowledgeBoundaryPresent: Boolean(protocol.allowedKnowledge || protocol.forbiddenKnowledge)
      },
      textCharsIncludingWhitespace: text.length,
      textAvailable: Boolean(text.trim()),
      textReference: text.trim() ? projectRelative(filePath) : null,
      audit: {
        status: audit.status || 'UNKNOWN',
        passed: audit.passed === true,
        issueCount: Array.isArray(audit.issues) ? audit.issues.length : null,
        humanReviewStatus: audit.humanReviewStatus || 'UNKNOWN'
      }
    };
  });
}

/** 为每个生成样本生成确定性原始指标；没有正文时返回明确的数据不足状态。 */
function buildDeterministicEvaluations(records, pools) {
  const poolByGenre = new Map((pools.pools || []).map(pool => [pool.genre, pool]));
  return records.map(record => {
    const raw = readJson(path.join(PROJECT_ROOT, record.sourceFile));
    const text = String(raw?.result?.text || '');
    if (!text.trim()) {
      return { runId: record.runId, status: 'INSUFFICIENT_DATA', sourceFile: record.sourceFile, metrics: null };
    }
    const requestedGenre = record.genre === 'UNSPECIFIED' ? '玄幻' : record.genre;
    const selectedPool = poolByGenre.get(requestedGenre) || poolByGenre.get('玄幻') || null;
    const baseline = selectedPool?.baseline || null;
    let aiFlavor = null;
    try {
      aiFlavor = typeof detector.computeAiFlavorScore === 'function'
        ? detector.computeAiFlavorScore(text, baseline)
        : { status: 'UNAVAILABLE' };
    } catch (error) {
      aiFlavor = { status: 'ERROR', error: error.message };
    }
    let evidenceMetrics = null;
    try {
      evidenceMetrics = metrics.summarizeChapter(text, { targetWords: 2500, tolerance: 0.15, knownEntities: [] });
    } catch (error) {
      evidenceMetrics = { status: 'ERROR', error: error.message };
    }
    return {
      runId: record.runId,
      status: 'MEASURED',
      sourceFile: record.sourceFile,
      measurementVersion: metrics.MEASUREMENT_VERSION || 'UNKNOWN',
      genreUsedForDetector: selectedPool?.genre || 'UNAVAILABLE',
      baselineInputUsedOnlyByDetector: Boolean(baseline),
      fingerprint: evidenceMetrics?.fingerprint || null,
      structure: evidenceMetrics?.structure || null,
      hardConstraints: evidenceMetrics?.hard || null,
      aiFlavor,
      styleDistance: 'DEFERRED_TO_COMPARISON_MODEL',
      confidence: 'UNMEASURED'
    };
  });
}

/** 从生成运行中的审计问题建立可定位证据索引，并逐条验证引用是否存在。 */
function buildEvidenceIndex(records) {
  const evidences = [];
  for (const record of records) {
    const raw = readJson(path.join(PROJECT_ROOT, record.sourceFile));
    const text = String(raw?.result?.text || '');
    const issues = raw?.result?.audit?.issues || raw?.audit?.issues || [];
    for (const issue of Array.isArray(issues) ? issues : []) {
      const quote = String(issue.quote || '');
      const located = text && typeof evidenceReview.locateQuote === 'function'
        ? evidenceReview.locateQuote(text, quote, issue.paragraphIndex)
        : { found: false, start: null, end: null, paragraphIndex: null };
      evidences.push({
        evidenceId: stableId(`${record.runId}:${quote}:${issue.paragraphIndex}`, 'evidence'),
        runId: record.runId,
        sourceFile: record.sourceFile,
        category: issue.category || 'UNKNOWN',
        severity: issue.severity || 'UNKNOWN',
        quote,
        problem: issue.problem || 'UNKNOWN',
        reason: issue.reason || 'UNKNOWN',
        paragraphIndex: issue.paragraphIndex ?? null,
        verifiedInSource: located.found === true,
        matchStart: located.start ?? null,
        matchEnd: located.end ?? null,
        verificationStatus: located.found === true ? 'VERIFIED' : 'UNVERIFIED'
      });
    }
  }
  return {
    schemaVersion: 'molan-evaluation-input-evidence-v1',
    generatedAt: new Date().toISOString(),
    totalEvidences: evidences.length,
    verifiedCount: evidences.filter(item => item.verifiedInSource).length,
    unverifiedCount: evidences.filter(item => !item.verifiedInSource).length,
    evidences
  };
}

/** 运行项目现有测试命令并保存原始回归状态；不把旧报告中的硬编码数字当作实测结果。 */
function runRegressionTests(shouldRun) {
  const testFiles = walkFiles(path.join(PROJECT_ROOT, 'test')).map(filePath => projectRelative(filePath));
  const base = {
    command: 'node --experimental-sqlite --no-warnings --test test/**/*.test.{js,mjs,cjs}',
    testFileCount: testFiles.length,
    testFiles,
    executed: false,
    status: 'NOT_RUN',
    exitCode: null,
    pass: null,
    fail: null,
    skipped: null,
    spawnError: null,
    rawTail: ''
  };
  if (!shouldRun) return base;
  const result = spawnSync(process.execPath, ['--experimental-sqlite', '--no-warnings', '--test', 'test/**/*.test.{js,mjs,cjs}'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const readCount = pattern => {
    const match = output.match(pattern);
    return match ? Number(match[1]) : null;
  };
  return {
    ...base,
    executed: true,
    status: result.error ? 'COMMAND_ERROR' : result.status === 0 ? 'PASS' : 'FAIL',
    exitCode: result.status,
    pass: readCount(/# pass\s+(\d+)/u),
    fail: readCount(/# fail\s+(\d+)/u),
    skipped: readCount(/# skipped\s+(\d+)/u),
    spawnError: result.error ? result.error.message : null,
    rawTail: output.slice(-4000)
  };
}

/** 生成版本与复现条件清单，区分实际版本信息和尚未保存的运行参数。 */
function buildVersionManifest(architecture, pools) {
  const packageJson = readJson(path.join(PROJECT_ROOT, 'package.json')) || {};
  return {
    schemaVersion: 'molan-evaluation-input-version-v1',
    generatedAt: new Date().toISOString(),
    project: { name: packageJson.name || 'molan-home', version: packageJson.version || 'UNKNOWN' },
    code: { gitHead: architecture.git.head, gitBranch: architecture.git.branch },
    measurement: {
      fingerprintVersion: metrics.MEASUREMENT_VERSION || 'UNKNOWN',
      detectorSource: projectRelative(path.join(PROJECT_ROOT, 'lib', 'ai-flavor-detector.js')),
      evidenceVerifierSource: projectRelative(path.join(PROJECT_ROOT, 'lib', 'evidence-review.js'))
    },
    benchmark: {
      poolIndex: pools.indexSource,
      poolCount: pools.pools.length,
      promptVersion: 'UNVERIFIED',
      skillVersion: 'UNVERIFIED',
      knowledgeVersion: 'UNVERIFIED',
      bibleVersion: 'UNVERIFIED',
      contractVersion: 'UNVERIFIED',
      modelVersion: 'UNVERIFIED',
      seed: 'UNVERIFIED'
    },
    reproducibilityGaps: [
      'generation run records do not consistently include model, temperature, topP, maxTokens and seed',
      'chapter counts for the full corpus were not measured by this package',
      'human judge and blinded selection records were not found in the scoped inputs',
      'confidence intervals and inter-rater agreement require repeated samples and human labels'
    ]
  };
}

/** 写入 JSON 文件并保持稳定的 UTF-8 缩进格式。 */
function writeJson(fileName, value) {
  fs.writeFileSync(path.join(OUTPUT_DIR, fileName), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** 生成供更强模型使用的比较提示词，并明确比较模型必须重新核验原始证据。 */
function buildComparisonPrompt(relativePackagePath) {
  const templatePath = path.join(PROJECT_ROOT, 'docs', '网文AI质量闭环评测与优化总控提示词.md');
  const template = fs.readFileSync(templatePath, 'utf8');
  return template.replaceAll('{{evaluation_package}}', relativePackagePath);
}

/** 主流程：只生成原始材料包和比较提示词，不计算跨对象质量差距。 */
function main() {
  const runTests = process.argv.includes('--run-tests');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const architecture = buildArchitectureInventory();
  const corpus = buildCorpusManifest();
  const pools = buildBenchmarkPools();
  const generationRuns = loadGenerationRecords();
  const evaluations = buildDeterministicEvaluations(generationRuns, pools);
  const evidence = buildEvidenceIndex(generationRuns);
  const regression = runRegressionTests(runTests);
  const versions = buildVersionManifest(architecture, pools);
  const packageIndex = {
    schemaVersion: 'molan-evaluation-input-package-v1',
    generatedAt: new Date().toISOString(),
    scope: '只生成原始评测材料；不输出跨对象比较、质量排名或优化结论。',
    projectRoot: PROJECT_ROOT,
    files: [
      'architecture-inventory.json', 'corpus-manifest.json', 'benchmark-pools.json',
      'generation-runs.json', 'deterministic-evaluations.json', 'evidence-index.json',
      'regression-input.json', 'version-manifest.json', 'evaluation-input.md', 'comparison-prompt.md'
    ],
    counts: {
      corpusGenres: corpus.totalGenres,
      corpusBooks: corpus.totalBooks,
      benchmarkPools: pools.pools.length,
      generationRuns: generationRuns.length,
      measuredRuns: evaluations.filter(item => item.status === 'MEASURED').length,
      evidenceItems: evidence.totalEvidences
    },
    unknowns: [
      '章节级全量拆书结果未在本材料包中重新生成',
      '人工评审、盲选和 Judge Agreement 未发现可复核输入',
      '生成模型、温度、TopP、最大 Token、Seed 等运行条件部分缺失',
      '未执行本包之外的跨版本因果比较'
    ]
  };
  writeJson('architecture-inventory.json', architecture);
  writeJson('corpus-manifest.json', corpus);
  writeJson('benchmark-pools.json', pools);
  writeJson('generation-runs.json', { schemaVersion: 'molan-generation-runs-v1', generatedAt: new Date().toISOString(), runs: generationRuns });
  writeJson('deterministic-evaluations.json', { schemaVersion: 'molan-deterministic-evaluations-v1', generatedAt: new Date().toISOString(), evaluations });
  writeJson('evidence-index.json', evidence);
  writeJson('regression-input.json', { schemaVersion: 'molan-regression-input-v1', generatedAt: new Date().toISOString(), regression });
  writeJson('version-manifest.json', versions);
  writeJson('package-index.json', packageIndex);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'comparison-prompt.md'), buildComparisonPrompt(projectRelative(OUTPUT_DIR)), 'utf8');
  const regressionLine = regression.executed ? `已执行，状态 ${regression.status}` : '未在生成包阶段执行';
  fs.writeFileSync(path.join(OUTPUT_DIR, 'evaluation-input.md'), `# 墨阑原始评测材料包\n\n生成时间：${packageIndex.generatedAt}\n\n本目录只提供可复核输入，不提供墨阑与 Benchmark 的比较结论。\n\n- 语料：${corpus.totalGenres} 个题材目录，${corpus.totalBooks} 个文件，${corpus.totalBytes} bytes；字符数为字节估算。\n- 已建立基线池：${pools.pools.length} 个。\n- 生成运行记录：${generationRuns.length} 个；正文可测样本：${packageIndex.counts.measuredRuns} 个。\n- 引用证据：${evidence.totalEvidences} 条，其中已在正文定位 ${evidence.verifiedCount} 条。\n- 回归命令：${regressionLine}。\n\n详细字段和数据来源见同目录 JSON。比较、差距、根因和最终判定请使用 comparison-prompt.md 交给外部模型，并要求其重新核验原始文件。\n`, 'utf8');
  console.log(JSON.stringify({ outputDir: OUTPUT_DIR, packageIndex: projectRelative(path.join(OUTPUT_DIR, 'package-index.json')), runTests, counts: packageIndex.counts, regression: regression.status }, null, 2));
}

main();
