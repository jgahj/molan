'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const memory = require('../lib/memory-system');

function fixture(context) {
  const db = new DatabaseSync(':memory:');
  context.after(() => db.close());
  memory.initializeSchema(db);
  return db;
}

function proposal(db, overrides = {}) {
  const result = memory.createChangeset(db, {
    bookId: 'book', baseStateVersion: 1,
    operations: [{ type: 'STATE_TRANSITION', payload: { entityId: 'sword', postState: 'sister' } }],
    ...overrides
  });
  memory.approveChangeset(db, 'book', result.id, 'author');
  return result;
}

test('同一分支旧基线只能提交一次，其他分支独立推进', context => {
  const db = fixture(context);
  const first = proposal(db);
  const stale = proposal(db);
  assert.equal(memory.commitChangeset(db, 'book', first.id, 'author').stateVersion, 2);
  assert.equal(memory.commitChangeset(db, 'book', stale.id, 'author').code, 'MEMORY_VERSION_CONFLICT');
  const alternate = proposal(db, { branchId: 'alternate' });
  assert.equal(memory.commitChangeset(db, 'book', alternate.id, 'author').stateVersion, 2);
  assert.equal(db.prepare('SELECT count(*) AS count FROM memory_outbox').get().count, 2);
});

test('审批绑定全部变更，确认后篡改被拒绝', context => {
  const db = fixture(context);
  const candidate = proposal(db);
  db.prepare("UPDATE memory_changesets SET candidate_hash = 'changed' WHERE id = ?").run(candidate.id);
  assert.equal(memory.commitChangeset(db, 'book', candidate.id, 'author').code, 'APPROVAL_STALE');
  assert.equal(db.prepare('SELECT count(*) AS count FROM state_transitions').get().count, 0);
});

test('幂等回执可恢复，同键不同请求拒绝', context => {
  const db = fixture(context);
  const first = proposal(db);
  const options = { idempotencyKey: 'request-1' };
  const receipt = memory.commitChangeset(db, 'book', first.id, 'author', options);
  const replay = memory.commitChangeset(db, 'book', first.id, 'author', options);
  assert.deepEqual(replay, { ...receipt, replayed: true });
  const second = proposal(db, { baseStateVersion: 2 });
  assert.equal(memory.commitChangeset(db, 'book', second.id, 'author', options).code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(memory.commitChangeset(db, 'book', first.id, 'author', { idempotencyKey: 'alias' }).replayed, true);
  assert.equal(memory.commitChangeset(db, 'book', second.id, 'author', { idempotencyKey: 'alias' }).code, 'IDEMPOTENCY_CONFLICT');
});

test('未知操作与未满足依赖不能被静默提交', context => {
  const db = fixture(context);
  const unknown = proposal(db, { operations: [{ type: 'DELETE_ALL', payload: {} }] });
  assert.equal(memory.commitChangeset(db, 'book', unknown.id, 'author').code, 'INVALID_MEMORY_OPERATION');
  const dependent = proposal(db, { dependencies: ['missing'] });
  assert.equal(memory.commitChangeset(db, 'book', dependent.id, 'author').code, 'CHANGESET_DEPENDENCY_MISSING');
});

test('正式事实不可跨作品引用命题', context => {
  const db = fixture(context);
  db.prepare("INSERT INTO memory_propositions (id, book_id, created_at) VALUES ('secret', 'other', 1)").run();
  const candidate = proposal(db, {
    operations: [{ type: 'INSERT_FACT', payload: { propositionId: 'secret' } }]
  });
  assert.equal(memory.commitChangeset(db, 'book', candidate.id, 'author').code, 'MEMORY_REFERENCE_INVALID');
  assert.equal(db.prepare('SELECT count(*) AS count FROM world_fact_decisions').get().count, 0);
});

test('数据库中途失败回滚记忆、版本、回执和outbox', context => {
  const db = fixture(context);
  const candidate = proposal(db);
  db.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON memory_outbox BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
  assert.throws(() => memory.commitChangeset(db, 'book', candidate.id, 'author'), /fixture failure/);
  assert.equal(db.prepare('SELECT count(*) AS count FROM state_transitions').get().count, 0);
  assert.equal(db.prepare('SELECT count(*) AS count FROM memory_commit_receipts').get().count, 0);
  assert.equal(db.prepare('SELECT count(*) AS count FROM memory_branch_heads').get().count, 0);
  assert.equal(db.prepare('SELECT count(*) AS count FROM memory_operations_log').get().count, 0);
  assert.equal(db.prepare('SELECT committed_at FROM memory_changesets WHERE id = ?').get(candidate.id).committed_at, null);
  db.exec('DROP TRIGGER fail_outbox');
  assert.equal(memory.commitChangeset(db, 'book', candidate.id, 'author').stateVersion, 2);
});

test('自动生成ID必须写入流水，重复ID不覆盖已确认历史', context => {
  const db = fixture(context);
  db.prepare("INSERT INTO memory_propositions (id, book_id, created_at) VALUES ('truth', 'book', 1)").run();
  const candidate = proposal(db, { operations: [{ type: 'INSERT_FACT', payload: { propositionId: 'truth' } }] });
  assert.equal(memory.commitChangeset(db, 'book', candidate.id, 'author').ok, true);
  const log = db.prepare('SELECT * FROM memory_operations_log WHERE changeset_id = ?').get(candidate.id);
  assert.ok(log.record_id);
  assert.equal(db.prepare('SELECT id FROM world_fact_decisions WHERE id = ?').get(log.record_id).id, log.record_id);
  const replacement = proposal(db, {
    baseStateVersion: 2,
    operations: [{ type: 'INSERT_FACT', payload: { id: log.record_id, propositionId: 'truth', verdict: 'false' } }]
  });
  assert.equal(memory.commitChangeset(db, 'book', replacement.id, 'author').code, 'MEMORY_RECORD_EXISTS');
  assert.equal(db.prepare('SELECT verdict FROM world_fact_decisions WHERE id = ?').get(log.record_id).verdict, 'true');
});

test('重复初始化保留版本，提交后重审批和变更请求被拒绝', context => {
  const db = fixture(context);
  const candidate = proposal(db);
  assert.equal(memory.commitChangeset(db, 'book', candidate.id, 'author').ok, true);
  memory.initializeSchema(db);
  assert.equal(memory.approveChangeset(db, 'book', candidate.id, 'author').code, 'CHANGESET_ALREADY_COMMITTED');
  assert.equal(memory.commitChangeset(db, 'book', candidate.id, 'author', {
    idempotencyKey: 'new-key', candidateHash: 'changed'
  }).code, 'IDEMPOTENCY_CONFLICT');
  const next = proposal(db, { baseStateVersion: 2 });
  assert.equal(memory.commitChangeset(db, 'book', next.id, 'author').stateVersion, 3);
});

test('同作品其他分支的命题不能被正式引用', context => {
  const db = fixture(context);
  db.prepare("INSERT INTO memory_propositions (id, book_id, branch_id, created_at) VALUES ('parallel', 'book', 'other', 1)").run();
  const candidate = proposal(db, {
    operations: [{ type: 'INSERT_COGNITION', payload: { targetExpressionId: 'parallel', holderEntityId: 'hero' } }]
  });
  assert.equal(memory.commitChangeset(db, 'book', candidate.id, 'author').code, 'MEMORY_REFERENCE_INVALID');
});
