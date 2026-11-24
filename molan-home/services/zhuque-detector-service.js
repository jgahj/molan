'use strict';

const crypto = require('node:crypto');

const DEFAULT_API_URL = 'https://ai-gateway.edgeone.link/v1/providers/zhuque-text/classify';
const DEFAULT_TIMEOUT_MS = 12000;
const MIN_TEXT_CHARS = 350;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 128;

const cache = new Map();

function resolveEnv(env) {
  return env && typeof env === 'object' ? env : process.env;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function isZhuqueConfigured(env) {
  const runtimeEnv = resolveEnv(env);
  return Boolean(String(runtimeEnv.MAKERS_MODELS_KEY || '').trim());
}

function resolveApiUrl(env) {
  const runtimeEnv = resolveEnv(env);
  return String(runtimeEnv.MOLAN_ZHUQUE_API_URL || DEFAULT_API_URL).trim();
}

function cacheKey(text, isMerge) {
  return crypto.createHash('sha256').update(`${isMerge ? '1' : '0'}|${text}`).digest('hex');
}

function readCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return { ...hit.value };
}

function writeCache(key, value) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

function resetZhuqueCache() {
  cache.clear();
}

function normalizeResponse(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const status = String(raw.status || '').toLowerCase();
  const ratios = raw.labels_ratio && typeof raw.labels_ratio === 'object' ? raw.labels_ratio : {};
  const human = clamp01(ratios['0']);
  const ai = clamp01(ratios['1']);
  const suspected = clamp01(ratios['2']);
  const greenRatio = clamp01(human);
  const aiLikeRatio = clamp01(ai + suspected);
  const segments = Array.isArray(raw.segment_labels)
    ? raw.segment_labels.map((item, index) => {
      const label = Number(item && item.label) || 0;
      const conf = clamp01(item && item.conf);
      return {
        index: index + 1,
        text: typeof (item && item.text) === 'string' ? item.text : '',
        label,
        conf,
        // 官方接口实测：conf 即网页版“AIGC 值”（片段2 conf=0.3753，报告=0.3758）。
        // conf 越高越像 AI，不是标签概率，因此不能再做 1-conf 反转。
        aigc: conf,
        position: Array.isArray(item && item.position) ? item.position : null,
        green: label === 0 && conf <= 0.5
      };
    })
    : [];
  const riskConfidence = clamp01(raw.softmax_confidence);
  const usage = raw.makers_models_usage && typeof raw.makers_models_usage === 'object'
    ? raw.makers_models_usage
    : {};
  return {
    status: status === 'success' ? 'success' : status || 'unknown',
    ok: status === 'success',
    greenRatio,
    aiLikeRatio,
    aiScore: Math.round(aiLikeRatio * 1000) / 10,
    riskConfidence,
    ratioConfidence: clamp01(raw.ratio_confidence),
    segments,
    usage: {
      makersTokens: Number(usage.total_tokens) || 0,
      modelTokens: Number(raw.usage && raw.usage.total_tokens) || 0
    },
    msg: typeof raw.msg === 'string' ? raw.msg : '',
    raw
  };
}

function zhuqueGateReached(report, options = {}) {
  if (!report || !report.ok) return false;
  const minGreenRatio = Number(options.minGreenRatio) >= 0 && Number(options.minGreenRatio) <= 1
    ? Number(options.minGreenRatio)
    : 0.99;
  const maxSegmentAigc = Number(options.maxSegmentAigc) >= 0 && Number(options.maxSegmentAigc) <= 1
    ? Number(options.maxSegmentAigc)
    : 0.5;
  if (report.greenRatio < minGreenRatio) return false;
  const segments = Array.isArray(report.segments) ? report.segments : [];
  if (!segments.length) return report.aiLikeRatio <= (1 - minGreenRatio);
  return segments.every(segment => segment.green && segment.aigc <= maxSegmentAigc);
}

async function detectZhuque(text, options = {}) {
  const env = resolveEnv(options.env);
  if (!isZhuqueConfigured(env)) return null;
  const content = String(text == null ? '' : text).trim();
  if (content.length < MIN_TEXT_CHARS) {
    return { ok: false, status: 'too_short', error: `朱雀检测建议文本不少于 ${MIN_TEXT_CHARS} 字` };
  }
  const isMerge = options.isMerge !== false;
  const key = cacheKey(content, isMerge);
  const cached = readCache(key);
  if (cached) return { ...cached, cached: true };

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, status: 'unavailable', error: '当前运行时没有可用的 fetch 实现' };
  }
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(resolveApiUrl(env), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${String(env.MAKERS_MODELS_KEY).trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text: content, is_merge: isMerge }),
      ...(controller ? { signal: controller.signal } : {})
    });
    if (!response || !response.ok) {
      const code = response && response.status ? response.status : 0;
      return { ok: false, status: 'http_error', error: `朱雀接口返回 HTTP ${code}` };
    }
    const payload = await response.json();
    const normalized = normalizeResponse(payload);
    if (!normalized) return { ok: false, status: 'bad_response', error: '朱雀接口返回体无法解析' };
    if (!normalized.ok) {
      return { ...normalized, ok: false, error: normalized.msg || '朱雀接口返回非 success 状态' };
    }
    writeCache(key, normalized);
    return normalized;
  } catch (error) {
    const message = error && error.name === 'AbortError'
      ? `朱雀接口超时（${timeoutMs}ms）`
      : (error && error.message ? error.message : String(error));
    return { ok: false, status: 'network_error', error: message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  DEFAULT_API_URL,
  MIN_TEXT_CHARS,
  isZhuqueConfigured,
  normalizeResponse,
  zhuqueGateReached,
  detectZhuque,
  resetZhuqueCache
};
