'use strict';

/**
 * real-novel-generator.js
 * ---------------------------------------------------------------------------
 * 真实大模型小说生成引擎 (Live Model Novel Generation Engine)
 *
 * 职责：
 * 1. 真实登录本地墨阑服务 (http://127.0.0.1:3000)；
 * 2. 真实调用项目配置的写作模型 (如 gpt-5.6-luna)；
 * 3. 实时解耦并解析流式 SSE 事件，彻底过滤计费控制帧，防止截断与解析崩溃；
 * 4. 自动管理磁盘持久化缓存，杜绝重复调用，完整保存真实生成小说正文与调用元数据。
 * ---------------------------------------------------------------------------
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseDecoupledStream } = require('./generation-pipeline-coordinator');

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
const DEFAULT_EMAIL = '1271055010@qq.com';
const DEFAULT_PASSWORD = '123456';
const DEFAULT_MODEL = 'gpt-5.6-luna';

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * 获取本地服务登录凭证
 */
async function getAuthToken(baseUrl = DEFAULT_BASE_URL, email = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) {
    return cachedToken;
  }

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15000)
  });

  if (!loginRes.ok) {
    throw new Error(`登录失败 HTTP ${loginRes.status}: ${await loginRes.text()}`);
  }

  const data = await loginRes.json();
  if (!data.token) {
    throw new Error('服务未返回有效 Token');
  }

  cachedToken = data.token;
  tokenExpiresAt = now + 3600 * 1000; // 缓存 1 小时
  return cachedToken;
}

/**
 * 真实调用模型生成小说章节
 * @param {Object} params 生成参数
 * @returns {Promise<Object>} 生成结果与正文
 */
async function generateRealChapter(params = {}) {
  const baseUrl = params.baseUrl || DEFAULT_BASE_URL;
  const model = params.model || DEFAULT_MODEL;
  const prompt = params.prompt || '';
  const systemPrompt = params.systemPrompt || '你是中文小说作者。按用户提示写完整小说正文，只交付标题及正文，严禁前言后记与AI自我分析。';
  const genre = params.genre || '通用';
  const maxTokens = params.maxTokens || 2000;
  const temperature = params.temperature || 0.75;
  const cacheDir = params.cacheDir || path.resolve(__dirname, '../data/evaluation-input/ground-truth-benchmarks/real-generated-chapters');

  // 1. 计算 Prompt 唯一哈希，优先检索本地真实缓存
  const promptHash = crypto.createHash('sha256').update(prompt + '||' + model + '||' + systemPrompt).digest('hex').slice(0, 16);
  const cacheFile = path.join(cacheDir, `${params.bookTitle || 'novel'}-${params.stage || 'stage'}-${params.variant || 'v'}-${promptHash}.json`);

  if (!params.forceRegenerate && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (cached && cached.content && cached.content.length > 100) {
        return {
          ...cached,
          isFromCache: true
        };
      }
    } catch (_) {}
  }

  // 2. 真实登录
  const token = await getAuthToken(baseUrl);

  // 3. 发送真实生成请求
  const startTime = Date.now();
  let retryCount = 0;
  let lastError = null;

  while (retryCount < 5) {
    try {
      const chatRes = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(180000), // 3分钟超时
        body: JSON.stringify({
          model,
          stage: 'writing',
          genre,
          max_tokens: maxTokens,
          temperature,
          twoPassHumanize: false,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
          ]
        })
      });

      if (!chatRes.ok) {
        const errText = await chatRes.text();
        throw new Error(`模型调用 HTTP ${chatRes.status}: ${errText}`);
      }

      const rawStream = await chatRes.text();
      const parsed = parseDecoupledStream(rawStream);

      if (!parsed.content || parsed.content.trim().length < 50) {
        throw new Error(`模型返回正文为空或过短 (${parsed.content?.length || 0} 字符)`);
      }

      const durationMs = Date.now() - startTime;
      const cleanContent = parsed.content.trim().replace(/^```(?:markdown|md)?\s*\n/, '').replace(/\n```\s*$/, '');

      const result = {
        ok: true,
        model,
        promptHash,
        bookTitle: params.bookTitle,
        genre,
        stage: params.stage,
        variant: params.variant,
        content: cleanContent,
        charCount: cleanContent.length,
        durationMs,
        usage: parsed.usage,
        removedBillingEvents: parsed.removedBillingEvents,
        generatedAt: new Date().toISOString(),
        isFromCache: false
      };

      // 写入持久化真实缓存
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2), 'utf8');

      return result;
    } catch (err) {
      retryCount += 1;
      lastError = err;
      const is429 = err.message && err.message.includes('429');
      const waitTime = is429 ? 5000 * retryCount : 2000 * retryCount;
      await new Promise(r => setTimeout(r, waitTime));
    }
  }

  throw new Error(`真实模型生成失败（已重试5次）: ${lastError?.message}`);
}

module.exports = {
  getAuthToken,
  generateRealChapter
};
