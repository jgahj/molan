'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createReadingLab } = require('../lib/xuanhuan-reading');

test('reading PG request recovers each authenticated actor once and ignores body actor', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-pg-actor-'));
  const recovered = [], listed = [], loaded = [];
  let initialization;
  const repository = { init: async input => { initialization = input; },
    recoverScoped: async input => recovered.push(input),
    list: async input => { listed.push(input); return []; },
    load: async input => { loaded.push(input); return null; } };
  const lab = createReadingLab({ dataDir: directory, repository,
    getAuthUser: async req => ({ token: 'token', user: { email: 'owner@example.test', userId: req.actor } }),
    readBody: async req => req.body, json: (_res, status, body) => ({ status, body }) });
  t.after(async () => { await lab.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const req = { url: '/api/xuanhuan-reading/jobs', method: 'GET', actor: 'trusted', body: { actorUserId: 'forged' } };
  assert.equal((await lab.handle(req, {})).status, 200);
  assert.equal((await lab.handle(req, {})).status, 200);
  assert.equal(initialization.recover, false);
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].actorUserId, 'trusted');
  assert.ok(listed.every(input => input.actorUserId === 'trusted'));
  await lab.handle({ ...req, url: '/api/xuanhuan-reading/jobs/aaaa', actor: 'second' }, {});
  assert.equal(recovered.length, 2);
  assert.equal(loaded[0].actorUserId, 'second');
});
