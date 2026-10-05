'use strict';

/**
 * @file batch-pipeline.js
 * 1279 部小说离线因子化批处理主流水线 (Corpus Offline Batch Pipeline Orchestrator)
 * 
 * 核心架构闭环：
 * 1. 严格 6 层物理隔离（进程隔离、数据库隔离、文件只读、CPU并发受控、内存防 OOM、配额隔离）；
 * 2. 细粒度断点续跑 (Checkpoint Manifest)，支持崩溃秒级恢复；
 * 3. 便宜初筛 + 深度正交因子化两阶段处理；
 * 4. 8 维非单一爽点目标分层；
 * 5. 暂存区隔离构建 -> 质量门禁 -> 原子版本发布。
 */

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { IsolationManager } = require('./isolation-manager');
const { CheckpointManifest } = require('./checkpoint-manifest');
const { screenCandidateChapter, factorizeCandidateChapter } = require('./candidate-screener');
const { mineStrategiesFromFeatures } = require('./strategy-miner');
const { PackagePublisher } = require('./package-publisher');

const DEFAULT_SOURCE_DIR = path.resolve(__dirname, '../../../../资源库/小说原本');
const CHAPTER_REGEX = /^[ \t\r]*(第[0-9零一二两三四五六七八九十百千万]+[章回节折卷]|Chapter\s*[0-9]+|楔子|序章|尾声|番外|引子)[ \t\r]*([^\r\n]*)/gim;

/**
 * 从书名中解析潜在作者
 * @param {string} name 
 * @returns {string|null}
 */
function parseAuthorFromBookName(name = '') {
  const str = String(name || '').trim();
  if (str.includes('_')) {
    const parts = str.split('_');
    if (parts.length >= 2 && parts[1].trim()) return parts[1].trim();
  }
  const matchColon = str.match(/作者[：:]([^\s_]+)/);
  if (matchColon) return matchColon[1].trim();
  const matchBracket = str.match(/^\[(.*?)\]/);
  if (matchBracket) return matchBracket[1].trim();
  return null;
}

/**
 * 扫描并发现原始语料中的书目列表
 * @param {string} sourceDir 原始语料根目录
 * @param {Object} filterOptions 过滤项 (bookId, category, limit)
 * @returns {Array<Object>} 待处理书目元数据列表
 */
function discoverSourceBooks(sourceDir, filterOptions = {}) {
  const books = [];
  if (!fs.existsSync(sourceDir)) {
    return books;
  }

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(sourceDir, entry.name);
    if (entry.isDirectory()) {
      const category = entry.name;
      if (filterOptions.category && category !== filterOptions.category) {
        continue;
      }

      const subFiles = fs.readdirSync(fullPath, { withFileTypes: true });
      for (const sub of subFiles) {
        if (sub.isFile() && (sub.name.endsWith('.txt') || sub.name.endsWith('.md'))) {
          const bookId = path.parse(sub.name).name;
          if (filterOptions.bookId && bookId !== filterOptions.bookId) {
            continue;
          }
          const author = parseAuthorFromBookName(bookId);
          books.push({
            bookId,
            title: bookId,
            author,
            category,
            filePath: path.join(fullPath, sub.name)
          });
        }
      }
    } else if (entry.isFile() && (entry.name.endsWith('.txt') || entry.name.endsWith('.md'))) {
      const bookId = path.parse(entry.name).name;
      if (filterOptions.bookId && bookId !== filterOptions.bookId) {
        continue;
      }
      const author = parseAuthorFromBookName(bookId);
      books.push({
        bookId,
        title: bookId,
        author,
        category: '根目录',
        filePath: fullPath
      });
    }
  }

  if (filterOptions.limit && filterOptions.limit > 0) {
    return books.slice(0, Number(filterOptions.limit));
  }

  return books;
}

/**
 * 从小说正文中切分出章节列表（纯内存流式按需分片）
 * @param {string} rawText 小说全文本
 * @returns {Array<Object>} 章节数组 [{ chapterNo, title, content, unsegmented? }]
 */
function splitChaptersFromText(rawText = '') {
  const chapters = [];
  const text = String(rawText || '');
  const matches = [];
  let match;

  CHAPTER_REGEX.lastIndex = 0;
  while ((match = CHAPTER_REGEX.exec(text)) !== null) {
    matches.push({
      header: match[1],
      title: (match[2] || '').trim(),
      index: match.index
    });
  }

  if (!matches.length) {
    // 无法匹配正则时，标记为 UNSEGMENTED，严防切分成虚拟章节污染下游策略训练或特征
    return [{
      chapterNo: 0,
      title: 'UNSEGMENTED',
      content: text,
      unsegmented: true
    }];
  }

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const chContent = next ? text.slice(cur.index, next.index) : text.slice(cur.index);
    const fullTitle = `${cur.header} ${cur.title}`.trim();
    chapters.push({
      chapterNo: i + 1,
      title: fullTitle,
      content: chContent
    });
  }

  return chapters;
}

