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

class CheckpointManifest {
  /**
   * @param {Object} options
   */
  constructor(options = {}) {
    this.stagingRoot = path.resolve(options.stagingRoot || path.join(process.cwd(), 'data', 'corpus-build', 'runs'));
    this.runId = options.runId || `corpus_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${Date.now().toString().slice(-4)}`;
    this.runDir = path.join(this.stagingRoot, this.runId);
    this.manifestFile = path.join(this.runDir, 'manifest.json');
    this.data = null;
  }

  /**
   * 初始化或加载已有断点清单
   * @param {Object} params
   * @returns {Object} 当前 manifest 数据
   */
  initOrResume(params = {}) {
    const { books = [], resume = true, sourceSnapshot = '' } = params;

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

    if (!this.data) {
      this.data = {
        runId: this.runId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sourceSnapshot: sourceSnapshot || sha256(this.runId),
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
    entry.status = 'completed';
    entry.completedAt = new Date().toISOString();
    entry.last_chapter = stats.lastChapter || stats.last_chapter || entry.last_chapter;
    entry.chaptersProcessed = stats.chaptersProcessed || stats.chaptersCount || entry.chaptersProcessed;
    entry.candidateChapters = stats.candidateChapters || entry.candidateChapters;
    entry.error = null;

    if (typeof stats.unsegmented !== 'undefined') {
      const rawUnseg = typeof stats.unsegmented === 'boolean'
        ? (stats.unsegmented ? 1 : 0)
        : Number(stats.unsegmented || 0);
      const unsegCount = Number.isFinite(rawUnseg) ? Math.max(0, rawUnseg) : 0;
      const prevUnseg = entry.unsegmented || 0;
      entry.unsegmented = unsegCount;
      this.data.unsegmented = (this.data.unsegmented || 0) - prevUnseg + unsegCount;
    }

    this.data.booksCompleted++;
    this.data.chaptersProcessed += (stats.newChapters || entry.chaptersProcessed);
    this.data.candidateChaptersFound += (stats.candidateChapters || 0);
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
}

module.exports = {
  CheckpointManifest
};
