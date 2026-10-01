const test = require('node:test');
const assert = require('node:assert/strict');
const review = require('../../../lib/evidence-review');
const content = '用于核验旧库提交回执的完整正文与不可变内容哈希。';

test('提交凭证随事务回滚，已提交结果可恢复债务且不重复登记', (t) => {
  let sqlite;
  try {
    sqlite = require('node:sqlite');
  } catch {
    if (t && typeof t.skip === 'function') {
      t.skip('node:sqlite 不可用，跳过该测试');
      return;
    }
  }
  const { DatabaseSync } = sqlite;
  const commits = require('../../../lib/benchmark-commit');
  const database = new DatabaseSync(':memory:');
  try {
    commits.initializeCommitReceipts(database);
    const entry = { snapshotId: 'snapshot-1', bookId: 'book-1', chapterNo: 1, stateVersion: 1, contentHash: review.textHash(content), content, ledgerDelta: { newPromises: [] } };
    database.exec('BEGIN');
    commits.saveCommitReceipt(database, entry);
    database.exec('ROLLBACK');
    assert.equal(commits.replayCommit(database, entry.bookId, entry, () => {}), null);
    commits.saveCommitReceipt(database, entry);
    let calls = 0;
    const pending = commits.replayCommit(database, entry.bookId, entry, () => { calls++; throw new Error('disk unavailable'); });
    assert.equal(pending.ok, true);
    assert.equal(pending.debtStatus, 'pending_recovery');
    assert.equal(commits.replayCommit(database, entry.bookId, { ...entry, content: content + '改动' }, () => { calls++; }).ok, false);
    assert.deepEqual(commits.recoverPendingCommitDebts(database, 'other-book', () => { calls++; }), { recovered: 0, pending: 0 });
    assert.deepEqual(commits.recoverPendingCommitDebts(database, entry.bookId, () => { calls++; }), { recovered: 1, pending: 0 });
    const recovered = commits.replayCommit(database, entry.bookId, entry, () => { calls++; });
    assert.equal(recovered.replayed, true);
    assert.equal(recovered.debtStatus, 'committed');
    assert.equal(recovered.snapshotId, entry.snapshotId);
    commits.replayCommit(database, entry.bookId, entry, () => { calls++; });
    assert.equal(calls, 2);
  } finally {
    database.close();
  }
});