class CorpusBatchPipeline {
  /**
   * @param {Object} options
   */
  constructor(options = {}) {
    this.sourceDir = options.sourceDir ? path.resolve(options.sourceDir) : DEFAULT_SOURCE_DIR;
    this.stagingRoot = path.resolve(options.stagingRoot || path.join(process.cwd(), 'data', 'corpus-build', 'runs'));
    this.runId = options.runId || null;
    this.isolationManager = new IsolationManager({
      workers: options.workers || 2,
      outputDir: path.dirname(this.stagingRoot),
      sourceDir: this.sourceDir
    });
    this.publisher = new PackagePublisher();
  }

  /**
   * 1. 抽取章节特征阶段 (corpus:extract)
   * 遵循两阶段策略：第一阶段便宜初筛 -> 第二阶段深度正交因子化
   */
  async runExtract(options = {}) {
    this.isolationManager.assertProcessIsolation();
    this.isolationManager.assertDatabaseIsolation(this.stagingRoot);

    // 确定运行 ID 与断点恢复
    const resumeRequested = options.resume === true;
    let effectiveRunId = options.runId || this.runId;
    if (resumeRequested && !effectiveRunId) {
      effectiveRunId = CheckpointManifest.findLatestIncompleteRunId(this.stagingRoot) || CheckpointManifest.findLatestRunId(this.stagingRoot);
    }
    if (!effectiveRunId) {
      effectiveRunId = `corpus_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${Date.now().toString().slice(-4)}`;
    }
    this.runId = effectiveRunId;

    const runDir = path.join(this.stagingRoot, effectiveRunId);
    if (!fs.existsSync(runDir)) fs.mkdirSync(runDir, { recursive: true });

    const manifestManager = new CheckpointManifest({
      stagingRoot: this.stagingRoot,
      runId: effectiveRunId
    });

    // 发现原始书目
    const discoveredBooks = discoverSourceBooks(this.sourceDir, {
      bookId: options.bookId,
      category: options.category,
      limit: options.limit
    });

    manifestManager.initOrResume({
      books: discoveredBooks,
      resume: resumeRequested
    });

    const pendingBooks = manifestManager.getPendingBooks();
    const featuresFile = path.join(runDir, 'chapter-features.jsonl');
    if (!fs.existsSync(featuresFile)) {
      fs.writeFileSync(featuresFile, '', 'utf8');
    }

    if (options.dryRun) {
      return {
        mode: 'dry_run',
        runId: effectiveRunId,
        sourceDir: this.sourceDir,
        booksDiscovered: discoveredBooks.length,
        booksPending: pendingBooks.length,
        stagingRunDir: runDir
      };
    }

    let totalCandidateChapters = 0;
    let chaptersProcessedThisRun = 0;
    const quotaManager = this.isolationManager.getQuotaManager();

    // 建立每书独立暂存目录 (Per-book Staging Directory)
    const stagingBooksDir = path.join(runDir, 'staging_books');
    if (!fs.existsSync(stagingBooksDir)) {
      fs.mkdirSync(stagingBooksDir, { recursive: true });
    }

    const maxConcurrency = Math.max(1, Math.min(8, Number(options.workers || this.isolationManager.maxWorkers || 2)));
    this.isolationManager.maxWorkers = maxConcurrency;

    // 互斥提交锁，保障暂存特征合并至 chapter-features.jsonl 及检查点更新的原子性，彻底杜绝行交叉
    let commitChain = Promise.resolve();
    const withCommitLock = async (fn) => {
      const p = commitChain.then(() => fn(), () => fn());
      commitChain = p;
      return p;
    };

    const processSingleBook = async (book) => {
      manifestManager.markBookStart(book.book_id);
      try {
        // 3. 严格只读打开与解码原始语料 (O_RDONLY + UTF-8/GB18030 容错)
        const fileContent = this.isolationManager.readReadOnlyFileText(book.filePath);
        const chapters = splitChaptersFromText(fileContent);

        let bookCandidates = 0;
        let validChaptersCount = 0;
        const featureLines = [];

        for (const chapter of chapters) {
          if (chapter.unsegmented || chapter.title === 'UNSEGMENTED' || chapter.chapterNo === 0) {
            // 标记跳过未切分章节，严防虚拟章节污染下游特征库与策略挖掘
            continue;
          }

          validChaptersCount++;
          // 第一阶段：便宜物理初筛
          const screener = screenCandidateChapter(chapter.content, {
            bookId: book.book_id,
            title: book.title,
            chapterNo: chapter.chapterNo,
            genre: book.category
          });

          // 第二阶段：高价值候选章节正交深度因子化 (受配额隔离监管)
          if (screener.isCandidate && !options.stage1Only) {
            if (quotaManager.canConsume(1000)) {
              quotaManager.consume(1000);
              const factors = factorizeCandidateChapter(chapter.content, {
                bookId: book.book_id,
                title: book.title,
                author: book.author || null,
                chapterNo: chapter.chapterNo,
                chapterTitle: chapter.title,
                genre: book.category
              }, screener);

              const enriched = {
                ...factors,
                author: factors.author || book.author || (book.title?.includes('_') ? book.title.split('_')[1] : null) || factors.novelTitle || '未知作者'
              };

              featureLines.push(JSON.stringify(enriched));
              bookCandidates++;
              totalCandidateChapters++;
            }
          }
          chaptersProcessedThisRun++;
        }

        // 写入独立书目暂存文件 (Per-book Staging: staging_books/<book_id>.features.jsonl)
        const bookStagingFile = path.join(stagingBooksDir, `${book.book_id}.features.jsonl`);
        fs.writeFileSync(bookStagingFile, featureLines.join('\n') + (featureLines.length ? '\n' : ''), 'utf8');

        // 互斥原子提交暂存特征与更新断点清单
        await withCommitLock(async () => {
          if (featureLines.length > 0 && fs.existsSync(bookStagingFile)) {
            const stagingContent = fs.readFileSync(bookStagingFile, 'utf8');
            if (stagingContent) {
              fs.appendFileSync(featuresFile, stagingContent, 'utf8');
            }
          }

          manifestManager.markBookComplete(book.book_id, {
            lastChapter: validChaptersCount,
            chaptersProcessed: validChaptersCount,
            candidateChapters: bookCandidates,
            newChapters: validChaptersCount,
            unsegmented: validChaptersCount === 0
          });
        });
      } catch (err) {
        await withCommitLock(async () => {
          manifestManager.markBookFailed(book.book_id, err.message);
        });
      } finally {
        this.isolationManager.releaseWorkerSlot();
      }

      // 内存隔离监控看门狗
      const memHealth = this.isolationManager.checkMemoryHealth();
      if (memHealth.warning && global.gc) {
        global.gc();
      }
    };

    const workerTasks = [];
    const queue = [...pendingBooks];
    let queueIndex = 0;
    const activeWorkersCount = Math.min(maxConcurrency, queue.length);

    for (let w = 0; w < activeWorkersCount; w++) {
      workerTasks.push((async () => {
        while (true) {
          let currentBook = null;
          if (queueIndex < queue.length) {
            currentBook = queue[queueIndex++];
          } else {
            break;
          }
          await this.isolationManager.acquireWorkerSlot();
          await processSingleBook(currentBook);
        }
      })());
    }

    await Promise.all(workerTasks);

    return {
      status: 'extract_completed',
      runId: effectiveRunId,
      runDir,
      featuresFile,
      summary: manifestManager.getSummary()
    };
  }

