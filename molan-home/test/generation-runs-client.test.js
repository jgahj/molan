'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGenerationRunClient } = require('../lib/client/generation-runs');

test('Generation Run create sends a stable idempotency key in header and request body', async () => {
  const calls = [];
  const client = createGenerationRunClient({ request: async (...args) => { calls.push(args); return { ok: true }; } });
  const body = { projectId: 'book-1', chapterId: 'chapter-1', userInstruction: '写一章' };
  await client.create(body, 'stable-key-123');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/generation-runs');
  assert.equal(calls[0][1].headers['Idempotency-Key'], 'stable-key-123');
  assert.deepEqual(calls[0][1].body, { ...body, idempotencyKey: 'stable-key-123' });
});

test('observe drains event pages in order and returns the authoritative author-confirmation state', async () => {
  const calls = [];
  const states = [
    { state: 'generating', result: {} },
    { state: 'waiting_author', result: { draft: '审计通过正文', outputHash: 'sha256:1' } }
  ];
  const pages = [
    { events: [{ sequence: 1, state: 'created' }, { sequence: 2, state: 'generating' }], hasMore: true },
    { events: [{ sequence: 3, state: 'waiting_author' }], hasMore: false }
  ];
  const client = createGenerationRunClient({
    wait: async () => {},
    request: async (path, options) => {
      calls.push({ path, options });
      if (path.includes('/events')) return pages.shift();
      if (path.endsWith('/run-1')) return { run: states.shift(), stages: [] };
      throw new Error('unexpected request');
    }
  });
  const received = [];
  const result = await client.observe('run-1', { onEvent: event => received.push(event.sequence) });
  assert.deepEqual(received, [1, 2, 3]);
  assert.equal(result.outcome, 'waiting_author');
  assert.equal(result.run.result.outputHash, 'sha256:1');
  assert.equal(result.cursor, 3);
  assert.deepEqual(calls.filter(call => call.path.includes('/events')).map(call => call.path), [
    '/api/generation-runs/run-1/events?after=0&limit=100',
    '/api/generation-runs/run-1/events?after=2&limit=100'
  ]);
});

test('event transport failure queries the run and stops on provider_unknown without retrying generation', async () => {
  const calls = [];
  const client = createGenerationRunClient({
    wait: async () => {},
    request: async (path, options) => {
      calls.push({ path, options });
      if (path.includes('/events')) throw new Error('event connection dropped');
      if (path.endsWith('/run-2')) return { run: { id: 'run-2', state: 'provider_unknown', result: {} }, stages: [] };
      throw new Error('unknown calls must stop');
    }
  });
  const result = await client.observe('run-2');
  assert.equal(result.outcome, 'provider_unknown');
  assert.equal(calls.length, 2);
  assert.match(calls[0].path, /\/events\?/);
  assert.equal(calls[1].path, '/api/generation-runs/run-2');
  assert.equal(calls.some(call => call.options && call.options.method === 'POST'), false);
});

test('revision, cancellation, and commit use distinct run routes and preserve CAS/hash fields', async () => {
  const calls = [];
  const client = createGenerationRunClient({ request: async (...args) => { calls.push(args); return { ok: true }; } });
  const revision = { issueId: 'issue-1', baseHash: 'before-hash', outputHash: 'current-output-hash', quote: '旧句', replacementWindow: { before: '', target: '旧句', after: '' } };
  const commit = { projectId: 'book-1', payload: { creationBookId: 'creation-1' }, baseStateVersion: 7, expectedRevision: 12, text: '审计通过正文', outputHash: 'output-hash' };
  await client.revise('run-3', revision);
  await client.cancel('run-3');
  await client.commit('run-3', commit);
  assert.equal(calls[0][0], '/api/generation-runs/run-3/revision');
  assert.deepEqual(calls[0][1].body, revision);
  assert.equal(calls[0][1].body.outputHash, 'current-output-hash');
  assert.equal(calls[1][0], '/api/generation-runs/run-3/cancel');
  assert.equal(calls[2][0], '/api/generation-runs/run-3/commit');
  assert.deepEqual(calls[2][1].body, commit);
});
