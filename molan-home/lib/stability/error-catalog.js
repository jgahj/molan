'use strict';

/**
 * 集中化错误目录与客户端恢复指引 (Error Catalog & Guidance)
 *
 * 建立全系统唯一的错误码分类账，映射每一个错误到：
 * - HTTP 响应状态码 (httpStatus)
 * - 是否可安全重试 (retryable)
 * - 是否为结果未知的 Provider 状态 (unknown)
 * - 用户友好提示语 (userMessage)
 * - 客户端/作者解决建议 (resolutionGuidance)
 * - 错误类别 (category)
 */

const ERROR_CATALOG = Object.freeze({
  // --- 契约与输入错误 (Client / Contract) ---
  GENRE_UNCERTAIN: {
    code: 'GENRE_UNCERTAIN',
    httpStatus: 422,
    retryable: false,
    unknown: false,
    category: 'client',
    userMessage: '请确认作品题材后继续',
    resolutionGuidance: '作品尚未选定有效题材或题材路由存在冲突，请在编辑器或题材面板中选择标准题材。'
  },
  STYLE_UNCERTAIN: {
    code: 'STYLE_UNCERTAIN',
    httpStatus: 422,
    retryable: false,
    unknown: false,
    category: 'client',
    userMessage: '请确认作品文风后继续',
    resolutionGuidance: '未检测到明确文风原型，请在文风配置中显式指定文风或选择由系统推荐的原型。'
  },
  CONTRACT_INVALID: {
    code: 'CONTRACT_INVALID',
    httpStatus: 422,
    retryable: false,
    unknown: false,
    category: 'client',
    userMessage: '章节合同不完整或格式无效',
    resolutionGuidance: '请检查章节目标 (chapterGoal)、出场人物 (characters)、字数预算或场景规划，确保满足契约规范。'
  },
  BIBLE_CONSTRAINT_VIOLATION: {
    code: 'BIBLE_CONSTRAINT_VIOLATION',
    httpStatus: 422,
    retryable: false,
    unknown: false,
    category: 'contract',
    userMessage: '内容违背创作圣经核心设定或实体约束',
    resolutionGuidance: '正文或规划与世界观公理、人物金手指或禁忌规则冲突，请修正设定后重新生成。'
  },

  // --- 上下文与配额 (Budget / Context) ---
  CONTEXT_OVERFLOW: {
    code: 'CONTEXT_OVERFLOW',
    httpStatus: 413,
    retryable: false,
    unknown: false,
    category: 'budget',
    userMessage: '上下文超过预算，请精简后重试',
    resolutionGuidance: '必要上下文总 Token 超过当前模型窗口硬上限，请缩减出场人物背景、远期因果债或场景数量。'
  },
  BUDGET_EXCEEDED: {
    code: 'BUDGET_EXCEEDED',
    httpStatus: 402,
    retryable: false,
    unknown: false,
    category: 'budget',
    userMessage: '创作额度不足',
    resolutionGuidance: '当前账户积分或代币预算已耗尽，请充值或调整额度配额后继续。'
  },

  // --- 并发与状态机 (Concurrency & State) ---
  CONCURRENCY_LOCKED: {
    code: 'CONCURRENCY_LOCKED',
    httpStatus: 409,
    retryable: true,
    unknown: false,
    category: 'concurrency',
    userMessage: '当前项目存在正在运行的生成或修订任务，请稍后重试',
    resolutionGuidance: '每个项目同一时间只允许一个活跃的生成或修订运行，请等待当前任务完成或释放锁。'
  },
  STATE_CONFLICT: {
    code: 'STATE_CONFLICT',
    httpStatus: 409,
    retryable: true,
    unknown: false,
    category: 'state',
    userMessage: '生成任务状态已变化，请刷新后重试',
    resolutionGuidance: '当前任务状态已被其他请求更新，请获取最新状态快照后重试。'
  },
  CHAPTER_POSITION_CONFLICT: {
    code: 'CHAPTER_POSITION_CONFLICT',
    httpStatus: 409,
    retryable: false,
    unknown: false,
    category: 'state',
    userMessage: '章节编号与服务端权威目录位置不一致',
    resolutionGuidance: '客户端传入的章节序号与服务端权威作品结构树中的章节物理位置产生冲突，为防止大纲与上下文错位已阻断生成。请刷新目录重新提交。'
  },
  INVALID_STATE_TRANSITION: {
    code: 'INVALID_STATE_TRANSITION',
    httpStatus: 409,
    retryable: false,
    unknown: false,
    category: 'state',
    userMessage: '生成任务状态冲突',
    resolutionGuidance: '请求的状态机流转不合法，状态机已拒绝非法跃迁。'
  },
  IDEMPOTENCY_KEY_REUSED: {
    code: 'IDEMPOTENCY_KEY_REUSED',
    httpStatus: 409,
    retryable: false,
    unknown: false,
    category: 'state',
    userMessage: '该幂等键已用于其他请求',
    resolutionGuidance: '幂等键 Payload 摘要不一致，请生成新的幂等键或重用先前请求参数。'
  },
  RUN_NOT_FOUND: {
    code: 'RUN_NOT_FOUND',
    httpStatus: 404,
    retryable: false,
    unknown: false,
    category: 'state',
    userMessage: '生成任务不存在或无权访问',
    resolutionGuidance: '指定的 runId 记录不存在，请确认任务 ID 是否正确。'
  },

  // --- 模型与供应商 (Provider / Stability) ---
  CIRCUIT_BREAKER_OPEN: {
    code: 'CIRCUIT_BREAKER_OPEN',
    httpStatus: 503,
    retryable: false,
    unknown: false,
    category: 'provider',
    userMessage: '模型服务熔断器已开启，暂停下游请求以防止拥堵',
    resolutionGuidance: '上游模型供应商近期故障率或超时率过高，系统已熔断保护，请在冷却期过后重试或切换备用模型。'
  },
  MODEL_TIMEOUT: {
    code: 'MODEL_TIMEOUT',
    httpStatus: 504,
    retryable: false,
    unknown: true,
    category: 'provider',
    userMessage: '模型请求超时，结果可能未知，请先查询任务状态',
    resolutionGuidance: '模型推理超出单次调用超时时限，为防止重发导致费用重复计费，请查询任务状态确认是否已由异步流接管。'
  },
  MODEL_429: {
    code: 'MODEL_429',
    httpStatus: 429,
    retryable: true,
    unknown: false,
    category: 'provider',
    userMessage: '模型服务繁忙，请稍后重试',
    resolutionGuidance: '模型服务商速率达到上限，系统将在退避后自动重试。'
  },
  MODEL_5XX: {
    code: 'MODEL_5XX',
    httpStatus: 502,
    retryable: true,
    unknown: false,
    category: 'provider',
    userMessage: '模型服务暂时不可用',
    resolutionGuidance: '模型服务商返回内部服务器错误，系统将尝试备用节点或重试。'
  },
  MODEL_EMPTY: {
    code: 'MODEL_EMPTY',
    httpStatus: 502,
    retryable: true,
    unknown: false,
    category: 'provider',
    userMessage: '模型未返回正文',
    resolutionGuidance: '模型完成响应但正文为空，请检查提示词或降低温度后重试。'
  },
  MODEL_TRUNCATED: {
    code: 'MODEL_TRUNCATED',
    httpStatus: 502,
    retryable: true,
    unknown: false,
    category: 'provider',
    userMessage: '模型返回内容不完整',
    resolutionGuidance: '模型输出在未完成章节结尾时提前截断，请检查 maxOutputTokens 设置。'
  },
  MODEL_CONTENT_BLOCKED: {
    code: 'MODEL_CONTENT_BLOCKED',
    httpStatus: 422,
    retryable: false,
    unknown: false,
    category: 'provider',
    userMessage: '生成内容未通过服务处理',
    resolutionGuidance: '生成请求或返回内容触及安全审查或结构校验失败，请修改引导词。'
  },
  USAGE_UNKNOWN: {
    code: 'USAGE_UNKNOWN',
    httpStatus: 502,
    retryable: false,
    unknown: true,
    category: 'provider',
    userMessage: '模型用量尚未确认，请勿自动重试',
    resolutionGuidance: '网络中断导致供应商 Token 计费未确认，请通过后台对账确认。'
  },
  PROVIDER_UNKNOWN: {
    code: 'PROVIDER_UNKNOWN',
    httpStatus: 502,
    retryable: false,
    unknown: true,
    category: 'provider',
    userMessage: '模型请求结果未知，请勿自动重试',
    resolutionGuidance: '租约丢失或连接断开，正文可能已在生成中，请先核对生成结果再操作。'
  },
  STAGE_TIMEOUT: {
    code: 'STAGE_TIMEOUT',
    httpStatus: 504,
    retryable: false,
    unknown: true,
    category: 'provider',
    userMessage: '任务执行阶段超时',
    resolutionGuidance: '特定子阶段（如规划、审计或修订）执行超出时限，请检查网络或精简任务。'
  },
  RUN_TIMEOUT: {
    code: 'RUN_TIMEOUT',
    httpStatus: 504,
    retryable: false,
    unknown: true,
    category: 'provider',
    userMessage: '任务整体执行超时',
    resolutionGuidance: '整个生成流程耗时超过全局死线（8-10分钟），系统已安全熔断中断。'
  },

  // --- 质量与审计门禁 (Quality Gate / Review) ---
  QUALITY_UNMEASURED: {
    code: 'QUALITY_UNMEASURED',
    httpStatus: 422,
    retryable: false,
    unknown: false,
    category: 'quality',
    userMessage: '正文文学质量未真实测量或证据不足，需要人工复核',
    resolutionGuidance: '系统拒绝以纯统计指标或假通过作为质量依据，质量评测缺失或未达到阈值时必须经人工复核。'
  },
  DUAL_JUDGE_DISCREPANCY: {
    code: 'DUAL_JUDGE_DISCREPANCY',
    httpStatus: 422,
    retryable: false,
    unknown: false,
    category: 'quality',
    userMessage: '双评委语义分歧过大，已转入人工复核',
    resolutionGuidance: '双独立评委评分差值超过容差（>0.18）或结论冲突，为保障小说文学水准已交由人工裁定。'
  },
  AUDIT_BLOCKED: {
    code: 'AUDIT_BLOCKED',
    httpStatus: 422,
    retryable: false,
    unknown: false,
    category: 'quality',
    userMessage: '正文未通过审计，需要人工复核',
    resolutionGuidance: '确定性审计或语义审计检测到硬性拦截项且无法自动修复，请进入编辑器人工调整。'
  },
  REVISION_EXHAUSTED: {
    code: 'REVISION_EXHAUSTED',
    httpStatus: 422,
    retryable: false,
    unknown: false,
    category: 'quality',
    userMessage: '局部修订次数已用完，需要人工复核',
    resolutionGuidance: '已达到最大局部修订轮次上限但仍有未解决问题，已安全暂停等待作者确认。'
  },
  HUMAN_REVIEW_REQUIRED: {
    code: 'HUMAN_REVIEW_REQUIRED',
    httpStatus: 422,
    retryable: false,
    unknown: false,
    category: 'quality',
    userMessage: '当前章节需要作者确认或人工复核',
    resolutionGuidance: '系统完成了审计与质量分析，请作者查阅审计证据与建议后决定是否采纳。'
  },

  // --- 缓存与基础设施 (Cache / System) ---
  CACHE_CORRUPTED: {
    code: 'CACHE_CORRUPTED',
    httpStatus: 500,
    retryable: false,
    unknown: false,
    category: 'system',
    userMessage: '缓存数据解析损坏',
    resolutionGuidance: '世界观或文风缓存校验哈希不匹配，已自动作废并重新从真源编译。'
  }
});