  /**
   * 2. 构建与挖掘创作策略 (corpus:build-strategy)
   */
  async runBuildStrategy(options = {}) {
    const runId = options.runId || this.runId || CheckpointManifest.findLatestRunId(this.stagingRoot);
    if (!runId) throw new Error('未指定 runId 且未找到可构建的暂存运行');
    const runDir = path.join(this.stagingRoot, runId);

    return mineStrategiesFromFeatures({ runDir });
  }

  /**
   * 3. 聚类章节运作原型 (corpus:discover-patterns)
   */
  async runDiscoverPatterns(options = {}) {
    return this.runBuildStrategy(options);
  }

  /**
   * 4. 产出质量评估报告 (corpus:quality-report)
   */
  async runQualityReport(options = {}) {
    const runId = options.runId || this.runId || CheckpointManifest.findLatestRunId(this.stagingRoot);
    if (!runId) throw new Error('未指定 runId');
    const reportFile = path.join(this.stagingRoot, runId, 'quality-report.json');
    if (!fs.existsSync(reportFile)) {
      await this.runBuildStrategy({ runId });
    }
    return JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  }

  /**
   * 5. 原子发布已验证知识包至生产环境 (corpus:publish)
   */
  async runPublish(options = {}) {
    const runId = options.runId || this.runId || CheckpointManifest.findLatestRunId(this.stagingRoot);
    if (!runId) throw new Error('未指定 runId 且未找到可发布的暂存运行');
    const runDir = path.join(this.stagingRoot, runId);

    // 若尚未生成策略规则，自动触发构建
    if (!fs.existsSync(path.join(runDir, 'strategy-rules.jsonl'))) {
      await this.runBuildStrategy({ runId });
    }

    return this.publisher.publishRun(runDir, options);
  }
}

module.exports = {
  CorpusBatchPipeline,
  discoverSourceBooks,
  splitChaptersFromText
};
