'use strict';

/**
 * @file checkpoint-manifest.js
 * 语料批处理断点续跑与任务清单管理器 (Checkpoint & Manifest Manager)
 * 
 * 核心架构目标：
 * 1. 支撑 1279 部小说长时间离线抽取，中途意外终止后执行 --resume 无缝续跑；
 * 2. 独立书目级细粒度状态跟踪 (book_id, status, last_chapter, error, retry_count)；
 * 3. 严格原子写文件，避免进程 crash 造成清单损坏。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function sha256(val) {
  return crypto.createHash('sha256').update(String(val || ''), 'utf8').digest('hex');
}

/**
 * 计算确定性的语料库 sourceSnapshot SHA-256 哈希值
 * 基于所有语料源文件的 (bookId, size, mtimeMs, contentSha)，并按 bookId 字典序排序
 * @param {Array<Object|string>} books
 * @param {string} sourceDir
 * @returns {string} 64 位 SHA-256 十六进制字符串
 */
function computeSourceSnapshot(books = [], sourceDir = '') {
  const hash = crypto.createHash('sha256');
  const records = [];
  const bookList = Array.isArray(books) ? books : (books && typeof books === 'object' ? Object.values(books) : []);

  if (bookList.length > 0) {
    for (const b of bookList) {
      const bookId = typeof b === 'string' ? b : String(b.bookId || b.id || b.book_id || b.title || '').trim();
      if (!bookId) continue;

      let targetPath = (typeof b === 'object' && b.filePath) ? b.filePath : '';
      if (targetPath) {
        if (!path.isAbsolute(targetPath) && sourceDir) {
          const cand = path.resolve(sourceDir, targetPath);
          if (fs.existsSync(cand)) targetPath = cand;
        }
      } else if (sourceDir && bookId) {
        const candidates = [
          path.join(sourceDir, `${bookId}.txt`),
          path.join(sourceDir, bookId),
          path.join(sourceDir, `${(b && b.title) || bookId}.txt`),
          path.join(sourceDir, `${bookId}.md`)
        ];
        for (const cand of candidates) {
          if (fs.existsSync(cand)) {
            targetPath = cand;
            break;
          }
        }
      }

      let size = 0;
      let mtimeMs = 0;
      let contentSha = '';
      if (targetPath && fs.existsSync(targetPath)) {
        try {
          const stat = fs.statSync(targetPath);
          size = stat.size || 0;
          mtimeMs = Math.round(stat.mtimeMs || 0);
          if (size > 0 && size <= 20 * 1024 * 1024) {
            const buf = fs.readFileSync(targetPath);
            contentSha = crypto.createHash('sha256').update(buf).digest('hex');
          }
        } catch (_) {}
      }
      records.push({ bookId, size, mtimeMs, contentSha });
    }
  } else if (sourceDir && fs.existsSync(sourceDir)) {
    try {
      const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isFile()) {
          const filePath = path.join(sourceDir, ent.name);
          const bookId = path.parse(ent.name).name;
          let size = 0;
          let mtimeMs = 0;
          let contentSha = '';
          try {
            const stat = fs.statSync(filePath);
            size = stat.size || 0;
            mtimeMs = Math.round(stat.mtimeMs || 0);
            if (size > 0 && size <= 20 * 1024 * 1024) {
              const buf = fs.readFileSync(filePath);
              contentSha = crypto.createHash('sha256').update(buf).digest('hex');
            }
          } catch (_) {}
          records.push({ bookId, size, mtimeMs, contentSha });
        }
      }
    } catch (_) {}
  }

  if (records.length === 0) {
    return sha256('empty_corpus');
  }

  records.sort((a, b) => a.bookId.localeCompare(b.bookId));
  for (const r of records) {
    hash.update(`${r.bookId}:${r.size}:${r.mtimeMs}:${r.contentSha}\n`);
  }
  return hash.digest('hex');
}

class CheckpointManifest {
  /**
   * @param {Object} options
   */
  constructor(options = {}) {
    this.stagingRoot = path.resolve(options.stagingRoot || path.join(process.cwd(), 'data', 'corpus-build', 'runs'));
    this.runId = options.runId || `corpus_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${Date.now().toString().slice(-4)}`;
    this.runDir = path.join(this.stagingRoot, this.runId);
    this.manifestFile = path.join(this.runDir, 'manifest.json');
    this.sourceDir = options.sourceDir ? path.resolve(options.sourceDir) : '';
    this.data = null;
  }

