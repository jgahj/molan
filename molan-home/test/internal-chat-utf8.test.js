'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const start = source.indexOf('async function callMolanChat(');
const end = source.indexOf('async function classifyGenreHint(', start);

function caller(payload, statusCode = 200) {
  const context = { Buffer, AbortController, Date, setTimeout, clearTimeout, console: { error: () => {} }, PORT: 3000, DYNAMIC_PROMPT_MARKER: 'test', resolveModelForUser: () => 'test-model', safeJsonParse: value => { try { return JSON.parse(value); } catch (_) { return null; } }, extractJsonFromMixedText: () => null, dissectionStreamText: value => value.content || '', requestError: (status, message) => Object.assign(new Error(message), { status }), recordModelUsage: () => {}, http: { request: (options, callback) => {
    const request = new EventEmitter(); request.destroy = error => request.emit('error', error);
    request.end = () => queueMicrotask(() => { const response = new PassThrough(); response.statusCode = statusCode; callback(response); for (const byte of Buffer.from(payload, 'utf8')) response.write(Buffer.from([byte])); response.end(); }); return request;
  } } };
  vm.createContext(context); vm.runInContext(source.slice(start, end), context);
  return options => context.callMolanChat('Bearer test-only', { email: 'test@example.com' }, options);
}

test('内部SSE调用遇到逐字节网络分块仍保留中文、引号和emoji', async () => {
  const text = '“步枪连它头骨都打不穿。”这是完整原句。🌙';
  const call = caller('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: [DONE]\n\n');
  const output = await call({ system: '测试', userPrompt: '测试', maxTokens: 100 }); assert.equal(output.text, text); assert.ok(!output.text.includes('\uFFFD'));
});
test('内部非SSE JSON响应的中文跨块不会损坏', async () => {
  const text = JSON.stringify({ evidence: '不把猜测当成事实，保留全部原文。' });
  const output = await caller(JSON.stringify({ choices: [{ message: { content: text } }] }))({ jsonMode: true }); assert.equal(output.json.evidence, '不把猜测当成事实，保留全部原文。');
});
test('错误响应的跨块中文保持准确，余额不足仍可识别', async () => {
  const call = caller(JSON.stringify({ error: '余额不足，请核对账户。' }), 402);
  await assert.rejects(call({}), error => error.status === 402 && error.code === 'upstream_balance_exhausted' && error.message.includes('余额不足，请核对账户。'));
});

test('内部服务显式报告 Provider 未知结果时保留未知状态', async () => {
  const call = caller(JSON.stringify({ error: '上游结果未知', code: 'PROVIDER_UNKNOWN', unknown: true }), 409);
  await assert.rejects(call({}), error => error.status === 409 && error.code === 'PROVIDER_UNKNOWN' && error.unknown === true);
});
