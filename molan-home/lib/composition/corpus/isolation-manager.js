'use strict';

/**
 * @file isolation-manager.js
 * 语料批处理 6 层物理与资源隔离管控器 (Corpus Batch 6-Layer Isolation Manager)
 * 
 * 核心架构目标：
 * 坚决贯彻“绝对不阻塞日常小说生成”的红线，落实 6 层隔离体系：
 * 
 * ① 进程隔离 (Process Isolation)
 *    Corpus Worker 独立 CLI 子进程运行，绝不作为 Web Server 中间件占用事件循环；
 * ② 数据库隔离 (Database Isolation)
 *    批处理严禁直接 INSERT production.sqlite / production PostgreSQL；严格走 Staging (JSONL/Staging DB)；
 * ③ 文件隔离 (File Isolation)
 *    原始小说语料以严格只读方式打开 (O_RDONLY)，产物仅写入 data/corpus-build/ staging 隔离区；
 * ④ CPU 隔离 (CPU Isolation)
 *    并发数严格受控 (--workers n)，内置自适应 yield 机制防 CPU 占满；
 * ⑤ 内存隔离 (Memory Isolation)
 *    流式分章读取，内存上限监控与防 OOM 回压；
 * ⑥ API/LLM 配额隔离 (Quota Isolation)
 *    语料分析绝不与用户日常生成争抢生产模型 Token 额度，支持独立额度桶与零 Token 规则模式。
 */

const fs = require('node:fs');
const path = require('node:path');

class CorpusQuotaManager {
  /**
   * @param {Object} options
   */
  constructor(options = {}) {
    this.maxDailyTokens = options.maxDailyTokens || 500000;
    this.usedTokens = 0;
    this.offlineZeroCostMode = options.offlineZeroCostMode !== false; // 默认零 Token 纯离线抽取模式
    this.quotaExhausted = false;
  }

  canConsume(tokenEstimate = 1000) {
    if (this.offlineZeroCostMode) return true;
    return (this.usedTokens + tokenEstimate) <= this.maxDailyTokens;
  }

  consume(tokens = 0) {
    if (this.offlineZeroCostMode) return;
    this.usedTokens += tokens;
    if (this.usedTokens >= this.maxDailyTokens) {
      this.quotaExhausted = true;
    }
  }

  getStatus() {
    return {
      offlineZeroCostMode: this.offlineZeroCostMode,
      maxDailyTokens: this.maxDailyTokens,
      usedTokens: this.usedTokens,
      quotaExhausted: this.quotaExhausted
    };
  }
}

class IsolationManager {
  /**
   * @param {Object} options
   */
  constructor(options = {}) {
    this.maxWorkers = Math.max(1, Math.min(8, Number(options.workers || 2)));
    this.memoryCeilingMb = Number(options.memoryCeilingMb || 512); // 单 Worker 内存上限 (MB)
    this.stagingRoot = path.resolve(options.outputDir || path.join(process.cwd(), 'data', 'corpus-build'));
    this.sourceDir = options.sourceDir ? path.resolve(options.sourceDir) : null;
    this.quotaManager = new CorpusQuotaManager(options.quotaOptions || {});
    this._activeWorkers = 0;
  }

  /**
   * 1. 进程隔离检查：断言当前不在 Web Server 运行时内
   */
  assertProcessIsolation() {
    if (process.env.MOLAN_IS_WEB_SERVER === '1' && !process.env.ALLOW_INPROCESS_CORPUS) {
      throw new Error('【进程隔离违规】：语料批处理绝不能在 Web Server 进程内直接执行，必须使用 CLI 独立进程');
    }
  }

  /**
   * 2. 数据库隔离检查：拦截对生产数据库的写入企图
   */
  assertDatabaseIsolation(targetDbPath = '') {
    const normalized = path.resolve(String(targetDbPath || ''));
    if (normalized.includes('production.sqlite') || normalized.includes('molan_prod')) {
      throw new Error(`【数据库隔离违规】：批处理禁止直接写入生产数据库 [${targetDbPath}]，必须暂存至 staging 区域`);
    }
  }

  /**
   * 3. 文件只读流创建：严格只读打开原始语料 (O_RDONLY)
   * @param {string} filePath
   * @returns {fs.ReadStream}
   */
  createReadOnlyStream(filePath) {
    const resolved = path.resolve(filePath);
    return fs.createReadStream(resolved, {
      flags: 'r',
      encoding: 'utf8',
      mode: 0o444
    });
  }

  /**
   * 严格只读打开并解码文件正文 (O_RDONLY + UTF-8 / GB18030 / GBK 自适应容错)
   * @param {string} filePath
   * @returns {string}
   */
  readReadOnlyFileText(filePath) {
    const resolved = path.resolve(filePath);
    const fd = fs.openSync(resolved, fs.constants.O_RDONLY);
    let buffer;
    try {
      buffer = fs.readFileSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    } catch (_) {
      try {
        return new TextDecoder('gb18030').decode(buffer);
      } catch (err) {
        return buffer.toString('utf8');
      }
    }
  }

  /**
   * 4. CPU 隔离并发控制
   */
  async acquireWorkerSlot() {
    while (this._activeWorkers >= this.maxWorkers) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    this._activeWorkers++;
  }

  releaseWorkerSlot() {
    this._activeWorkers = Math.max(0, this._activeWorkers - 1);
  }

  /**
   * 5. 内存隔离看门狗：防 OOM 检查
   */
  checkMemoryHealth() {
    const mem = process.memoryUsage();
    const heapUsedMb = Math.round(mem.heapUsed / (1024 * 1024));
    const isExceeded = heapUsedMb > this.memoryCeilingMb;
    return {
      heapUsedMb,
      memoryCeilingMb: this.memoryCeilingMb,
      warning: isExceeded,
      actionNeeded: isExceeded ? 'gc_or_throttle' : 'ok'
    };
  }

  /**
   * 6. 配额隔离代理
   */
  getQuotaManager() {
    return this.quotaManager;
  }
}

module.exports = {
  IsolationManager,
  CorpusQuotaManager
};
