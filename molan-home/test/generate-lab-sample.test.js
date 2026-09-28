const test = require('node:test');
const assert = require('node:assert/strict');

const streamOf = packets => packets.map(packet => `data: ${JSON.stringify(packet)}\n\n`).join('');
const content = { choices: [{ delta: { content: '原创章节正文。' } }] };
const completedUsage = { molan_usage: { requestId: 'test-request', modelId: 'test-model', status: 'completed' } };

test('sample SSE parser retains content and actual project usage', async () => {
  const { parseChatStream } = await import('../scripts/generate-lab-sample.mjs');
  const result = parseChatStream(': heartbeat\n\n' + streamOf([content, completedUsage]) + 'data: [DONE]\n\n');
  assert.equal(result.text, '原创章节正文。');
  assert.equal(result.usage.requestId, 'test-request');
  assert.equal(result.usage.modelId, 'test-model');
});

test('sample SSE parser rejects errors, empty output and missing receipts', async () => {
  const { parseChatStream } = await import('../scripts/generate-lab-sample.mjs');
  for (const packets of [
    [content, { error: { message: 'failed' } }],
    [content, { molan_error: { message: 'failed' } }],
    [completedUsage],
    [content],
    [content, { molan_usage: { ...completedUsage.molan_usage, status: 'failed' } }]
  ]) {
    assert.throws(() => parseChatStream(streamOf(packets)));
  }
  assert.throws(() => parseChatStream('data: {broken}\n\n'));
});

test('sample SSE parser rejects truncation and supports CRLF multiline data', async () => {
  const { parseChatStream } = await import('../scripts/generate-lab-sample.mjs');
  assert.throws(() => parseChatStream(streamOf([
    content, { choices: [{ finish_reason: 'length' }] }, completedUsage
  ])));
  assert.throws(() => parseChatStream(streamOf([
    content, { molan_usage: { ...completedUsage.molan_usage, finishReason: 'content_filter' } }
  ])));
  const multiline = 'data: {"choices": [\r\ndata: {"delta": {"content": "正文。"}}]}\r\n\r\n';
  assert.equal(parseChatStream(multiline + streamOf([completedUsage])).text, '正文。');
});

test('sample prompts transfer techniques without source plot and rigid genre rules', async () => {
  const { buildSampleSystem } = await import('../scripts/generate-lab-sample.mjs');
  const { NARRATIVE_ROUTES } = require('../lib/genre-engine');
  for (const route of ['jianzhu', 'yuanshi']) {
    const prepared = NARRATIVE_ROUTES[route].generationPrompt
      + '\n【即时动机与信息差约束（不可违背）】保留动机资产'
      + '\n【极品质感铁律（去匠气与去AI味）】杜绝一切现代公文，纯叙述单句成段严格控制在0至2处';
    const system = buildSampleSystem(prepared, route);
    assert.match(system, /保留动机资产/);
    assert.match(system, /短段本身不是缺陷/);
    assert.doesNotMatch(system, /道祖太极鱼|数码单反|定江府|纯叙述单句成段严格控制/);
    assert.doesNotMatch(system, /杜绝一切现代公文/);
  }
  assert.throws(() => buildSampleSystem('模板未知', 'yuanshi'));
});
