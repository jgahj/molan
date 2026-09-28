'use strict';

/**
 * pipeline-coordinator.js
 * ---------------------------------------------------------------------------
 * 流式事件解耦与状态机自愈管线协调器 (Pipeline Coordinator - OPT-ARCH-001)
 *
 * 核心设计目标：
 * 1. 根治 DEF-PIPE-001：流式事件碰撞中断与截断残卷问题；
 * 2. 状态机中枢：维护 INIT -> GENERATING -> VALIDATING -> REVISING -> COMMITTED 状态流转；
 * 3. 流式协议多路解耦：隔离上游计费 (molan_billing)、心跳包与正文 content_delta；
 * 4. 指数退避重试 (Exponential Backoff)：网络抖动或瞬态异常时自动恢复；
 * 5. Diff 增量补丁修订 (Hunk Patching)：替代 3000 字全量重写，避免超时截断产出 1394 字残卷。
 * ---------------------------------------------------------------------------
 */

const PIPELINE_STATES = Object.freeze({
  INIT: 'INIT',
  GENERATING: 'GENERATING',
  VALIDATING: 'VALIDATING',
  REVISING: 'REVISING',
  COMMITTED: 'COMMITTED',
  FAILED: 'FAILED'
});

/**
 * 流式协议多路复用解耦解析器 (Decoupled Stream Parser)
 * 彻底隔离上游流式计费、心跳包与小说正文 delta，杜绝解析崩溃
 */
function parseDecoupledStream(rawStream = '') {
  let removedBillingEvents = 0;
  let removedHeartbeats = 0;
  let content = '';
  let usage = null;
  let finishReason = null;
  const streamErrors = [];

  const events = rawStream.split(/\r?\n\r?\n/);
  for (const event of events) {
    if (!event.trim()) continue;

    // 1. 过滤心跳包
    if (/^: (?:ping|keep-alive)/.test(event)) {
      removedHeartbeats += 1;
      continue;
    }

    // 2. 提取并隔离计费控制帧 (如 {"molan_billing": ...})
    if (/molan_billing/.test(event)) {
      removedBillingEvents += 1;
      continue;
    }

    // 3. 处理正规 SSE data 帧
    const lines = event.split(/\r?\n/).filter(l => l.startsWith('data:'));
    for (const line of lines) {
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      try {
        const packet = JSON.parse(payload);
        if (packet.error || packet.molan_error) {
          streamErrors.push(packet.error?.message || '上游流式返回错误');
        }
        if (packet.molan_usage) usage = packet.molan_usage;
        const choice = packet.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const delta = choice?.delta?.content || choice?.message?.content || choice?.text || '';
        content += delta;
      } catch (err) {
        // 遇到非正规数据包进行安全旁路，绝不抛错阻断整个正文
        streamErrors.push(`流式非正规数据包被隔离: ${err.message}`);
      }
    }
  }

  return {
    content,
    usage,
    finishReason,
    streamErrors,
    removedBillingEvents,
    removedHeartbeats
  };
}

/**
 * Diff 增量补丁修订器 (Hunk Patching)
 * 仅对需要修饰的特定段落执行增量补丁替换，彻底取代 3000 字全量重写
 *
 * @param {string} originalText 原始正文
 * @param {Object} patchSpec 补丁规格 { searchSnippet, replacementSnippet, targetBlock }
 * @returns {Object} 补丁应用结果 { success, patchedText, replacedCount, reason }
 */
function applyHunkPatch(originalText = '', patchSpec = {}) {
  if (typeof originalText !== 'string' || !originalText) {
    return { success: false, patchedText: originalText, replacedCount: 0, reason: '原始文本为空' };
  }

  const { searchSnippet, replacementSnippet, targetBlock } = patchSpec;

  if (targetBlock instanceof RegExp) {
    if (!targetBlock.test(originalText)) {
      return { success: false, patchedText: originalText, replacedCount: 0, reason: '目标正则未命中' };
    }
    const patchedText = originalText.replace(targetBlock, replacementSnippet || '');
    return { success: true, patchedText, replacedCount: 1, reason: null };
  }

  if (typeof searchSnippet === 'string' && searchSnippet.trim()) {
    const trimmedSnippet = searchSnippet.trim();
    if (!originalText.includes(trimmedSnippet)) {
      return { success: false, patchedText: originalText, replacedCount: 0, reason: '未找到待替换的上下文片段' };
    }
    const patchedText = originalText.replace(trimmedSnippet, (replacementSnippet || '').trim());
    return { success: true, patchedText, replacedCount: 1, reason: null };
  }

  return { success: false, patchedText: originalText, replacedCount: 0, reason: '无效的补丁规格' };
}