  /**
   * 初始化或加载已有断点清单
   * @param {Object} params
   * @returns {Object} 当前 manifest 数据
   */
  initOrResume(params = {}) {
    const { books = [], resume = true, sourceSnapshot = '', sourceDir = '' } = params;

    if (!fs.existsSync(this.runDir)) {
      fs.mkdirSync(this.runDir, { recursive: true });
    }

    if (resume && fs.existsSync(this.manifestFile)) {
      try {
        const raw = fs.readFileSync(this.manifestFile, 'utf8');
        this.data = JSON.parse(raw);
      } catch (err) {
        // 若解析失败，创建新状态备份
      }
    }

    if (this.data && resume) {
      // 恢复中断状态：将 stranded 的 in_progress 书目重置为 pending，以供断点续跑重新调度
      if (this.data.books) {
        let hasReset = false;
        for (const bookEntry of Object.values(this.data.books)) {
          if (bookEntry.status === 'in_progress') {
            bookEntry.status = 'pending';
            bookEntry.error = 'Interrupted by process termination (auto-recovered)';
            hasReset = true;
          }
        }
        if (hasReset) {
          this.data.updatedAt = new Date().toISOString();
          this.save();
        }
      }
    }

    if (!this.data) {
      const effectiveSourceDir = sourceDir || this.sourceDir || '';
      const effectiveSnapshot = sourceSnapshot || computeSourceSnapshot(books, effectiveSourceDir);
      this.data = {
        runId: this.runId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sourceSnapshot: effectiveSnapshot,
        booksTotal: books.length,
        booksCompleted: 0,
        chaptersProcessed: 0,
        candidateChaptersFound: 0,
        unsegmented: 0,
        failed: 0,
        status: 'in_progress',
        books: {}
      };

      for (const b of books) {
        const bId = String(b.bookId || b.id || b.title || '').trim();
        if (bId) {
          this.data.books[bId] = {
            book_id: bId,
            title: b.title || bId,
            category: b.category || '通用',
            filePath: b.filePath || '',
            status: 'pending',
            last_chapter: 0,
            chaptersProcessed: 0,
            candidateChapters: 0,
            unsegmented: 0,
            feature_version: '1.0.0',
            error: null,
            retry_count: 0
          };
        }
      }
      this.save();
    } else {
      // 若是 resume，合入可能新发现的书目
      for (const b of books) {
        const bId = String(b.bookId || b.id || b.title || '').trim();
        if (bId && !this.data.books[bId]) {
          this.data.books[bId] = {
            book_id: bId,
            title: b.title || bId,
            category: b.category || '通用',
            filePath: b.filePath || '',
            status: 'pending',
            last_chapter: 0,
            chaptersProcessed: 0,
            candidateChapters: 0,
            unsegmented: 0,
            feature_version: '1.0.0',
            error: null,
            retry_count: 0
          };
          this.data.booksTotal++;
        }
      }
      this.save();
    }

    return this.data;
  }

  isBookCompleted(bookId) {
    const entry = this.data?.books?.[bookId];
    return entry && entry.status === 'completed';
  }

  getBookCheckpoint(bookId) {
    return this.data?.books?.[bookId] || null;
  }

  markBookStart(bookId) {
    if (!this.data || !this.data.books[bookId]) return;
    this.data.books[bookId].status = 'in_progress';
    this.data.books[bookId].startedAt = this.data.books[bookId].startedAt || new Date().toISOString();
    this.data.updatedAt = new Date().toISOString();
    this.save();
  }

