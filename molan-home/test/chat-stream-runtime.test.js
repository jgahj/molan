'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatStreamRuntime } = require('../services/chat-stream-runtime');

test('chat stream callbacks preserve line order, passthrough mode and tail billing marker', () => {
  const lines = [], chunks = [];
  const stream = createChatStreamRuntime({ maxResponseBytes: 100, maxBufferBytes: 100,
    onLimit: () => assert.fail('unexpected limit'), onChunk: chunk => chunks.push(String(chunk)), onLine: (line, tail) => lines.push({ line, tail }) });
  stream.push('data: first', false);
  stream.push('\n\ndata: second', true);
  stream.finish();
  assert.deepEqual(chunks, ['\n\ndata: second']);
  assert.deepEqual(lines.map(item => item.line), ['data: first', '', 'data: second']);
  assert.equal(lines[2].tail, true);
});

test('chat stream limits stop callbacks before forwarding oversized content', () => {
  const limits = [], lines = [], chunks = [];
  const stream = createChatStreamRuntime({ maxResponseBytes: 30, maxBufferBytes: 5,
    onLimit: code => limits.push(code), onChunk: chunk => chunks.push(chunk), onLine: line => lines.push(line) });
  stream.push('123456', true);
  stream.push('\ndata: next', true);
  stream.finish();
  assert.deepEqual(limits, ['upstream_sse_buffer_overflow']);
  assert.deepEqual(chunks, []);
  assert.deepEqual(lines, []);
});
