'use strict';

const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const store = require('../../../lib/generation/sqlite-store');

function createRun(db, id, now = 5000) {
  return store.createRun(db, {
    id, workspaceId: 'ws-1', projectId: 'project-1', actorUserId: 'user-1', chapterId: 'chapter-1',
    idempotencyKey: `key-${id}`, requestHash: `hash-${id}`, request: {}, now
  });
}

test('SQLite stage summaries and event sequences are transactional and fenced by the current lease', () => {
  const db = new DatabaseSync(':memory:');
  try {
    store.ensureSqliteSchema(db);
    createRun(db, 'run-1');
    const owner = 'worker-1';
    const lease = store.acquireLease(db, {
      id: 'run-1', workspaceId: 'ws-1', projectId: 'project-1', actorUserId: 'user-1',
      leaseOwner: owner, ttlMs: 15000, now: 6000
    });
    assert.equal(lease.acquired, true);
    const scope = {
      id: 'run-1', generationId: 'run-1', workspaceId: 'ws-1', projectId: 'project-1', actorUserId: 'user-1',
      leaseOwner: owner, fencingToken: lease.fencingToken
    };

    store.recordStage(db, {
      ...scope, stage: 'writer', status: 'completed', reservedCostMinor: 20, actualCostMinor: 10,
      startedAt: 6500, finishedAt: 7000, now: 7000
    });
    const costs = db.prepare('SELECT reserved_cost_minor, actual_cost_minor FROM generation_runs WHERE id = ?').get('run-1');
    assert.equal(Number(costs.reserved_cost_minor), 20);
    assert.equal(Number(costs.actual_cost_minor), 10);

    const first = store.appendEvent(db, { ...scope, now: 8000, event: { message: 'progress-1' } });
    const second = store.appendEvent(db, { ...scope, now: 8001, event: { message: 'progress-2' } });
    assert.equal(first.sequence, 2);
    assert.equal(second.sequence, 3);

    assert.throws(() => store.appendEvent(db, {
      ...scope, fencingToken: lease.fencingToken - 1, now: 9000, event: { message: 'stale' }
    }), { code: 'RUN_NOT_FOUND' });
    assert.equal(Number(db.prepare('SELECT count(*) AS count FROM generation_run_events WHERE generation_id = ?').get('run-1').count), 3);

    assert.throws(() => store.recordStage(db, {
      ...scope, stage: 'late', status: 'completed', startedAt: 10000, finishedAt: 15000, now: 22000
    }), { code: 'RUN_NOT_FOUND' });
    assert.equal(Number(db.prepare('SELECT count(*) AS count FROM generation_stage_runs WHERE generation_id = ?').get('run-1').count), 1);
  } finally {
    db.close();
  }
});

test('SQLite rolls back a stage insert when the run summary update fails', () => {
  const db = new DatabaseSync(':memory:');
  try {
    store.ensureSqliteSchema(db);
    createRun(db, 'run-2');
    db.exec(`CREATE TRIGGER reject_generation_cost BEFORE UPDATE ON generation_runs
      WHEN NEW.actual_cost_minor > 0 BEGIN SELECT RAISE(ABORT, 'test failure'); END`);
    assert.throws(() => store.recordStage(db, {
      id: 'run-2', generationId: 'run-2', workspaceId: 'ws-1', projectId: 'project-1', actorUserId: 'user-1',
      stage: 'writer', status: 'completed', actualCostMinor: 10, startedAt: 1, finishedAt: 2, now: 2
    }), /test failure/);
    assert.equal(Number(db.prepare('SELECT count(*) AS count FROM generation_stage_runs WHERE generation_id = ?').get('run-2').count), 0);
    assert.equal(Number(db.prepare('SELECT actual_cost_minor FROM generation_runs WHERE id = ?').get('run-2').actual_cost_minor), 0);
  } finally {
    db.close();
  }
});
