const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const importSource = fs.readFileSync(path.join(__dirname, '..', 'completion-import.js'), 'utf8');

function extractSource(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `找不到函数起点：${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `找不到函数终点：${endMarker}`);
  return source.slice(start, end);
}

const chatTextSource = extractSource(indexSource, 'async function requestChatText', 'async function requestEditorAnswer');
const streamingChatSource = extractSource(importSource, 'async function requestStreamingChat', 'function knowledgeDataFromModel');

function makeWindow() {
  return {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: id => clearTimeout(id),
    addEventListener() {},
    removeEventListener() {}
  };
}

function loadChatText() {
  const factory = new Function('backendState', 'captureBackendSession', 'isCurrentBackendSession', 'BACKEND_BASE', 'currentUnifiedModel', 'window', `
    ${chatTextSource}
    return requestChatText;
  `);
  return factory(
    { token: 'test-token' },
    () => ({}),
    () => true,
    'http://127.0.0.1:0',
    () => 'test-model',
    makeWindow()
  );
}

function loadStreamingChat() {
  const factory = new Function('backendState', 'captureImportSession', 'isCurrentImportSession', 'sessionChangedError', 'currentUnifiedModel', 'window', `
    const BACKEND_BASE = 'http://127.0.0.1:0';
    ${streamingChatSource}
    return requestStreamingChat;
  `);
  return factory(
    { token: 'test-token' },
    () => ({}),
    () => true,
    () => Object.assign(new Error('登录账户已切换'), { code: 'SESSION_CHANGED' }),
    () => 'test-model',
    makeWindow()
  );
}

function sseChunks(textParts) {
  const encoder = new TextEncoder();
  const frames = textParts.map(part => `data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
  frames.push('data: {"molan_usage":{"totalTokens":42}}\n\n');
  frames.push('data: [DONE]\n\n');
  return frames.map(frame => encoder.encode(frame));
}

const abortError = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });

// 模拟真实 fetch 的分片读取：等待下一片期间连接被 abort 时以 AbortError 拒绝。
function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (!ms) return resolve();
    const timer = setTimeout(() => {
      signal && signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal && signal.addEventListener('abort', onAbort, { once: true });
  });
}

function streamingResponse(chunks, { intervalMs = 0, stallForeverAfter = Infinity, signal = null } = {}) {
  let index = 0;
  return {
    ok: true,
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) return { done: true, value: undefined };
            if (index >= stallForeverAfter) {
              return new Promise((_, reject) => {
                if (signal && signal.aborted) return reject(signal.reason || abortError());
                signal && signal.addEventListener('abort', () => reject(signal.reason || abortError()), { once: true });
              });
            }
            await abortableDelay(intervalMs, signal);
            if (signal && signal.aborted) throw (signal.reason || abortError());
            return { done: false, value: chunks[index++] };
          }
        };
      }
    }
  };
}

test('创书长流式生成持续吐字时不会被固定总时长误判为超时', async () => {
  const originalFetch = globalThis.fetch;
  try {
    // 6 个分片、每片间隔 120ms，总时长 720ms 远超 300ms 的超时配置；
    // 旧实现按固定总时长计时会在此中途中止，新实现按空闲计时应正常完成。
    const chunks = sseChunks(['创', '作', '包', '流', '式', '完成']);
    globalThis.fetch = async (url, options = {}) => streamingResponse(chunks, { intervalMs: 120, signal: options.signal });
    const requestChatText = loadChatText();
    const result = await requestChatText(
      [{ role: 'user', content: '生成创作包' }],
      { stage: 'writing', maxTokens: 6000, timeoutMs: 300, jsonMode: true, returnUsage: true, requireUsage: true }
    );
    assert.equal(result.text, '创作包流式完成');
    assert.equal(result.usage.totalTokens, 42);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('流式连接真正停滞时仍会按空闲超时中止', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const chunks = sseChunks(['开头']);
    globalThis.fetch = async (url, options = {}) => streamingResponse(chunks, { stallForeverAfter: 1, signal: options.signal });
    const requestChatText = loadChatText();
    await assert.rejects(
      requestChatText([{ role: 'user', content: '生成创作包' }], { stage: 'writing', timeoutMs: 200, returnUsage: true }),
      error => error.code === 'REQUEST_TIMEOUT'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('拆书抽取流式请求同样按空闲计时，长任务不再被固定时长中止', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const chunks = sseChunks(['知', '识', '抽', '取', '完', '成']);
    globalThis.fetch = async (url, options = {}) => streamingResponse(chunks, { intervalMs: 100, signal: options.signal });
    const requestStreamingChat = loadStreamingChat();
    const result = await requestStreamingChat([{ role: 'user', content: '抽取知识' }], { timeoutMs: 150 });
    assert.equal(result.text, '知识抽取完成');
    assert.equal(result.usage.totalTokens, 42);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
