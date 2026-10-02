'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { createPostgresRepository, readConfig, internalUuid } = require('../lib/postgres-repository');

test('real isolated PG dissection lease: competing instances, stale writes, renewal and recovery', {
  skip: process.env.MOLAN_PG_LEASE_ACCEPTANCE !== '1', timeout: 20000
}, async () => {
  const settings = readConfig();
  assert.ok(settings.enabled && /test|acceptance/i.test(settings.config.database || ''));
  const first = createPostgresRepository();
  const second = createPostgresRepository();
  const pool = new Pool(settings.config);
  const suffix = crypto.randomBytes(12).toString('hex');
  const actor = 'lease_' + suffix;
  const task = { id: 'd_lease_' + suffix, ownerUserId: actor, userEmail: `${actor}@example.test`,
    title: '合成租约验收', status: 'queued', sourceText: '合成正文', result: {}, meta: {}, actualCredits: null };
  const child = { dissectionId: task.id, rowKey: 'unit_' + suffix, sourceTable: 'dissection_units',
    document: { id: 'unit_' + suffix, dissection_id: task.id } };
  try {
    await Promise.all([first.initialize(), second.initialize()]);
    await first.runtimeRegisterAccount({ userId: actor, email: task.userEmail, name: '租约验收' });
    await first.runtimeInsertDissection(task);
    const claims = await Promise.all([
      first.runtimeClaimDissectionWorker(actor, task.id, 'first-' + suffix),
      second.runtimeClaimDissectionWorker(actor, task.id, 'second-' + suffix)
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    const lease = claims.find(Boolean);
    const winner = claims[0] ? first : second;
    const loser = claims[0] ? second : first;
    const otherTask = { ...task, id: task.id + '_other' };
    await loser.runtimeInsertDissection(otherTask);
    assert.equal(await loser.runtimeClaimDissectionWorker(actor, otherTask.id, 'same-owner-other'), null);
    await assert.rejects(loser.runtimeUpsertDissectionRows(actor, [child]),
      error => error.code === 'revision_conflict');
    await winner.withDissectionWorkerLease(lease, async () => {
      assert.equal(await winner.runtimeRenewDissectionWorker(lease), true);
      await winner.runtimeUpsertDissectionRows(actor, [child]);
      await winner.runtimeUpdateDissection({ ...task, status: 'running' });
    });
    await loser.runtimeRecoverExpiredDissectionWorkers();
    assert.equal((await loser.runtimeGetDissection(actor, task.id)).worker_id, lease.workerId);
    const cancelled = await loser.runtimeRequestDissectionCancel(actor, task.id);
    await loser.runtimeRequeueDissection(actor, task.id, {
      expectedRevision: Number(cancelled.revision), phaseIndex: 0, phase: 'characters', progress: 0
    });
    await assert.rejects(winner.withDissectionWorkerLease(lease,
      () => winner.runtimeUpsertDissectionRows(actor, [{ ...child, document: { stale: true } }])),
    error => error.code === 'revision_conflict');
    await assert.rejects(winner.withDissectionWorkerLease(lease,
      () => winner.runtimeUpdateDissection({ ...task, status: 'running' })),
    error => error.code === 'revision_conflict');
    await assert.rejects(winner.withDissectionWorkerLease(lease,
      () => winner.runtimeGetDissection(actor, task.id)),
    error => error.code === 'worker_lease_lost');
    const nextLease = await loser.runtimeClaimDissectionWorker(actor, task.id, 'new-' + suffix);
    assert.ok(nextLease.fence > lease.fence);
    await winner.runtimeReleaseDissectionWorker(lease);
    assert.equal((await loser.runtimeGetDissection(actor, task.id)).worker_id, nextLease.workerId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE novel_app');
      await client.query("SELECT set_config('app.user_id', $1, true)", [internalUuid(actor)]);
      await client.query("UPDATE luna.runtime_dissections SET worker_lease_until = clock_timestamp() - interval '1 second' WHERE id = $1", [task.id]);
      await client.query('COMMIT');
    } finally { client.release(); }
    assert.equal(await loser.runtimeRenewDissectionWorker(nextLease), false);
    await loser.runtimeRecoverExpiredDissectionWorkers();
    const recovered = await loser.runtimeGetDissection(actor, task.id);
    assert.equal(recovered.status, 'interrupted');
    assert.equal(recovered.worker_id, '');
    assert.ok(Number(recovered.worker_fence) > nextLease.fence);
    assert.equal(await loser.runtimeClaimDissectionWorker(actor, task.id, 'no-auto-retry'), null);
    assert.equal((await loser.runtimeListDissectionRows(actor, task.id, 'dissection_units'))[0].document.stale, undefined);
  } finally {
    await Promise.all([first.close(), second.close(), pool.end()]);
  }
});