/**
 * Pipeline Coordinator 状态机
 */
class PipelineCoordinator {
  constructor(options = {}) {
    this.id = options.id || `pipeline-${Date.now()}`;
    this.state = PIPELINE_STATES.INIT;
    this.history = [{ state: this.state, timestamp: Date.now(), metadata: options }];
    this.maxRetries = options.maxRetries ?? 3;
    this.initialBackoffMs = options.initialBackoffMs ?? 50;
    this.chapterContent = '';
    this.auditResults = null;
    this.patchHistory = [];
  }

  getState() {
    return this.state;
  }

  getHistory() {
    return [...this.history];
  }

  transitionTo(nextState, metadata = {}) {
    const validTransitions = {
      [PIPELINE_STATES.INIT]: [PIPELINE_STATES.GENERATING, PIPELINE_STATES.FAILED],
      [PIPELINE_STATES.GENERATING]: [PIPELINE_STATES.VALIDATING, PIPELINE_STATES.FAILED],
      [PIPELINE_STATES.VALIDATING]: [PIPELINE_STATES.COMMITTED, PIPELINE_STATES.REVISING, PIPELINE_STATES.FAILED],
      [PIPELINE_STATES.REVISING]: [PIPELINE_STATES.VALIDATING, PIPELINE_STATES.COMMITTED, PIPELINE_STATES.FAILED],
      [PIPELINE_STATES.COMMITTED]: [],
      [PIPELINE_STATES.FAILED]: [PIPELINE_STATES.INIT]
    };

    const allowed = validTransitions[this.state] || [];
    if (!allowed.includes(nextState)) {
      throw new Error(`非法状态迁移: 无法从 ${this.state} 迁移到 ${nextState}`);
    }

    this.state = nextState;
    this.history.push({ state: nextState, timestamp: Date.now(), metadata });
    return this.state;
  }

  /**
   * 带指数退避重试的任务执行器
   */
  async executeWithRetry(actionName, taskFn, customRetries = null) {
    const retries = customRetries ?? this.maxRetries;
    let attempt = 0;
    let lastError = null;

    while (attempt <= retries) {
      try {
        const result = await taskFn(attempt);
        return result;
      } catch (err) {
        attempt += 1;
        lastError = err;
        if (attempt > retries) {
          break;
        }
        // 指数退避: initialBackoff * (2 ^ (attempt - 1))
        const backoffMs = this.initialBackoffMs * Math.pow(2, attempt - 1);
        await new Promise(res => setTimeout(res, backoffMs));
      }
    }

    throw new Error(`[${actionName}] 重试 ${retries} 次后失败: ${lastError?.message}`);
  }

  /**
   * 执行增量局部修订 (Diff-based Patching)
   */
  applyRevisionPatch(patchSpec) {
    this.transitionTo(PIPELINE_STATES.REVISING, { patchSpec });
    const patchResult = applyHunkPatch(this.chapterContent, patchSpec);

    if (patchResult.success) {
      this.chapterContent = patchResult.patchedText;
      this.patchHistory.push(patchSpec);
      this.transitionTo(PIPELINE_STATES.VALIDATING, { patchResult });
      return patchResult;
    }

    this.transitionTo(PIPELINE_STATES.FAILED, { reason: patchResult.reason });
    return patchResult;
  }

  commit(finalAudit = null) {
    this.auditResults = finalAudit;
    this.transitionTo(PIPELINE_STATES.COMMITTED, { finalAudit });
    return {
      id: this.id,
      state: this.state,
      contentLength: this.chapterContent.length,
      patchCount: this.patchHistory.length,
      historyLength: this.history.length
    };
  }
}

module.exports = {
  PIPELINE_STATES,
  PipelineCoordinator,
  parseDecoupledStream,
  applyHunkPatch
};