const ALL_ERROR_CODES = Object.freeze(Object.keys(ERROR_CATALOG));

/** 获取错误定义的完整详情，未知错误码退回通用 MODEL_CONTENT_BLOCKED。 */
function getErrorDefinition(code) {
  const normalized = String(code || '').trim();
  if (ERROR_CATALOG[normalized]) {
    return ERROR_CATALOG[normalized];
  }
  return {
    code: normalized || 'UNKNOWN_ERROR',
    httpStatus: 500,
    retryable: false,
    unknown: false,
    category: 'system',
    userMessage: '生成任务失败',
    resolutionGuidance: '发生未知错误，请检查系统日志。'
  };
}

/** 判断给定的错误码是否属于可安全重试的操作。 */
function isRetryable(code) {
  const def = getErrorDefinition(code);
  return def.retryable === true;
}

/** 判断错误码是否代表 Provider 结果未知的挂起状态。 */
function isUnknownState(code) {
  const def = getErrorDefinition(code);
  return def.unknown === true;
}

/** 格式化为 API 标准响应体。 */
function formatApiError(code, customMessage, details) {
  const def = getErrorDefinition(code);
  return {
    error: {
      code: def.code,
      message: customMessage || def.userMessage,
      resolutionGuidance: def.resolutionGuidance,
      retryable: def.retryable,
      unknown: def.unknown,
      category: def.category,
      ...(details && typeof details === 'object' ? { details } : {})
    }
  };
}

module.exports = {
  ERROR_CATALOG,
  ALL_ERROR_CODES,
  getErrorDefinition,
  isRetryable,
  isUnknownState,
  formatApiError
};
