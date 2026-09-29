'use strict';

const { GenerationError } = require('./errors');
const { hashValue, stableValue } = require('./manifest');

const MAX_IDEMPOTENCY_KEY = 160;
const MAX_RUN_PAYLOAD_BYTES = 2 * 1024 * 1024;

/** 验证生成请求并剔除仅用于传输的字段，供幂等散列和恢复使用。 */
function normalizeGenerationRequest(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new GenerationError('CONTRACT_INVALID', '生成请求必须是 JSON 对象', { status: 400 });
  }
  const projectId = String(input.projectId || input.novelId || '').trim();
  const chapterId = String(input.chapterId || '').trim();
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const normalizedMessages = messages.slice(-128).map(message => ({
    role: ['system', 'user', 'assistant'].includes(String(message && message.role)) ? String(message.role) : 'user',
    content: String(message && message.content || '').slice(0, 200000)
  }));
  const idempotencyKey = String(input.idempotencyKey || input.requestId || '').trim();
  if (!projectId) throw new GenerationError('CONTRACT_INVALID', '缺少 projectId', { status: 400 });
  if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY || /[\u0000-\u001f\u007f]/.test(idempotencyKey)) {
    throw new GenerationError('CONTRACT_INVALID', '缺少有效的 Idempotency-Key', { status: 400 });
  }
  const contract = input.contract && typeof input.contract === 'object'
    ? stableValue(input.contract)
    : input.chapterContract && typeof input.chapterContract === 'object'
      ? stableValue(input.chapterContract)
      : null;
  const storyContext = input.storyContext && typeof input.storyContext === 'object'
    ? stableValue(input.storyContext)
    : {
        previousEnding: String(input.previousEnding || ''),
        factLedger: input.factLedger && typeof input.factLedger === 'object' ? stableValue(input.factLedger) : null,
        continuity: input.continuity && typeof input.continuity === 'object' ? stableValue(input.continuity) : null,
        characters: Array.isArray(input.characters) ? stableValue(input.characters) : [],
        planText: String(input.planText || '')
      };
  const request = {
    projectId,
    novelId: String(input.novelId || projectId),
    chapterId,
    sceneId: String(input.sceneId || '').trim(),
    creationBookId: String(input.creationBookId || '').trim(),
    modelId: String(input.modelId || input.model || '').trim(),
    reviseModelId: String(input.reviseModelId || '').trim(),
    genre: String(input.genre || '').trim(),
    subgenre: String(input.subgenre || '').trim(),
    style: String(input.style || input.stylePreset || '').trim(),
    userInstruction: String(input.userInstruction || input.prompt || '').slice(0, 30000),
    prompt: String(input.prompt || input.userInstruction || '').slice(0, 30000),
    writingSystem: String(input.writingSystem || '').slice(0, 80000),
    messages: normalizedMessages,
    contract,
    chapterContract: input.chapterContract && typeof input.chapterContract === 'object'
      ? stableValue(input.chapterContract)
      : contract,
    factLedger: input.factLedger && typeof input.factLedger === 'object' ? stableValue(input.factLedger) : null,
    continuity: input.continuity && typeof input.continuity === 'object' ? stableValue(input.continuity) : null,
    previousEnding: String(input.previousEnding || ''),
    planText: String(input.planText || ''),
    characters: Array.isArray(input.characters) ? stableValue(input.characters) : [],
    targetWords: Math.max(0, Math.floor(Number(input.targetWords) || 0)),
    control: input.control === true,
    controlSystem: String(input.controlSystem || '').slice(0, 80000),
    maxRounds: input.maxRounds == null ? 2 : Math.min(2, Math.max(0, Number(input.maxRounds) || 0)),
    modelParams: {
      ...(input.modelParams && typeof input.modelParams === 'object' ? stableValue(input.modelParams) : {}),
      temperature: Number.isFinite(Number(input.temperature)) ? Math.min(1.5, Math.max(0, Number(input.temperature))) : 0.8,
      topP: Number.isFinite(Number(input.topP)) ? Math.min(1, Math.max(0, Number(input.topP))) : null,
      seed: Number.isFinite(Number(input.seed)) ? Number(input.seed) : null,
      reasoningEffort: String(input.reasoningEffort || '').trim().toLowerCase(),
      targetWords: Math.max(0, Math.floor(Number(input.targetWords) || 0)),
      maxRounds: input.maxRounds == null ? 2 : Math.min(2, Math.max(0, Number(input.maxRounds) || 0))
    },
    sourceGenerationId: String(input.sourceGenerationId || ''),
    replay: input.replay === true
  };
  if (Buffer.byteLength(JSON.stringify(request), 'utf8') > MAX_RUN_PAYLOAD_BYTES) {
    throw new GenerationError('CONTEXT_OVERFLOW', '生成上下文超过 2 MB 限制', { status: 413 });
  }
  return { request, idempotencyKey };
}

/** 对规范化请求计算稳定摘要，排除 idempotency key 本身。 */
function requestHash(request) {
  return hashValue(request);
}

module.exports = { normalizeGenerationRequest, requestHash, MAX_RUN_PAYLOAD_BYTES };
