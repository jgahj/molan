'use strict';

const workflow = require('./memory-workflow');

function drain(db, limit = 8) {
  const groups = db.prepare(`SELECT book_id, branch_id, MIN(created_at) AS queued_at FROM memory_outbox
    WHERE status = 'queued' GROUP BY book_id, branch_id ORDER BY queued_at LIMIT ?`).all(limit);
  const results = [];
  for (const group of groups) {
    try {
      const result = workflow.processProjections(db, group.book_id, group.branch_id);
      if (result.status === 'PROJECTION_DRIFT') {
        db.prepare(`UPDATE memory_outbox SET status = 'failed', last_error = 'PROJECTION_DRIFT', updated_at = ?
          WHERE book_id = ? AND branch_id = ? AND status = 'queued'`).run(Date.now(), group.book_id, group.branch_id);
      }
      results.push(result);
    } catch (error) {
      db.prepare(`UPDATE memory_outbox SET status = CASE WHEN attempt_count + 1 >= 5 THEN 'failed' ELSE 'queued' END,
        attempt_count = attempt_count + 1, last_error = ?, updated_at = ?
        WHERE book_id = ? AND branch_id = ? AND status = 'queued'`)
        .run(error.code || 'PROJECTION_WRITE_FAILED', Date.now(), group.book_id, group.branch_id);
      results.push({ bookId: group.book_id, branchId: group.branch_id, status: 'PROJECTION_FAILED' });
    }
  }
  return results;
}

function start(db) {
  const timer = setInterval(() => {
    try { drain(db); } catch (_) {}
  }, 2000);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { drain, start };
