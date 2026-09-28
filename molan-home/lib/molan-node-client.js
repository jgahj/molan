'use strict';

const DEFAULT_BASE_URL = process.env.MOLAN_BASE_URL || 'http://127.0.0.1:3000';

function localBaseUrl(value = DEFAULT_BASE_URL) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('仅允许无凭据的本机回环服务地址');
  return url.origin;
}

function sseTextOf(packet) {
  const choice = Array.isArray(packet.choices) ? packet.choices[0] : null;
  if (!choice) return '';
  if (typeof choice.delta?.content === 'string') return choice.delta.content;
  if (typeof choice.message?.content === 'string') return choice.message.content;
  return typeof choice.text === 'string' ? choice.text : '';
}

function parseChatStream(rawStream) {
  let text = '';
  let usage = null;
  let correctionAudit = null;
  let finishReason = '';
  let done = false;
  for (const event of String(rawStream || '').split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim();
    if (!data) continue;
    if (data === '[DONE]') { done = true; continue; }
    let packet;
    try { packet = JSON.parse(data); } catch (_) { throw Object.assign(new Error('流事件JSON损坏，结果未知，不自动重试'), { code: 'stream_invalid' }); }
    if (packet.error || packet.molan_error) throw Object.assign(new Error('生成流返回错误，结果未知，不自动重试'), { code: 'stream_error' });
    if (packet.molan_usage) usage = packet.molan_usage;
    correctionAudit = packet.molan_correction_audit || packet.molan_usage?.correctionAudit || correctionAudit;
    const choice = Array.isArray(packet.choices) ? packet.choices[0] : null;
    if (choice?.finish_reason) finishReason = String(choice.finish_reason);
    text += sseTextOf(packet);
  }
  if (!text.trim() || !done || ['content_filter', 'error'].includes(finishReason)) throw Object.assign(new Error('正文为空、流不完整或被截断，结果未知'), { code: 'stream_incomplete' });
  if (finishReason === 'length' && text.trim().length < 500) throw Object.assign(new Error('正文过短且被截断，结果未知'), { code: 'stream_incomplete' });
  if (!usage || Number(usage.totalTokens ?? usage.total_tokens) <= 0 || ['missing', 'failed'].includes(usage.status)) throw Object.assign(new Error('缺少有效用量凭证，不计为成功'), { code: 'usage_missing' });
  if (usage.status === 'truncated' && text.trim().length < 500) throw Object.assign(new Error('用量凭证截断且正文过短，不计为成功'), { code: 'usage_missing' });
  return { text: text.trim(), usage, correctionAudit, finishReason };
}

async function verifyLocalStorage(baseUrl) {
  const origin = localBaseUrl(baseUrl);
  const response = await fetch(origin + '/api/benchmark/capabilities', { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('本地服务尚未提供安全评测能力，请使用已更新的本地服务');
  const payload = await response.json();
  if (payload.localStorage !== true || payload.cloudProxy !== false || payload.protocol !== 'benchmark-local-v2') throw new Error('服务未确认仅本地写入，已停止请求');
  return origin;
}

async function login(options = {}) {
  const baseUrl = await verifyLocalStorage(options.baseUrl || DEFAULT_BASE_URL);
  const token = options.token || process.env.MOLAN_TOKEN;
  if (token) return { token, baseUrl };
  const email = options.email || process.env.MOLAN_EMAIL;
  const password = options.password || process.env.MOLAN_PASSWORD;
  if (!email || !password) throw new Error('请通过环境变量提供本地会话或登录信息，不使用内置凭据');
  const response = await fetch(baseUrl + '/api/auth/login', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('本地登录失败 HTTP ' + response.status);
  const payload = await response.json();
  if (!payload.token) throw new Error('登录响应缺少会话');
  return { token: payload.token, baseUrl };
}

function parseLooseJson(text) {
  const source = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(source); } catch (_) { return null; }
}

async function requestJson(session, pathname, body, options = {}) {
  if (!/^\/api\/benchmark\/[a-z-]+$/.test(pathname)) throw new Error('评测客户端只允许本地评测API');
  const baseUrl = await verifyLocalStorage(session.baseUrl);
  const response = await fetch(baseUrl + pathname, { method: body == null ? 'GET' : 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token }, ...(body == null ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(options.timeoutMs || 900000) });
  if (!response.ok) throw Object.assign(new Error('本地评测请求失败 HTTP ' + response.status + '，不自动重试'), { code: 'request_failed_or_unknown', status: response.status });
  return response.json();
}

async function chat(session, options = {}) {
  const baseUrl = await verifyLocalStorage(session.baseUrl);
  const body = { messages: options.messages, stage: options.stage || 'single', max_tokens: options.maxTokens || 4096, temperature: options.temperature ?? 0.8, twoPassHumanize: false, model: options.model, genre: options.genre, jsonMode: options.jsonMode === true, thinking: options.thinking === true };
  const response = await fetch(baseUrl + '/api/chat', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token }, body: JSON.stringify(body), signal: AbortSignal.timeout(options.timeoutMs || 900000) });
  if (!response.ok) throw Object.assign(new Error('本地生成请求失败 HTTP ' + response.status), { code: 'request_failed_or_unknown' });
  const parsed = parseChatStream(await response.text());
  return options.jsonMode ? { ...parsed, json: parseLooseJson(parsed.text) } : parsed;
}

async function chatWithRetry(session, options) {
  return chat(session, options);
}

module.exports = { DEFAULT_BASE_URL, localBaseUrl, verifyLocalStorage, login, requestJson, chat, chatWithRetry, parseChatStream, parseLooseJson, sseTextOf };
