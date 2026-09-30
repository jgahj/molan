/**
 * @deprecated
 * ⚠️【历史组件说明 / DEPRECATED】
 * 本文件定义的 PipelineCoordinator 与 PIPELINE_STATES 是早期单体实验使用的管线状态机。
 * 当前生产生成主链路已完全统一收敛至：
 * 1. 唯一业务状态机：lib/generation/state-machine.js
 * 2. 唯一生产编排器：lib/generation/orchestrator.js
 * 3. 唯一正文起草引擎：lib/generation/content-engine.js
 * 生产入口（server.js /api/generation-runs）严禁调用本模块。
 * 本模块仅保留给离线测试和流解析工具函数 (parseDecoupledStream, applyHunkPatch)。
 */

const RETRY_POLICIES = Object.freeze({
  RETRYABLE: 'retryable',
  NON_RETRYABLE: 'non_retryable',
  UNKNOWN: 'unknown'
});

/**
 * 严格分类错误类型，杜绝任意异常自动重试与未知结果重复生成：
 * 1. RETRYABLE: 限流 (429)、服务不可用 (503)、连接未建立时的瞬态网络抖动 (ECONNRESET, ETIMEDOUT 等)
 * 2. UNKNOWN: 请求已发出但未收到完整确认、流中断、超时未知、PROVIDER_UNKNOWN 等
 * 3. NON_RETRYABLE: 客户端参数错误 (400, 422, 428)、鉴权 (401, 403)、状态冲突 (409)、正文越界 (413)、语义门禁拦截等
 */
function classifyError(err) {
  if (!err) return RETRY_POLICIES.NON_RETRYABLE;

  if (err.unknown === true || err.code === 'PROVIDER_UNKNOWN' || (err.status === 502 && err.unknown)) {
    return RETRY_POLICIES.UNKNOWN;
  }
  if (err.retryable === false) {
    return RETRY_POLICIES.NON_RETRYABLE;
  }
  if (err.retryable === true) {
    return RETRY_POLICIES.RETRYABLE;
  }

  const message = String(err.message || '');
  const code = String(err.code || '');
  const status = Number(err.status || err.statusCode || 0);

  // 1. 明确的未知状态 (UNKNOWN) -> 绝不自动重试
  if (code === 'PROVIDER_UNKNOWN' || /provider.*unknown|结果未知|未确认/i.test(message)) {
    return RETRY_POLICIES.UNKNOWN;
  }

  // 2. 明确的非重试状态 (NON_RETRYABLE)
  if ([400, 401, 403, 404, 409, 413, 422, 428].includes(status)) {
    return RETRY_POLICIES.NON_RETRYABLE;
  }
  if (['CONTRACT_INVALID', 'STATE_CONFLICT', 'IDEMPOTENCY_KEY_REQUIRED', 'IDEMPOTENCY_KEY_REUSED', 'CONTEXT_OVERFLOW', 'AUDIT_BLOCKED', 'MODEL_CONTENT_BLOCKED'].includes(code)) {
    return RETRY_POLICIES.NON_RETRYABLE;
  }

  // 3. 明确的可重试状态 (RETRYABLE)
  if (status === 429 || status === 503) {
    return RETRY_POLICIES.RETRYABLE;
  }
  if (['RATE_LIMIT_EXCEEDED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return RETRY_POLICIES.RETRYABLE;
  }
  if (/(?:ETIMEDOUT|ECONNRESET|网络瞬态抖动|rate limit|429|503)/i.test(message)) {
    return RETRY_POLICIES.RETRYABLE;
  }

  // 默认不可重试，防止将未知逻辑错误盲目重试
  return RETRY_POLICIES.NON_RETRYABLE;
}

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
   * 带明确错误分类审查的重试任务执行器：
   * - RETRYABLE: 指数退避重试；
   * - NON_RETRYABLE: 立即阻断抛出，绝不重试；
   * - UNKNOWN: 立即判定为 PROVIDER_UNKNOWN 并抛出，严禁自动重复调用。
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
        lastError = err;
        const policy = classifyError(err);

        // 如果是不可重试错误或未知状态，绝对不进行自动重试，立即向上抛出
        if (policy === RETRY_POLICIES.NON_RETRYABLE) {
          throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
            retryPolicy: RETRY_POLICIES.NON_RETRYABLE,
            actionName
          });
        }
        if (policy === RETRY_POLICIES.UNKNOWN) {
          throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
            retryPolicy: RETRY_POLICIES.UNKNOWN,
            code: 'PROVIDER_UNKNOWN',
            unknown: true,
            actionName
          });
        }

        attempt += 1;
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
  RETRY_POLICIES,
  classifyError,
  parseDecoupledStream,
  applyHunkPatch
};