  markBookComplete(bookId, stats = {}) {
    if (!this.data || !this.data.books[bookId]) return;
    const entry = this.data.books[bookId];
    const wasCompleted = entry.status === 'completed';

    entry.status = 'completed';
    entry.completedAt = wasCompleted ? entry.completedAt : new Date().toISOString();
    entry.last_chapter = stats.lastChapter ?? stats.last_chapter ?? entry.last_chapter;
    entry.error = null;

    const prevChapters = Number(entry.chaptersProcessed || 0);
    const prevCandidates = Number(entry.candidateChapters || 0);

    let newChapters = prevChapters;
    if (typeof stats.chaptersProcessed !== 'undefined') {
      newChapters = Number(stats.chaptersProcessed || 0);
    } else if (typeof stats.chaptersCount !== 'undefined') {
      newChapters = Number(stats.chaptersCount || 0);
    } else if (typeof stats.newChapters !== 'undefined' && !wasCompleted) {
      newChapters = prevChapters + Number(stats.newChapters || 0);
    }

    let newCandidates = prevCandidates;
    if (typeof stats.candidateChapters !== 'undefined') {
      newCandidates = Number(stats.candidateChapters || 0);
    }

    entry.chaptersProcessed = newChapters;
    entry.candidateChapters = newCandidates;

    if (typeof stats.unsegmented !== 'undefined') {
      const rawUnseg = typeof stats.unsegmented === 'boolean'
        ? (stats.unsegmented ? 1 : 0)
        : Number(stats.unsegmented || 0);
      const unsegCount = Number.isFinite(rawUnseg) ? Math.max(0, rawUnseg) : 0;
      const prevUnseg = entry.unsegmented || 0;
      entry.unsegmented = unsegCount;
      this.data.unsegmented = (this.data.unsegmented || 0) - prevUnseg + unsegCount;
    }

    if (!wasCompleted) {
      this.data.booksCompleted = (this.data.booksCompleted || 0) + 1;
    }

    const deltaChapters = newChapters - prevChapters;
    const deltaCandidates = newCandidates - prevCandidates;
    this.data.chaptersProcessed = Math.max(0, (this.data.chaptersProcessed || 0) + deltaChapters);
    this.data.candidateChaptersFound = Math.max(0, (this.data.candidateChaptersFound || 0) + deltaCandidates);

    this.data.updatedAt = new Date().toISOString();
    this.save();
  }

  markBookFailed(bookId, errorMsg) {
    if (!this.data || !this.data.books[bookId]) return;
    const entry = this.data.books[bookId];
    entry.status = 'failed';
    entry.failedAt = new Date().toISOString();
    entry.error = String(errorMsg || '未知错误');
    entry.retry_count = (entry.retry_count || 0) + 1;

    this.data.failed++;
    this.data.updatedAt = new Date().toISOString();
    this.save();
  }

  getPendingBooks() {
    if (!this.data) return [];
    return Object.values(this.data.books).filter(b => b.status === 'pending' || (b.status === 'failed' && b.retry_count < 3));
  }

  getSummary() {
    if (!this.data) return { status: 'uninitialized' };
    return {
      runId: this.data.runId,
      booksTotal: this.data.booksTotal,
      booksCompleted: this.data.booksCompleted,
      chaptersProcessed: this.data.chaptersProcessed,
      candidateChaptersFound: this.data.candidateChaptersFound,
      unsegmented: this.data.unsegmented || 0,
      failed: this.data.failed,
      status: this.data.booksCompleted >= this.data.booksTotal ? 'completed' : 'in_progress'
    };
  }

  save() {
    if (!this.data) return;
    const nonce = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString('hex');
    const tmp = `${this.manifestFile}.tmp_${Date.now()}_${process.pid}_${nonce}`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    try {
      fs.renameSync(tmp, this.manifestFile);
    } catch (err) {
      try {
        fs.copyFileSync(tmp, this.manifestFile);
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch (_) {
        throw err;
      }
    }
  }

  /**
   * 自动探测最新运行目录以支持 --resume
   */
  static findLatestRunId(stagingRoot = path.join(process.cwd(), 'data', 'corpus-build', 'runs')) {
    if (!fs.existsSync(stagingRoot)) return null;
    const dirs = fs.readdirSync(stagingRoot).filter(d => fs.statSync(path.join(stagingRoot, d)).isDirectory());
    if (!dirs.length) return null;
    dirs.sort((a, b) => b.localeCompare(a));
    return dirs[0];
  }

  /**
   * 自动探测最新未完成的运行目录以供 --resume 恢复
   */
  static findLatestIncompleteRunId(stagingRoot = path.join(process.cwd(), 'data', 'corpus-build', 'runs')) {
    if (!fs.existsSync(stagingRoot)) return null;
    const dirs = fs.readdirSync(stagingRoot).filter(d => fs.statSync(path.join(stagingRoot, d)).isDirectory());
    if (!dirs.length) return null;
    dirs.sort((a, b) => b.localeCompare(a));

    for (const d of dirs) {
      const manifestPath = path.join(stagingRoot, d, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          if (data && data.status !== 'completed' && (data.booksCompleted < data.booksTotal || data.failed > 0)) {
            return d;
          }
        } catch (_) {}
      }
    }
    return null;
  }

  static computeSourceSnapshot(books, sourceDir) {
    return computeSourceSnapshot(books, sourceDir);
  }
}

CheckpointManifest.computeSourceSnapshot = computeSourceSnapshot;

module.exports = {
  CheckpointManifest,
  computeSourceSnapshot
};
