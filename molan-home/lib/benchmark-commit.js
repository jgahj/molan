'use strict';

const { textHash } = require('./evidence-review');

/** 正式提交只能使用同一正文的完整服务端审计，客户端 passed 声明不能替代证据。 */
function validateCommitAudit(record, body) {
  if (!record) return { ok: false, code: 'audit_missing' };
  if (typeof body.content !== 'string' || !body.content.trim() || body.contentHash !== textHash(body.content)) return { ok: false, code: 'content_hash_invalid' };
  if (record.content_hash !== body.contentHash) return { ok: false, code: 'audit_content_changed' };
  let audit;
  try { audit = JSON.parse(record.result_json); } catch (_) { return { ok: false, code: 'audit_evidence_missing' }; }
  if (record.passed !== 1 || audit.protocol !== 'benchmark-local-v2' || audit.passed !== true || audit.contentHash !== body.contentHash || audit.semanticAudit?.passed !== true || audit.semanticAudit?.status !== 'passed') return { ok: false, code: 'audit_blocked' };
  return { ok: true, audit };
}

/** 在同一 SQLite 事务内保存提交凭证和待登记债务，支持断连后安全恢复。 */
function initializeCommitReceipts(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS benchmark_commit_receipts (
    snapshot_id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    chapter_no INTEGER NOT NULL,
    state_version INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    content TEXT NOT NULL,
    ledger_json TEXT NOT NULL,
    debt_status TEXT NOT NULL DEFAULT 'pending_recovery',
    UNIQUE(book_id, chapter_no)
  )`);
}

function saveCommitReceipt(database, entry) {
  database.prepare('INSERT INTO benchmark_commit_receipts (snapshot_id,book_id,chapter_no,state_version,content_hash,content,ledger_json) VALUES (?,?,?,?,?,?,?)')
    .run(entry.snapshotId, entry.bookId, entry.chapterNo, entry.stateVersion, entry.contentHash, entry.content, JSON.stringify(entry.ledgerDelta || {}));
}

/** 债务写入按种子幂等；失败保留待恢复状态，不回滚已提交正文和快照。 */
function finishCommitReceipt(database, receipt, recordDebts) {
  if (receipt.debt_status === 'committed') return 'committed';
  try {
    recordDebts(receipt.book_id, receipt.chapter_no, receipt.content, JSON.parse(receipt.ledger_json));
    database.prepare("UPDATE benchmark_commit_receipts SET debt_status = 'committed' WHERE snapshot_id = ?").run(receipt.snapshot_id);
    return 'committed';
  } catch (_) {
    return 'pending_recovery';
  }
}

function replayCommit(database, bookId, body, recordDebts) {
  const receipt = database.prepare('SELECT * FROM benchmark_commit_receipts WHERE book_id = ? AND chapter_no = ?').get(bookId, body.chapterNo);
  if (!receipt) return null;
  if (typeof body.content !== 'string' || body.contentHash !== textHash(body.content) || receipt.content_hash !== body.contentHash) {
    return { ok: false, code: 'committed_content_conflict' };
  }
  const debtStatus = finishCommitReceipt(database, receipt, recordDebts);
  return { ok: true, replayed: true, snapshotId: receipt.snapshot_id, stateVersion: receipt.state_version, debtStatus };
}

/** 读取已提交债务前重放待恢复记录，不触发推理、不改变正文或章节版本。 */
function recoverPendingCommitDebts(database, bookId, recordDebts) {
  const pending = database.prepare("SELECT * FROM benchmark_commit_receipts WHERE book_id = ? AND debt_status = 'pending_recovery' ORDER BY chapter_no").all(bookId);
  let recovered = 0;
  for (const receipt of pending) if (finishCommitReceipt(database, receipt, recordDebts) === 'committed') recovered += 1;
  return { recovered, pending: pending.length - recovered };
}

module.exports = { validateCommitAudit, initializeCommitReceipts, saveCommitReceipt, finishCommitReceipt, replayCommit, recoverPendingCommitDebts };
