'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createLab } = require('../lib/xuanhuan-lab');
const { createPostgresRepository } = require('../lib/postgres-repository');
const { PostgresLabJobRepository } = require('../lib/repositories/postgres-lab-job-repository');

test('live PostgreSQL blind lab serves owner-scoped reads over HTTP', { skip: process.env.MOLAN_LAB_PG_LIVE_TEST !== '1' }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-pg-blind-http-'));
  const labDir = path.join(directory, 'xuanhuan-lab');
  fs.mkdirSync(labDir);
  const holdouts = Array.from({ length: 6 }, (_, index) => ({ id: `holdout-${index + 1}`, bookId: `book-${index + 1}`,
    title: `Holdout ${index + 1}`, chapter: 'Chapter 1', split: 'holdout', text: `独立留出测试片段${index + 1}。`.repeat(40), functions: ['交易'] }));
  fs.writeFileSync(path.join(labDir, 'corpus.json'), JSON.stringify({ version: 'pg-smoke', splitPolicy: 'smoke',
    books: [{ title: 'Reference', split: 'reference' }, ...holdouts.map(scene => ({ title: scene.title, split: 'holdout' }))],
    scenes: [{ id: 'reference', bookId: 'reference', split: 'reference', text: '参考测试片段。'.repeat(40), functions: ['交易'] }, ...holdouts] }));
  const postgres = createPostgresRepository({ env: process.env });
  const repository = new PostgresLabJobRepository(postgres);
  const owner = `blind-http-${require('node:crypto').randomUUID()}@example.test`;
  const actorUserId = `blind-http-${require('node:crypto').randomUUID()}`;
  const lab = createLab({ dataDir: directory, repository,
    getAuthUser: async () => ({ token: 'smoke-token', user: { email: owner, userId: actorUserId } }),
    readBody: async req => req.body || {},
    json: (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); } });
  const server = http.createServer((req, res) => void lab.handle(req, res));
  t.after(async () => {
    await new Promise(resolve => server.listening ? server.close(resolve) : resolve());
    await lab.close();
    await postgres.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/xuanhuan-lab`;
  const jobs = await fetch(`${base}/jobs`);
  assert.equal(jobs.status, 200);
  assert.deepEqual((await jobs.json()).jobs, []);
  const benchmarks = await fetch(`${base}/benchmarks`);
  assert.equal(benchmarks.status, 200);
  const result = await benchmarks.json();
  assert.equal(result.samples.length, 6);
  assert.equal(result.finished, false);
});
