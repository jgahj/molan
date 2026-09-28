const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const completionEditorSource = fs.readFileSync(path.join(__dirname, '..', 'completion-editor.js'), 'utf8');

test('server implements SSE keep-alive heartbeats for cloud proxy and direct chat', () => {
  assert.ok(serverSource.includes("': keep-alive\\n\\n'"), 'Cloud proxy must send SSE keep-alive heartbeat');
  assert.ok(serverSource.includes('keepAlive: true, timeout: 300000'), 'Cloud proxy must use persistent http(s) Agent with keepAlive');
  assert.ok(serverSource.includes("': ping\\n\\n'"), 'Chat stream must send periodic ping comment during reasoning/idle');
  assert.ok(serverSource.includes('cleanupKeepAlive()'), 'Chat stream must clean up heartbeat timer on close/end');
});

test('server bounds stalled and oversized upstream chat streams', () => {
  assert.match(serverSource, /UPSTREAM_TOTAL_TIMEOUT_MS/);
  assert.match(serverSource, /requestDeadlineTimer\s*=\s*setTimeout/);
  assert.match(serverSource, /cleanupRequestDeadline\(\);/);
  assert.match(serverSource, /UPSTREAM_MAX_RESPONSE_BYTES/);
  assert.match(serverSource, /UPSTREAM_SSE_BUFFER_BYTES/);
  assert.match(serverSource, /abortUpstreamRequest\('upstream_timeout'/);
  assert.match(serverSource, /qualityScanText/);
});

test('PostgreSQL token ledger notifications do not rebuild the full runtime mirror', () => {
  assert.match(serverSource, /token-reserved/);
  assert.match(serverSource, /token-settled/);
  assert.match(serverSource, /token-recorded/);
  assert.match(serverSource, /token-stale-released/);
  assert.match(serverSource, /if\s*\(new Set\(\[[\s\S]*?token-reserved[\s\S]*?\)\.has\(kind\)\)\s*return/);
});

test('index.html requestChatText catches stream read errors and preserves partialText', () => {
  const fnStart = indexSource.indexOf('async function requestChatText');
  const fnEnd = indexSource.indexOf('async function requestEditorAnswer', fnStart);
  assert.ok(fnStart >= 0 && fnEnd > fnStart);
  const fnSource = indexSource.slice(fnStart, fnEnd);

  assert.match(fnSource, /try\s*\{\s*readResult\s*=\s*await\s+reader\.read\(\)/, 'reader.read must be guarded with try-catch');
  assert.match(fnSource, /NETWORK_INTERRUPTED/, 'Network interrupted error code must be emitted');
  assert.match(fnSource, /网络连接中断，已保留当前已生成正文/, 'Friendly Chinese message must be displayed on stream disruption');
  assert.match(fnSource, /streamErr\.partialText\s*=\s*answer/, 'Partial text must be captured on stream error');
});

test('completion-editor.js handles failed and interrupted states with partialText preservation and retry', () => {
  assert.match(completionEditorSource, /failed:\s*'生成未完成'/, 'workflowLabels must map failed to Chinese');
  assert.match(completionEditorSource, /interrupted:\s*'网络连接中断'/, 'workflowLabels must map interrupted to Chinese');
  assert.match(completionEditorSource, /data-completion-ai-retry/, 'renderEditorChat must render retry button');
  assert.match(completionEditorSource, /item\.status === 'interrupted'/, 'interrupted status badge must be handled');

  const sendStart = completionEditorSource.indexOf('async function sendEditorAI()');
  const sendEnd = completionEditorSource.indexOf('\n  function resultAt(', sendStart);
  assert.ok(sendStart >= 0 && sendEnd > sendStart);
  const sendSource = completionEditorSource.slice(sendStart, sendEnd);

  assert.match(sendSource, /if\s*\(partialText\)\s*\{[\s\S]*?text:\s*partialText[\s\S]*?workflowStage:\s*'needs_review'[\s\S]*?status:\s*'needs_review'[\s\S]*?retryPrompt:\s*prompt/, 'sendEditorAI must preserve partialText, block adoption and retain the explicit retry prompt');
  assert.match(completionEditorSource, /const aiRetry = event\.target\.closest\('\[data-completion-ai-retry\]'\)/, 'Event delegation must listen for retry button clicks');
});
